import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredBucketOpeningCapacityStates } from "./storedBucketOpeningCapacityStates.js";

export const BUCKET_OPENING_CAPACITY_STATE_FILE_NAME = "bucket-opening-capacity-state.json";
type Projection = Awaited<ReturnType<typeof resolveStoredBucketOpeningCapacityStates>>["projection"];
type Options = { lockTimeoutMs?: number; lockRetryDelayMs?: number };
const snapshotQuery = z.object({ portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();
const refreshSchema = snapshotQuery.extend({ expectedDocumentHash: sha256HashSchema.nullable() }).strict();
const documentSchema = z.object({ schemaVersion: z.literal("bucket_opening_capacity_state_document.v1"),
  projections: z.array(z.unknown()).min(1), documentHash: sha256HashSchema }).strict();
export interface StoredBucketOpeningCapacityDocument {
  readonly schemaVersion: "bucket_opening_capacity_state_document.v1";
  readonly projections: readonly Projection[];
  readonly documentHash: string;
}

export function createBucketOpeningCapacityStatePaths(baseDir: string) {
  return { statePath: join(baseDir, BUCKET_OPENING_CAPACITY_STATE_FILE_NAME),
    lockPath: join(baseDir, `.${BUCKET_OPENING_CAPACITY_STATE_FILE_NAME}.lock`) };
}

/** Whole-document projection CAS only. No latest-portfolio, source lease, allocation or execution authority. */
export class BucketOpeningCapacityStateFileRepository {
  private readonly baseDir: string;
  private readonly paths: ReturnType<typeof createBucketOpeningCapacityStatePaths>;
  private readonly options: Required<Options>;
  constructor(baseDir: string, options: Options = {}) {
    if (typeof baseDir !== "string" || !baseDir.length) throw new Error("opening capacity base directory is required");
    this.baseDir = resolve(baseDir);
    this.paths = createBucketOpeningCapacityStatePaths(this.baseDir);
    this.options = { lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? 5_000),
      lockRetryDelayMs: positiveInteger(options.lockRetryDelayMs ?? 10) };
  }

  /** Missing is explicit null; existing bytes must match independently replayed stored source snapshots. */
  async readVerifiedSnapshot(): Promise<StoredBucketOpeningCapacityDocument | null> {
    return this.withLock(async () => {
      const stored = await this.readStored();
      if (stored !== null) await syncFile(this.paths.statePath);
      return stored;
    });
  }

  /** Recomputes from repository sources, never accepts a caller-supplied state or resolver callback. */
  async refresh(value: z.input<typeof refreshSchema>): Promise<StoredBucketOpeningCapacityDocument> {
    const input = refreshSchema.parse(value);
    if (!isDeepStrictEqual(value, input)) throw new Error("opening capacity refresh must already be canonical");
    return this.withLock(async (assertOwned) => {
      const stored = await this.readStored();
      const replayed = stored?.projections.find((item) => item.portfolioSnapshotId === input.portfolioSnapshotId);
      const current = replayed ?? (await resolveStoredBucketOpeningCapacityStates({ baseDir: this.baseDir,
        portfolioSnapshotId: input.portfolioSnapshotId }, this.options)).projection;
      const previous = stored?.projections.find((item) => item.portfolioId === current.portfolioId);
      const next = makeDocument([...(stored?.projections.filter((item) => item.portfolioId !== current.portfolioId) ?? []), current]);
      // A retry changes no bytes even if its original expected hash predates the successful replacement.
      if (stored !== null && isDeepStrictEqual(stored, next)) { await syncFile(this.paths.statePath); return stored; }
      if ((stored?.documentHash ?? null) !== input.expectedDocumentHash) throw new Error("opening capacity document CAS mismatch");
      if (previous !== undefined && Date.parse(current.asOf) <= Date.parse(previous.asOf)) {
        throw new Error("opening capacity snapshot must advance; older or ambiguous same-time replacements are forbidden");
      }
      await assertOwned();
      await writeSnapshot(this.paths.statePath, next);
      return next;
    });
  }

  private async readStored(): Promise<StoredBucketOpeningCapacityDocument | null> {
    let bytes: Buffer;
    try { bytes = await readFile(this.paths.statePath); }
    catch (error) { if (isNodeError(error) && error.code === "ENOENT") return null; throw error; }
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes) || !raw.endsWith("\n")) throw new Error("opening capacity document has invalid UTF-8 or a torn final line");
    const value: unknown = JSON.parse(raw), parsed = documentSchema.parse(value);
    // Strict serialization rejects duplicate JSON keys, hidden unknown fields, and noncanonical representations.
    if (raw !== `${JSON.stringify(parsed)}\n`) throw new Error("opening capacity document bytes are noncanonical");
    const { documentHash, ...payload } = parsed;
    if (hashCanonicalPayload(payload) !== documentHash) throw new Error("opening capacity document hash mismatch");
    const projections: Projection[] = [];
    for (const candidate of parsed.projections) {
      const query = snapshotQuery.passthrough().parse(candidate);
      const actual = (await resolveStoredBucketOpeningCapacityStates({ baseDir: this.baseDir,
        portfolioSnapshotId: query.portfolioSnapshotId }, this.options)).projection;
      if (!isDeepStrictEqual(candidate, actual)) throw new Error("opening capacity projection differs from stored source replay");
      projections.push(actual);
    }
    const expected = makeDocument(projections);
    if (!isDeepStrictEqual(value, expected)) throw new Error("opening capacity document differs from canonical source replay");
    if (raw !== `${JSON.stringify(expected)}\n`) throw new Error("opening capacity document nested bytes are noncanonical");
    return expected;
  }

  // This outer lock serializes projection readers/writers only. Source repositories keep their existing lock order.
  // Do not call this repository while already holding one of the source repository locks.
  private async withLock<T>(operation: (assertOwned: () => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(this.baseDir, { recursive: true });
    await syncAncestors(this.baseDir);
    const deadline = performance.now() + this.options.lockTimeoutMs;
    let lastContention: unknown;
    while (true) {
      if (performance.now() >= deadline) throw new Error("opening capacity state lock is unavailable", { cause: lastContention });
      let handle: Awaited<ReturnType<typeof open>>;
      try { handle = await open(this.paths.lockPath, "wx"); }
      catch (error) {
        if (!isNodeError(error) || !(error.code === "EEXIST" || (process.platform === "win32" && error.code === "EPERM"))) throw error;
        lastContention = error;
        await new Promise((done) => setTimeout(done, Math.max(1, Math.min(this.options.lockRetryDelayMs, deadline - performance.now()))));
        continue;
      }
      const token = `${randomUUID()}\n`;
      try { await handle.writeFile(token, "utf8"); await handle.sync(); }
      catch (error) { await handle.close(); throw error; } // Preserve failed initialization barriers for explicit recovery.
      const assertOwned = async () => {
        if (await readFile(this.paths.lockPath, "utf8") !== token) throw new Error("opening capacity state lock ownership changed");
      };
      try { await assertOwned(); return await operation(assertOwned); }
      finally {
        try { await assertOwned(); } finally { await handle.close(); }
        await unlink(this.paths.lockPath);
        await syncDirectory(this.baseDir);
      }
    }
  }
}

function makeDocument(projections: readonly Projection[]): StoredBucketOpeningCapacityDocument {
  const ordered = [...projections].sort((a, b) => compareText(a.portfolioId, b.portfolioId));
  if (new Set(ordered.map((item) => item.portfolioId)).size !== ordered.length) throw new Error("opening capacity document repeats a portfolio");
  const payload = { schemaVersion: "bucket_opening_capacity_state_document.v1" as const, projections: Object.freeze(ordered) };
  return Object.freeze({ ...payload, documentHash: hashCanonicalPayload(payload) });
}
async function writeSnapshot(path: string, document: StoredBucketOpeningCapacityDocument) {
  const temporary = `${path}.tmp-${randomUUID()}`, handle = await open(temporary, "wx");
  try { await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8"); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temporary).catch(() => undefined); throw error; }
  await handle.close();
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  await syncDirectory(dirname(path));
}
async function syncFile(path: string) {
  const handle = await open(path, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function syncAncestors(path: string) {
  const paths: string[] = [];
  for (let current = await realpath(path); ; current = dirname(current)) {
    paths.unshift(current);
    if (dirname(current) === current) break;
  }
  for (const current of paths) await syncDirectory(current);
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!unsupportedDirectorySync(error)) throw error; } finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown) { return process.platform === "win32" && isNodeError(error) && error.code === "EPERM"; }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("opening capacity lock option must be a positive safe integer");
  return value;
}
