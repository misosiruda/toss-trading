import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME } from "../storage/artifactPaths.js";
import { HistoricalMarketSnapshotFileSource, type VerifiedHistoricalMarketSnapshotHistory } from "../storage/historicalMarketSnapshotSource.js";
import { MarketTechnicalEvidenceFileSource, resolveMarketTechnicalEvidenceSourceBinding,
  type MarketTechnicalEvidenceSourceBinding, type MarketTechnicalEvidenceSourceInput } from "./marketTechnicalEvidenceSource.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const MARKET_TECHNICAL_EVIDENCE_RECORDS_FILE_NAME = "market-technical-evidence-records.jsonl";
const entrySchema = z.object({ schemaVersion: z.enum(["market_technical_evidence_entry.v1", "market_technical_evidence_entry.v2"]), binding: z.unknown(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const markerSchema = z.object({ schemaVersion: z.literal("market_technical_evidence_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();
const completionSchema = z.object({ schemaVersion: z.literal("market_technical_evidence_completion.v1"), entryHash: sha256HashSchema,
  commitHash: sha256HashSchema, observedAt: offsetQualifiedIsoDateTimeSchema, completionHash: sha256HashSchema }).strict();
export const marketTechnicalEvidenceObservationSchema = z.object({
  recordCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0)),
  entriesHash: sha256HashSchema, observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type MarketTechnicalEvidenceObservation = Readonly<z.infer<typeof marketTechnicalEvidenceObservationSchema>>;
export interface VerifiedMarketTechnicalEvidenceOrigin {
  readonly binding: MarketTechnicalEvidenceSourceBinding;
  readonly appendStartedAt: string;
  readonly committedAt: string;
  readonly entryHash: string;
  readonly commitHash: string;
  /** Proves the preceding entry/marker flush, not this completion line's own durable time. Absent on legacy v1. */
  readonly completion?: Readonly<z.infer<typeof completionSchema>>;
}
export interface VerifiedMarketTechnicalEvidenceHistory {
  readonly origins: readonly VerifiedMarketTechnicalEvidenceOrigin[];
  readonly generationHash: string | null;
}
const observations = new WeakMap<VerifiedMarketTechnicalEvidenceHistory, MarketTechnicalEvidenceObservation>();

export function getDurableMarketTechnicalEvidenceObservation(history: VerifiedMarketTechnicalEvidenceHistory): MarketTechnicalEvidenceObservation {
  const observation = observations.get(history);
  if (!observation) throw new Error("market technical evidence history lacks a live durable observation lease");
  return observation;
}
export function resolveObservedMarketTechnicalEvidenceHistory(history: VerifiedMarketTechnicalEvidenceHistory, value: unknown) {
  const current = getDurableMarketTechnicalEvidenceObservation(history);
  const observation = marketTechnicalEvidenceObservationSchema.parse(value);
  if (!isDeepStrictEqual(value, observation) || Date.parse(observation.observedAt) > Date.parse(current.observedAt)) {
    throw new Error("market technical evidence observation is noncanonical or in the future");
  }
  const origins = history.origins.slice(0, observation.recordCount);
  if (origins.length !== observation.recordCount || hashCanonicalPayload(origins) !== observation.entriesHash ||
    origins.some((origin) => Date.parse(origin.completion?.observedAt ?? origin.committedAt) > Date.parse(observation.observedAt))) {
    throw new Error("market technical evidence observation does not match committed prefix");
  }
  return Object.freeze(origins);
}
export function createMarketTechnicalEvidencePaths(baseDir: string) {
  return { recordsPath: join(baseDir, MARKET_TECHNICAL_EVIDENCE_RECORDS_FILE_NAME),
    lockPath: join(baseDir, `.${MARKET_TECHNICAL_EVIDENCE_RECORDS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".market-technical-evidence-pending.json") };
}

/** Captures actual source content. No supplied evidence/receipt append, provider promotion or candidate authority. */
export class MarketTechnicalEvidenceFileRepository {
  private readonly paths: ReturnType<typeof createMarketTechnicalEvidencePaths>;
  private readonly sourcePath: string;
  private readonly options: { lockTimeoutMs: number; lockRetryDelayMs: number };
  constructor(baseDir: string, options: { historicalPath?: string; lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    const directory = resolve(baseDir);
    this.paths = createMarketTechnicalEvidencePaths(directory);
    this.sourcePath = resolve(options.historicalPath ?? join(directory, HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME));
    if (Object.values(this.paths).includes(this.sourcePath)) throw new Error("market technical source and destination paths overlap");
    this.options = { lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? 5000), lockRetryDelayMs: positiveInteger(options.lockRetryDelayMs ?? 10) };
  }
  async readAll(): Promise<readonly VerifiedMarketTechnicalEvidenceOrigin[]> {
    return this.withDurableVerifiedHistory(async (history) => history.origins);
  }
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedMarketTechnicalEvidenceHistory) => Promise<T>): Promise<T> {
    return new HistoricalMarketSnapshotFileSource(this.sourcePath, this.options).withDurableVerifiedHistory((source) => this.withLock(async () => {
      const { history, observedAt } = await this.readUnderLock(source);
      observations.set(history, Object.freeze({ recordCount: history.origins.length, entriesHash: hashCanonicalPayload(history.origins), observedAt }));
      try { return await operation(history); } finally { observations.delete(history); }
    }));
  }
  /** Historical source -> evidence log lock. Same canonical query/content returns the original immutable capture. */
  async capture(value: MarketTechnicalEvidenceSourceInput): Promise<VerifiedMarketTechnicalEvidenceOrigin> {
    return new MarketTechnicalEvidenceFileSource(this.sourcePath, this.options).withEvidence(value, (binding, source) => this.withLock(async () => {
      const { history } = await this.readUnderLock(source);
      const existing = history.origins.find((origin) => origin.binding.evidence.evidenceRef === binding.evidence.evidenceRef);
      if (existing) {
        const previous = existing.binding.evidence;
        if (previous.sourceContractId !== binding.evidence.sourceContractId ||
          !isDeepStrictEqual(previous.calculationInput, binding.evidence.calculationInput) ||
          !isDeepStrictEqual(previous.calculation, binding.evidence.calculation)) throw new Error("market technical evidence reference collision");
        // capture() does not accept a caller timestamp or receipt: repeated capture
        // preserves the first record, source receipt and commit, not a new timestamp.
        return existing;
      }
      const appendStartedAt = new Date().toISOString();
      if (Date.parse(binding.evidence.createdAt) > Date.parse(appendStartedAt) ||
        (history.origins.length && Date.parse(history.origins.at(-1)!.completion?.observedAt ?? history.origins.at(-1)!.committedAt) > Date.parse(appendStartedAt))) {
        throw new Error("market technical evidence append clock moved backwards");
      }
      const payload = { schemaVersion: "market_technical_evidence_entry.v2" as const, binding, appendStartedAt, previousCommitHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      const pending = await open(this.paths.pendingPath, "wx");
      try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`); await pending.sync(); } finally { await pending.close(); }
      await syncDirectory(dirname(this.paths.pendingPath));
      await appendLine(this.paths.recordsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("market technical evidence commit clock moved backwards");
      const marker = { schemaVersion: "market_technical_evidence_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.recordsPath, { ...marker, commitHash });
      const observedAt = new Date().toISOString();
      if (Date.parse(observedAt) < Date.parse(committedAt)) throw new Error("market technical evidence flush clock moved backwards");
      const completionPayload = { schemaVersion: "market_technical_evidence_completion.v1" as const, entryHash, commitHash, observedAt };
      const completion = Object.freeze({ ...completionPayload, completionHash: hashCanonicalPayload(completionPayload) });
      await appendLine(this.paths.recordsPath, completion);
      if (Date.now() < Date.parse(observedAt)) throw new Error("market technical evidence completion flush clock moved backwards");
      await unlink(this.paths.pendingPath);
      await syncDirectory(dirname(this.paths.pendingPath));
      return Object.freeze({ binding, appendStartedAt, committedAt, entryHash, commitHash, completion });
    }));
  }
  private async readUnderLock(source: VerifiedHistoricalMarketSnapshotHistory) {
    try { await lstat(this.paths.pendingPath); throw new Error("market technical evidence pending append requires explicit recovery"); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    const { raw, observedAt } = await readDurableRaw(this.paths.recordsPath);
    if (raw && !raw.endsWith("\n")) throw new Error("market technical evidence log has a torn final line");
    const lines = raw ? raw.split(/\r?\n/).slice(0, -1) : [];
    const origins: VerifiedMarketTechnicalEvidenceOrigin[] = [];
    const refs = new Set<string>();
    let generationHash: string | null = null;
    for (let index = 0; index < lines.length;) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const { entryHash, ...payload } = entry;
        if (!isDeepStrictEqual(value, entry) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generationHash) {
          throw new Error("entry hash or predecessor mismatch");
        }
        const binding = resolveMarketTechnicalEvidenceSourceBinding(source, entry.binding);
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = markerSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(binding.evidence.createdAt) > Date.parse(entry.appendStartedAt) ||
          Date.parse(entry.appendStartedAt) > Date.parse(marker.committedAt) || Date.parse(marker.committedAt) > Date.parse(observedAt) ||
          (origins.length && Date.parse(origins.at(-1)!.completion?.observedAt ?? origins.at(-1)!.committedAt) > Date.parse(entry.appendStartedAt))) throw new Error("commit hash or chronology mismatch");
        let completion: z.infer<typeof completionSchema> | undefined;
        if (entry.schemaVersion === "market_technical_evidence_entry.v2") {
          const completionValue: unknown = JSON.parse(lines[index + 2] ?? "");
          completion = completionSchema.parse(completionValue);
          const { completionHash, ...completionPayload } = completion;
          if (!isDeepStrictEqual(completionValue, completion) || completion.entryHash !== entryHash || completion.commitHash !== commitHash ||
            completionHash !== hashCanonicalPayload(completionPayload) || Date.parse(completion.observedAt) < Date.parse(marker.committedAt) ||
            Date.parse(completion.observedAt) > Date.parse(observedAt)) throw new Error("completion hash or chronology mismatch");
        }
        if (refs.has(binding.evidence.evidenceRef)) throw new Error("duplicate evidence reference");
        refs.add(binding.evidence.evidenceRef);
        origins.push(Object.freeze({ binding, appendStartedAt: entry.appendStartedAt, committedAt: marker.committedAt, entryHash, commitHash,
          ...(completion ? { completion: Object.freeze(completion) } : {}) }));
        generationHash = completion?.completionHash ?? commitHash;
        index += completion ? 3 : 2;
      } catch (cause) { throw new Error(`market technical evidence corrupt entry at line ${index + 1}`, { cause }); }
    }
    return { history: Object.freeze({ origins: Object.freeze(origins), generationHash }), observedAt };
  }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.paths.recordsPath);
    await mkdir(directory, { recursive: true });
    let current = await realpath(directory);
    const ancestors: string[] = [];
    while (true) { ancestors.unshift(current); const parent = dirname(current); if (parent === current) break; current = parent; }
    for (const ancestor of ancestors) await syncDirectory(ancestor);
    const deadline = performance.now() + this.options.lockTimeoutMs;
    let lastError: unknown;
    let handle: Awaited<ReturnType<typeof open>>;
    while (true) {
      if (performance.now() >= deadline) throw new Error("market technical evidence lock is unavailable", { cause: lastError });
      try { handle = await open(this.paths.lockPath, "wx"); break; }
      catch (error) {
        if (!(isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM")))) throw error;
        lastError = error;
        await new Promise((done) => setTimeout(done, Math.max(1, Math.min(this.options.lockRetryDelayMs, deadline - performance.now()))));
      }
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token); await handle.sync(); }
    catch (error) { await handle.close(); throw error; } // Preserve uncertain ownership for explicit recovery.
    try { return await operation(); }
    finally {
      try { if (await readFile(this.paths.lockPath, "utf8") !== token) throw new Error("market technical evidence lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(this.paths.lockPath);
      await syncDirectory(directory);
    }
  }
}

async function readDurableRaw(path: string): Promise<{ raw: string; observedAt: string }> {
  await regularOrMissing(path);
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); } catch (again) { if (isCode(again, "ENOENT")) return { raw: "", observedAt }; throw again; }
    throw new Error("market technical evidence log appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("market technical evidence log must be a regular file");
    const bytes = await handle.readFile();
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw).equals(bytes)) throw new Error("market technical evidence log contains invalid UTF-8");
    await handle.sync(); await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (!bytesRead) throw new Error("market technical evidence log changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    await regularOrMissing(path);
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    const same = (a: typeof before, b: typeof before) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) || !same(before, after) || !same(after, named)) {
      throw new Error("market technical evidence log changed during observation");
    }
    return { raw, observedAt };
  } finally { await handle.close(); }
}
async function appendLine(path: string, value: unknown) {
  await regularOrMissing(path);
  const handle = await open(path, "a");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function regularOrMissing(path: string) {
  try { if (!(await lstat(path)).isFile()) throw new Error("market technical evidence log must be a regular file"); }
  catch (error) { if (!isCode(error, "ENOENT")) throw error; }
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (process.platform === "win32" && isCode(error, "EPERM")) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!(process.platform === "win32" && isCode(error, "EPERM"))) throw error; }
  finally { await handle.close(); }
}
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock option must be a positive safe integer"); return value; }
