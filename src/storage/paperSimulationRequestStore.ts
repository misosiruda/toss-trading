import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";

import { parsePaperSimulationRunConfig, type PaperSimulationRunConfig } from "../api/paperSimulationConfig.js";
import { PAPER_SIMULATION_ID_PATTERN, paperSimulationObservationEventSchema, parsePaperSimulationObservation } from "../domain/paperSimulationObservation.js";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { maskObject } from "../security/masking.js";
import { createBatchReplayRootDirForStorage } from "./artifactPaths.js";
import { assertExperimentPath, hasFsCode, readExperimentFile, writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";

export const PAPER_SIMULATION_REQUEST_FILE = "paper-simulation-request.json";
export const PAPER_SIMULATION_RUNTIME_FILE = "paper-simulation-runtime.json";
const OBSERVATIONS_FILE = "paper-simulation-observations.jsonl";
const MAX_REQUEST_BYTES = 16_384;
const namespaceSchema = z.object({
  schemaVersion: z.literal("paper_simulation_runtime_namespace.v1"), sourceRuntimeId: z.uuid()
}).strict();
const runtimeSchema = z.object({
  schemaVersion: z.literal("paper_simulation_source_runtime.v1"),
  sourceRuntimeId: z.uuid(), nodeVersion: z.string().min(1).max(80),
  executionModelVersion: z.string().min(1).max(80)
}).strict();
const recordSchema = z.object({
  schemaVersion: z.literal("paper_simulation_canonical_request.v1"),
  simulationRunId: z.string().regex(PAPER_SIMULATION_ID_PATTERN),
  batchId: z.string().regex(PAPER_SIMULATION_ID_PATTERN), acceptedAt: z.iso.datetime(),
  sourceRuntime: runtimeSchema, requestedConfig: z.unknown(), redacted: z.boolean()
}).strict();
export interface CanonicalRequestInput { requestedConfig: PaperSimulationRunConfig }
export type PaperSimulationRequestRead = {
  mode: "paper_only"; readOnly: true; status: "available";
  schemaVersion: "paper_simulation_canonical_request.v1";
  simulationRunId: string; batchId: string; acceptedAt: string;
  sourceRuntime: z.infer<typeof runtimeSchema>; canonicalRequestHash: string;
  requestedConfig: PaperSimulationRunConfig;
} | { mode: "paper_only"; readOnly: true; status: "unavailable"; simulationRunId: string; reasonCode: "canonical_request_unavailable" };

export function unavailablePaperSimulationRequest(simulationRunId: string): PaperSimulationRequestRead {
  return { mode: "paper_only", readOnly: true, status: "unavailable", simulationRunId, reasonCode: "canonical_request_unavailable" };
}
function root(storage: string) { return createBatchReplayRootDirForStorage(storage); }
export function paperSimulationRequestPath(storage: string, id: string): string {
  if (!PAPER_SIMULATION_ID_PATTERN.test(id)) throw new Error("invalid paper simulation identity");
  return join(root(storage), id, PAPER_SIMULATION_REQUEST_FILE);
}

/** Called only after exclusive batch reservation; no effective/child request, unknown JSON or secrets. */
export async function persistPaperSimulationRequest(storage: string, id: string, acceptedAt: string, input: CanonicalRequestInput): Promise<string> {
  const runtimePath = join(root(storage), PAPER_SIMULATION_RUNTIME_FILE);
  try {
    await writeExclusiveExperimentFile(runtimePath, JSON.stringify(namespaceSchema.parse({
      schemaVersion: "paper_simulation_runtime_namespace.v1", sourceRuntimeId: randomUUID()
    })) + "\n");
    await syncDirectory(root(storage));
  } catch (error) { if (!hasFsCode(error, "EEXIST")) throw error; }
  const marker = await stableRead(runtimePath, 2048);
  const namespace = namespaceSchema.parse(JSON.parse(marker.text));
  // A competing creator may have written complete bytes but not synced its marker yet.
  await syncExistingFile(runtimePath, marker.fingerprint);
  await syncDirectory(root(storage));
  const runtime = runtimeSchema.parse({ schemaVersion: "paper_simulation_source_runtime.v1",
    sourceRuntimeId: namespace.sourceRuntimeId, nodeVersion: process.version, executionModelVersion: PAPER_EXECUTION_MODEL_VERSION });
  const parsed = parsePaperSimulationRunConfig(input.requestedConfig);
  const masked = maskObject(parsed);
  const record = recordSchema.parse({
    schemaVersion: "paper_simulation_canonical_request.v1", simulationRunId: id, batchId: id,
    acceptedAt, sourceRuntime: runtime, requestedConfig: masked,
    redacted: createReplayResearchHash(masked) !== createReplayResearchHash(parsed)
  });
  const text = JSON.stringify(record) + "\n";
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) throw new Error("canonical request too large");
  await writeExclusiveExperimentFile(paperSimulationRequestPath(storage, id), text);
  await syncDirectory(dirname(paperSimulationRequestPath(storage, id)));
  return createReplayResearchHash(record);
}

/** Bounded exact-ID evidence only. Missing/legacy/corrupt/redacted evidence is never reconstructed. */
export async function readPaperSimulationRequest(storage: string, id: string): Promise<PaperSimulationRequestRead> {
  const unavailable = unavailablePaperSimulationRequest(id);
  if (!PAPER_SIMULATION_ID_PATTERN.test(id)) return unavailable;
  const deadline = performance.now() + 1000;
  const checkpoint = () => { if (performance.now() > deadline) throw new Error("canonical read budget exhausted"); };
  try {
    const requestPath = paperSimulationRequestPath(storage, id);
    const observationPath = join(dirname(requestPath), OBSERVATIONS_FILE);
    const runtimePath = join(root(storage), PAPER_SIMULATION_RUNTIME_FILE);
    const reads: Array<{ path: string; fingerprint: Stats }> = [];
    const read = async (path: string, limit: number) => {
      const value = await stableRead(path, limit, checkpoint);
      reads.push({ path, fingerprint: value.fingerprint }); return value.text;
    };
    if (await exists(observationPath + ".paper-log.lock")) return unavailable;
    const record = recordSchema.parse(JSON.parse(await read(requestPath, MAX_REQUEST_BYTES)));
    if (record.simulationRunId !== id || record.batchId !== id || record.redacted) return unavailable;
    const namespace = namespaceSchema.parse(JSON.parse(await read(runtimePath, 2048)));
    const runtime = record.sourceRuntime;
    if (namespace.sourceRuntimeId !== runtime.sourceRuntimeId
      || runtime.nodeVersion !== process.version || runtime.executionModelVersion !== PAPER_EXECUTION_MODEL_VERSION) return unavailable;
    const requestedConfig = parsePaperSimulationRunConfig(record.requestedConfig);
    // Parsing must not drop unknown properties or restore defaults.
    if (createReplayResearchHash(requestedConfig) !== createReplayResearchHash(record.requestedConfig)
      || createReplayResearchHash(maskObject(requestedConfig)) !== createReplayResearchHash(requestedConfig)) return unavailable;
    const raw = await read(observationPath, 4096);
    const observation = parsePaperSimulationObservation(raw, id);
    if (observation.status !== "available" || observation.acceptedAt !== record.acceptedAt) return unavailable;
    const accepted = paperSimulationObservationEventSchema.parse(JSON.parse(raw.split("\n")[0]!));
    const hash = createReplayResearchHash(record);
    if (accepted.event !== "accepted" || accepted.canonicalRequestHash !== hash) return unavailable;
    for (const entry of reads) {
      await assertExperimentPath(entry.path, false, checkpoint);
      if (!sameFile(await lstat(entry.path), entry.fingerprint)) return unavailable;
      checkpoint();
    }
    if (await exists(observationPath + ".paper-log.lock")) return unavailable;
    checkpoint();
    return { mode: "paper_only", readOnly: true, status: "available", schemaVersion: record.schemaVersion,
      simulationRunId: id, batchId: id, acceptedAt: record.acceptedAt, sourceRuntime: runtime,
      canonicalRequestHash: hash, requestedConfig };
  } catch { return unavailable; }
}
async function stableRead(path: string, limit: number, checkpoint: () => void = () => {}): Promise<{ text: string; fingerprint: Stats }> {
  checkpoint();
  const before = await lstat(path);
  const text = await readExperimentFile(path, limit, "ARTIFACT_INTEGRITY", checkpoint);
  const after = await lstat(path);
  checkpoint();
  if (!sameFile(after, before)) throw new Error("canonical evidence changed");
  return { text, fingerprint: after };
}
function sameFile(current: Stats, before: Stats): boolean {
  return current.isFile() && !current.isSymbolicLink() && current.nlink === 1
    && current.dev === before.dev && current.ino === before.ino && current.size === before.size
    && current.mtimeMs === before.mtimeMs && current.ctimeMs === before.ctimeMs;
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (hasFsCode(error, "ENOENT")) return false; throw error; }
}
async function syncExistingFile(path: string, expected: Stats): Promise<void> {
  await assertExperimentPath(path);
  const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    if (!sameFile(await handle.stat(), expected)) throw new Error("runtime marker changed");
    await handle.sync();
    if (!sameFile(await lstat(path), expected)) throw new Error("runtime marker changed");
  } finally { await handle.close(); }
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
