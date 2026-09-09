import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { BucketSelectionRequestFileRepository, getDurableBucketSelectionRequestObservation, bucketSelectionRequestObservationSchema,
  resolveObservedBucketSelectionRequestHistory, type VerifiedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { parseCandidateSizingInputRecord, resolveCandidateSizingInputRequestBinding,
  type CandidateSizingInputRecord } from "./candidateSizingInput.js";
import { PortfolioSizingSnapshotFileRepository, getDurablePortfolioSizingSnapshotObservation, portfolioSizingSnapshotObservationSchema,
  resolveObservedPortfolioSizingSnapshotHistory, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const CANDIDATE_SIZING_INPUT_RECORDS_FILE_NAME = "candidate-sizing-input-records.jsonl";
const sourceSchema = z.object({ requestObservation: bucketSelectionRequestObservationSchema,
  snapshotObservation: portfolioSizingSnapshotObservationSchema }).strict();
type Source = Readonly<z.infer<typeof sourceSchema>>;
const entrySchema = z.object({ schemaVersion: z.literal("candidate_sizing_input_entry.v1"), record: z.unknown(), source: sourceSchema,
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const commitSchema = z.object({ schemaVersion: z.literal("candidate_sizing_input_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();

export interface VerifiedCandidateSizingInputOrigin {
  readonly record: CandidateSizingInputRecord;
  readonly source: Source;
  readonly appendStartedAt: string;
  readonly committedAt: string;
  readonly entryHash: string;
  readonly commitHash: string;
}
export interface VerifiedCandidateSizingInputHistory {
  readonly origins: readonly VerifiedCandidateSizingInputOrigin[];
  readonly generationHash: string | null;
}
const observations = new WeakMap<VerifiedCandidateSizingInputHistory, string>();

/** Actual source locks and the input lock are held only during this observation's callback. */
export function getDurableCandidateSizingInputObservation(history: VerifiedCandidateSizingInputHistory): string {
  const observedAt = observations.get(history);
  if (observedAt === undefined) throw new Error("candidate sizing input history lacks a durable observation lease");
  return observedAt;
}

export function createCandidateSizingInputPaths(baseDir: string) {
  return { recordsPath: join(baseDir, CANDIDATE_SIZING_INPUT_RECORDS_FILE_NAME),
    lockPath: join(baseDir, `.${CANDIDATE_SIZING_INPUT_RECORDS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".candidate-sizing-input-pending.json") };
}

/** Source-bound immutable records, not evaluated features, sizing, eligibility or current capacity allocation. */
export class CandidateSizingInputFileRepository {
  private readonly paths: ReturnType<typeof createCandidateSizingInputPaths>;
  private readonly options: { lockTimeoutMs: number; lockRetryDelayMs: number };
  constructor(private readonly baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.paths = createCandidateSizingInputPaths(baseDir);
    this.options = { lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? 5000),
      lockRetryDelayMs: positiveInteger(options.lockRetryDelayMs ?? 10) };
  }

  async readAll(): Promise<readonly VerifiedCandidateSizingInputOrigin[]> {
    return this.withDurableVerifiedHistory(async (history) => history.origins);
  }

  /** Request -> snapshot -> sizing input. Consumers must not re-enter the source or input stores. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedCandidateSizingInputHistory) => Promise<T>): Promise<T> {
    return this.withSources((requests, snapshots) => this.withLock(async () => {
      const { history, observedAt } = await this.readUnderLock(requests, snapshots);
      observations.set(history, observedAt);
      try { return await operation(history); }
      finally { observations.delete(history); }
    }));
  }

  async append(value: unknown): Promise<VerifiedCandidateSizingInputOrigin> {
    const record = parseCandidateSizingInputRecord(value);
    return this.withSources((requests, snapshots) => this.withLock(async () => {
      const { history } = await this.readUnderLock(requests, snapshots);
      const existing = history.origins.find((item) => item.record.sizingInputRecordId === record.sizingInputRecordId);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.record, record)) throw new Error("candidate sizing input ID collision");
        return existing;
      }
      const source = freezeSource({ requestObservation: getDurableBucketSelectionRequestObservation(requests),
        snapshotObservation: getDurablePortfolioSizingSnapshotObservation(snapshots) });
      const appendStartedAt = new Date().toISOString();
      verifySource(record, source, requests, snapshots, appendStartedAt);
      const previous = history.origins.at(-1);
      if (previous && Date.parse(appendStartedAt) < Date.parse(previous.committedAt)) throw new Error("candidate sizing input append clock moved backwards");
      const payload = { schemaVersion: "candidate_sizing_input_entry.v1" as const, record, source,
        appendStartedAt, previousCommitHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      // An interrupted entry/marker write remains fail-closed, even when a complete line is visible.
      const pending = await open(this.paths.pendingPath, "wx");
      try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`); await pending.sync(); }
      finally { await pending.close(); }
      await syncDirectory(dirname(this.paths.pendingPath));
      await appendLine(this.paths.recordsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("candidate sizing input commit clock moved backwards");
      const marker = { schemaVersion: "candidate_sizing_input_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.recordsPath, { ...marker, commitHash });
      if (Date.now() < Date.parse(committedAt)) throw new Error("candidate sizing input flush clock moved backwards");
      await unlink(this.paths.pendingPath);
      await syncDirectory(dirname(this.paths.pendingPath));
      return Object.freeze({ record, source, appendStartedAt, committedAt, entryHash, commitHash });
    }));
  }

  private withSources<T>(operation: (requests: VerifiedBucketSelectionRequestHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>): Promise<T> {
    return new BucketSelectionRequestFileRepository(this.baseDir, this.options).withDurableVerifiedHistory((requests) =>
      new PortfolioSizingSnapshotFileRepository(this.baseDir, this.options).withDurableVerifiedHistory((snapshots) => operation(requests, snapshots)));
  }

  private async readUnderLock(requests: VerifiedBucketSelectionRequestHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) {
    try { await lstat(this.paths.pendingPath); throw new Error("candidate sizing input pending append requires explicit recovery"); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    const { raw, observedAt } = await readDurableRaw(this.paths.recordsPath);
    if (raw && !raw.endsWith("\n")) throw new Error("candidate sizing input file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const origins: VerifiedCandidateSizingInputOrigin[] = [];
    const ids = new Set<string>();
    let generationHash: string | null = null;
    let previousTime: string | undefined;
    for (let index = 0; index < lines.length; index += 2) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const record = parseCandidateSizingInputRecord(entry.record);
        const { entryHash, ...payload } = entry;
        if (!isDeepStrictEqual(entry, value) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generationHash) {
          throw new Error("candidate sizing input entry hash or predecessor mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = commitSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) || Date.parse(marker.committedAt) > Date.parse(observedAt) ||
          (previousTime !== undefined && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) {
          throw new Error("candidate sizing input commit hash or chronology mismatch");
        }
        verifySource(record, entry.source, requests, snapshots, entry.appendStartedAt);
        if (ids.has(record.sizingInputRecordId)) throw new Error("candidate sizing input duplicate record ID");
        ids.add(record.sizingInputRecordId);
        origins.push(Object.freeze({ record, source: freezeSource(entry.source), appendStartedAt: entry.appendStartedAt,
          committedAt: marker.committedAt, entryHash, commitHash }));
        generationHash = commitHash;
        previousTime = marker.committedAt;
      } catch (cause) { throw new Error(`candidate sizing input corrupt entry at line ${index + 1}`, { cause }); }
    }
    return { history: Object.freeze({ origins: Object.freeze(origins), generationHash }), observedAt };
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.baseDir, { recursive: true });
    let directory = await realpath(this.baseDir);
    while (true) {
      await syncDirectory(directory);
      const parent = dirname(directory);
      if (directory === parent) break;
      directory = parent;
    }
    const release = await acquireLock(this.paths.lockPath, this.options);
    try { return await operation(); } finally { await release(); }
  }
}

function verifySource(record: CandidateSizingInputRecord, source: Source,
  requests: VerifiedBucketSelectionRequestHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory, appendStartedAt: string) {
  const request = resolveObservedBucketSelectionRequestHistory(requests, source.requestObservation)
    .find((item) => item.requestId === record.requestId);
  if (!request) throw new Error("candidate sizing input request source is missing");
  resolveCandidateSizingInputRequestBinding({ sizingInput: record, request });
  const snapshot = resolveObservedPortfolioSizingSnapshotHistory(snapshots, source.snapshotObservation)
    .find((item) => item.portfolioSnapshotId === record.portfolioSnapshotId);
  if (!snapshot || snapshot.portfolioSnapshotHash !== record.portfolioSnapshotHash || snapshot.portfolioId !== record.portfolioId ||
    snapshot.policyHash !== record.policyHash || Date.parse(snapshot.asOf) !== Date.parse(record.asOf) ||
    Date.parse(snapshot.asOf) > Date.parse(source.snapshotObservation.observedAt) ||
    Date.parse(record.createdAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.requestObservation.observedAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.snapshotObservation.observedAt) > Date.parse(appendStartedAt)) {
    throw new Error("candidate sizing input snapshot source or availability mismatch");
  }
}

function freezeSource(source: Source): Source {
  return Object.freeze({ requestObservation: Object.freeze({ ...source.requestObservation }),
    snapshotObservation: Object.freeze({ ...source.snapshotObservation }) });
}

async function readDurableRaw(path: string): Promise<{ raw: string; observedAt: string }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); } catch (recheck) { if (isCode(recheck, "ENOENT")) return { raw: "", observedAt }; throw recheck; }
    throw new Error("candidate sizing input source appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("candidate sizing input source must be a regular file");
    const bytes = await handle.readFile();
    await handle.sync();
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (!bytesRead) throw new Error("candidate sizing input source changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("candidate sizing input source must be a regular file");
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("candidate sizing input source changed during observation");
    }
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("candidate sizing input source contains invalid UTF-8");
    return { raw, observedAt };
  } finally { await handle.close(); }
}

async function appendLine(path: string, value: unknown) {
  const handle = await open(path, "a");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (process.platform === "win32" && isCode(error, "EPERM")) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!(process.platform === "win32" && isCode(error, "EPERM"))) throw error; }
  finally { await handle.close(); }
}
async function acquireLock(path: string, options: { lockTimeoutMs: number; lockRetryDelayMs: number }): Promise<() => Promise<void>> {
  const deadline = performance.now() + options.lockTimeoutMs;
  let lastError: unknown;
  while (performance.now() < deadline) {
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(path, "wx"); }
    catch (error) {
      if (!(isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM")))) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(options.lockRetryDelayMs, Math.max(0, deadline - performance.now()))));
      continue;
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token); await handle.sync(); }
    // Initialization failure cannot prove pathname ownership; retain the lock for explicit recovery.
    catch (error) { await handle.close(); throw error; }
    return async () => {
      try { if (await readFile(path, "utf8") !== token) throw new Error("candidate sizing input lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(path);
      await syncDirectory(dirname(path));
    };
  }
  throw new Error("candidate sizing input repository lock is unavailable", { cause: lastError });
}
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock option must be a positive safe integer"); return value; }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
