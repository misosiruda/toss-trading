import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { createInitialBucketTurnoverState } from "./bucketTurnover.js";
import { bucketTurnoverSnapshotOriginSchema, createBucketTurnoverSnapshotOrigin, resolveBucketTurnoverSnapshotOrigin,
  type BucketTurnoverSnapshotOrigin } from "./bucketTurnoverSnapshotOrigin.js";
import { PortfolioSizingSnapshotFileRepository, getDurablePortfolioSizingSnapshotObservation,
  type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot, RuntimePortfolioPolicyActivationFileRepository,
  type RuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { resolveActiveRuntimePortfolioPolicyAsOf } from "./runtimePortfolioPolicyActivation.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const BUCKET_TURNOVER_WINDOWS_FILE_NAME = "bucket-turnover-windows.jsonl";
const identifier = z.string().min(1).max(240).refine((value) => value === value.trim());
const inputSchema = z.object({ portfolioId: identifier, bucket: strategyBucketSchema, expectedPolicyHash: sha256HashSchema }).strict();
const policyOriginSchema = z.object({ activationId: identifier, activationEventHash: sha256HashSchema,
  runtimePolicyRecordId: identifier, policyHash: sha256HashSchema, policyLineageHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema,
  activationHistory: z.object({ eventCount: z.number().int().positive().safe(), eventsHash: sha256HashSchema }).strict()
}).strict();
type PolicyOrigin = z.infer<typeof policyOriginSchema>;
const entrySchema = z.object({ schemaVersion: z.literal("bucket_turnover_window_entry.v1"),
  snapshotOrigin: bucketTurnoverSnapshotOriginSchema, policyOrigin: policyOriginSchema,
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, previousEntryHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema
}).strict();
const markerSchema = z.object({ schemaVersion: z.literal("bucket_turnover_window_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();

export interface VerifiedBucketTurnoverWindowOrigin {
  snapshotOrigin: BucketTurnoverSnapshotOrigin;
  policyOrigin: Readonly<PolicyOrigin>;
  appendedAt: string;
  commitHash: string;
}
export interface VerifiedBucketTurnoverWindowHistory {
  windows: readonly VerifiedBucketTurnoverWindowOrigin[];
  generationHash: string | null;
}
const histories = new WeakSet<VerifiedBucketTurnoverWindowHistory>();

export function createBucketTurnoverWindowPaths(baseDir: string) {
  return { recordsPath: join(baseDir, BUCKET_TURNOVER_WINDOWS_FILE_NAME), lockPath: join(baseDir, `.${BUCKET_TURNOVER_WINDOWS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".bucket-turnover-window-pending.json") };
}

/** One immutable origin per window. This is not turnover event storage, a Risk gate or a fill transaction. */
export class BucketTurnoverWindowFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly pendingPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  constructor(private readonly baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    const paths = createBucketTurnoverWindowPaths(baseDir);
    this.recordsPath = paths.recordsPath; this.lockPath = paths.lockPath; this.pendingPath = paths.pendingPath;
    this.lockTimeoutMs = positiveInteger(options.lockTimeoutMs ?? 5_000);
    this.lockRetryDelayMs = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  async readVerifiedHistory(): Promise<VerifiedBucketTurnoverWindowHistory> {
    const policies = await readStoredRuntimePortfolioPolicyActivationSnapshot(this.baseDir);
    return new PortfolioSizingSnapshotFileRepository(this.baseDir).withDurableVerifiedHistory((snapshots) =>
      this.withLock(async () => this.readUnderLock(snapshots, policies)));
  }

  async createOrResolve(value: z.input<typeof inputSchema>): Promise<VerifiedBucketTurnoverWindowOrigin> {
    const input = inputSchema.parse(value);
    if (!isDeepStrictEqual(input, value)) throw new Error("turnover window request must already be canonical");
    // Match the established source -> activation -> destination lock order.
    const policies = await readStoredRuntimePortfolioPolicyActivationSnapshot(this.baseDir);
    return new PortfolioSizingSnapshotFileRepository(this.baseDir).withDurableVerifiedHistory(async (snapshots) => {
      const activationStore = new RuntimePortfolioPolicyActivationFileRepository(this.baseDir, policies.policies, policies.dependencies.repository);
      return activationStore.withDurableActivePolicy(input.portfolioId, async (active, observedAt, activationHistory, verifyHistory) => {
        if (active.policy.policyHash !== input.expectedPolicyHash) throw new Error("turnover window active policy drift");
        const bucket = active.policy.strategyBuckets.find((item) => item.bucket === input.bucket);
        if (bucket === undefined) throw new Error("turnover window bucket is not enabled");
        const window = createInitialBucketTurnoverState({ portfolioId: input.portfolioId, bucket: input.bucket,
          policyHash: active.policy.policyHash, durationSeconds: bucket.turnoverWindow.durationSeconds,
          asOf: observedAt, windowOpenPortfolioNetWorthKrw: 1 });
        const snapshotObservation = getDurablePortfolioSizingSnapshotObservation(snapshots);
        if (Date.parse(snapshotObservation.observedAt) > Date.parse(observedAt) ||
          Date.parse(snapshotObservation.observedAt) < Date.parse(window.windowStartedAt)) {
          throw new Error("turnover source observation crossed a window boundary or clock moved backward");
        }
        return this.withLock(async () => {
          const history = await this.readUnderLock(snapshots, policies);
          const existing = history.windows.find((origin) => origin.snapshotOrigin.initialState.turnoverStateId === window.turnoverStateId);
          if (existing !== undefined) {
            verifyHistory(existing.policyOrigin.activationHistory);
            await syncFile(this.recordsPath);
            return existing;
          }
          const snapshotOrigin = createBucketTurnoverSnapshotOrigin(snapshots, { portfolioId: input.portfolioId, bucket: input.bucket,
            policyHash: active.policy.policyHash, durationSeconds: bucket.turnoverWindow.durationSeconds, asOf: window.windowStartedAt });
          const policyOrigin: PolicyOrigin = { activationId: active.activation.activationId, activationEventHash: active.activation.activationEventHash,
            runtimePolicyRecordId: active.policy.runtimePolicyRecordId, policyHash: active.policy.policyHash,
            policyLineageHash: active.policy.lineageHash, observedAt, activationHistory };
          // Reject a policy generation appended after the initial source composition; a fresh call can retry.
          verifyPolicyOrigin(snapshotOrigin, policyOrigin, policies);
          const appendStartedAt = new Date().toISOString();
          const previousTime = history.windows.at(-1)?.appendedAt;
          if (Date.parse(appendStartedAt) < Date.parse(observedAt) ||
            (previousTime !== undefined && Date.parse(appendStartedAt) < Date.parse(previousTime)) ||
            Date.parse(appendStartedAt) >= Date.parse(window.windowEndsAt)) throw new Error("turnover window append clock or boundary mismatch");
          const payload = { schemaVersion: "bucket_turnover_window_entry.v1" as const, snapshotOrigin, policyOrigin,
            appendStartedAt, previousEntryHash: history.generationHash };
          const entryHash = hashCanonicalPayload(payload);
          // A retained barrier makes even a fully written but late marker unreadable after restart.
          const pending = await open(this.pendingPath, "wx");
          try {
            await pending.writeFile(`${JSON.stringify({ schemaVersion: "bucket_turnover_window_pending.v1", entryHash,
              turnoverStateId: window.turnoverStateId })}\n`, "utf8");
            await pending.sync();
          } finally { await pending.close(); }
          await syncDirectory(dirname(this.pendingPath));
          await appendLine(this.recordsPath, { ...payload, entryHash });
          const committedAt = new Date().toISOString();
          if (Date.parse(committedAt) < Date.parse(appendStartedAt) || Date.parse(committedAt) >= Date.parse(window.windowEndsAt)) {
            throw new Error("turnover window commit clock or boundary mismatch");
          }
          const marker = { schemaVersion: "bucket_turnover_window_commit.v1" as const, entryHash, committedAt };
          const commitHash = hashCanonicalPayload(marker);
          await appendLine(this.recordsPath, { ...marker, commitHash });
          const completedAt = Date.now();
          if (completedAt < Date.parse(committedAt) || completedAt >= Date.parse(window.windowEndsAt)) {
            throw new Error("turnover window fsync completion clock or boundary mismatch");
          }
          await unlink(this.pendingPath);
          await syncDirectory(dirname(this.pendingPath));
          return deepFreeze({ snapshotOrigin, policyOrigin, appendedAt: committedAt, commitHash });
        });
      });
    });
  }

  private async readUnderLock(snapshots: VerifiedPortfolioSizingSnapshotHistory, policies: RuntimePortfolioPolicyActivationSnapshot): Promise<VerifiedBucketTurnoverWindowHistory> {
    try { await lstat(this.pendingPath); }
    catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; return this.readCommittedUnderLock(snapshots, policies); }
    throw new Error("turnover window has a pending append; explicit recovery is required");
  }

  private async readCommittedUnderLock(snapshots: VerifiedPortfolioSizingSnapshotHistory, policies: RuntimePortfolioPolicyActivationSnapshot): Promise<VerifiedBucketTurnoverWindowHistory> {
    let raw: string;
    try { raw = await readFile(this.recordsPath, "utf8"); }
    catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; raw = ""; }
    if (raw.length > 0 && !raw.endsWith("\n")) throw new Error("turnover window file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const windows: VerifiedBucketTurnoverWindowOrigin[] = [];
    const ids = new Set<string>();
    let previousHash: string | null = null;
    let previousTime: string | null = null;
    for (let index = 0; index < lines.length; index += 2) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const snapshotOrigin = resolveBucketTurnoverSnapshotOrigin(snapshots, entry.snapshotOrigin);
        verifyPolicyOrigin(snapshotOrigin, entry.policyOrigin, policies);
        const { entryHash, ...payload } = entry;
        const initial = snapshotOrigin.initialState;
        if (!isDeepStrictEqual(value, entry) || entryHash !== hashCanonicalPayload(payload) || entry.previousEntryHash !== previousHash ||
          Date.parse(entry.appendStartedAt) < Date.parse(entry.policyOrigin.observedAt) ||
          Date.parse(entry.appendStartedAt) >= Date.parse(initial.windowEndsAt) ||
          (previousTime !== null && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) throw new Error("turnover window entry hash or chronology mismatch");
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = markerSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) ||
          Date.parse(marker.committedAt) >= Date.parse(initial.windowEndsAt) ||
          Date.parse(marker.committedAt) > Date.parse(getDurablePortfolioSizingSnapshotObservation(snapshots).observedAt)) {
          throw new Error("turnover window commit marker mismatch");
        }
        if (ids.has(initial.turnoverStateId)) throw new Error("turnover window duplicate root identity");
        ids.add(initial.turnoverStateId);
        windows.push(deepFreeze({ snapshotOrigin, policyOrigin: entry.policyOrigin, appendedAt: marker.committedAt, commitHash }));
        previousHash = commitHash; previousTime = marker.committedAt;
      } catch (error) { throw new Error(`turnover window corrupt entry at line ${index + 1}`, { cause: error }); }
    }
    if (windows.length > 0) await syncFile(this.recordsPath);
    const history = Object.freeze({ windows: Object.freeze(windows), generationHash: previousHash });
    histories.add(history);
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

/** Repository-verified historical origin, not a live lease or current execution permission. */
export function resolveVerifiedBucketTurnoverWindowOrigin(history: VerifiedBucketTurnoverWindowHistory, turnoverStateId: string): VerifiedBucketTurnoverWindowOrigin {
  if (!histories.has(history)) throw new Error("turnover window history is not repository-verified");
  const origin = history.windows.find((item) => item.snapshotOrigin.initialState.turnoverStateId === turnoverStateId);
  if (origin === undefined) throw new Error("turnover window does not resolve exactly once");
  return origin;
}

function verifyPolicyOrigin(origin: BucketTurnoverSnapshotOrigin, receipt: PolicyOrigin, source: RuntimePortfolioPolicyActivationSnapshot): void {
  const initial = origin.initialState;
  const events = source.events.slice(0, receipt.activationHistory.eventCount);
  if (events.length !== receipt.activationHistory.eventCount || hashCanonicalPayload(events) !== receipt.activationHistory.eventsHash) {
    throw new Error("turnover activation prefix differs from stored source");
  }
  const active = resolveActiveRuntimePortfolioPolicyAsOf({ portfolioId: initial.portfolioId, asOf: receipt.observedAt,
    events, policies: source.policies, dependencies: source.dependencies.repository });
  const bucket = active.policy.strategyBuckets.find((item) => item.bucket === initial.bucket);
  if (bucket === undefined || receipt.activationId !== active.activation.activationId || receipt.activationEventHash !== active.activation.activationEventHash ||
    receipt.runtimePolicyRecordId !== active.policy.runtimePolicyRecordId || receipt.policyHash !== active.policy.policyHash ||
    receipt.policyLineageHash !== active.policy.lineageHash || initial.lastAppliedPolicyHash !== active.policy.policyHash ||
    Date.parse(origin.observation.observedAt) > Date.parse(receipt.observedAt)) throw new Error("turnover window policy origin mismatch");
  const expected = createInitialBucketTurnoverState({ portfolioId: initial.portfolioId, bucket: initial.bucket,
    policyHash: active.policy.policyHash, asOf: receipt.observedAt, durationSeconds: bucket.turnoverWindow.durationSeconds,
    windowOpenPortfolioNetWorthKrw: initial.windowOpenPortfolioNetWorthKrw });
  if (!isDeepStrictEqual(initial, expected)) throw new Error("turnover window differs from policy-selected duration or observation");
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
    if (performance.now() >= deadline) throw new Error("turnover window repository lock is unavailable", { cause: lastContention });
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
      try { if (await readFile(path, "utf8") !== token) throw new Error("turnover window lock ownership changed"); } finally { await handle.close(); }
      await unlink(path); await syncDirectory(dirname(path));
    };
  }
}
function positiveInteger(value: number): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock timing must be a positive safe integer"); return value; }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}
