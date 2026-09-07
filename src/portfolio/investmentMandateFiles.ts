import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

import {
  type InvestmentMandateEvent,
  type InvestmentMandateRecord,
  parseInvestmentMandateEvent,
  parseInvestmentMandateRecord
} from "./investmentMandate.js";
import {
  type InvestmentMandateHistorySnapshot,
  type InvestmentMandateState,
  resolveCurrentInvestmentMandate,
  validateInvestmentMandateHistory
} from "./investmentMandateState.js";

export const INVESTMENT_MANDATE_RECORDS_FILE_NAME =
  "instrument-mandate-records.jsonl";
export const INVESTMENT_MANDATE_EVENTS_FILE_NAME =
  "instrument-mandate-events.jsonl";

export interface InvestmentMandateFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

const verifiedInvestmentMandateHistories =
  new WeakSet<VerifiedInvestmentMandateHistory>();
const durableInvestmentMandateObservations = new WeakMap<VerifiedInvestmentMandateHistory, InvestmentMandateObservation>();

const observationCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0));
export const investmentMandateObservationSchema = z.object({
  recordCount: observationCountSchema,
  recordsHash: sha256HashSchema,
  eventCount: observationCountSchema,
  eventsHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type InvestmentMandateObservation = Readonly<z.infer<typeof investmentMandateObservationSchema>>;

export interface VerifiedInvestmentMandateHistory
  extends InvestmentMandateHistorySnapshot {}

export function createInvestmentMandatePaths(baseDir: string): {
  recordsPath: string;
  eventsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, INVESTMENT_MANDATE_RECORDS_FILE_NAME),
    eventsPath: join(baseDir, INVESTMENT_MANDATE_EVENTS_FILE_NAME),
    lockPath: join(baseDir, ".instrument-mandates.lock")
  };
}

/**
 * Strict append-only repository for immutable paper-only mandate history.
 *
 * Both JSONL files share one exclusive lock. Each operation reads, rehashes and
 * folds both generations before acknowledging an exact retry or durable append.
 */
export class InvestmentMandateFileRepository {
  private readonly recordsPath: string;
  private readonly eventsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: InvestmentMandateFileRepositoryOptions = {}
  ) {
    const paths = createInvestmentMandatePaths(baseDir);
    this.recordsPath = paths.recordsPath;
    this.eventsPath = paths.eventsPath;
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

  async readSnapshot(): Promise<InvestmentMandateHistorySnapshot> {
    return this.withConsistentSnapshot(async (snapshot) => snapshot);
  }

  /**
   * Leases a repository-verified generation only while the shared lock is held.
   * The lease is revoked before the lock is released, so it cannot be reused
   * after a later append advances the durable history.
   */
  async withVerifiedHistory<T>(
    operation: (history: VerifiedInvestmentMandateHistory) => Promise<T> | T
  ): Promise<T> {
    return this.withLock(async () => {
      const history = await this.readSnapshotUnderLock();
      verifiedInvestmentMandateHistories.add(history);
      try {
        return await operation(history);
      } finally {
        verifiedInvestmentMandateHistories.delete(history);
      }
    });
  }

  /** Syncs both validated files before issuing an observation under the shared lock. */
  async withDurableVerifiedHistory<T>(
    operation: (history: VerifiedInvestmentMandateHistory) => Promise<T> | T
  ): Promise<T> {
    return this.withLock(async () => {
      const { history, observedAt } = await this.readDurableSnapshotUnderLock();
      const observation: InvestmentMandateObservation = Object.freeze({
        recordCount: history.records.length, recordsHash: hashCanonicalPayload(history.records),
        eventCount: history.events.length, eventsHash: hashCanonicalPayload(history.events),
        observedAt
      });
      verifiedInvestmentMandateHistories.add(history);
      durableInvestmentMandateObservations.set(history, observation);
      try {
        return await operation(history);
      } finally {
        durableInvestmentMandateObservations.delete(history);
        verifiedInvestmentMandateHistories.delete(history);
      }
    });
  }

  /**
   * Keeps the append-only mandate generation stable while a dependent durable
   * state validates and commits its exact mandate/event lineage.
   */
  async withConsistentSnapshot<T>(
    operation: (snapshot: InvestmentMandateHistorySnapshot) => Promise<T>
  ): Promise<T> {
    return this.withLock(async () => operation(await this.readSnapshotUnderLock()));
  }

  async readRecords(): Promise<readonly InvestmentMandateRecord[]> {
    return (await this.readSnapshot()).records;
  }

  async readEvents(): Promise<readonly InvestmentMandateEvent[]> {
    return (await this.readSnapshot()).events;
  }

  async resolveCurrent(input: {
    portfolioId: string;
    market: InvestmentMandateRecord["market"];
    symbol: string;
  }): Promise<InvestmentMandateState> {
    const snapshot = await this.readSnapshot();
    return resolveCurrentInvestmentMandate({ ...input, ...snapshot });
  }

  async appendRecord(value: unknown): Promise<InvestmentMandateRecord> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const snapshot = await this.readSnapshotUnderLock();
      const existing = snapshot.records.find(
        (record) => record.mandateId === candidate.mandateId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("investment mandate record ID collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      validateInvestmentMandateHistory({
        records: [...snapshot.records, candidate],
        events: snapshot.events
      });
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  async appendEvent(value: unknown): Promise<InvestmentMandateEvent> {
    const candidate = cloneEvent(value);
    return this.withLock(async () => {
      const snapshot = await this.readSnapshotUnderLock();
      const existing = snapshot.events.find(
        (event) => event.mandateEventId === candidate.mandateEventId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("investment mandate event ID collision");
        }
        await syncDurableJsonFile(this.eventsPath);
        return existing;
      }
      validateInvestmentMandateHistory({
        records: snapshot.records,
        events: [...snapshot.events, candidate]
      });
      await appendDurableJsonLine(this.eventsPath, candidate);
      return candidate;
    });
  }

  private async readSnapshotUnderLock(): Promise<InvestmentMandateHistorySnapshot> {
    const records = await readJsonLines({
      path: this.recordsPath,
      label: "investment mandate record",
      parse: parseInvestmentMandateRecord,
      id: (record) => record.mandateId
    });
    const events = await readJsonLines({
      path: this.eventsPath,
      label: "investment mandate event",
      parse: parseInvestmentMandateEvent,
      id: (event) => event.mandateEventId
    });
    return validateInvestmentMandateHistory({ records, events });
  }

  private async readDurableSnapshotUnderLock(): Promise<{ history: InvestmentMandateHistorySnapshot; observedAt: string }> {
    const sources: Awaited<ReturnType<typeof openBoundMandateSource>>[] = [];
    try {
      const recordsSource = await openBoundMandateSource(this.recordsPath);
      sources.push(recordsSource);
      const eventsSource = await openBoundMandateSource(this.eventsPath);
      sources.push(eventsSource);
      const records = parseJsonLines({ raw: recordsSource.bytes.toString("utf8"), label: "investment mandate record",
        parse: parseInvestmentMandateRecord, id: (record) => record.mandateId });
      const events = parseJsonLines({ raw: eventsSource.bytes.toString("utf8"), label: "investment mandate event",
        parse: parseInvestmentMandateEvent, id: (event) => event.mandateEventId });
      const history = validateInvestmentMandateHistory({ records, events });
      for (const source of sources) await source.handle?.sync();
      await syncOutputDirectory(dirname(this.recordsPath));
      // Date both flushed sources before final verification, never after descriptor close.
      const observedAt = new Date().toISOString();
      for (const source of sources) await verifyBoundMandateSource(source);
      return { history, observedAt };
    } finally {
      await Promise.all(sources.map((source) => source.handle?.close()));
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const outputDirectory = dirname(this.recordsPath);
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

export function getVerifiedInvestmentMandateHistorySnapshot(
  history: VerifiedInvestmentMandateHistory
): InvestmentMandateHistorySnapshot {
  if (!verifiedInvestmentMandateHistories.has(history)) {
    throw new Error("investment mandate history is not repository verified");
  }
  return history;
}

/** The receipt describes observed bytes, not event creation-time authenticity or execution permission. */
export function getDurableInvestmentMandateObservation(history: VerifiedInvestmentMandateHistory): InvestmentMandateObservation {
  getVerifiedInvestmentMandateHistorySnapshot(history);
  const observation = durableInvestmentMandateObservations.get(history);
  if (observation === undefined) throw new Error("investment mandate history lacks a durable observation lease");
  return observation;
}

/** Revalidates a stored observation against a currently locked durable source; never grants a new lease to its prefix. */
export function resolveObservedInvestmentMandateHistory(history: VerifiedInvestmentMandateHistory, value: unknown): InvestmentMandateHistorySnapshot {
  const current = getDurableInvestmentMandateObservation(history);
  const observation = investmentMandateObservationSchema.parse(value);
  if (Date.parse(observation.observedAt) > Date.parse(current.observedAt)) {
    throw new Error("investment mandate observation clock moved backwards");
  }
  const records = history.records.slice(0, observation.recordCount);
  const events = history.events.slice(0, observation.eventCount);
  if (records.length !== observation.recordCount || events.length !== observation.eventCount ||
    hashCanonicalPayload(records) !== observation.recordsHash || hashCanonicalPayload(events) !== observation.eventsHash) {
    throw new Error("investment mandate observation does not match durable source prefixes");
  }
  return validateInvestmentMandateHistory({ records, events });
}

function cloneRecord(value: unknown): InvestmentMandateRecord {
  const record = parseInvestmentMandateRecord(value);
  return parseInvestmentMandateRecord(JSON.parse(JSON.stringify(record)));
}

function cloneEvent(value: unknown): InvestmentMandateEvent {
  const event = parseInvestmentMandateEvent(value);
  return parseInvestmentMandateEvent(JSON.parse(JSON.stringify(event)));
}

async function readJsonLines<T>(input: {
  path: string;
  label: string;
  parse: (value: unknown) => T;
  id: (value: T) => string;
}): Promise<readonly T[]> {
  let raw: string;
  try {
    raw = await readFile(input.path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return Object.freeze([]);
    }
    throw error;
  }
  return parseJsonLines({ ...input, raw });
}

function parseJsonLines<T>(input: {
  raw: string;
  label: string;
  parse: (value: unknown) => T;
  id: (value: T) => string;
}): readonly T[] {
  const { raw } = input;
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error(`${input.label} file has a torn final line`);
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const values: T[] = [];
  const ids = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(`${input.label} file contains corrupt line ${index + 1}`);
    }
    let value: T;
    try {
      value = input.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `${input.label} file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    const id = input.id(value);
    if (ids.has(id)) {
      throw new Error(`${input.label} file contains a duplicate ID`);
    }
    ids.add(id);
    values.push(value);
  }
  return Object.freeze(values);
}

/** Keep the parsed bytes and fsync attached to one descriptor for each source. */
async function openBoundMandateSource(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r+");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { path, handle: undefined, before: undefined, bytes: Buffer.alloc(0) };
    }
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    return { path, handle, before, bytes };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function verifyBoundMandateSource(source: Awaited<ReturnType<typeof openBoundMandateSource>>): Promise<void> {
  const { path, handle, before, bytes } = source;
  if (handle === undefined || before === undefined) {
    try {
      await lstat(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
    throw new Error("investment mandate source appeared during durable observation");
  }
  const verified = Buffer.alloc(bytes.length);
  let offset = 0;
  while (offset < verified.length) {
    const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
    if (bytesRead === 0) throw new Error("investment mandate source changed during durable observation");
    offset += bytesRead;
  }
  const after = await handle.stat({ bigint: true });
  // Windows pathname stat can report dev=0; compare descriptor identities on both sides.
  const namedHandle = await open(path, "r");
  let named;
  try {
    named = await namedHandle.stat({ bigint: true });
  } finally {
    await namedHandle.close();
  }
  if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) ||
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
    after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size ||
    after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
    throw new Error("investment mandate source changed during durable observation");
  }
}

async function appendDurableJsonLine(
  path: string,
  value: InvestmentMandateRecord | InvestmentMandateEvent
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

function isUnsupportedWindowsDirectorySync(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    isNodeError(error) &&
    error.code === "EPERM"
  );
}

async function acquireExclusiveLock(input: {
  lockPath: string;
  timeoutMs: number;
  retryDelayMs: number;
}): Promise<() => Promise<void>> {
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error("investment mandate repository lock is unavailable");
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
            throw new Error("investment mandate lock ownership changed");
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
        throw new Error("investment mandate repository lock is unavailable");
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
