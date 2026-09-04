import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { parseRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { replayRebalancePlanEvents } from "./rebalancePlanEventReplay.js";
import { RebalancePlanFileRepository, resolveVerifiedRebalancePlanOrigin, type VerifiedRebalancePlanHistory } from "./rebalancePlanFiles.js";

export const REBALANCE_PLAN_EVENTS_FILE_NAME = "rebalance-plan-events.jsonl";
export interface VerifiedRebalancePlanEventHistory {
  events: readonly RebalancePlanEvent[];
  generationHash: string | null;
}
export interface VerifiedRebalancePlanEventOrigin {
  event: RebalancePlanEvent;
  planCommitHash: string;
  appendedAt: string;
  commitHash: string;
}
type Replay = ReturnType<typeof replayRebalancePlanEvents>;
const histories = new WeakMap<VerifiedRebalancePlanEventHistory, {
  origins: ReadonlyMap<string, VerifiedRebalancePlanEventOrigin>;
  states: ReadonlyMap<string, Replay>;
  lastCommittedAt: string | null;
}>();
const entrySchema = z.object({
  schemaVersion: z.literal("rebalance_plan_event_entry.v1"), event: z.unknown(),
  planCommitHash: sha256HashSchema, appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousEntryHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema
}).strict();
const markerSchema = z.object({
  schemaVersion: z.literal("rebalance_plan_event_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema
}).strict();

export function createRebalancePlanEventPaths(baseDir: string) {
  return { eventsPath: join(baseDir, REBALANCE_PLAN_EVENTS_FILE_NAME), lockPath: join(baseDir, `.${REBALANCE_PLAN_EVENTS_FILE_NAME}.lock`) };
}

/** Artifact persistence only: not a Risk approval or cross-artifact execution transaction. */
export class RebalancePlanEventFileRepository {
  private readonly eventsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  constructor(baseDir: string, private readonly plans: RebalancePlanFileRepository,
    options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    const paths = createRebalancePlanEventPaths(baseDir);
    this.eventsPath = paths.eventsPath;
    this.lockPath = paths.lockPath;
    this.lockTimeoutMs = positiveInteger(options.lockTimeoutMs ?? 5_000);
    this.lockRetryDelayMs = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  async readAll(): Promise<readonly RebalancePlanEvent[]> { return (await this.readVerifiedHistory()).events; }
  async readVerifiedHistory(): Promise<VerifiedRebalancePlanEventHistory> {
    return this.withLock(async () => this.readHistoryUnderLock(await this.plans.readVerifiedHistory()));
  }
  async readPlanState(planId: string): Promise<Replay> {
    return replayVerifiedRebalancePlanEventHistory(await this.readVerifiedHistory(), planId);
  }

  async append(value: unknown): Promise<RebalancePlanEvent> {
    const event = parseRebalancePlanEvent(value);
    return this.withLock(async () => {
      const plans = await this.plans.readVerifiedHistory();
      const history = await this.readHistoryUnderLock(plans);
      const metadata = histories.get(history)!;
      const existing = metadata.origins.get(event.planEventId);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.event, event)) throw new Error("rebalance event identity has different content");
        await syncFile(this.eventsPath);
        return existing.event;
      }
      const plan = resolveVerifiedRebalancePlanOrigin(plans, event.planId);
      const prior = metadata.states.get(event.planId);
      replayRebalancePlanEvents({ plan: plan.record, events: [...(prior?.events ?? []), event] });
      const predecessorTime = prior === undefined ? plan.appendedAt : metadata.origins.get(prior.lastEvent.planEventId)!.appendedAt;
      if (Date.parse(event.asOf) < Date.parse(predecessorTime)) throw new Error("rebalance event precedes stored plan or predecessor availability");
      const appendStartedAt = new Date().toISOString();
      if (Date.parse(appendStartedAt) < Date.parse(event.asOf)) throw new Error("rebalance event cannot be appended before its asOf");
      if (metadata.lastCommittedAt !== null && Date.parse(appendStartedAt) < Date.parse(metadata.lastCommittedAt)) {
        throw new Error("rebalance event clock moved backwards since previous commit");
      }
      const payload = { schemaVersion: "rebalance_plan_event_entry.v1" as const, event, planCommitHash: plan.commitHash,
        appendStartedAt, previousEntryHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      await appendLine(this.eventsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("rebalance event clock moved backwards during append");
      const marker = { schemaVersion: "rebalance_plan_event_commit.v1" as const, entryHash, committedAt };
      await appendLine(this.eventsPath, { ...marker, commitHash: hashCanonicalPayload(marker) });
      return event;
    });
  }

  private async readHistoryUnderLock(plans: VerifiedRebalancePlanHistory): Promise<VerifiedRebalancePlanEventHistory> {
    let raw: string;
    try { raw = await readFile(this.eventsPath, "utf8"); }
    catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; raw = ""; }
    if (raw.length > 0 && !raw.endsWith("\n")) throw new Error("rebalance event file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const origins = new Map<string, VerifiedRebalancePlanEventOrigin>();
    const groups = new Map<string, RebalancePlanEvent[]>();
    const lastPlanTimes = new Map<string, string>();
    let previousHash: string | null = null;
    let previousTime: string | null = null;
    for (let index = 0; index < lines.length; index += 2) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const event = parseRebalancePlanEvent(entry.event);
        const plan = resolveVerifiedRebalancePlanOrigin(plans, event.planId);
        const payload = { schemaVersion: entry.schemaVersion, event, planCommitHash: entry.planCommitHash,
          appendStartedAt: entry.appendStartedAt, previousEntryHash: entry.previousEntryHash };
        if (entry.entryHash !== hashCanonicalPayload(payload) || entry.previousEntryHash !== previousHash ||
          entry.planCommitHash !== plan.commitHash || !isDeepStrictEqual(value, { ...payload, entryHash: entry.entryHash }) ||
          Date.parse(entry.appendStartedAt) < Date.parse(event.asOf) ||
          Date.parse(event.asOf) < Date.parse(lastPlanTimes.get(event.planId) ?? plan.appendedAt) ||
          (previousTime !== null && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) {
          throw new Error("rebalance event entry hash, plan origin or chronology mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = markerSchema.parse(markerValue);
        const markerPayload = { schemaVersion: marker.schemaVersion, entryHash: marker.entryHash, committedAt: marker.committedAt };
        if (marker.entryHash !== entry.entryHash || marker.commitHash !== hashCanonicalPayload(markerPayload) ||
          !isDeepStrictEqual(markerValue, { ...markerPayload, commitHash: marker.commitHash }) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt)) throw new Error("rebalance event commit marker mismatch");
        if (origins.has(event.planEventId)) throw new Error("rebalance event file contains duplicate identity");
        origins.set(event.planEventId, Object.freeze({ event, planCommitHash: plan.commitHash, appendedAt: marker.committedAt, commitHash: marker.commitHash }));
        const events = groups.get(event.planId) ?? [];
        events.push(event); groups.set(event.planId, events);
        lastPlanTimes.set(event.planId, marker.committedAt);
        previousHash = marker.commitHash; previousTime = marker.committedAt;
      } catch (error) { throw new Error(`rebalance event file contains corrupt entry at line ${index + 1}`, { cause: error }); }
    }
    const states = new Map<string, Replay>();
    for (const [planId, events] of groups) states.set(planId, replayRebalancePlanEvents({ plan: resolveVerifiedRebalancePlanOrigin(plans, planId).record, events }));
    const history = Object.freeze({ events: Object.freeze([...origins.values()].map(({ event }) => event)), generationHash: previousHash });
    histories.set(history, { origins, states, lastCommittedAt: previousTime });
    return history;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.eventsPath);
    await mkdir(directory, { recursive: true });
    await syncAncestors(directory);
    const release = await acquireLock(this.lockPath, this.lockTimeoutMs, this.lockRetryDelayMs);
    try { return await operation(); } finally { await release(); }
  }
}

/** A verified historical observation, not a claim of current generation or execution authority. */
export function resolveVerifiedRebalancePlanEventOrigin(history: VerifiedRebalancePlanEventHistory, eventId: string): VerifiedRebalancePlanEventOrigin {
  const metadata = histories.get(history);
  if (metadata === undefined) throw new Error("rebalance event history is not repository-verified");
  const origin = metadata.origins.get(eventId);
  if (origin === undefined) throw new Error("rebalance event does not resolve exactly once");
  return origin;
}
export function replayVerifiedRebalancePlanEventHistory(history: VerifiedRebalancePlanEventHistory, planId: string): Replay {
  const metadata = histories.get(history);
  if (metadata === undefined) throw new Error("rebalance event history is not repository-verified");
  const state = metadata.states.get(planId);
  if (state === undefined) throw new Error("rebalance plan has no stored event history");
  return state;
}

async function appendLine(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "a");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
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
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown): boolean {
  return process.platform === "win32" && isNodeError(error) && error.code === "EPERM";
}
async function acquireLock(path: string, timeoutMs: number, retryDelayMs: number): Promise<() => Promise<void>> {
  const deadline = performance.now() + timeoutMs;
  let lastContention: unknown;
  while (true) {
    if (performance.now() >= deadline) throw new Error("rebalance event repository lock is unavailable", { cause: lastContention });
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
      try { if (await readFile(path, "utf8") !== token) throw new Error("rebalance event lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(path);
      await syncDirectory(dirname(path));
    };
  }
}
function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock timing must be a positive safe integer");
  return value;
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
