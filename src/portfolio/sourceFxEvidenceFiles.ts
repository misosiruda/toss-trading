import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { parseSourceFxEvidenceRecord, type SourceFxEvidenceRecord } from "./sourceFxEvidence.js";

export const SOURCE_FX_EVIDENCE_FILE_NAME = "source-fx-evidence.jsonl";
export interface SourceFxEvidenceFileRepositoryOptions { lockTimeoutMs?: number; lockRetryDelayMs?: number }
export interface VerifiedSourceFxEvidenceHistory { records: readonly SourceFxEvidenceRecord[] }
export interface VerifiedSourceFxEvidenceOrigin { record: SourceFxEvidenceRecord; appendedAt: string; commitHash: string }
interface Observation { observedAt: string; recordCount: number; entriesHash: string }
const observations = new WeakMap<VerifiedSourceFxEvidenceHistory, {
  origins: ReadonlyMap<string, VerifiedSourceFxEvidenceOrigin>; observation: Readonly<Observation>
}>();
const entrySchema = z.object({ schemaVersion: z.literal("source_fx_evidence_entry.v1"), record: z.unknown(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const markerSchema = z.object({ schemaVersion: z.literal("source_fx_evidence_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();

export function createSourceFxEvidencePaths(baseDir: string) {
  return { recordsPath: join(baseDir, SOURCE_FX_EVIDENCE_FILE_NAME), lockPath: join(baseDir, `.${SOURCE_FX_EVIDENCE_FILE_NAME}.lock`) };
}

/** Actual committed source storage. A held observation binds cooperative writers, not external provider trust. */
export class SourceFxEvidenceFileRepository {
  private readonly paths: ReturnType<typeof createSourceFxEvidencePaths>;
  private readonly timeout: number;
  private readonly retry: number;
  constructor(baseDir: string, options: SourceFxEvidenceFileRepositoryOptions = {}) {
    this.paths = createSourceFxEvidencePaths(baseDir);
    this.timeout = positiveInteger(options.lockTimeoutMs ?? 5_000);
    this.retry = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  async readAll(): Promise<readonly SourceFxEvidenceRecord[]> {
    return this.withDurableVerifiedHistory(async (history) => history.records);
  }

  /** The repository owns the source lock until completion. Observation tokens expire when the callback exits. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedSourceFxEvidenceHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const { entries, observedAt } = await readDurableSource(this.paths.recordsPath);
      const history = Object.freeze({ records: Object.freeze(entries.map((entry) => entry.record)) });
      observations.set(history, { origins: new Map(entries.map((entry) => [entry.record.evidenceRef, entry])),
        observation: Object.freeze({ observedAt, recordCount: entries.length, entriesHash: hashCanonicalPayload(entries) }) });
      try { return await operation(history); } finally { observations.delete(history); }
    });
  }

  async append(value: unknown): Promise<SourceFxEvidenceRecord> {
    const record = parseSourceFxEvidenceRecord(value);
    return this.withLock(async () => {
      const { entries, observedAt } = await readDurableSource(this.paths.recordsPath);
      const existing = entries.find((entry) => entry.record.evidenceRef === record.evidenceRef);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.record, record)) throw new Error("source FX evidence ref collision");
        return existing.record; // The exact source descriptor has already been read, fsynced and rechecked.
      }
      if (entries.some((entry) => originKey(entry.record) === originKey(record))) throw new Error("source FX evidence origin collision");
      const appendStartedAt = new Date().toISOString();
      if (Date.parse(appendStartedAt) < Math.max(Date.parse(record.createdAt), Date.parse(observedAt))) {
        throw new Error("source FX evidence append clock precedes creation or observation");
      }
      const payload = { schemaVersion: "source_fx_evidence_entry.v1" as const, record, appendStartedAt,
        previousCommitHash: entries.at(-1)?.commitHash ?? null };
      const entryHash = hashCanonicalPayload(payload);
      await appendLine(this.paths.recordsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("source FX evidence append clock moved backwards");
      const marker = { schemaVersion: "source_fx_evidence_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.recordsPath, { ...marker, commitHash });
      const confirmed = await readDurableSource(this.paths.recordsPath);
      if (confirmed.entries.at(-1)?.commitHash !== commitHash) throw new Error("source FX evidence append generation changed");
      return record;
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.paths.recordsPath);
    await mkdir(directory, { recursive: true });
    await syncAncestors(directory);
    const release = await acquireLock(this.paths.lockPath, this.timeout, this.retry);
    try { return await operation(); } finally { await release(); }
  }
}

export function getDurableSourceFxEvidenceObservation(history: VerifiedSourceFxEvidenceHistory): Readonly<Observation> {
  return metadata(history).observation;
}

export function resolveVerifiedSourceFxEvidenceOrigin(history: VerifiedSourceFxEvidenceHistory, evidenceRef: string): VerifiedSourceFxEvidenceOrigin {
  const origin = metadata(history).origins.get(evidenceRef);
  if (origin === undefined) throw new Error("source FX evidence does not resolve exactly once");
  return origin;
}

/** Content parsing never authenticates a repository observation or grants an active source lease. */
export function parseSourceFxEvidenceRecords(raw: string): readonly SourceFxEvidenceRecord[] {
  return Object.freeze(parseLog(raw).map((entry) => entry.record));
}

function metadata(history: VerifiedSourceFxEvidenceHistory) {
  const value = observations.get(history);
  if (value === undefined) throw new Error("source FX evidence observation is unverified or expired");
  return value;
}

function parseLog(raw: string): readonly VerifiedSourceFxEvidenceOrigin[] {
  if (raw.length > 0 && !raw.endsWith("\n")) throw new Error("source FX evidence file has a torn final line");
  const lines = raw.split(/\r?\n/); lines.pop();
  const entries: VerifiedSourceFxEvidenceOrigin[] = [], refs = new Set<string>(), origins = new Set<string>();
  let previousCommitHash: string | null = null, previousTime = -Infinity;
  for (let index = 0; index < lines.length; index += 2) {
    try {
      const entry = entrySchema.parse(JSON.parse(lines[index]!)), record = parseSourceFxEvidenceRecord(entry.record);
      const payload = { schemaVersion: entry.schemaVersion, record, appendStartedAt: entry.appendStartedAt,
        previousCommitHash: entry.previousCommitHash };
      if (entry.entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== previousCommitHash ||
        Date.parse(entry.appendStartedAt) < Math.max(Date.parse(record.createdAt), previousTime) ||
        lines[index] !== JSON.stringify({ ...payload, entryHash: entry.entryHash })) throw new Error("FX entry hash, canonical bytes or chronology mismatch");
      const marker = markerSchema.parse(JSON.parse(lines[index + 1] ?? ""));
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash: marker.entryHash, committedAt: marker.committedAt };
      if (marker.entryHash !== entry.entryHash || marker.commitHash !== hashCanonicalPayload(markerPayload) ||
        Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) ||
        lines[index + 1] !== JSON.stringify({ ...markerPayload, commitHash: marker.commitHash })) throw new Error("FX commit marker mismatch");
      const origin = originKey(record);
      if (refs.has(record.evidenceRef) || origins.has(origin)) throw new Error("duplicate FX ref or origin");
      refs.add(record.evidenceRef); origins.add(origin);
      entries.push(Object.freeze({ record, appendedAt: marker.committedAt, commitHash: marker.commitHash }));
      previousCommitHash = marker.commitHash; previousTime = Date.parse(marker.committedAt);
    } catch (error) { throw new Error(`source FX evidence corrupt entry at line ${index + 1}`, { cause: error }); }
  }
  return Object.freeze(entries);
}

/** Fsyncs the parsed descriptor, then rechecks its identity, bytes and named path before issuing an observation. */
async function readDurableSource(path: string) {
  let named;
  try { named = await lstat(path); }
  catch (error) {
    if (!isErrorCode(error, "ENOENT")) throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); }
    catch (again) { if (isErrorCode(again, "ENOENT")) return { entries: Object.freeze([]) as readonly VerifiedSourceFxEvidenceOrigin[], observedAt }; throw again; }
    throw new Error("source FX evidence appeared during observation");
  }
  if (!named.isFile() || named.isSymbolicLink()) throw new Error("source FX evidence must be a regular file");
  const handle = await open(path, "r+");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new Error("source FX evidence must be a regular single-link file");
    const bytes = await handle.readFile(), raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("source FX evidence contains invalid UTF-8");
    const entries = parseLog(raw);
    await handle.sync(); await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    if (entries.some((entry) => Date.parse(entry.appendedAt) > Date.parse(observedAt))) throw new Error("source FX evidence observation clock precedes commit");
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (bytesRead === 0) throw new Error("source FX evidence changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true }), finalPath = await lstat(path);
    if (!finalPath.isFile() || finalPath.isSymbolicLink()) throw new Error("source FX evidence path changed during observation");
    const namedHandle = await open(path, "r");
    try {
      if (before.size !== BigInt(bytes.length) || !bytes.equals(verified) || !sameStat(before, after) ||
        !sameStat(before, await namedHandle.stat({ bigint: true }))) throw new Error("source FX evidence changed during observation");
    } finally { await namedHandle.close(); }
    return { entries, observedAt };
  } finally { await handle.close(); }
}

function sameStat(a: BigIntStats, b: BigIntStats) {
  return b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
}
function originKey(record: SourceFxEvidenceRecord) {
  return JSON.stringify([record.sourceContractId, record.baseCurrency, record.quoteCurrency, Date.parse(record.observedAt)]);
}
async function appendLine(path: string, value: unknown) {
  const handle = await open(path, "a");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function acquireLock(path: string, timeout: number, retry: number): Promise<() => Promise<void>> {
  const deadline = performance.now() + timeout;
  while (true) {
    if (performance.now() >= deadline) throw new Error("source FX evidence lock is unavailable");
    let handle;
    try { handle = await open(path, "wx"); }
    catch (error) {
      if (!isErrorCode(error, "EEXIST") && !(process.platform === "win32" && isErrorCode(error, "EPERM"))) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(retry, deadline - performance.now())))); continue;
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token, "utf8"); await handle.sync(); }
    catch (error) { await handle.close(); throw error; } // Preserve a failed acquisition barrier; never steal a lock.
    return async () => {
      try { if (await readFile(path, "utf8") !== token) throw new Error("source FX evidence lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(path);
    };
  }
}
async function syncAncestors(path: string) {
  let current = await realpath(path); const directories: string[] = [];
  while (true) { directories.unshift(current); const parent = dirname(current); if (parent === current) break; current = parent; }
  for (const directory of directories) await syncDirectory(directory);
}
async function syncDirectory(path: string) {
  let handle;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown) { return process.platform === "win32" && isErrorCode(error, "EPERM"); }
function isErrorCode(error: unknown, code: string) { return error instanceof Error && "code" in error && error.code === code; }
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock timing must be a positive safe integer"); return value; }
