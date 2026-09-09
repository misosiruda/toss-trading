import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parseBucketTurnoverState, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, resolveVerifiedBucketTurnoverEventOrigin,
  assertBucketTurnoverEventHistorySource, type VerifiedBucketTurnoverEventHistory } from "./bucketTurnoverEventFiles.js";
import { BucketTurnoverWindowFileRepository, resolveVerifiedBucketTurnoverWindowOrigin, type VerifiedBucketTurnoverWindowHistory } from "./bucketTurnoverWindowFiles.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { getDurableSourcePriceEvidenceObservation, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { getDurablePortfolioSizingSnapshotObservation, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { bucketTurnoverObservationSchema, type BucketTurnoverObservation } from "./bucketTurnoverObservation.js";

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
const observationSources = new WeakMap<VerifiedBucketTurnoverStateSnapshot, {
  events: VerifiedBucketTurnoverEventHistory; windows: VerifiedBucketTurnoverWindowHistory;
}>();

/** Explicit projection refresh only; stale or missing projections never silently become current Risk authority. */
export class BucketTurnoverStateFileRepository {
  private readonly statePath: string;
  private readonly events: BucketTurnoverEventFileRepository;
  constructor(private readonly baseDir: string, private readonly options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.options = { ...options };
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

  /** Historical prefix replay only. A supplied history must be repository-issued for this root; it may be a validated event prefix. */
  async resolveObservedState(value: unknown, turnoverStateId: string, knownEvents?: VerifiedBucketTurnoverEventHistory) {
    const events = knownEvents ?? await this.events.readVerifiedHistory();
    await assertBucketTurnoverEventHistorySource(events, this.baseDir, knownEvents !== undefined);
    const windows = await new BucketTurnoverWindowFileRepository(this.baseDir, this.options).readVerifiedHistory();
    if (knownEvents !== undefined) await assertBucketTurnoverEventHistorySource(events, this.baseDir, true);
    return resolveObservedState({ events, windows }, value, turnoverStateId);
  }

  /** The callback holds event/snapshot/window locks, not policy/Risk/reservation/execution authority. */
  async withDurableSnapshot<T>(operation: (snapshot: VerifiedBucketTurnoverStateSnapshot) => Promise<T>): Promise<T> {
    return this.events.withDurableStateSources((events, windows) => this.withObservedSnapshot(events, windows, operation));
  }

  /** Source leases only, not Risk approval. Holds event -> price -> snapshot -> window; never re-enter those stores. */
  async withDurableRiskSources<T>(operation: (sources: Readonly<{ projection: VerifiedBucketTurnoverStateSnapshot;
    prices: VerifiedSourcePriceEvidenceHistory; snapshots: VerifiedPortfolioSizingSnapshotHistory }>) => Promise<T>): Promise<T> {
    return this.events.withDurableRiskSources((events, windows, prices, snapshots) =>
      this.withObservedSnapshot(events, windows, (projection) => {
        const priceAt = Date.parse(getDurableSourcePriceEvidenceObservation(prices).observedAt);
        const snapshotAt = Date.parse(getDurablePortfolioSizingSnapshotObservation(snapshots).observedAt);
        const projectionAt = Date.parse(getDurableBucketTurnoverStateObservation(projection).observedAt);
        if (priceAt > snapshotAt || snapshotAt > projectionAt) throw new Error("turnover Risk source observation clock moved backward");
        return operation(Object.freeze({ projection, prices, snapshots }));
      }));
  }

  private async withObservedSnapshot<T>(events: VerifiedBucketTurnoverEventHistory, windows: VerifiedBucketTurnoverWindowHistory,
    operation: (snapshot: VerifiedBucketTurnoverStateSnapshot) => Promise<T>): Promise<T> {
    const current = deriveProjection(events, windows);
    const stored = await this.readStored(events, windows);
    if (stored === null) throw new Error("turnover projection is missing; explicit refresh is required");
    if (!isDeepStrictEqual(stored, current)) throw new Error("turnover projection is stale; explicit refresh is required");
    await syncFile(this.statePath);
    const observedAt = new Date().toISOString();
    for (const origin of windows.windows) {
      if (Date.parse(observedAt) < Date.parse(origin.completion?.completedAt ?? origin.appendedAt)) throw new Error("turnover projection observation clock moved backward");
    }
    for (const event of events.events) {
      const origin = resolveVerifiedBucketTurnoverEventOrigin(events, event.turnoverEventId);
      if (Date.parse(observedAt) < Date.parse(origin.completion?.completedAt ?? origin.appendedAt)) {
        throw new Error("turnover projection observation clock moved backward");
      }
    }
    observations.set(stored, Object.freeze({ observedAt }));
    observationSources.set(stored, { events, windows });
    try { return await operation(stored); } finally { observations.delete(stored); observationSources.delete(stored); }
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

/** Source availability for a state in the actively locked projection, never for a clone or expired observation. */
export function getDurableBucketTurnoverStateSource(snapshot: VerifiedBucketTurnoverStateSnapshot, turnoverStateId: string) {
  getDurableBucketTurnoverStateObservation(snapshot);
  const sources = observationSources.get(snapshot)!;
  return stateSource(snapshot, sources, turnoverStateId);
}

export function getDurableBucketTurnoverObservation(snapshot: VerifiedBucketTurnoverStateSnapshot): BucketTurnoverObservation {
  const { observedAt } = getDurableBucketTurnoverStateObservation(snapshot);
  const { sourceWindowCount, sourceWindowGenerationHash, sourceEventCount, sourceEventGenerationHash, projectionHash } = snapshot;
  return Object.freeze({ sourceWindowCount, sourceWindowGenerationHash, sourceEventCount, sourceEventGenerationHash, projectionHash, observedAt });
}

/** Replays a retry's old prefix inside the currently held source locks without acquiring them again. */
export function resolveObservedBucketTurnoverState(snapshot: VerifiedBucketTurnoverStateSnapshot, value: unknown, turnoverStateId: string) {
  const current = getDurableBucketTurnoverStateObservation(snapshot);
  const observation = bucketTurnoverObservationSchema.parse(value);
  if (Date.parse(observation.observedAt) > Date.parse(current.observedAt)) throw new Error("turnover source observation is in the future");
  return resolveObservedState(observationSources.get(snapshot)!, value, turnoverStateId);
}

function resolveObservedState(sources: { events: VerifiedBucketTurnoverEventHistory; windows: VerifiedBucketTurnoverWindowHistory },
  value: unknown, turnoverStateId: string) {
  const observation = bucketTurnoverObservationSchema.parse(value);
  if (!isDeepStrictEqual(value, observation) || Date.parse(observation.observedAt) > Date.now()) throw new Error("turnover observation is noncanonical or in the future");
  const projection = deriveProjection(sources.events, sources.windows, observation.sourceEventCount, observation.sourceWindowCount);
  const { states: _states, schemaVersion: _schema, ...identity } = projection;
  const { observedAt, ...expected } = observation;
  if (!isDeepStrictEqual(identity, expected)) throw new Error("turnover observation does not match its actual source prefix");
  const cutoff = Date.parse(observedAt);
  for (const window of sources.windows.windows.slice(0, observation.sourceWindowCount)) {
    if (Date.parse(window.completion?.completedAt ?? window.appendedAt) > cutoff) throw new Error("turnover window prefix was unavailable at observation");
  }
  for (const event of sources.events.events.slice(0, observation.sourceEventCount)) {
    const origin = resolveVerifiedBucketTurnoverEventOrigin(sources.events, event.turnoverEventId);
    if (Date.parse(origin.completion?.completedAt ?? origin.appendedAt) > cutoff) throw new Error("turnover event prefix was unavailable at observation");
  }
  // A receipt may not omit a source already completed before its observation. Equal millisecond
  // timestamps do not prove ordering; current creation instead uses the complete locked histories.
  for (const window of sources.windows.windows.slice(observation.sourceWindowCount)) {
    if (Date.parse(window.completion?.completedAt ?? window.appendedAt) < cutoff) throw new Error("turnover observation omits an already available window");
  }
  for (const event of sources.events.events.slice(observation.sourceEventCount)) {
    const origin = resolveVerifiedBucketTurnoverEventOrigin(sources.events, event.turnoverEventId);
    if (Date.parse(origin.completion?.completedAt ?? origin.appendedAt) < cutoff) throw new Error("turnover observation omits an already available event");
  }
  return Object.freeze({ projection, source: stateSource(projection, sources, turnoverStateId) });
}

function stateSource(snapshot: VerifiedBucketTurnoverStateSnapshot,
  sources: { events: VerifiedBucketTurnoverEventHistory; windows: VerifiedBucketTurnoverWindowHistory }, turnoverStateId: string) {
  const state = snapshot.states.find((item) => item.turnoverStateId === turnoverStateId);
  if (state === undefined) throw new Error("turnover projection has no matching window state");
  const root = resolveVerifiedBucketTurnoverWindowOrigin(sources.windows, turnoverStateId);
  const last = state.lastTurnoverEventId === undefined ? null
    : resolveVerifiedBucketTurnoverEventOrigin(sources.events, state.lastTurnoverEventId);
  const rootTime = root.completion?.completedAt;
  const eventTime = last?.completion?.completedAt;
  const availableAt = rootTime === undefined || (last !== null && eventTime === undefined) ? null
    : eventTime !== undefined && Date.parse(eventTime) > Date.parse(rootTime) ? eventTime : rootTime;
  return Object.freeze({ state, availableAt, windowCommitHash: root.commitHash, lastEventCommitHash: last?.commitHash ?? null,
    windowCompletionHash: root.completion?.completionHash ?? null, lastEventCompletionHash: last?.completion?.completionHash ?? null });
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
  const lastOrigin = lastEvent === undefined ? undefined : resolveVerifiedBucketTurnoverEventOrigin(events, lastEvent.turnoverEventId);
  const lastWindow = roots.at(-1);
  const payload = { schemaVersion: "bucket_turnover_state_document.v1" as const, sourceWindowCount: windowCount,
    sourceWindowGenerationHash: lastWindow?.completion?.completionHash ?? lastWindow?.commitHash ?? null, sourceEventCount: eventCount,
    sourceEventGenerationHash: lastOrigin?.completion?.completionHash ?? lastOrigin?.commitHash ?? null,
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
