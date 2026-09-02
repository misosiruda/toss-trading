import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import { dirname } from "node:path";
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
  createBucketEquityPaths,
  type BucketEquityFileRepositoryOptions
} from "./bucketEquityFiles.js";
import {
  type BucketEquityHistorySnapshot,
  foldBucketEquityHistory
} from "./bucketEquityState.js";
import {
  type BucketPositionMarkHeadEvent,
  type BucketPositionMarkHeadState,
  parseBucketPositionMarkHeadEvent,
  parseBucketPositionMarkHeadState
} from "./bucketPositionMarkHead.js";
import { createBucketPositionMarkHeadPaths } from "./bucketPositionMarkHeadFiles.js";
import {
  type BucketPositionMarkHeadHistorySnapshot,
  foldBucketPositionMarkHeadHistory
} from "./bucketPositionMarkHeadState.js";
import {
  type ResolvedBucketValuationApplication,
  resolveBucketValuationApplication
} from "./bucketValuationApplication.js";
import {
  createBucketValuationApplicationTransactionPath
} from "./bucketValuationApplicationTransactionBoundary.js";
import {
  type BucketValuationMarkRecord,
  parseBucketValuationMarkRecord
} from "./bucketValuationMark.js";
import { createBucketValuationMarkPaths } from "./bucketValuationMarkFiles.js";
import {
  compareText,
  hashCanonicalPayload
} from "./runtimePolicyContracts.js";

const stateDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    states: z.array(z.unknown())
  })
  .strict();

const pendingTransactionSchema = z
  .object({
    schemaVersion: z.literal(1),
    previousMarkFileByteLength: z.number().int().safe().nonnegative(),
    previousMarkLogHash: sha256HashSchema,
    previousEquityEventFileByteLength: z.number().int().safe().nonnegative(),
    previousEquityEventLogHash: sha256HashSchema,
    previousPositionEventFileByteLength: z.number().int().safe().nonnegative(),
    previousPositionEventLogHash: sha256HashSchema,
    previousRiskStateDocumentHash: sha256HashSchema,
    previousPositionStateDocumentHash: sha256HashSchema,
    record: z.unknown(),
    bucketEquityEvent: z.unknown(),
    positionMarkHeadEvents: z.array(z.unknown()).min(1).max(10_000),
    resultingRiskStates: z.array(z.unknown()),
    resultingPositionStates: z.array(z.unknown()),
    transactionHash: sha256HashSchema
  })
  .strict();

interface PendingBucketValuationApplicationTransaction {
  schemaVersion: 1;
  previousMarkFileByteLength: number;
  previousMarkLogHash: z.infer<typeof sha256HashSchema>;
  previousEquityEventFileByteLength: number;
  previousEquityEventLogHash: z.infer<typeof sha256HashSchema>;
  previousPositionEventFileByteLength: number;
  previousPositionEventLogHash: z.infer<typeof sha256HashSchema>;
  previousRiskStateDocumentHash: z.infer<typeof sha256HashSchema>;
  previousPositionStateDocumentHash: z.infer<typeof sha256HashSchema>;
  record: BucketValuationMarkRecord;
  bucketEquityEvent: BucketEquityEvent;
  positionMarkHeadEvents: readonly BucketPositionMarkHeadEvent[];
  resultingRiskStates: readonly BucketRiskState[];
  resultingPositionStates: readonly BucketPositionMarkHeadState[];
  transactionHash: z.infer<typeof sha256HashSchema>;
}

interface RepositorySnapshotUnderLock {
  markRaw: Buffer;
  equityEventRaw: Buffer;
  positionEventRaw: Buffer;
  riskStateRaw: Buffer;
  positionStateRaw: Buffer;
  records: readonly BucketValuationMarkRecord[];
  equity: BucketEquityHistorySnapshot;
  positions: BucketPositionMarkHeadHistorySnapshot;
}

export interface BucketValuationApplicationFileSnapshot {
  records: readonly BucketValuationMarkRecord[];
  equity: BucketEquityHistorySnapshot;
  positions: BucketPositionMarkHeadHistorySnapshot;
}

export interface PersistedBucketValuationApplication {
  record: BucketValuationMarkRecord;
  bucketEquityEvent: Extract<BucketEquityEvent, { eventType: "valuation" }>;
  positionMarkHeadEvents: readonly Extract<
    BucketPositionMarkHeadEvent,
    { eventType: "valuation_applied" }
  >[];
  alreadyApplied: boolean;
}

export interface BucketValuationApplicationFileRepositoryOptions
  extends BucketEquityFileRepositoryOptions {}

export function createBucketValuationApplicationPaths(baseDir: string): {
  markRecordsPath: string;
  equityEventsPath: string;
  riskStatePath: string;
  equityTransactionPath: string;
  positionEventsPath: string;
  positionStatePath: string;
  positionTransactionPath: string;
  transactionPath: string;
  lockPaths: readonly string[];
} {
  const mark = createBucketValuationMarkPaths(baseDir);
  const equity = createBucketEquityPaths(baseDir);
  const positions = createBucketPositionMarkHeadPaths(baseDir);
  return {
    markRecordsPath: mark.recordsPath,
    equityEventsPath: equity.eventsPath,
    riskStatePath: equity.statePath,
    equityTransactionPath: equity.transactionPath,
    positionEventsPath: positions.eventsPath,
    positionStatePath: positions.statePath,
    positionTransactionPath: positions.transactionPath,
    transactionPath: createBucketValuationApplicationTransactionPath(baseDir),
    lockPaths: Object.freeze(
      [mark.lockPath, equity.lockPath, positions.lockPath].sort(compareText)
    )
  };
}

/**
 * Atomically commits one verified valuation mark across all portfolio journals.
 *
 * The durable aggregate journal is the commit decision. Recovery always
 * validates the exact previous byte prefixes and rolls the complete graph
 * forward before any single-repository reader may expose it.
 */
export class BucketValuationApplicationFileRepository {
  private readonly paths: ReturnType<
    typeof createBucketValuationApplicationPaths
  >;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    private readonly baseDir: string,
    options: BucketValuationApplicationFileRepositoryOptions = {}
  ) {
    this.paths = createBucketValuationApplicationPaths(baseDir);
    this.lockTimeoutMs = positiveInteger(
      options.lockTimeoutMs ?? 5_000,
      "lockTimeoutMs"
    );
    this.lockRetryDelayMs = positiveInteger(
      options.lockRetryDelayMs ?? 10,
      "lockRetryDelayMs"
    );
  }

  async readSnapshot(): Promise<BucketValuationApplicationFileSnapshot> {
    return this.withLocks(async () => {
      await this.assertNoSingleRepositoryTransactionUnderLocks();
      await this.recoverPendingTransactionUnderLocks();
      return publicSnapshot(await this.readSnapshotUnderLocks());
    });
  }

  async apply(input: {
    value: unknown;
    currentPriceEvidence: readonly unknown[];
  }): Promise<PersistedBucketValuationApplication> {
    const record = cloneRecord(input.value);
    return this.withLocks(async () => {
      await this.assertNoSingleRepositoryTransactionUnderLocks();
      await this.recoverPendingTransactionUnderLocks();
      const snapshot = await this.readSnapshotUnderLocks();
      const existing = snapshot.records.find(
        (candidate) =>
          candidate.bucketValuationMarkRecordId ===
          record.bucketValuationMarkRecordId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, record)) {
          throw new Error("bucket valuation application mark ID collision");
        }
        await syncSnapshotFiles(this.paths);
        return resolvePersistedApplication(snapshot, existing, true);
      }
      if (
        snapshot.records.some(
          (candidate) => markOriginKey(candidate) === markOriginKey(record)
        )
      ) {
        throw new Error("bucket valuation application mark origin collision");
      }

      const currentRiskState = resolveCurrentRiskState(snapshot, record);
      const currentPositionStates = snapshot.positions.states;
      const currentPositionEvents = resolveCurrentPositionEvents(
        snapshot,
        record
      );
      const application = resolveBucketValuationApplication({
        value: record,
        currentPositionStates,
        currentPositionEvents,
        currentPriceEvidence: input.currentPriceEvidence,
        currentRiskState
      });
      const nextEquity = foldBucketEquityHistory([
        ...snapshot.equity.events,
        application.bucketEquityEvent
      ]);
      const nextPositions = foldBucketPositionMarkHeadHistory([
        ...snapshot.positions.events,
        ...application.positionMarkHeadEvents
      ]);
      const transaction = createPendingTransaction(
        snapshot,
        application,
        nextEquity.states,
        nextPositions.states
      );
      await writeDurableJsonDocument(this.paths.transactionPath, transaction);
      await this.rollForwardTransactionUnderLocks(transaction);
      return persistedApplication(application, false);
    });
  }

  private async recoverPendingTransactionUnderLocks(): Promise<void> {
    const transaction = await readPendingTransaction(this.paths.transactionPath);
    if (transaction === undefined) {
      return;
    }
    await this.rollForwardTransactionUnderLocks(transaction);
  }

  private async rollForwardTransactionUnderLocks(
    transaction: PendingBucketValuationApplicationTransaction
  ): Promise<void> {
    const current = {
      markRaw: await readOptionalBuffer(this.paths.markRecordsPath),
      equityEventRaw: await readOptionalBuffer(this.paths.equityEventsPath),
      positionEventRaw: await readOptionalBuffer(this.paths.positionEventsPath),
      riskStateRaw: await readOptionalBuffer(this.paths.riskStatePath),
      positionStateRaw: await readOptionalBuffer(this.paths.positionStatePath)
    };
    const markBytes = jsonLines([transaction.record]);
    const equityBytes = jsonLines([transaction.bucketEquityEvent]);
    const positionBytes = jsonLines(transaction.positionMarkHeadEvents);
    const markPrevious = validateAppendTarget({
      raw: current.markRaw,
      previousByteLength: transaction.previousMarkFileByteLength,
      previousHash: transaction.previousMarkLogHash,
      appendedBytes: markBytes,
      label: "mark"
    });
    const equityPrevious = validateAppendTarget({
      raw: current.equityEventRaw,
      previousByteLength: transaction.previousEquityEventFileByteLength,
      previousHash: transaction.previousEquityEventLogHash,
      appendedBytes: equityBytes,
      label: "equity event"
    });
    const positionPrevious = validateAppendTarget({
      raw: current.positionEventRaw,
      previousByteLength: transaction.previousPositionEventFileByteLength,
      previousHash: transaction.previousPositionEventLogHash,
      appendedBytes: positionBytes,
      label: "position event"
    });

    const previousRecords = parseMarkLogBuffer(markPrevious);
    assertMarkCanAppend(previousRecords, transaction.record);
    const previousEquity = parseEquityEventLogBuffer(equityPrevious);
    const expectedEquity = foldBucketEquityHistory([
      ...previousEquity.events,
      transaction.bucketEquityEvent
    ]);
    if (!isDeepStrictEqual(expectedEquity.states, transaction.resultingRiskStates)) {
      throw new Error(
        "bucket valuation application risk states do not match replay"
      );
    }
    const previousPositions = parsePositionEventLogBuffer(positionPrevious);
    const expectedPositions = foldBucketPositionMarkHeadHistory([
      ...previousPositions.events,
      ...transaction.positionMarkHeadEvents
    ]);
    if (
      !isDeepStrictEqual(
        expectedPositions.states,
        transaction.resultingPositionStates
      )
    ) {
      throw new Error(
        "bucket valuation application position states do not match replay"
      );
    }
    assertApplicationEvents(
      transaction.record,
      transaction.bucketEquityEvent,
      transaction.positionMarkHeadEvents
    );
    const resultingRiskStateBytes = stateDocumentBytes(
      transaction.resultingRiskStates
    );
    const resultingPositionStateBytes = stateDocumentBytes(
      transaction.resultingPositionStates
    );
    assertStateDocumentCanRollForward({
      raw: current.riskStateRaw,
      previousHash: transaction.previousRiskStateDocumentHash,
      resultingBytes: resultingRiskStateBytes,
      label: "risk state"
    });
    assertStateDocumentCanRollForward({
      raw: current.positionStateRaw,
      previousHash: transaction.previousPositionStateDocumentHash,
      resultingBytes: resultingPositionStateBytes,
      label: "position state"
    });

    await ensureAppended(
      this.paths.markRecordsPath,
      transaction.previousMarkFileByteLength,
      markBytes,
      current.markRaw.length
    );
    await ensureAppended(
      this.paths.equityEventsPath,
      transaction.previousEquityEventFileByteLength,
      equityBytes,
      current.equityEventRaw.length
    );
    await ensureAppended(
      this.paths.positionEventsPath,
      transaction.previousPositionEventFileByteLength,
      positionBytes,
      current.positionEventRaw.length
    );
    await writeDurableBytes(this.paths.riskStatePath, resultingRiskStateBytes);
    await writeDurableBytes(
      this.paths.positionStatePath,
      resultingPositionStateBytes
    );
    await removeDurableFile(this.paths.transactionPath);
  }

  private async readSnapshotUnderLocks(): Promise<RepositorySnapshotUnderLock> {
    const markRaw = await readOptionalBuffer(this.paths.markRecordsPath);
    const equityEventRaw = await readOptionalBuffer(this.paths.equityEventsPath);
    const positionEventRaw = await readOptionalBuffer(
      this.paths.positionEventsPath
    );
    const riskStateRaw = await readRequiredBuffer(
      this.paths.riskStatePath,
      "bucket valuation application risk state snapshot is missing"
    );
    const positionStateRaw = await readRequiredBuffer(
      this.paths.positionStatePath,
      "bucket valuation application position state snapshot is missing"
    );
    const records = parseMarkLogBuffer(markRaw);
    const equity = parseEquityEventLogBuffer(equityEventRaw);
    const positions = parsePositionEventLogBuffer(positionEventRaw);
    const storedRiskStates = parseRiskStateDocument(riskStateRaw);
    const storedPositionStates = parsePositionStateDocument(positionStateRaw);
    if (!isDeepStrictEqual(storedRiskStates, equity.states)) {
      throw new Error(
        "bucket valuation application risk state does not match replay"
      );
    }
    if (!isDeepStrictEqual(storedPositionStates, positions.states)) {
      throw new Error(
        "bucket valuation application position state does not match replay"
      );
    }
    return {
      markRaw,
      equityEventRaw,
      positionEventRaw,
      riskStateRaw,
      positionStateRaw,
      records,
      equity,
      positions
    };
  }

  private async assertNoSingleRepositoryTransactionUnderLocks(): Promise<void> {
    for (const path of [
      this.paths.equityTransactionPath,
      this.paths.positionTransactionPath
    ]) {
      if (await fileExists(path)) {
        throw new Error(
          "bucket valuation application requires single-repository recovery"
        );
      }
    }
  }

  private async withLocks<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.baseDir, { recursive: true });
    await syncDirectoryAncestors(this.baseDir);
    const releases: Array<() => Promise<void>> = [];
    try {
      for (const lockPath of this.paths.lockPaths) {
        releases.push(
          await acquireExclusiveLock({
            lockPath,
            timeoutMs: this.lockTimeoutMs,
            retryDelayMs: this.lockRetryDelayMs
          })
        );
      }
      return await operation();
    } finally {
      await releaseAllLocks(releases);
    }
  }
}

function createPendingTransaction(
  snapshot: RepositorySnapshotUnderLock,
  application: ResolvedBucketValuationApplication,
  resultingRiskStates: readonly BucketRiskState[],
  resultingPositionStates: readonly BucketPositionMarkHeadState[]
): PendingBucketValuationApplicationTransaction {
  const payload = {
    schemaVersion: 1 as const,
    previousMarkFileByteLength: snapshot.markRaw.length,
    previousMarkLogHash: hashBytes(snapshot.markRaw),
    previousEquityEventFileByteLength: snapshot.equityEventRaw.length,
    previousEquityEventLogHash: hashBytes(snapshot.equityEventRaw),
    previousPositionEventFileByteLength: snapshot.positionEventRaw.length,
    previousPositionEventLogHash: hashBytes(snapshot.positionEventRaw),
    previousRiskStateDocumentHash: hashBytes(snapshot.riskStateRaw),
    previousPositionStateDocumentHash: hashBytes(snapshot.positionStateRaw),
    record: application.record,
    bucketEquityEvent: application.bucketEquityEvent,
    positionMarkHeadEvents: application.positionMarkHeadEvents,
    resultingRiskStates,
    resultingPositionStates
  };
  return deepFreeze({
    ...payload,
    transactionHash: hashCanonicalPayload(payload)
  });
}

async function readPendingTransaction(
  path: string
): Promise<PendingBucketValuationApplicationTransaction | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!raw.endsWith("\n")) {
    throw new Error(
      "bucket valuation application transaction has a torn final write"
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "bucket valuation application transaction contains corrupt JSON",
      { cause: error }
    );
  }
  return parsePendingTransaction(value);
}

function parsePendingTransaction(
  value: unknown
): PendingBucketValuationApplicationTransaction {
  const parsed = pendingTransactionSchema.parse(value);
  if (!isDeepStrictEqual(value, parsed)) {
    throw new Error(
      "bucket valuation application transaction must already be canonical"
    );
  }
  const {
    transactionHash,
    record: recordValue,
    bucketEquityEvent: equityEventValue,
    positionMarkHeadEvents: positionEventValues,
    resultingRiskStates: riskStateValues,
    resultingPositionStates: positionStateValues,
    ...base
  } = parsed;
  const record = parseBucketValuationMarkRecord(recordValue);
  const bucketEquityEvent = parseBucketEquityEvent(equityEventValue);
  const positionMarkHeadEvents = positionEventValues.map((event) =>
    parseBucketPositionMarkHeadEvent(event)
  );
  const resultingRiskStates = riskStateValues.map((state) =>
    parseBucketRiskState(state)
  );
  const resultingPositionStates = positionStateValues.map((state) =>
    parseBucketPositionMarkHeadState(state)
  );
  const payload = {
    ...base,
    record,
    bucketEquityEvent,
    positionMarkHeadEvents,
    resultingRiskStates,
    resultingPositionStates
  };
  if (transactionHash !== hashCanonicalPayload(payload)) {
    throw new Error(
      "bucket valuation application transaction hash does not match its payload"
    );
  }
  return deepFreeze({ ...payload, transactionHash });
}

function resolveCurrentRiskState(
  snapshot: RepositorySnapshotUnderLock,
  record: BucketValuationMarkRecord
): BucketRiskState {
  const matches = snapshot.equity.states.filter(
    (state) =>
      state.portfolioId === record.portfolioId && state.bucket === record.bucket
  );
  if (matches.length !== 1) {
    throw new Error(
      "bucket valuation application risk state does not resolve exactly once"
    );
  }
  return matches[0] as BucketRiskState;
}

function resolveCurrentPositionEvents(
  snapshot: RepositorySnapshotUnderLock,
  record: BucketValuationMarkRecord
): readonly BucketPositionMarkHeadEvent[] {
  const activeStates = snapshot.positions.states.filter(
    (state) =>
      state.portfolioId === record.portfolioId &&
      state.bucket === record.bucket &&
      state.quantity > 0
  );
  return Object.freeze(
    activeStates.map((state) => {
      const matches = snapshot.positions.events.filter(
        (event) =>
          event.positionMarkHeadEventId ===
          state.lastPositionMarkHeadEventId
      );
      if (matches.length !== 1) {
        throw new Error(
          "bucket valuation application current position event does not resolve exactly once"
        );
      }
      return matches[0] as BucketPositionMarkHeadEvent;
    })
  );
}

function resolvePersistedApplication(
  snapshot: RepositorySnapshotUnderLock,
  record: BucketValuationMarkRecord,
  alreadyApplied: boolean
): PersistedBucketValuationApplication {
  const equityMatches = snapshot.equity.events.filter(
    (event) =>
      event.eventType === "valuation" &&
      event.bucketValuationMarkRecordId === record.bucketValuationMarkRecordId
  );
  if (equityMatches.length !== 1) {
    throw new Error(
      "stored bucket valuation application equity event is incomplete"
    );
  }
  const bucketEquityEvent = equityMatches[0] as Extract<
    BucketEquityEvent,
    { eventType: "valuation" }
  >;
  const positionMatches = snapshot.positions.events.filter(
    (event) =>
      event.eventType === "valuation_applied" &&
      event.bucketValuationMarkRecordId === record.bucketValuationMarkRecordId
  ) as Extract<
    BucketPositionMarkHeadEvent,
    { eventType: "valuation_applied" }
  >[];
  assertApplicationEvents(record, bucketEquityEvent, positionMatches);
  const byScope = new Map(
    positionMatches.map((event) => [instrumentKey(event), event])
  );
  const canonicalEvents = record.positionInputs.map((position) => {
    const event = byScope.get(instrumentKey(position));
    if (event === undefined) {
      throw new Error(
        "stored bucket valuation application position event is incomplete"
      );
    }
    return event;
  });
  return deepFreeze({
    record,
    bucketEquityEvent,
    positionMarkHeadEvents: canonicalEvents,
    alreadyApplied
  });
}

function persistedApplication(
  application: ResolvedBucketValuationApplication,
  alreadyApplied: boolean
): PersistedBucketValuationApplication {
  return deepFreeze({
    record: application.record,
    bucketEquityEvent: application.bucketEquityEvent,
    positionMarkHeadEvents: application.positionMarkHeadEvents,
    alreadyApplied
  });
}

function assertApplicationEvents(
  record: BucketValuationMarkRecord,
  event: BucketEquityEvent,
  positionEvents: readonly BucketPositionMarkHeadEvent[]
): asserts event is Extract<BucketEquityEvent, { eventType: "valuation" }> {
  if (
    event.eventType !== "valuation" ||
    event.portfolioId !== record.portfolioId ||
    event.bucket !== record.bucket ||
    event.policyHash !== record.policyHash ||
    event.bucketValuationMarkRecordId !==
      record.bucketValuationMarkRecordId ||
    event.valuationMarkHash !== record.valuationMarkHash ||
    event.equityDeltaKrw !== record.equityDeltaKrw ||
    event.asOf !== record.asOf
  ) {
    throw new Error(
      "bucket valuation application equity event does not match its mark"
    );
  }
  const expectedEvidence = record.positionInputs
    .map((position) => position.currentPriceEvidenceRef)
    .sort(compareText);
  if (!isDeepStrictEqual(event.evidenceRefs, expectedEvidence)) {
    throw new Error(
      "bucket valuation application evidence set does not match its mark"
    );
  }
  if (positionEvents.length !== record.positionInputs.length) {
    throw new Error(
      "bucket valuation application position event set is incomplete"
    );
  }
  const eventsByScope = new Map<
    string,
    Extract<BucketPositionMarkHeadEvent, { eventType: "valuation_applied" }>
  >();
  for (const positionEvent of positionEvents) {
    if (positionEvent.eventType !== "valuation_applied") {
      throw new Error(
        "bucket valuation application contains a non-valuation position event"
      );
    }
    const valuationEvent = positionEvent as Extract<
      BucketPositionMarkHeadEvent,
      { eventType: "valuation_applied" }
    >;
    const key = instrumentKey(valuationEvent);
    if (eventsByScope.has(key)) {
      throw new Error(
        "bucket valuation application contains a duplicate position scope"
      );
    }
    eventsByScope.set(key, valuationEvent);
  }
  for (const position of record.positionInputs) {
    const positionEvent = eventsByScope.get(instrumentKey(position));
    if (
      positionEvent === undefined ||
      positionEvent.portfolioId !== record.portfolioId ||
      positionEvent.bucket !== record.bucket ||
      positionEvent.resultingQuantity !== position.quantity ||
      positionEvent.resultingPriceKrw !== position.currentPriceKrw ||
      positionEvent.resultingPriceEvidenceRef !==
        position.currentPriceEvidenceRef ||
      positionEvent.bucketValuationMarkRecordId !==
        record.bucketValuationMarkRecordId ||
      positionEvent.valuationMarkHash !== record.valuationMarkHash ||
      positionEvent.bucketEquityEventId !== event.bucketEquityEventId ||
      positionEvent.bucketEquityEventHash !== event.bucketEquityEventHash ||
      positionEvent.asOf !== record.asOf
    ) {
      throw new Error(
        "bucket valuation application position event does not match its mark"
      );
    }
  }
}

function validateAppendTarget(input: {
  raw: Buffer;
  previousByteLength: number;
  previousHash: string;
  appendedBytes: Buffer;
  label: string;
}): Buffer {
  if (input.raw.length < input.previousByteLength) {
    throw new Error(
      `bucket valuation application ${input.label} log is shorter than its prefix`
    );
  }
  const previous = input.raw.subarray(0, input.previousByteLength);
  if (hashBytes(previous) !== input.previousHash) {
    throw new Error(
      `bucket valuation application ${input.label} prefix hash mismatch`
    );
  }
  const suffix = input.raw.subarray(input.previousByteLength);
  if (
    suffix.length > input.appendedBytes.length ||
    !input.appendedBytes.subarray(0, suffix.length).equals(suffix)
  ) {
    throw new Error(
      `bucket valuation application ${input.label} bytes do not match journal`
    );
  }
  return previous;
}

function assertStateDocumentCanRollForward(input: {
  raw: Buffer;
  previousHash: string;
  resultingBytes: Buffer;
  label: string;
}): void {
  const currentHash = hashBytes(input.raw);
  if (
    currentHash !== input.previousHash &&
    currentHash !== hashBytes(input.resultingBytes)
  ) {
    throw new Error(
      `bucket valuation application ${input.label} bytes do not match journal`
    );
  }
}

function assertMarkCanAppend(
  records: readonly BucketValuationMarkRecord[],
  record: BucketValuationMarkRecord
): void {
  if (
    records.some(
      (candidate) =>
        candidate.bucketValuationMarkRecordId ===
        record.bucketValuationMarkRecordId
    )
  ) {
    throw new Error("bucket valuation application mark already exists in prefix");
  }
  if (
    records.some(
      (candidate) => markOriginKey(candidate) === markOriginKey(record)
    )
  ) {
    throw new Error("bucket valuation application mark origin collision");
  }
}

function parseMarkLogBuffer(
  raw: Buffer
): readonly BucketValuationMarkRecord[] {
  const values = parseJsonLines(raw, "bucket valuation mark");
  const records = values.map((value) => parseBucketValuationMarkRecord(value));
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const record of records) {
    if (ids.has(record.bucketValuationMarkRecordId)) {
      throw new Error("bucket valuation mark file contains a duplicate ID");
    }
    const origin = markOriginKey(record);
    if (origins.has(origin)) {
      throw new Error("bucket valuation mark file contains a duplicate origin");
    }
    ids.add(record.bucketValuationMarkRecordId);
    origins.add(origin);
  }
  return Object.freeze(records);
}

function parseEquityEventLogBuffer(raw: Buffer): BucketEquityHistorySnapshot {
  return foldBucketEquityHistory(
    parseJsonLines(raw, "bucket equity event").map((value) =>
      parseBucketEquityEvent(value)
    )
  );
}

function parsePositionEventLogBuffer(
  raw: Buffer
): BucketPositionMarkHeadHistorySnapshot {
  return foldBucketPositionMarkHeadHistory(
    parseJsonLines(raw, "position mark head event").map((value) =>
      parseBucketPositionMarkHeadEvent(value)
    )
  );
}

function parseJsonLines(raw: Buffer, label: string): readonly unknown[] {
  if (raw.length > 0 && raw[raw.length - 1] !== 0x0a) {
    throw new Error(`${label} file has a torn final line`);
  }
  const lines = raw.toString("utf8").split(/\r?\n/);
  lines.pop();
  return Object.freeze(
    lines.map((line, index) => {
      if (line.length === 0) {
        throw new Error(`${label} file contains corrupt line ${index + 1}`);
      }
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`${label} file contains corrupt line ${index + 1}`, {
          cause: error
        });
      }
    })
  );
}

function parseRiskStateDocument(raw: Buffer): readonly BucketRiskState[] {
  return parseStateDocument(raw, parseBucketRiskState, "risk");
}

function parsePositionStateDocument(
  raw: Buffer
): readonly BucketPositionMarkHeadState[] {
  return parseStateDocument(raw, parseBucketPositionMarkHeadState, "position");
}

function parseStateDocument<T>(
  raw: Buffer,
  parser: (value: unknown) => T,
  label: string
): readonly T[] {
  const text = raw.toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error(
      `bucket valuation application ${label} state has a torn final write`
    );
  }
  let stored: z.infer<typeof stateDocumentSchema>;
  try {
    stored = stateDocumentSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `bucket valuation application ${label} state contains corrupt JSON`,
      { cause: error }
    );
  }
  return Object.freeze(stored.states.map((state) => parser(state)));
}

function publicSnapshot(
  snapshot: RepositorySnapshotUnderLock
): BucketValuationApplicationFileSnapshot {
  return deepFreeze({
    records: snapshot.records,
    equity: snapshot.equity,
    positions: snapshot.positions
  });
}

function cloneRecord(value: unknown): BucketValuationMarkRecord {
  const record = parseBucketValuationMarkRecord(value);
  return parseBucketValuationMarkRecord(JSON.parse(JSON.stringify(record)));
}

function markOriginKey(record: BucketValuationMarkRecord): string {
  return JSON.stringify([
    record.portfolioId,
    record.bucket,
    Date.parse(record.asOf)
  ]);
}

function instrumentKey(value: { market: string; symbol: string }): string {
  return JSON.stringify([value.market, value.symbol]);
}

function jsonLines(values: readonly unknown[]): Buffer {
  return Buffer.from(values.map((value) => JSON.stringify(value)).join("\n") + "\n");
}

function stateDocumentBytes(states: readonly unknown[]): Buffer {
  return Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, states }, null, 2)}\n`,
    "utf8"
  );
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

async function readRequiredBuffer(path: string, message: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  }
}

async function ensureAppended(
  path: string,
  previousByteLength: number,
  appendedBytes: Buffer,
  currentByteLength: number
): Promise<void> {
  const suffixLength = currentByteLength - previousByteLength;
  if (suffixLength === appendedBytes.length) {
    await syncDurableFile(path);
    return;
  }
  if (suffixLength > 0) {
    await truncateDurableFile(path, previousByteLength);
  }
  const handle = await open(path, "a");
  try {
    await handle.writeFile(appendedBytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function writeDurableBytes(path: string, value: Buffer): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(value);
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

async function writeDurableJsonDocument(path: string, value: unknown): Promise<void> {
  await writeDurableBytes(
    path,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
  );
}

async function truncateDurableFile(path: string, byteLength: number): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(byteLength);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function syncDurableFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function syncSnapshotFiles(
  paths: ReturnType<typeof createBucketValuationApplicationPaths>
): Promise<void> {
  for (const path of [
    paths.markRecordsPath,
    paths.equityEventsPath,
    paths.riskStatePath,
    paths.positionEventsPath,
    paths.positionStatePath
  ]) {
    await syncDurableFile(path);
  }
}

async function removeDurableFile(path: string): Promise<void> {
  await unlink(path);
  await syncOutputDirectory(dirname(path));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
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
      throw new Error("bucket valuation application repository lock is unavailable");
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
            throw new Error(
              "bucket valuation application lock ownership changed"
            );
          }
        } finally {
          await handle.close();
        }
        await unlink(input.lockPath);
        await syncOutputDirectory(dirname(input.lockPath));
      };
    } catch (error) {
      if (!isRetryableLockContention(error)) {
        throw error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          "bucket valuation application repository lock is unavailable"
        );
      }
      await delay(Math.min(input.retryDelayMs, remainingMs));
    }
  }
}

async function releaseAllLocks(
  releases: Array<() => Promise<void>>
): Promise<void> {
  let firstError: unknown;
  for (const release of releases.reverse()) {
    try {
      await release();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}

function isRetryableLockContention(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "EEXIST" ||
      (process.platform === "win32" && error.code === "EPERM"))
  );
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
