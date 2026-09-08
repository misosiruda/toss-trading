import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parseBucketTurnoverState, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, resolveVerifiedBucketTurnoverEventOrigin,
  type VerifiedBucketTurnoverEventHistory } from "./bucketTurnoverEventFiles.js";
import { resolveVerifiedBucketTurnoverWindowOrigin, type VerifiedBucketTurnoverWindowHistory } from "./bucketTurnoverWindowFiles.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";

export const BUCKET_TURNOVER_STATE_FILE_NAME = "bucket-turnover-state.json";
const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const documentSchema = z.object({ schemaVersion: z.literal("bucket_turnover_state_document.v1"),
  sourceWindowCount: count, sourceWindowGenerationHash: sha256HashSchema.nullable(),
  sourceEventCount: count, sourceEventGenerationHash: sha256HashSchema.nullable(),
  states: z.array(z.unknown()), projectionHash: sha256HashSchema }).strict();
export interface VerifiedBucketTurnoverStateSnapshot extends Omit<z.infer<typeof documentSchema>, "states"> {
  states: readonly BucketTurnoverState[];
}
const observations = new WeakMap<VerifiedBucketTurnoverStateSnapshot, Readonly<{ observedAt: string }>>();

/** Explicit projection refresh only; stale or missing projections never silently become current Risk authority. */
export class BucketTurnoverStateFileRepository {
  private readonly statePath: string;
  private readonly events: BucketTurnoverEventFileRepository;
  constructor(baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.statePath = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    this.events = new BucketTurnoverEventFileRepository(baseDir, options);
  }

  async refresh(value: { expectedProjectionHash: string | null }): Promise<VerifiedBucketTurnoverStateSnapshot> {
    const input = z.object({ expectedProjectionHash: sha256HashSchema.nullable() }).strict().parse(value);
    if (!isDeepStrictEqual(value, input)) throw new Error("turnover projection request must already be canonical");
    return this.events.withDurableStateSources(async (events, windows) => {
      const current = deriveProjection(events, windows);
      const stored = await this.readStored(events, windows);
      // Exact retries converge to the already persisted current projection, with no clock/hash changes.
      if (stored !== null && isDeepStrictEqual(stored, current)) { await syncFile(this.statePath); return stored; }
      if ((stored?.projectionHash ?? null) !== input.expectedProjectionHash) throw new Error("turnover projection CAS mismatch");
      await writeSnapshot(this.statePath, current);
      return current;
    });
  }

  async readVerifiedSnapshot(): Promise<VerifiedBucketTurnoverStateSnapshot> {
    return this.withDurableSnapshot(async (snapshot) => snapshot);
  }

  /** The callback holds event/snapshot/window locks, not policy/Risk/reservation/execution authority. */
  async withDurableSnapshot<T>(operation: (snapshot: VerifiedBucketTurnoverStateSnapshot) => Promise<T>): Promise<T> {
    return this.events.withDurableStateSources(async (events, windows) => {
      const current = deriveProjection(events, windows);
      const stored = await this.readStored(events, windows);
      if (stored === null) throw new Error("turnover projection is missing; explicit refresh is required");
      if (!isDeepStrictEqual(stored, current)) throw new Error("turnover projection is stale; explicit refresh is required");
      await syncFile(this.statePath);
      const observedAt = new Date().toISOString();
      for (const origin of windows.windows) {
        if (Date.parse(observedAt) < Date.parse(origin.appendedAt)) throw new Error("turnover projection observation clock moved backward");
      }
      for (const event of events.events) {
        if (Date.parse(observedAt) < Date.parse(resolveVerifiedBucketTurnoverEventOrigin(events, event.turnoverEventId).appendedAt)) {
          throw new Error("turnover projection observation clock moved backward");
        }
      }
      observations.set(stored, Object.freeze({ observedAt }));
      try { return await operation(stored); } finally { observations.delete(stored); }
    });
  }

  private async readStored(events: VerifiedBucketTurnoverEventHistory, windows: VerifiedBucketTurnoverWindowHistory): Promise<VerifiedBucketTurnoverStateSnapshot | null> {
    let raw: string;
    try { raw = await readFile(this.statePath, "utf8"); }
    catch (error) { if (isNodeError(error) && error.code === "ENOENT") return null; throw error; }
    try {
      const value: unknown = JSON.parse(raw);
      const parsed = documentSchema.parse(value);
      for (const state of parsed.states) parseBucketTurnoverState(state);
      // A valid historical prefix may advance only through explicit refresh, never through ordinary read.
      const expected = deriveProjection(events, windows, parsed.sourceEventCount, parsed.sourceWindowCount);
      if (!isDeepStrictEqual(value, expected)) throw new Error("projection differs from its complete source prefix replay");
      return expected;
    } catch (error) { throw new Error("turnover projection is corrupt", { cause: error }); }
  }
}

export function getDurableBucketTurnoverStateObservation(snapshot: VerifiedBucketTurnoverStateSnapshot): Readonly<{ observedAt: string }> {
  const observation = observations.get(snapshot);
  if (observation === undefined) throw new Error("turnover projection has no active durable observation");
  return observation;
}

function deriveProjection(events: VerifiedBucketTurnoverEventHistory, windows: VerifiedBucketTurnoverWindowHistory,
  eventCount = events.events.length, windowCount = windows.windows.length): VerifiedBucketTurnoverStateSnapshot {
  if (eventCount > events.events.length || windowCount > windows.windows.length) throw new Error("turnover projection source prefix is unavailable");
  const roots = windows.windows.slice(0, windowCount);
  const prefix = events.events.slice(0, eventCount);
  const rootIds = new Set(roots.map(({ snapshotOrigin }) => snapshotOrigin.initialState.turnoverStateId));
  for (const event of prefix) {
    resolveVerifiedBucketTurnoverEventOrigin(events, event.turnoverEventId);
    if (!rootIds.has(event.turnoverStateId)) throw new Error("turnover projection event has no window root in its prefix");
  }
  const states = roots.map((root) => {
    const id = root.snapshotOrigin.initialState.turnoverStateId;
    resolveVerifiedBucketTurnoverWindowOrigin(windows, id);
    return replayBucketTurnoverEvents({ initialState: root.snapshotOrigin.initialState,
      events: prefix.filter((event) => event.turnoverStateId === id) });
  }).sort((a, b) => compareText(a.turnoverStateId, b.turnoverStateId));
  const lastEvent = prefix.at(-1);
  const payload = { schemaVersion: "bucket_turnover_state_document.v1" as const, sourceWindowCount: windowCount,
    sourceWindowGenerationHash: roots.at(-1)?.commitHash ?? null, sourceEventCount: eventCount,
    sourceEventGenerationHash: lastEvent === undefined ? null : resolveVerifiedBucketTurnoverEventOrigin(events, lastEvent.turnoverEventId).commitHash,
    states: Object.freeze(states) };
  return Object.freeze({ ...payload, projectionHash: hashCanonicalPayload(payload) });
}

async function writeSnapshot(path: string, snapshot: VerifiedBucketTurnoverStateSnapshot): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx");
  try { await handle.writeFile(`${JSON.stringify(snapshot)}\n`, "utf8"); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temporaryPath).catch(() => undefined); throw error; }
  await handle.close();
  try { await rename(temporaryPath, path); }
  catch (error) { await unlink(temporaryPath).catch(() => undefined); throw error; }
  await syncDirectory(dirname(path));
}
async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!unsupportedDirectorySync(error)) throw error; } finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown): boolean { return process.platform === "win32" && isNodeError(error) && error.code === "EPERM"; }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
