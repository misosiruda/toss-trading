import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parseOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { replayOpeningCapacityReservationEvents } from "./openingCapacityReservationEventReplay.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const OPENING_CAPACITY_RESERVATION_EVENTS_FILE_NAME = "opening-capacity-reservation-events.jsonl";
const timestamp = offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString());
const entrySchema = z.object({ schemaVersion: z.literal("opening_capacity_event_entry.v1"), event: z.unknown(),
  appendStartedAt: timestamp, previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const markerSchema = z.object({ schemaVersion: z.literal("opening_capacity_event_commit.v1"), entryHash: sha256HashSchema,
  committedAt: timestamp, commitHash: sha256HashSchema }).strict();
type Ledger = ReturnType<typeof replayOpeningCapacityReservationEvents>;
export interface VerifiedOpeningCapacityEventOrigin {
  readonly event: OpeningCapacityReservationEvent;
  readonly appendStartedAt: string;
  readonly committedAt: string;
  readonly entryHash: string;
  readonly commitHash: string;
}
export interface VerifiedOpeningCapacityEventHistory {
  readonly events: readonly OpeningCapacityReservationEvent[];
  readonly ledgers: readonly Ledger[];
  readonly generationHash: string | null;
  readonly verificationScope: "stored_opening_capacity_event_history_only";
}
const origins = new WeakMap<VerifiedOpeningCapacityEventHistory, ReadonlyMap<string, VerifiedOpeningCapacityEventOrigin>>();
const observations = new WeakMap<VerifiedOpeningCapacityEventHistory, string>();

/** Storage origin only: does not authenticate the event's manual/selector/mandate/fill source claims. */
export function resolveStoredOpeningCapacityEventOrigin(history: VerifiedOpeningCapacityEventHistory, eventId: string) {
  const index = origins.get(history);
  if (!index) throw new Error("opening capacity history lacks a verified storage origin");
  const origin = index.get(eventId);
  if (!origin) throw new Error("opening capacity event is absent from the verified history");
  return origin;
}

/** Only valid inside the owning callback. This lease does not grant allocation or execution authority. */
export function getDurableOpeningCapacityEventObservedAt(history: VerifiedOpeningCapacityEventHistory) {
  const observedAt = observations.get(history);
  if (!observedAt) throw new Error("opening capacity history lacks a durable observation lease");
  return observedAt;
}

export function createOpeningCapacityReservationEventPaths(baseDir: string) {
  return { eventsPath: join(baseDir, OPENING_CAPACITY_RESERVATION_EVENTS_FILE_NAME),
    lockPath: join(baseDir, `.${OPENING_CAPACITY_RESERVATION_EVENTS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".opening-capacity-reservation-event-pending.json") };
}

/** Append-only structural journal. Not the shared budget/slot allocator or an atomic mandate/fill transaction. */
export class OpeningCapacityReservationEventFileRepository {
  private readonly baseDir: string;
  private readonly paths: ReturnType<typeof createOpeningCapacityReservationEventPaths>;
  private readonly options: { lockTimeoutMs: number; lockRetryDelayMs: number };
  constructor(baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.baseDir = resolve(baseDir);
    this.paths = createOpeningCapacityReservationEventPaths(this.baseDir);
    this.options = { lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? 5000),
      lockRetryDelayMs: positiveInteger(options.lockRetryDelayMs ?? 10) };
  }

  async readAll() { return (await this.readVerifiedHistory()).events; }
  async readVerifiedHistory(): Promise<VerifiedOpeningCapacityEventHistory> {
    return this.withDurableVerifiedHistory(async (history) => history);
  }
  /** Consumers must not re-enter this repository while holding its lock. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedOpeningCapacityEventHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const { history, observedAt } = await this.readUnderLock();
      observations.set(history, observedAt);
      try { return await operation(history); } finally { observations.delete(history); }
    });
  }

  async append(value: unknown): Promise<VerifiedOpeningCapacityEventOrigin> {
    // Capture and freeze before the first await; caller mutation cannot change the write.
    const event = parseOpeningCapacityReservationEvent(value);
    return this.withLock(async () => {
      const { history } = await this.readUnderLock();
      const index = origins.get(history)!;
      const existing = index.get(event.capacityReservationEventId);
      if (existing) {
        if (!isDeepStrictEqual(event, existing.event)) throw new Error("opening capacity event ID collision");
        return existing;
      }
      const ledger = history.ledgers.find((item) => scopeKey(item) === scopeKey(event));
      replayOpeningCapacityReservationEvents({ portfolioId: event.portfolioId, policyHash: event.policyHash,
        bucket: event.bucket, events: [...(ledger?.events ?? []), event] });
      const appendStartedAt = new Date().toISOString();
      const previousScope = ledger?.events.at(-1);
      validateAvailability(event, appendStartedAt, previousScope ? index.get(previousScope.capacityReservationEventId) : undefined);
      const previousEvent = history.events.at(-1);
      if (previousEvent && Date.parse(appendStartedAt) < Date.parse(index.get(previousEvent.capacityReservationEventId)!.committedAt)) {
        throw new Error("opening capacity append clock moved backwards");
      }
      const payload = { schemaVersion: "opening_capacity_event_entry.v1" as const, event, appendStartedAt,
        previousCommitHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      // Keep the barrier on every interrupted write; a complete-looking pair alone is not success.
      const pending = await open(this.paths.pendingPath, "wx");
      try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`); await pending.sync(); }
      finally { await pending.close(); }
      await syncDirectory(dirname(this.paths.pendingPath));
      await appendLine(this.paths.eventsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("opening capacity commit clock moved backwards");
      const marker = { schemaVersion: "opening_capacity_event_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.eventsPath, { ...marker, commitHash });
      if (Date.now() < Date.parse(committedAt)) throw new Error("opening capacity flush clock moved backwards");
      await unlink(this.paths.pendingPath);
      await syncDirectory(dirname(this.paths.pendingPath));
      return Object.freeze({ event, appendStartedAt, committedAt, entryHash, commitHash });
    });
  }

  private async readUnderLock() {
    try { await lstat(this.paths.pendingPath); throw new Error("opening capacity pending append requires explicit recovery"); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    const { raw, observedAt } = await readDurableRaw(this.paths.eventsPath);
    if (raw && !raw.endsWith("\n")) throw new Error("opening capacity file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const byId = new Map<string, VerifiedOpeningCapacityEventOrigin>();
    const scopes = new Map<string, { events: OpeningCapacityReservationEvent[]; last: VerifiedOpeningCapacityEventOrigin }>();
    const events: OpeningCapacityReservationEvent[] = [];
    let generationHash: string | null = null;
    let previousTime: string | undefined;
    for (let i = 0; i < lines.length; i += 2) {
      try {
        const value: unknown = JSON.parse(lines[i]!);
        const entry = entrySchema.parse(value);
        const event = parseOpeningCapacityReservationEvent(entry.event);
        const { entryHash, ...payload } = entry;
        if (!isDeepStrictEqual(value, entry) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generationHash) {
          throw new Error("opening capacity entry hash or predecessor mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[i + 1] ?? "");
        const marker = markerSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) || Date.parse(marker.committedAt) > Date.parse(observedAt) ||
          (previousTime !== undefined && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) {
          throw new Error("opening capacity commit hash or chronology mismatch");
        }
        const group = scopes.get(scopeKey(event));
        validateAvailability(event, entry.appendStartedAt, group?.last);
        if (byId.has(event.capacityReservationEventId)) throw new Error("opening capacity duplicate event ID");
        const origin = Object.freeze({ event, appendStartedAt: entry.appendStartedAt, committedAt: marker.committedAt, entryHash, commitHash });
        byId.set(event.capacityReservationEventId, origin);
        events.push(event);
        if (group) { group.events.push(event); group.last = origin; }
        else scopes.set(scopeKey(event), { events: [event], last: origin });
        generationHash = commitHash;
        previousTime = marker.committedAt;
      } catch (cause) { throw new Error(`opening capacity corrupt entry at line ${i + 1}`, { cause }); }
    }
    // Once per ledger, not once per growing event prefix. Every scope is checked before any consumer runs.
    const ledgers = [...scopes.values()].map(({ events: group, last }) => replayOpeningCapacityReservationEvents({
      portfolioId: last.event.portfolioId, policyHash: last.event.policyHash, bucket: last.event.bucket, events: group }));
    const history: VerifiedOpeningCapacityEventHistory = Object.freeze({ events: Object.freeze(events), ledgers: Object.freeze(ledgers),
      generationHash, verificationScope: "stored_opening_capacity_event_history_only" });
    origins.set(history, byId);
    return { history, observedAt };
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

function scopeKey(value: { portfolioId: string; policyHash: string; bucket: string }) {
  return JSON.stringify([value.portfolioId, value.policyHash, value.bucket]);
}
function validateAvailability(event: OpeningCapacityReservationEvent, appendStartedAt: string, previous?: VerifiedOpeningCapacityEventOrigin) {
  if (Date.parse(event.createdAt) > Date.parse(appendStartedAt) ||
    (previous && Date.parse(event.asOf) < Date.parse(previous.committedAt))) {
    throw new Error("opening capacity event predates its ledger origin or is not yet available");
  }
}

async function readDurableRaw(path: string): Promise<{ raw: string; observedAt: string }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); } catch (recheck) { if (isCode(recheck, "ENOENT")) return { raw: "", observedAt }; throw recheck; }
    throw new Error("opening capacity source appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("opening capacity source must be a regular file");
    const bytes = await handle.readFile();
    await handle.sync();
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (!bytesRead) throw new Error("opening capacity source changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("opening capacity source must be a regular file");
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("opening capacity source changed during observation");
    }
    return { raw: new TextDecoder("utf-8", { fatal: true }).decode(bytes), observedAt };
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
      try { if (await readFile(path, "utf8") !== token) throw new Error("opening capacity lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(path);
      await syncDirectory(dirname(path));
    };
  }
  throw new Error("opening capacity repository lock is unavailable", { cause: lastError });
}
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock option must be a positive safe integer"); return value; }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
