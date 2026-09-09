import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { ManualAssignmentFileRepository, getDurableManualAssignmentObservation, manualAssignmentObservationSchema,
  resolveObservedManualAssignmentHistory, type VerifiedManualAssignmentHistory } from "./manualAssignmentFiles.js";
import { parseManualOpeningCapacityReservationRecord, resolveManualOpeningCapacityReservationBinding,
  type ManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { PortfolioSizingSnapshotFileRepository, getDurablePortfolioSizingSnapshotObservation, portfolioSizingSnapshotObservationSchema,
  resolveObservedPortfolioSizingSnapshotHistory, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const MANUAL_OPENING_CAPACITY_RESERVATIONS_FILE_NAME = "manual-opening-capacity-reservations.jsonl";
const sourceSchema = z.object({ manualObservation: manualAssignmentObservationSchema,
  snapshotObservation: portfolioSizingSnapshotObservationSchema }).strict();
type Source = Readonly<z.infer<typeof sourceSchema>>;
const entrySchema = z.object({ schemaVersion: z.literal("manual_capacity_reservation_entry.v1"), record: z.unknown(), source: sourceSchema,
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const commitSchema = z.object({ schemaVersion: z.literal("manual_capacity_reservation_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();

export interface VerifiedManualCapacityReservationOrigin {
  readonly record: ManualOpeningCapacityReservationRecord;
  readonly source: Source;
  readonly appendStartedAt: string;
  readonly committedAt: string;
  readonly entryHash: string;
  readonly commitHash: string;
}
export interface VerifiedManualCapacityReservationHistory {
  readonly origins: readonly VerifiedManualCapacityReservationOrigin[];
  readonly generationHash: string | null;
}
const observations = new WeakMap<VerifiedManualCapacityReservationHistory, string>();

/** Actual source locks and the reservation lock are held only during this observation's callback. */
export function getDurableManualCapacityReservationObservation(history: VerifiedManualCapacityReservationHistory): string {
  const observedAt = observations.get(history);
  if (observedAt === undefined) throw new Error("manual capacity history lacks a durable observation lease");
  return observedAt;
}

export function createManualOpeningCapacityReservationPaths(baseDir: string) {
  return { recordsPath: join(baseDir, MANUAL_OPENING_CAPACITY_RESERVATIONS_FILE_NAME),
    lockPath: join(baseDir, `.${MANUAL_OPENING_CAPACITY_RESERVATIONS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".manual-opening-capacity-reservation-pending.json") };
}

/** Source-bound immutable records, not current capacity allocation or an atomic mandate transaction. */
export class ManualOpeningCapacityReservationFileRepository {
  private readonly paths: ReturnType<typeof createManualOpeningCapacityReservationPaths>;
  private readonly options: { lockTimeoutMs: number; lockRetryDelayMs: number };
  constructor(private readonly baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.paths = createManualOpeningCapacityReservationPaths(baseDir);
    this.options = { lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? 5000),
      lockRetryDelayMs: positiveInteger(options.lockRetryDelayMs ?? 10) };
  }

  async readAll(): Promise<readonly VerifiedManualCapacityReservationOrigin[]> {
    return this.withDurableVerifiedHistory(async (history) => history.origins);
  }

  /** Manual -> snapshot -> reservation. Consumers must reuse the supplied histories, never re-enter their stores. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedManualCapacityReservationHistory) => Promise<T>): Promise<T> {
    return this.withSources((manual, snapshots) => this.withLock(async () => {
      const { history, observedAt } = await this.readUnderLock(manual, snapshots);
      observations.set(history, observedAt);
      try { return await operation(history); }
      finally { observations.delete(history); }
    }));
  }

  async append(value: unknown): Promise<VerifiedManualCapacityReservationOrigin> {
    const record = parseManualOpeningCapacityReservationRecord(value);
    return this.withSources((manual, snapshots) => this.withLock(async () => {
      const { history } = await this.readUnderLock(manual, snapshots);
      const existing = history.origins.find((item) => item.record.manualCapacityReservationId === record.manualCapacityReservationId);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.record, record)) throw new Error("manual capacity reservation ID collision");
        return existing;
      }
      const source = freezeSource({ manualObservation: getDurableManualAssignmentObservation(manual),
        snapshotObservation: getDurablePortfolioSizingSnapshotObservation(snapshots) });
      const appendStartedAt = new Date().toISOString();
      verifySource(record, source, manual, snapshots, appendStartedAt);
      const previous = history.origins.at(-1);
      if (previous && Date.parse(appendStartedAt) < Date.parse(previous.committedAt)) throw new Error("manual capacity append clock moved backwards");
      const payload = { schemaVersion: "manual_capacity_reservation_entry.v1" as const, record, source,
        appendStartedAt, previousCommitHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      // An interrupted entry/marker write remains fail-closed, even when a complete line is visible.
      const pending = await open(this.paths.pendingPath, "wx");
      try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`); await pending.sync(); }
      finally { await pending.close(); }
      await syncDirectory(dirname(this.paths.pendingPath));
      await appendLine(this.paths.recordsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("manual capacity commit clock moved backwards");
      const marker = { schemaVersion: "manual_capacity_reservation_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.recordsPath, { ...marker, commitHash });
      if (Date.now() < Date.parse(committedAt)) throw new Error("manual capacity flush clock moved backwards");
      await unlink(this.paths.pendingPath);
      await syncDirectory(dirname(this.paths.pendingPath));
      return Object.freeze({ record, source, appendStartedAt, committedAt, entryHash, commitHash });
    }));
  }

  private withSources<T>(operation: (manual: VerifiedManualAssignmentHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>): Promise<T> {
    return new ManualAssignmentFileRepository(this.baseDir, this.options).withDurableVerifiedHistory((manual) =>
      new PortfolioSizingSnapshotFileRepository(this.baseDir, this.options).withDurableVerifiedHistory((snapshots) => operation(manual, snapshots)));
  }

  private async readUnderLock(manual: VerifiedManualAssignmentHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) {
    try { await lstat(this.paths.pendingPath); throw new Error("manual capacity pending append requires explicit recovery"); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    const { raw, observedAt } = await readDurableRaw(this.paths.recordsPath);
    if (raw && !raw.endsWith("\n")) throw new Error("manual capacity file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const origins: VerifiedManualCapacityReservationOrigin[] = [];
    const ids = new Set<string>();
    let generationHash: string | null = null;
    let previousTime: string | undefined;
    for (let index = 0; index < lines.length; index += 2) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const record = parseManualOpeningCapacityReservationRecord(entry.record);
        const { entryHash, ...payload } = entry;
        if (!isDeepStrictEqual(entry, value) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generationHash) {
          throw new Error("manual capacity entry hash or predecessor mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = commitSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) || Date.parse(marker.committedAt) > Date.parse(observedAt) ||
          (previousTime !== undefined && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) {
          throw new Error("manual capacity commit hash or chronology mismatch");
        }
        verifySource(record, entry.source, manual, snapshots, entry.appendStartedAt);
        if (ids.has(record.manualCapacityReservationId)) throw new Error("manual capacity duplicate reservation ID");
        ids.add(record.manualCapacityReservationId);
        origins.push(Object.freeze({ record, source: freezeSource(entry.source), appendStartedAt: entry.appendStartedAt,
          committedAt: marker.committedAt, entryHash, commitHash }));
        generationHash = commitHash;
        previousTime = marker.committedAt;
      } catch (cause) { throw new Error(`manual capacity corrupt entry at line ${index + 1}`, { cause }); }
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

function verifySource(record: ManualOpeningCapacityReservationRecord, source: Source,
  manual: VerifiedManualAssignmentHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory, appendStartedAt: string) {
  const events = resolveObservedManualAssignmentHistory(manual, source.manualObservation);
  const event = events.find((item) => item.manualAssignmentEventId === record.manualAssignmentEventId);
  if (!event) throw new Error("manual capacity authorization source is missing");
  resolveManualOpeningCapacityReservationBinding({ reservation: record, manualAssignmentEvent: event });
  const snapshot = resolveObservedPortfolioSizingSnapshotHistory(snapshots, source.snapshotObservation)
    .find((item) => item.portfolioSnapshotId === record.currentPortfolioSnapshotId);
  if (!snapshot || snapshot.portfolioSnapshotHash !== record.currentPortfolioSnapshotHash || snapshot.portfolioId !== record.portfolioId ||
    snapshot.policyHash !== record.policyHash || Date.parse(snapshot.asOf) > Date.parse(record.createdAt) ||
    Date.parse(event.createdAt) > Date.parse(source.manualObservation.observedAt) ||
    Date.parse(snapshot.asOf) > Date.parse(source.snapshotObservation.observedAt) ||
    Date.parse(record.createdAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.manualObservation.observedAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.snapshotObservation.observedAt) > Date.parse(appendStartedAt)) {
    throw new Error("manual capacity snapshot source or availability mismatch");
  }
}

function freezeSource(source: Source): Source {
  return Object.freeze({ manualObservation: Object.freeze({ ...source.manualObservation }),
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
    throw new Error("manual capacity source appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("manual capacity source must be a regular file");
    const bytes = await handle.readFile();
    await handle.sync();
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (!bytesRead) throw new Error("manual capacity source changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("manual capacity source must be a regular file");
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("manual capacity source changed during observation");
    }
    return { raw: bytes.toString("utf8"), observedAt };
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
      try { if (await readFile(path, "utf8") !== token) throw new Error("manual capacity lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(path);
      await syncDirectory(dirname(path));
    };
  }
  throw new Error("manual capacity repository lock is unavailable", { cause: lastError });
}
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock option must be a positive safe integer"); return value; }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
