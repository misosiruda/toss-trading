import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { historicalMarketSnapshotSchema, parseWithSchema, sha256HashSchema, type HistoricalMarketSnapshot } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "../portfolio/runtimePolicyContracts.js";

export interface HistoricalMarketSnapshotSourceOptions { lockTimeoutMs?: number; lockRetryDelayMs?: number }
export interface VerifiedHistoricalMarketSnapshotHistory { readonly records: readonly HistoricalMarketSnapshot[] }
export const historicalMarketSnapshotObservationSchema = z.object({
  recordCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0)),
  recordsHash: sha256HashSchema, observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type HistoricalMarketSnapshotObservation = Readonly<z.infer<typeof historicalMarketSnapshotObservationSchema>>;
const observations = new WeakMap<VerifiedHistoricalMarketSnapshotHistory, HistoricalMarketSnapshotObservation>();

/** Observed local content only; not provider trust, historical completeness, FX/PIT provenance or candidate eligibility. */
export function getDurableHistoricalMarketSnapshotObservation(history: VerifiedHistoricalMarketSnapshotHistory): HistoricalMarketSnapshotObservation {
  const observation = observations.get(history);
  if (!observation) throw new Error("historical snapshot history lacks a live durable observation lease");
  return observation;
}
export function resolveObservedHistoricalMarketSnapshotHistory(history: VerifiedHistoricalMarketSnapshotHistory, value: unknown): readonly HistoricalMarketSnapshot[] {
  const current = getDurableHistoricalMarketSnapshotObservation(history);
  const observation = historicalMarketSnapshotObservationSchema.parse(value);
  if (!isDeepStrictEqual(value, observation)) throw new Error("historical snapshot observation must already be canonical");
  if (Date.parse(observation.observedAt) > Date.parse(current.observedAt)) throw new Error("historical snapshot observation is in the future");
  const prefix = history.records.slice(0, observation.recordCount);
  if (prefix.length !== observation.recordCount || hashCanonicalPayload(prefix) !== observation.recordsHash) {
    throw new Error("historical snapshot observation does not match source prefix");
  }
  assertChronology(prefix, observation.observedAt);
  return Object.freeze(prefix);
}

/** Shared boundary for repository appends, ingest dataset replacements and strict consumer observations. */
export class HistoricalMarketSnapshotFileSource {
  private readonly path: string;
  private readonly lockPath: string;
  private readonly timeoutMs: number;
  private readonly retryMs: number;
  constructor(filePath: string, options: HistoricalMarketSnapshotSourceOptions = {}) {
    this.path = resolve(filePath);
    this.lockPath = join(dirname(this.path), `.${basename(this.path)}.lock`);
    this.timeoutMs = positiveInteger(options.lockTimeoutMs ?? 5000);
    this.retryMs = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  async append(value: HistoricalMarketSnapshot): Promise<void> {
    const record = parseWithSchema(historicalMarketSnapshotSchema, value, "historicalMarketSnapshot");
    const line = `${JSON.stringify(record)}\n`;
    await this.withLock(async () => {
      await assertRegularOrMissing(this.path);
      const handle = await open(this.path, "a");
      try { await handle.writeFile(line, "utf8"); }
      finally { await handle.close(); }
    });
  }

  /** Explicit ingest replacement, not append-only evidence storage. Existing dataset replacement semantics are retained. */
  async replaceAll(values: readonly HistoricalMarketSnapshot[]): Promise<void> {
    const records = values.map((value) => parseWithSchema(historicalMarketSnapshotSchema, value, "historicalMarketSnapshot"));
    const raw = records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
    await this.withLock(async () => {
      await assertRegularOrMissing(this.path);
      const temporaryPath = join(dirname(this.path), `.${basename(this.path)}.${randomUUID()}.tmp`);
      const handle = await open(temporaryPath, "wx");
      try { await handle.writeFile(raw, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      // Publish only a complete flushed dataset. Failed temporary files remain
      // separate from the source path for explicit inspection/recovery.
      await rename(temporaryPath, this.path);
      await syncDirectory(dirname(this.path));
    });
  }

  async withDurableVerifiedHistory<T>(operation: (history: VerifiedHistoricalMarketSnapshotHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      await syncAncestors(dirname(this.path));
      const { records, observedAt } = await readDurableSource(this.path);
      const history = Object.freeze({ records });
      observations.set(history, Object.freeze({ recordCount: records.length, recordsHash: hashCanonicalPayload(records), observedAt }));
      try { return await operation(history); }
      finally { observations.delete(history); }
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const deadline = performance.now() + this.timeoutMs;
    let lastContention: unknown;
    let handle: Awaited<ReturnType<typeof open>>;
    while (true) {
      if (performance.now() >= deadline) throw new Error("historical snapshot source lock is unavailable", { cause: lastContention });
      try { handle = await open(this.lockPath, "wx"); break; }
      catch (error) {
        if (!nodeError(error) || !(error.code === "EEXIST" || (process.platform === "win32" && error.code === "EPERM"))) throw error;
        lastContention = error;
        await new Promise((done) => setTimeout(done, Math.max(1, Math.min(this.retryMs, deadline - performance.now()))));
      }
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token, "utf8"); await handle.sync(); }
    catch (error) { await handle.close(); throw error; } // Preserve uncertain ownership for explicit recovery.
    try { return await operation(); }
    finally {
      try {
        if (await readFile(this.lockPath, "utf8") !== token) throw new Error("historical snapshot lock ownership changed");
      } finally { await handle.close(); }
      await unlink(this.lockPath);
      await syncDirectory(dirname(this.path));
    }
  }
}

async function readDurableSource(path: string): Promise<{ records: readonly HistoricalMarketSnapshot[]; observedAt: string }> {
  await assertRegularOrMissing(path);
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if (!nodeError(error) || error.code !== "ENOENT") throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); }
    catch (again) { if (nodeError(again) && again.code === "ENOENT") return { records: Object.freeze([]), observedAt }; throw again; }
    throw new Error("historical snapshot source appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("historical snapshot source must be a regular file");
    const bytes = await handle.readFile();
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("historical snapshot source contains invalid UTF-8");
    const records = parseStrictHistory(raw);
    await handle.sync();
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    assertChronology(records, observedAt);
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (!bytesRead) throw new Error("historical snapshot source changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    await assertRegularOrMissing(path);
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); }
    finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) ||
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size ||
      after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("historical snapshot source changed during observation");
    }
    return { records, observedAt };
  } finally { await handle.close(); }
}

function parseStrictHistory(raw: string): readonly HistoricalMarketSnapshot[] {
  if (raw.length && !raw.endsWith("\n")) throw new Error("historical snapshot source has a torn final line");
  const ids = new Set<string>();
  const records = raw.split(/\r?\n/).filter((line) => line.trim().length).map((line) => {
    const value: unknown = JSON.parse(line);
    const record = historicalMarketSnapshotSchema.parse(value);
    if (!isDeepStrictEqual(value, record)) throw new Error("historical snapshot source record must already be canonical");
    assertJsonValues(record);
    offsetQualifiedIsoDateTimeSchema.parse(record.observedAt);
    offsetQualifiedIsoDateTimeSchema.parse(record.createdAt);
    if (Date.parse(record.createdAt) < Date.parse(record.observedAt)) throw new Error("historical snapshot source materialization predates observation");
    if (ids.has(record.snapshotId)) throw new Error("historical snapshot source has duplicate snapshot identity");
    ids.add(record.snapshotId);
    return deepFreeze(record);
  });
  return Object.freeze(records);
}
function assertJsonValues(value: unknown): void {
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) throw new Error("historical snapshot source has noncanonical number");
  if (typeof value === "string" && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error("historical snapshot source has malformed Unicode");
  if (value !== null && typeof value === "object") Object.values(value).forEach(assertJsonValues);
}
function assertChronology(records: readonly HistoricalMarketSnapshot[], observedAt: string) {
  if (records.some((record) => Date.parse(record.createdAt) > Date.parse(observedAt))) throw new Error("historical snapshot receipt predates stored materialization");
}
async function assertRegularOrMissing(path: string) {
  try { if (!(await lstat(path)).isFile()) throw new Error("historical snapshot source must be a regular file"); }
  catch (error) { if (!nodeError(error) || error.code !== "ENOENT") throw error; }
}
async function syncAncestors(path: string) {
  let current = await realpath(path);
  const paths: string[] = [];
  while (true) { paths.unshift(current); const parent = dirname(current); if (parent === current) break; current = parent; }
  for (const directory of paths) await syncDirectory(directory);
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown) { return process.platform === "win32" && nodeError(error) && error.code === "EPERM"; }
function nodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("historical source lock option must be a positive safe integer"); return value; }
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
