import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { paperSimulationInputSnapshotSchema, type PaperSimulationInputSnapshot } from "../domain/paperSimulationInputSnapshot.js";
import { PAPER_SIMULATION_ID_PATTERN, paperSimulationObservationEventSchema, parsePaperSimulationObservation } from "../domain/paperSimulationObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { maskObject } from "../security/masking.js";
import { containsReplaySourceCredential } from "../security/replaySourceText.js";
import { assertExperimentPath, hasFsCode, readExperimentFile, writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";
import { PAPER_SIMULATION_RUNTIME_FILE, paperSimulationCanonicalRecordSchema,
  paperSimulationRequestPath, paperSimulationRuntimeNamespaceSchema } from "./paperSimulationRequestStore.js";

export const PAPER_SIMULATION_INPUT_FILE = "paper-simulation-input.json";
const MAX_BYTES = 32_768;
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const recordSchema = z.object({
  schemaVersion: z.literal("paper_simulation_input_provenance.v1"),
  requestedSchemaVersion: z.literal("paper_simulation_requested_config.v1"),
  effectiveSchemaVersion: z.literal("paper_simulation_effective_config.v1"),
  simulationRunId: z.string().regex(PAPER_SIMULATION_ID_PATTERN), batchId: z.string().regex(PAPER_SIMULATION_ID_PATTERN),
  acceptedAt: z.iso.datetime(), canonicalRequestHash: hash, snapshot: z.unknown(), redacted: z.boolean()
}).strict();
const flags = { mode: "paper_only" as const, readOnly: true as const,
  source: "unavailable" as const, childInput: "unavailable" as const,
  initialPortfolio: "unavailable" as const, runtime: "unavailable" as const, dependencies: "unavailable" as const,
  result: "unavailable" as const, comparability: "unavailable" as const };
export type PaperSimulationInputRead = typeof flags & ({ status: "available"; simulationRunId: string;
  batchId: string; acceptedAt: string; schemaVersion: "paper_simulation_input_provenance.v1";
  requestedSchemaVersion: "paper_simulation_requested_config.v1";
  effectiveSchemaVersion: "paper_simulation_effective_config.v1";
  inputProvenanceHash: string; canonicalRequestHash: string; snapshot: PaperSimulationInputSnapshot;
} | { status: "unavailable"; simulationRunId: string; reasonCode: "admission_input_unavailable" });

/** Writer-owned result, not an admission receipt or a public JSON-to-context constructor. */
export type PaperSimulationPersistedInput = Readonly<{
  schemaVersion: "paper_simulation_input_provenance.v1";
  inputProvenanceHash: string;
} & ({ status: "available"; snapshot: PaperSimulationInputSnapshot }
  | { status: "unavailable"; reason: "redacted" })>;

export function paperSimulationInputPath(storage: string, id: string): string {
  return join(dirname(paperSimulationRequestPath(storage, id)), PAPER_SIMULATION_INPUT_FILE);
}

/** Only admission calls this, after exclusive ID reservation and durable canonical request. */
export async function persistPaperSimulationInput(storage: string, id: string, acceptedAt: string,
  canonicalRequestHash: string, value: unknown): Promise<string> {
  return (await persistPaperSimulationInputWithEvidence(storage, id, acceptedAt, canonicalRequestHash, value)).inputProvenanceHash;
}

/** Return only evidence from this actual write; never reread accepted history to issue a context. */
export async function persistPaperSimulationInputWithEvidence(storage: string, id: string, acceptedAt: string,
  canonicalRequestHash: string, value: unknown): Promise<PaperSimulationPersistedInput> {
  const snapshot = paperSimulationInputSnapshotSchema.parse(value);
  const masked = maskObject(snapshot);
  const canonical = paperSimulationCanonicalRecordSchema.parse(JSON.parse(
    await readExperimentFile(paperSimulationRequestPath(storage, id), 16_384)));
  if (canonical.simulationRunId !== id || canonical.batchId !== id || canonical.acceptedAt !== acceptedAt
    || createReplayResearchHash(canonical) !== canonicalRequestHash
    || createReplayResearchHash(canonical.requestedConfig) !== createReplayResearchHash(masked.requestedConfig)) {
    throw new Error("admission input binding mismatch");
  }
  const record = recordSchema.parse({ schemaVersion: "paper_simulation_input_provenance.v1",
    requestedSchemaVersion: "paper_simulation_requested_config.v1", effectiveSchemaVersion: "paper_simulation_effective_config.v1",
    simulationRunId: id, batchId: id, acceptedAt, canonicalRequestHash, snapshot: masked,
    redacted: canonical.redacted || createReplayResearchHash(masked) !== createReplayResearchHash(snapshot) });
  const text = JSON.stringify(record) + "\n";
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("admission input exceeds limit");
  // The frozen v1 grammar bounds all strings/containers before credential inspection. The legacy
  // stored bytes stay unchanged; credentials its masker misses still must never enter new context state.
  const evidence: PaperSimulationPersistedInput = Object.freeze({ schemaVersion: record.schemaVersion,
    inputProvenanceHash: createReplayResearchHash(record),
    ...(record.redacted || containsStoredCredential(masked)
      ? { status: "unavailable" as const, reason: "redacted" as const }
      : { status: "available" as const, snapshot: freezeStoredSnapshot(paperSimulationInputSnapshotSchema.parse(record.snapshot)) }) });
  const path = paperSimulationInputPath(storage, id);
  await writeExclusiveExperimentFile(path, text);
  await syncDirectory(dirname(path));
  return evidence;
}

function containsStoredCredential(value: unknown): boolean {
  if (typeof value === "string") return containsReplaySourceCredential(value);
  return value !== null && typeof value === "object" && Object.values(value).some(containsStoredCredential);
}

function freezeStoredSnapshot<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeStoredSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Internal stored admission evidence, not a public DTO or child/runtime completeness claim. */
export async function readPaperSimulationInput(storage: string, id: string): Promise<PaperSimulationInputRead> {
  const unavailable = { ...flags, status: "unavailable" as const, simulationRunId: id,
    reasonCode: "admission_input_unavailable" as const };
  if (!PAPER_SIMULATION_ID_PATTERN.test(id)) return unavailable;
  const deadline = performance.now() + 1000;
  const checkpoint = () => { if (performance.now() > deadline) throw new Error("admission read limit"); };
  try {
    const path = paperSimulationInputPath(storage, id);
    const observationPath = join(dirname(path), "paper-simulation-observations.jsonl");
    const reads: Array<{ path: string; fingerprint: Stats }> = [];
    const read = async (file: string, limit: number) => {
      checkpoint();
      const before = await lstat(file);
      const text = await readExperimentFile(file, limit, "ARTIFACT_INTEGRITY", checkpoint);
      const after = await lstat(file);
      if (!sameFile(after, before)) throw new Error("admission evidence changed");
      reads.push({ path: file, fingerprint: after }); checkpoint(); return text;
    };
    if (await exists(observationPath + ".paper-log.lock")) return unavailable;
    const record = recordSchema.parse(JSON.parse(await read(path, MAX_BYTES)));
    if (record.simulationRunId !== id || record.batchId !== id || record.redacted) return unavailable;
    const snapshot = paperSimulationInputSnapshotSchema.parse(record.snapshot);
    if (createReplayResearchHash(snapshot) !== createReplayResearchHash(record.snapshot)
      || createReplayResearchHash(maskObject(snapshot)) !== createReplayResearchHash(snapshot)) return unavailable;
    const canonical = paperSimulationCanonicalRecordSchema.parse(JSON.parse(await read(paperSimulationRequestPath(storage, id), 16_384)));
    if (canonical.simulationRunId !== id || canonical.batchId !== id || canonical.acceptedAt !== record.acceptedAt
      || canonical.redacted || createReplayResearchHash(canonical) !== record.canonicalRequestHash
      || createReplayResearchHash(canonical.requestedConfig) !== createReplayResearchHash(snapshot.requestedConfig)) return unavailable;
    const namespace = paperSimulationRuntimeNamespaceSchema.parse(JSON.parse(await read(join(dirname(dirname(path)), PAPER_SIMULATION_RUNTIME_FILE), 2048)));
    // Historical admission values remain observations across Node versions; clone keeps its own current-runtime gate.
    if (namespace.sourceRuntimeId !== canonical.sourceRuntime.sourceRuntimeId) return unavailable;
    const raw = await read(observationPath, 4096);
    const observation = parsePaperSimulationObservation(raw, id);
    if (observation.status !== "available" || observation.acceptedAt !== record.acceptedAt) return unavailable;
    const accepted = paperSimulationObservationEventSchema.parse(JSON.parse(raw.split("\n")[0]!));
    const inputProvenanceHash = createReplayResearchHash(record);
    if (accepted.event !== "accepted" || accepted.canonicalRequestHash !== record.canonicalRequestHash
      || accepted.inputProvenanceHash !== inputProvenanceHash) return unavailable;
    for (const entry of reads) {
      await assertExperimentPath(entry.path, false, checkpoint);
      if (!sameFile(await lstat(entry.path), entry.fingerprint)) return unavailable;
      checkpoint();
    }
    if (await exists(observationPath + ".paper-log.lock")) return unavailable;
    checkpoint();
    return { ...flags, status: "available", simulationRunId: id, batchId: id, acceptedAt: record.acceptedAt,
      schemaVersion: record.schemaVersion, requestedSchemaVersion: record.requestedSchemaVersion,
      effectiveSchemaVersion: record.effectiveSchemaVersion, inputProvenanceHash,
      canonicalRequestHash: record.canonicalRequestHash, snapshot };
  } catch { return unavailable; }
}
function sameFile(current: Stats, before: Stats): boolean {
  return current.isFile() && !current.isSymbolicLink() && current.nlink === 1
    && current.dev === before.dev && current.ino === before.ino && current.size === before.size
    && current.mtimeMs === before.mtimeMs && current.ctimeMs === before.ctimeMs;
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (hasFsCode(error, "ENOENT")) return false; throw error; }
}
async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) {
    if (process.platform === "win32" && hasFsCode(error, "EPERM")) return; throw error;
  }
  try { await handle.sync(); } catch (error) {
    if (!(process.platform === "win32" && hasFsCode(error, "EPERM"))) throw error;
  } finally { await handle.close(); }
}
