import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";

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

  async readVerifiedHistory(): Promise<VerifiedInvestmentMandateHistory> {
    return this.withLock(async () => this.readSnapshotUnderLock());
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

  private async readSnapshotUnderLock(): Promise<VerifiedInvestmentMandateHistory> {
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
    const history = validateInvestmentMandateHistory({ records, events });
    verifiedInvestmentMandateHistories.add(history);
    return history;
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
