import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { parseRebalancePlanRecord, type RebalancePlanRecord } from "./rebalancePlan.js";

export const REBALANCE_PLAN_RECORDS_FILE_NAME = "rebalance-plan-records.jsonl";
export interface RebalancePlanFileRepositoryOptions { lockTimeoutMs?: number; lockRetryDelayMs?: number }
export interface VerifiedRebalancePlanHistory { records: readonly RebalancePlanRecord[] }
export interface VerifiedRebalancePlanOrigin { record: RebalancePlanRecord; appendedAt: string; commitHash: string }
const histories = new WeakMap<VerifiedRebalancePlanHistory, {
  origins: ReadonlyMap<string, VerifiedRebalancePlanOrigin>;
  tailHash: string | null;
  lastCommittedAt: string | null;
}>();
const entrySchema = z.object({
  schemaVersion: z.literal("rebalance_plan_entry.v1"), record: z.unknown(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousEntryHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema
}).strict();
const markerSchema = z.object({
  schemaVersion: z.literal("rebalance_plan_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema
}).strict();
type ParsedEntry = VerifiedRebalancePlanOrigin;

export function createRebalancePlanPaths(baseDir: string) {
  return { recordsPath: join(baseDir, REBALANCE_PLAN_RECORDS_FILE_NAME), lockPath: join(baseDir, `.${REBALANCE_PLAN_RECORDS_FILE_NAME}.lock`) };
}

/** Immutable artifact storage, not cycle completion, approval or atomic execution. */
export class RebalancePlanFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  constructor(baseDir: string, options: RebalancePlanFileRepositoryOptions = {}) {
    const paths = createRebalancePlanPaths(baseDir);
    this.recordsPath = paths.recordsPath;
    this.lockPath = paths.lockPath;
    this.lockTimeoutMs = positiveInteger(options.lockTimeoutMs ?? 5_000);
    this.lockRetryDelayMs = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  async readAll(): Promise<readonly RebalancePlanRecord[]> { return (await this.readVerifiedHistory()).records; }
  async readVerifiedHistory(): Promise<VerifiedRebalancePlanHistory> {
    return this.withLock(async () => this.readHistoryUnderLock());
  }
  async resolveById(planId: string): Promise<RebalancePlanRecord> {
    return resolveVerifiedRebalancePlanOrigin(await this.readVerifiedHistory(), planId).record;
  }

  async append(value: unknown): Promise<RebalancePlanRecord> {
    const candidate = parseRebalancePlanRecord(JSON.parse(JSON.stringify(parseRebalancePlanRecord(value))));
    return this.withLock(async () => {
      const history = await this.readHistoryUnderLock();
      const existing = history.records.find((record) => record.cycleId === candidate.cycleId || record.planId === candidate.planId);
      if (existing !== undefined) {
        const { createdAt: _priorTime, ...prior } = existing;
        const { createdAt: _candidateTime, ...next } = candidate;
        if (!isDeepStrictEqual(prior, next)) throw new Error("rebalance cycle already has a different plan");
        await syncFile(this.recordsPath);
        return existing;
      }
      const metadata = histories.get(history)!;
      const appendStartedAt = new Date().toISOString();
      if (Date.parse(appendStartedAt) < Date.parse(candidate.createdAt)) throw new Error("rebalance plan cannot be appended before creation");
      if (metadata.lastCommittedAt !== null && Date.parse(appendStartedAt) < Date.parse(metadata.lastCommittedAt)) {
        throw new Error("rebalance plan clock moved backwards since previous commit");
      }
      const payload = { schemaVersion: "rebalance_plan_entry.v1" as const, record: candidate, appendStartedAt, previousEntryHash: metadata.tailHash };
      const entryHash = hashCanonicalPayload(payload);
      await appendLine(this.recordsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("rebalance plan clock moved backwards during append");
      const marker = { schemaVersion: "rebalance_plan_commit.v1" as const, entryHash, committedAt };
      await appendLine(this.recordsPath, { ...marker, commitHash: hashCanonicalPayload(marker) });
      return candidate;
    });
  }

  private async readHistoryUnderLock(): Promise<VerifiedRebalancePlanHistory> {
    let raw: string;
    try { raw = await readFile(this.recordsPath, "utf8"); }
    catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; raw = ""; }
    const entries = parseLog(raw);
    const history = Object.freeze({ records: Object.freeze(entries.map((entry) => entry.record)) });
    histories.set(history, {
      origins: new Map(entries.map((entry) => [entry.record.planId, Object.freeze(entry)])),
      tailHash: entries.at(-1)?.commitHash ?? null,
      lastCommittedAt: entries.at(-1)?.appendedAt ?? null
    });
    return history;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.recordsPath);
    await mkdir(directory, { recursive: true });
    await syncAncestors(directory);
    const release = await acquireLock(this.lockPath, this.lockTimeoutMs, this.lockRetryDelayMs);
    try { return await operation(); } finally { await release(); }
  }
}

/** Parsing validates content but does not issue a repository provenance token. */
export function parseRebalancePlanRecords(raw: string): readonly RebalancePlanRecord[] {
  return Object.freeze(parseLog(raw).map((entry) => entry.record));
}
export function resolveVerifiedRebalancePlanOrigin(history: VerifiedRebalancePlanHistory, planId: string): VerifiedRebalancePlanOrigin {
  const metadata = histories.get(history);
  if (metadata === undefined) throw new Error("rebalance plan history is not repository-verified");
  const origin = metadata.origins.get(planId);
  if (origin === undefined) throw new Error("rebalance plan does not resolve exactly once");
  return origin;
}

function parseLog(raw: string): readonly ParsedEntry[] {
  if (raw.length > 0 && !raw.endsWith("\n")) throw new Error("rebalance plan file has a torn final line");
  const lines = raw.split(/\r?\n/); lines.pop();
  const entries: ParsedEntry[] = [];
  const ids = new Set<string>();
  const cycles = new Set<string>();
  let previousHash: string | null = null;
  let previousTime: string | null = null;
  for (let index = 0; index < lines.length; index += 2) {
    try {
      const value: unknown = JSON.parse(lines[index]!);
      const parsed = entrySchema.parse(value);
      const record = parseRebalancePlanRecord(parsed.record);
      const payload = { schemaVersion: parsed.schemaVersion, record, appendStartedAt: parsed.appendStartedAt, previousEntryHash: parsed.previousEntryHash };
      if (parsed.entryHash !== hashCanonicalPayload(payload) || parsed.previousEntryHash !== previousHash ||
        !isDeepStrictEqual(value, { ...payload, entryHash: parsed.entryHash }) ||
        Date.parse(parsed.appendStartedAt) < Date.parse(record.createdAt) ||
        (previousTime !== null && Date.parse(parsed.appendStartedAt) < Date.parse(previousTime))) throw new Error("rebalance plan entry hash or chronology mismatch");
      const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
      const marker = markerSchema.parse(markerValue);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash: marker.entryHash, committedAt: marker.committedAt };
      if (marker.entryHash !== parsed.entryHash || marker.commitHash !== hashCanonicalPayload(markerPayload) ||
        !isDeepStrictEqual(markerValue, { ...markerPayload, commitHash: marker.commitHash }) ||
        Date.parse(marker.committedAt) < Date.parse(parsed.appendStartedAt)) throw new Error("rebalance plan commit marker mismatch");
      if (ids.has(record.planId) || cycles.has(record.cycleId)) throw new Error("rebalance plan file has duplicate plan or cycle identity");
      ids.add(record.planId); cycles.add(record.cycleId);
      entries.push({ record, appendedAt: marker.committedAt, commitHash: marker.commitHash });
      previousHash = marker.commitHash; previousTime = marker.committedAt;
    } catch (error) { throw new Error(`rebalance plan file contains corrupt entry at line ${index + 1}`, { cause: error }); }
  }
  return entries;
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
  while (true) {
    directories.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
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
    if (performance.now() >= deadline) throw new Error("rebalance plan repository lock is unavailable", { cause: lastContention });
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "wx");
    } catch (error) {
      // Windows can report EPERM while the prior lock is delete-pending. Only
      // acquisition is retried; write/fsync/ownership errors below must escape.
      if (!isNodeError(error) || !(error.code === "EEXIST" || (process.platform === "win32" && error.code === "EPERM"))) throw error;
      lastContention = error;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(retryDelayMs, deadline - performance.now()))));
      continue;
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token, "utf8"); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(path).catch(() => undefined); throw error; }
    return async () => {
      try { if (await readFile(path, "utf8") !== token) throw new Error("rebalance plan lock ownership changed"); }
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
