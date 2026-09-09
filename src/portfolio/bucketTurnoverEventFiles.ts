import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { createBucketTurnoverEvent, parseBucketTurnoverEvent, replayBucketTurnoverEvents,
  type BucketTurnoverEvent, type BucketTurnoverState } from "./bucketTurnover.js";
import { resolveBucketTurnoverFillOrigin } from "./bucketTurnoverFillOrigin.js";
import { BucketTurnoverWindowFileRepository, resolveVerifiedBucketTurnoverWindowOrigin, type VerifiedBucketTurnoverWindowHistory } from "./bucketTurnoverWindowFiles.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";

import { createBucketTurnoverCompletion, parseBucketTurnoverCompletion, type BucketTurnoverCompletion } from "./bucketTurnoverCompletion.js";

export const BUCKET_TURNOVER_EVENTS_FILE_NAME = "bucket-turnover-events.jsonl";
const identifier = z.string().min(1).max(240).refine((value) => value === value.trim());
const requestSchema = z.object({ paperFillRecordId: identifier, expectedTurnoverStateHash: sha256HashSchema }).strict();
const entrySchema = z.object({ schemaVersion: z.enum(["bucket_turnover_event_entry.v1", "bucket_turnover_event_entry.v2"]), event: z.unknown(), source: z.unknown(),
  priorStateHash: sha256HashSchema, appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousEntryHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const markerSchema = z.object({ schemaVersion: z.literal("bucket_turnover_event_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();
type Source = Awaited<ReturnType<typeof resolveBucketTurnoverFillOrigin>>;
export interface VerifiedBucketTurnoverEventOrigin {
  event: BucketTurnoverEvent; source: Source; priorStateHash: string; appendedAt: string; commitHash: string;
  completion?: BucketTurnoverCompletion;
}
export interface VerifiedBucketTurnoverEventHistory { events: readonly BucketTurnoverEvent[]; generationHash: string | null }
const histories = new WeakMap<VerifiedBucketTurnoverEventHistory, {
  origins: ReadonlyMap<string, VerifiedBucketTurnoverEventOrigin>;
  fills: ReadonlyMap<string, VerifiedBucketTurnoverEventOrigin>;
  states: ReadonlyMap<string, BucketTurnoverState>;
  lastCommittedAt: string | null;
}>();

export function createBucketTurnoverEventPaths(baseDir: string) {
  return { eventsPath: join(baseDir, BUCKET_TURNOVER_EVENTS_FILE_NAME), lockPath: join(baseDir, `.${BUCKET_TURNOVER_EVENTS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".bucket-turnover-event-pending.json") };
}

/** Turnover artifact CAS/replay only, not current Risk approval or atomic fill/accounting application. */
export class BucketTurnoverEventFileRepository {
  private readonly paths: ReturnType<typeof createBucketTurnoverEventPaths>;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  constructor(private readonly baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.paths = createBucketTurnoverEventPaths(baseDir);
    this.lockTimeoutMs = positiveInteger(options.lockTimeoutMs ?? 5_000);
    this.lockRetryDelayMs = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  async readVerifiedHistory(): Promise<VerifiedBucketTurnoverEventHistory> { return this.withLock(() => this.readUnderLock()); }
  /** Event -> snapshot -> window locks remain held; do not re-enter those repositories in the callback. */
  async withDurableStateSources<T>(operation: (events: VerifiedBucketTurnoverEventHistory,
    windows: VerifiedBucketTurnoverWindowHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const events = await this.readUnderLock();
      return new BucketTurnoverWindowFileRepository(this.baseDir, {
        lockTimeoutMs: this.lockTimeoutMs, lockRetryDelayMs: this.lockRetryDelayMs
      }).withDurableVerifiedHistory((windows) => operation(events, windows));
    });
  }

  /** Resolve historical event dependencies first, then retain event -> price -> snapshot -> window locks for the consumer. */
  async withDurableRiskSources<T>(operation: (events: VerifiedBucketTurnoverEventHistory, windows: VerifiedBucketTurnoverWindowHistory,
    prices: VerifiedSourcePriceEvidenceHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const events = await this.readUnderLock();
      return new BucketTurnoverWindowFileRepository(this.baseDir, {
        lockTimeoutMs: this.lockTimeoutMs, lockRetryDelayMs: this.lockRetryDelayMs
      }).withDurableRiskSources((windows, prices, snapshots) => operation(events, windows, prices, snapshots));
    });
  }
  async readWindowState(turnoverStateId: string): Promise<BucketTurnoverState> {
    identifier.parse(turnoverStateId);
    return this.withLock(async () => {
      const history = await this.readUnderLock();
      const root = resolveVerifiedBucketTurnoverWindowOrigin(await new BucketTurnoverWindowFileRepository(this.baseDir).readVerifiedHistory(), turnoverStateId);
      return replayBucketTurnoverEvents({ initialState: root.snapshotOrigin.initialState,
        events: history.events.filter((event) => event.turnoverStateId === turnoverStateId) });
    });
  }

  async appendFill(value: z.input<typeof requestSchema>): Promise<BucketTurnoverEvent> {
    return this.#appendFill(value, false);
  }

  /** New v2 event completion follows pair fsync and pending-barrier removal; existing events cannot acquire it later. */
  async appendFillWithCompletion(value: z.input<typeof requestSchema>): Promise<BucketTurnoverEvent> {
    return this.#appendFill(value, true);
  }

  async #appendFill(value: z.input<typeof requestSchema>, requireCompletion: boolean): Promise<BucketTurnoverEvent> {
    const input = requestSchema.parse(value);
    if (!isDeepStrictEqual(value, input)) throw new Error("turnover append request must already be canonical");
    return this.withLock(async () => {
      const history = await this.readUnderLock();
      const metadata = histories.get(history)!;
      const source = await resolveBucketTurnoverFillOrigin({ baseDir: this.baseDir, paperFillRecordId: input.paperFillRecordId },
        { lockTimeoutMs: this.lockTimeoutMs, lockRetryDelayMs: this.lockRetryDelayMs });
      const existing = metadata.fills.get(fillKey(source));
      if (existing !== undefined) {
        if (requireCompletion && existing.completion === undefined) throw new Error("turnover event completion cannot be added after persistence");
        if (!isDeepStrictEqual(existing.source, source) || existing.priorStateHash !== input.expectedTurnoverStateHash) {
          throw new Error("turnover fill retry origin or original state mismatch");
        }
        await syncFile(this.paths.eventsPath);
        return existing.event;
      }
      const initial = source.windowOrigin.snapshotOrigin.initialState;
      if (requireCompletion && source.windowOrigin.completion === undefined) throw new Error("turnover event completion requires a completed window root");
      const prior = metadata.states.get(initial.turnoverStateId) ?? initial;
      if (prior.turnoverStateHash !== input.expectedTurnoverStateHash) throw new Error("turnover state CAS mismatch");
      assertRiskPrior(source, prior);
      const createdAt = new Date().toISOString();
      if (Date.parse(createdAt) < Date.parse(source.paperFillOrigin.completion!.completedAt) ||
        Date.parse(createdAt) >= Date.parse(initial.windowEndsAt) ||
        (metadata.lastCommittedAt !== null && Date.parse(createdAt) < Date.parse(metadata.lastCommittedAt))) {
        throw new Error("turnover event source availability, clock or window boundary mismatch");
      }
      const cumulative = BigInt(prior.cumulativeAbsoluteFilledNotionalKrw) + BigInt(source.absoluteFilledNotionalKrw);
      if (cumulative > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("turnover cumulative amount exceeds safe integer range");
      const event = createBucketTurnoverEvent({ turnoverStateId: initial.turnoverStateId, portfolioId: source.portfolioId,
        bucket: source.bucket, policyHash: source.policyHash, rebalancePlanId: source.rebalancePlanId,
        rebalanceActionId: source.rebalanceActionId, fillId: source.fillId, absoluteFilledNotionalKrw: source.absoluteFilledNotionalKrw,
        resultingCumulativeAbsoluteFilledNotionalKrw: Number(cumulative), asOf: source.asOf, createdAt,
        ...(prior.lastTurnoverEventId === undefined ? {} : { previousTurnoverEventId: prior.lastTurnoverEventId }) });
      replayBucketTurnoverEvents({ initialState: initial,
        events: [...history.events.filter((item) => item.turnoverStateId === initial.turnoverStateId), event] });
      const payload = { schemaVersion: requireCompletion ? "bucket_turnover_event_entry.v2" as const : "bucket_turnover_event_entry.v1" as const, event, source,
        priorStateHash: prior.turnoverStateHash, appendStartedAt: createdAt, previousEntryHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      const pending = await open(this.paths.pendingPath, "wx");
      try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`, "utf8"); await pending.sync(); } finally { await pending.close(); }
      await syncDirectory(dirname(this.paths.pendingPath));
      await appendLine(this.paths.eventsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      assertCommitTime(committedAt, createdAt, initial.windowEndsAt);
      const marker = { schemaVersion: "bucket_turnover_event_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.eventsPath, { ...marker, commitHash });
      assertCommitTime(new Date().toISOString(), committedAt, initial.windowEndsAt);
      await unlink(this.paths.pendingPath);
      await syncDirectory(dirname(this.paths.pendingPath));
      if (requireCompletion) {
        const completedAt = new Date().toISOString();
        const completion = parseBucketTurnoverCompletion(createBucketTurnoverCompletion({ sourceKind: "event", commitHash, completedAt }),
          { sourceKind: "event", commitHash, committedAt, windowEndsAt: initial.windowEndsAt, observedAt: completedAt });
        await appendLine(this.paths.eventsPath, completion);
      }
      return event;
    });
  }

  private async readUnderLock(): Promise<VerifiedBucketTurnoverEventHistory> {
    try { await lstat(this.paths.pendingPath); throw new Error("turnover event pending append requires explicit recovery"); }
    catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; }
    let raw: string;
    try { raw = await readFile(this.paths.eventsPath, "utf8"); }
    catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; raw = ""; }
    if (raw.length > 0 && !raw.endsWith("\n")) throw new Error("turnover event file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const origins = new Map<string, VerifiedBucketTurnoverEventOrigin>();
    const fills = new Map<string, VerifiedBucketTurnoverEventOrigin>();
    const states = new Map<string, BucketTurnoverState>();
    const groups = new Map<string, BucketTurnoverEvent[]>();
    let previousHash: string | null = null;
    let previousTime: string | null = null;
    for (let index = 0; index < lines.length; index += 2) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const event = parseBucketTurnoverEvent(entry.event);
        const sourceRef = z.object({ paperFillOrigin: z.object({ paperFillRecordId: identifier }).passthrough() }).passthrough().parse(entry.source);
        const source = await resolveBucketTurnoverFillOrigin({ baseDir: this.baseDir, paperFillRecordId: sourceRef.paperFillOrigin.paperFillRecordId },
          { lockTimeoutMs: this.lockTimeoutMs, lockRetryDelayMs: this.lockRetryDelayMs });
        const initial = source.windowOrigin.snapshotOrigin.initialState;
        const prior = states.get(initial.turnoverStateId) ?? initial;
        assertRiskPrior(source, prior);
        const payload = { schemaVersion: entry.schemaVersion, event, source, priorStateHash: prior.turnoverStateHash,
          appendStartedAt: entry.appendStartedAt, previousEntryHash: previousHash };
        const expectedEvent = createBucketTurnoverEvent({ turnoverStateId: initial.turnoverStateId, portfolioId: source.portfolioId,
          bucket: source.bucket, policyHash: source.policyHash, rebalancePlanId: source.rebalancePlanId, rebalanceActionId: source.rebalanceActionId,
          fillId: source.fillId, absoluteFilledNotionalKrw: source.absoluteFilledNotionalKrw,
          resultingCumulativeAbsoluteFilledNotionalKrw: event.resultingCumulativeAbsoluteFilledNotionalKrw, asOf: source.asOf, createdAt: entry.appendStartedAt,
          ...(prior.lastTurnoverEventId === undefined ? {} : { previousTurnoverEventId: prior.lastTurnoverEventId }) });
        if (!isDeepStrictEqual(event, expectedEvent) || !isDeepStrictEqual(value, { ...payload, entryHash: hashCanonicalPayload(payload) }) ||
          Date.parse(event.createdAt) < Date.parse(source.paperFillOrigin.completion!.completedAt) ||
          (previousTime !== null && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) throw new Error("turnover event source, chain or chronology mismatch");
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = markerSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entry.entryHash ||
          commitHash !== hashCanonicalPayload(markerPayload) || Date.parse(marker.committedAt) > Date.now()) throw new Error("turnover event commit mismatch");
        assertCommitTime(marker.committedAt, entry.appendStartedAt, initial.windowEndsAt);
        const completion = entry.schemaVersion === "bucket_turnover_event_entry.v2"
          ? parseBucketTurnoverCompletion(JSON.parse(lines[index + 2] ?? ""), { sourceKind: "event", commitHash, committedAt: marker.committedAt,
            windowEndsAt: initial.windowEndsAt, observedAt: new Date().toISOString() }) : undefined;
        if (completion !== undefined) {
          if (source.windowOrigin.completion === undefined) throw new Error("turnover event completion requires a completed window root");
          index += 1;
        }
        if (origins.has(event.turnoverEventId) || fills.has(fillKey(source))) throw new Error("turnover event duplicate identity or portfolio fill");
        const events = [...(groups.get(initial.turnoverStateId) ?? []), event];
        states.set(initial.turnoverStateId, replayBucketTurnoverEvents({ initialState: initial, events }));
        groups.set(initial.turnoverStateId, events);
        const origin = Object.freeze({ event, source, priorStateHash: prior.turnoverStateHash, appendedAt: marker.committedAt, commitHash,
          ...(completion === undefined ? {} : { completion }) });
        origins.set(event.turnoverEventId, origin); fills.set(fillKey(source), origin);
        previousHash = completion?.completionHash ?? commitHash; previousTime = completion?.completedAt ?? marker.committedAt;
      } catch (error) { throw new Error(`turnover event corrupt entry at line ${index + 1}`, { cause: error }); }
    }
    if (origins.size > 0) await syncFile(this.paths.eventsPath);
    const history = Object.freeze({ events: Object.freeze([...origins.values()].map(({ event }) => event)), generationHash: previousHash });
    histories.set(history, { origins, fills, states, lastCommittedAt: previousTime });
    return history;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.paths.eventsPath);
    await mkdir(directory, { recursive: true }); await syncAncestors(directory);
    const release = await acquireLock(this.paths.lockPath, this.lockTimeoutMs, this.lockRetryDelayMs);
    try { return await operation(); } finally { await release(); }
  }
}

export function resolveVerifiedBucketTurnoverEventOrigin(history: VerifiedBucketTurnoverEventHistory, eventId: string): VerifiedBucketTurnoverEventOrigin {
  const metadata = histories.get(history);
  if (metadata === undefined) throw new Error("turnover event history is not repository-verified");
  const origin = metadata.origins.get(eventId);
  if (origin === undefined) throw new Error("turnover event does not resolve exactly once");
  return origin;
}
function assertRiskPrior(source: Source, prior: BucketTurnoverState): void {
  if (source.turnoverAssessment.turnoverStateHash !== prior.turnoverStateHash ||
    source.turnoverAssessment.priorBucketTurnoverNotionalKrw !== prior.cumulativeAbsoluteFilledNotionalKrw ||
    source.turnoverAssessment.requestedBucketTurnoverNotionalKrw < source.absoluteFilledNotionalKrw) {
    throw new Error("turnover Risk assessment differs from complete prior replay");
  }
}
function fillKey(source: Source): string { return JSON.stringify([source.portfolioId, source.fillId]); }
function assertCommitTime(value: string, before: string, end: string): void {
  if (Date.parse(value) < Date.parse(before) || Date.parse(value) >= Date.parse(end)) throw new Error("turnover event commit clock or boundary mismatch");
}
async function appendLine(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "a");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function syncAncestors(path: string): Promise<void> {
  let current = await realpath(path);
  const directories: string[] = [];
  while (true) { directories.unshift(current); const parent = dirname(current); if (parent === current) break; current = parent; }
  for (const directory of directories) await syncDirectory(directory);
}
async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!unsupportedDirectorySync(error)) throw error; } finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown): boolean { return process.platform === "win32" && isNodeError(error) && error.code === "EPERM"; }
async function acquireLock(path: string, timeoutMs: number, retryDelayMs: number): Promise<() => Promise<void>> {
  const deadline = performance.now() + timeoutMs;
  let lastContention: unknown;
  while (true) {
    if (performance.now() >= deadline) throw new Error("turnover event repository lock is unavailable", { cause: lastContention });
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(path, "wx"); }
    catch (error) {
      if (!isNodeError(error) || !(error.code === "EEXIST" || (process.platform === "win32" && error.code === "EPERM"))) throw error;
      lastContention = error;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(retryDelayMs, deadline - performance.now()))));
      continue;
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token, "utf8"); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(path).catch(() => undefined); throw error; }
    return async () => {
      try { if (await readFile(path, "utf8") !== token) throw new Error("turnover event lock ownership changed"); } finally { await handle.close(); }
      await unlink(path); await syncDirectory(dirname(path));
    };
  }
}
function positiveInteger(value: number): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock timing must be a positive safe integer"); return value; }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
