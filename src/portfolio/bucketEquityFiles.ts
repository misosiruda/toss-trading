import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  type BucketEquityEvent,
  type BucketRiskState,
  parseBucketEquityEvent,
  parseBucketRiskState
} from "./bucketEquity.js";
import {
  type BucketEquityHistorySnapshot,
  foldBucketEquityHistory
} from "./bucketEquityState.js";
import {
  compareText,
  hashCanonicalPayload
} from "./runtimePolicyContracts.js";

export const BUCKET_EQUITY_EVENTS_FILE_NAME = "bucket-equity-events.jsonl";
export const BUCKET_RISK_STATE_FILE_NAME = "bucket-risk-state.json";
export const BUCKET_EQUITY_TRANSACTION_FILE_NAME =
  ".bucket-equity-transaction.json";

const bucketRiskStateDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    states: z.array(z.unknown())
  })
  .strict();

const pendingTransactionSchema = z
  .object({
    schemaVersion: z.literal(1),
    previousEventFileByteLength: z.number().int().safe().nonnegative(),
    previousEventLogHash: sha256HashSchema,
    event: z.unknown(),
    resultingStates: z.array(z.unknown()),
    transactionHash: sha256HashSchema
  })
  .strict();

interface EventLogSnapshot {
  raw: Buffer;
  snapshot: BucketEquityHistorySnapshot;
}

interface PendingTransaction {
  schemaVersion: 1;
  previousEventFileByteLength: number;
  previousEventLogHash: z.infer<typeof sha256HashSchema>;
  event: BucketEquityEvent;
  resultingStates: readonly BucketRiskState[];
  transactionHash: z.infer<typeof sha256HashSchema>;
}

export interface BucketEquityFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createBucketEquityPaths(baseDir: string): {
  eventsPath: string;
  statePath: string;
  transactionPath: string;
  lockPath: string;
} {
  return {
    eventsPath: join(baseDir, BUCKET_EQUITY_EVENTS_FILE_NAME),
    statePath: join(baseDir, BUCKET_RISK_STATE_FILE_NAME),
    transactionPath: join(baseDir, BUCKET_EQUITY_TRANSACTION_FILE_NAME),
    lockPath: join(baseDir, `.${BUCKET_EQUITY_EVENTS_FILE_NAME}.lock`)
  };
}

/**
 * Strict append-only bucket equity storage with a durable risk-state projection.
 *
 * A pending journal binds the exact previous event-log bytes, candidate event,
 * and resulting states. Recovery either rolls an incomplete line back to that
 * verified prefix or completes the state projection before exposing a snapshot.
 */
export class BucketEquityFileRepository {
  private readonly eventsPath: string;
  private readonly statePath: string;
  private readonly transactionPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: BucketEquityFileRepositoryOptions = {}
  ) {
    const paths = createBucketEquityPaths(baseDir);
    this.eventsPath = paths.eventsPath;
    this.statePath = paths.statePath;
    this.transactionPath = paths.transactionPath;
    this.lockPath = paths.lockPath;
    this.lockTimeoutMs = positiveInteger(
      options.lockTimeoutMs ?? 5_000,
      "lockTimeoutMs"
    );
    this.lockRetryDelayMs = positiveInteger(
      options.lockRetryDelayMs ?? 10,
      "lockRetryDelayMs"
    );
  }

  async readSnapshot(): Promise<BucketEquityHistorySnapshot> {
    return this.withConsistentSnapshot((snapshot) => snapshot);
  }

  async append(value: unknown): Promise<BucketEquityEvent> {
    const candidate = cloneEvent(value);
    return this.withLock(async () => {
      await this.recoverPendingTransactionUnderLock();
      const eventLog = await this.readEventLogUnderLock();
      await this.assertStoredStateMatchesReplay(eventLog.snapshot.states);
      const existing = eventLog.snapshot.events.find(
        (event) => event.bucketEquityEventId === candidate.bucketEquityEventId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("bucket equity event ID collision");
        }
        await syncDurableJsonFile(this.eventsPath);
        await syncDurableJsonFile(this.statePath);
        return existing;
      }

      const nextSnapshot = foldBucketEquityHistory([
        ...eventLog.snapshot.events,
        candidate
      ]);
      const transaction = createPendingTransaction({
        previousEventLog: eventLog.raw,
        event: candidate,
        resultingStates: nextSnapshot.states
      });
      await writeDurableJsonDocument(this.transactionPath, transaction);
      await appendDurableJsonLine(this.eventsPath, candidate);
      await writeDurableStateSnapshot(this.statePath, nextSnapshot.states);
      await removeDurableFile(this.transactionPath);
      return candidate;
    });
  }

  async withConsistentSnapshot<T>(
    operation: (snapshot: BucketEquityHistorySnapshot) => Promise<T> | T
  ): Promise<T> {
    return this.withLock(async () => {
      await this.recoverPendingTransactionUnderLock();
      const eventLog = await this.readEventLogUnderLock();
      await this.assertStoredStateMatchesReplay(eventLog.snapshot.states);
      return operation(eventLog.snapshot);
    });
  }

  private async recoverPendingTransactionUnderLock(): Promise<void> {
    const transaction = await this.readPendingTransactionUnderLock();
    if (transaction === undefined) {
      return;
    }
    const raw = await readOptionalBuffer(this.eventsPath);
    if (raw.length < transaction.previousEventFileByteLength) {
      throw new Error(
        "bucket equity transaction event log is shorter than its prefix"
      );
    }
    const previous = raw.subarray(0, transaction.previousEventFileByteLength);
    if (hashBytes(previous) !== transaction.previousEventLogHash) {
      throw new Error(
        "bucket equity transaction event-log prefix hash mismatch"
      );
    }
    const previousSnapshot = parseEventLogBuffer(previous);
    const expectedTransactionSnapshot = foldBucketEquityHistory([
      ...previousSnapshot.events,
      transaction.event
    ]);
    if (
      !isDeepStrictEqual(
        expectedTransactionSnapshot.states,
        transaction.resultingStates
      )
    ) {
      throw new Error(
        "bucket equity transaction resulting states do not match replay"
      );
    }
    const candidateLine = Buffer.from(
      `${JSON.stringify(transaction.event)}\n`,
      "utf8"
    );
    const suffix = raw.subarray(transaction.previousEventFileByteLength);
    if (suffix.length > candidateLine.length) {
      throw new Error(
        "bucket equity transaction has unexpected later event bytes"
      );
    }
    if (!candidateLine.subarray(0, suffix.length).equals(suffix)) {
      throw new Error(
        "bucket equity transaction event bytes do not match journal"
      );
    }

    if (suffix.length < candidateLine.length) {
      if (suffix.length > 0) {
        await truncateDurableFile(
          this.eventsPath,
          transaction.previousEventFileByteLength
        );
      }
      await writeDurableStateSnapshot(
        this.statePath,
        previousSnapshot.states
      );
      await removeDurableFile(this.transactionPath);
      return;
    }

    await writeDurableStateSnapshot(
      this.statePath,
      transaction.resultingStates
    );
    await removeDurableFile(this.transactionPath);
  }

  private async readPendingTransactionUnderLock(): Promise<
    PendingTransaction | undefined
  > {
    let raw: string;
    try {
      raw = await readFile(this.transactionPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    if (!raw.endsWith("\n")) {
      throw new Error("bucket equity transaction file has a torn final write");
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error("bucket equity transaction file contains corrupt JSON", {
        cause: error
      });
    }
    return parsePendingTransaction(value);
  }

  private async readEventLogUnderLock(): Promise<EventLogSnapshot> {
    const raw = await readOptionalBuffer(this.eventsPath);
    return {
      raw,
      snapshot: parseEventLogBuffer(raw)
    };
  }

  private async assertStoredStateMatchesReplay(
    expectedStates: readonly BucketRiskState[]
  ): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if (
        isNodeError(error) &&
        error.code === "ENOENT" &&
        expectedStates.length === 0
      ) {
        return;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error("bucket risk state snapshot is missing");
      }
      throw error;
    }
    const states = parseStateDocument(raw);
    if (!isDeepStrictEqual(states, expectedStates)) {
      throw new Error("bucket risk state snapshot does not match event replay");
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const outputDirectory = dirname(this.eventsPath);
    await mkdir(outputDirectory, { recursive: true });
    await syncDirectoryAncestors(outputDirectory);
    const release = await acquireExclusiveLock({
      lockPath: this.lockPath,
      timeoutMs: this.lockTimeoutMs,
      retryDelayMs: this.lockRetryDelayMs
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}

function createPendingTransaction(input: {
  previousEventLog: Buffer;
  event: BucketEquityEvent;
  resultingStates: readonly BucketRiskState[];
}): PendingTransaction {
  const payload = {
    schemaVersion: 1 as const,
    previousEventFileByteLength: input.previousEventLog.length,
    previousEventLogHash: hashBytes(input.previousEventLog),
    event: input.event,
    resultingStates: input.resultingStates
  };
  return Object.freeze({
    ...payload,
    transactionHash: hashCanonicalPayload(payload)
  });
}

function parsePendingTransaction(value: unknown): PendingTransaction {
  const parsed = pendingTransactionSchema.parse(value);
  if (!isDeepStrictEqual(value, parsed)) {
    throw new Error("bucket equity transaction must already be canonical");
  }
  const {
    transactionHash,
    event: eventValue,
    resultingStates: stateValues,
    ...payloadBase
  } = parsed;
  const event = parseBucketEquityEvent(eventValue);
  const resultingStates = stateValues.map((state) =>
    parseBucketRiskState(state)
  );
  assertCanonicalStates(resultingStates);
  const payload = {
    ...payloadBase,
    event,
    resultingStates
  };
  if (transactionHash !== hashCanonicalPayload(payload)) {
    throw new Error("bucket equity transaction hash does not match its payload");
  }
  return Object.freeze({
    ...payload,
    resultingStates: Object.freeze(resultingStates),
    transactionHash
  });
}

function parseEventLogBuffer(raw: Buffer): BucketEquityHistorySnapshot {
  if (raw.length > 0 && raw[raw.length - 1] !== 0x0a) {
    throw new Error("bucket equity event file has a torn final line");
  }
  const text = raw.toString("utf8");
  const lines = text.split(/\r?\n/);
  lines.pop();
  const events: BucketEquityEvent[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(
        `bucket equity event file contains corrupt line ${index + 1}`
      );
    }
    try {
      events.push(parseBucketEquityEvent(JSON.parse(line)));
    } catch (error) {
      throw new Error(
        `bucket equity event file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
  }
  return foldBucketEquityHistory(events);
}

function parseStateDocument(raw: string): readonly BucketRiskState[] {
  if (!raw.endsWith("\n")) {
    throw new Error("bucket risk state snapshot has a torn final write");
  }
  let stored: z.infer<typeof bucketRiskStateDocumentSchema>;
  try {
    stored = bucketRiskStateDocumentSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error("bucket risk state snapshot contains corrupt JSON", {
      cause: error
    });
  }
  const states = stored.states.map((state) => parseBucketRiskState(state));
  assertCanonicalStates(states);
  return Object.freeze(states);
}

function assertCanonicalStates(states: readonly BucketRiskState[]): void {
  const scopes = new Set<string>();
  for (const state of states) {
    const key = JSON.stringify([state.portfolioId, state.bucket]);
    if (scopes.has(key)) {
      throw new Error("bucket risk state snapshot contains a duplicate scope");
    }
    scopes.add(key);
  }
  const canonical = [...states].sort(
    (left, right) =>
      compareText(left.portfolioId, right.portfolioId) ||
      compareText(left.bucket, right.bucket)
  );
  if (
    canonical.some(
      (state, index) => state.riskStateHash !== states[index]?.riskStateHash
    )
  ) {
    throw new Error("bucket risk state snapshot has non-canonical ordering");
  }
}

function cloneEvent(value: unknown): BucketEquityEvent {
  const event = parseBucketEquityEvent(value);
  return parseBucketEquityEvent(JSON.parse(JSON.stringify(event)));
}

function hashBytes(value: Buffer): z.infer<typeof sha256HashSchema> {
  return sha256HashSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`
  );
}

async function readOptionalBuffer(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return Buffer.alloc(0);
    }
    throw error;
  }
}

async function appendDurableJsonLine(
  path: string,
  value: BucketEquityEvent
): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function writeDurableStateSnapshot(
  path: string,
  states: readonly BucketRiskState[]
): Promise<void> {
  await writeDurableJsonDocument(path, {
    schemaVersion: 1,
    states
  });
}

async function writeDurableJsonDocument(
  path: string,
  value: unknown
): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await syncOutputDirectory(dirname(path));
}

async function truncateDurableFile(
  path: string,
  byteLength: number
): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(byteLength);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function removeDurableFile(path: string): Promise<void> {
  await unlink(path);
  await syncOutputDirectory(dirname(path));
}

async function syncDurableJsonFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function syncDirectoryAncestors(outputDirectory: string): Promise<void> {
  const outputPath = await realpath(outputDirectory);
  const directories: string[] = [];
  let currentPath = outputPath;
  while (true) {
    directories.unshift(currentPath);
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
  for (const directory of directories) {
    await syncOutputDirectory(directory);
  }
}

async function syncOutputDirectory(outputDirectory: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>>;
  try {
    directory = await open(outputDirectory, "r");
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySync(error)) {
      throw error;
    }
    return;
  }
  try {
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySync(error)) {
      throw error;
    }
  } finally {
    await directory.close();
  }
}

async function acquireExclusiveLock(input: {
  lockPath: string;
  timeoutMs: number;
  retryDelayMs: number;
}): Promise<() => Promise<void>> {
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error("bucket equity repository lock is unavailable");
    }
    try {
      const handle = await open(input.lockPath, "wx");
      const token = randomUUID();
      try {
        await handle.writeFile(`${token}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(input.lockPath).catch(() => undefined);
        throw error;
      }
      return async () => {
        try {
          const storedToken = await readFile(input.lockPath, "utf8");
          if (storedToken !== `${token}\n`) {
            throw new Error("bucket equity lock ownership changed");
          }
        } finally {
          await handle.close();
        }
        await unlink(input.lockPath);
        await syncOutputDirectory(dirname(input.lockPath));
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error("bucket equity repository lock is unavailable");
      }
      await delay(Math.min(input.retryDelayMs, remainingMs));
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function isUnsupportedWindowsDirectorySync(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    isNodeError(error) &&
    error.code === "EPERM"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
