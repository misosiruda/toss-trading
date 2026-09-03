import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  parsePaperFillExecutionRecord,
  type PaperFillExecutionRecord
} from "./paperFillExecution.js";

export const PAPER_FILL_EXECUTION_RECORDS_FILE_NAME =
  "paper-fill-execution-records.jsonl";

export interface PaperFillExecutionFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

const verifiedPaperFillExecutionHistories =
  new WeakSet<VerifiedPaperFillExecutionHistory>();

export interface VerifiedPaperFillExecutionHistory {
  records: readonly PaperFillExecutionRecord[];
}

export function createPaperFillExecutionPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, PAPER_FILL_EXECUTION_RECORDS_FILE_NAME),
    lockPath: join(baseDir, `.${PAPER_FILL_EXECUTION_RECORDS_FILE_NAME}.lock`)
  };
}

/** Strict append-only storage for immutable accepted paper fills. */
export class PaperFillExecutionFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: PaperFillExecutionFileRepositoryOptions = {}
  ) {
    const paths = createPaperFillExecutionPaths(baseDir);
    this.recordsPath = paths.recordsPath;
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

  async readAll(): Promise<readonly PaperFillExecutionRecord[]> {
    return this.withLock(async () => (await this.readHistoryUnderLock()).records);
  }

  async readVerifiedHistory(): Promise<VerifiedPaperFillExecutionHistory> {
    return this.withLock(async () => this.readHistoryUnderLock());
  }

  async resolveById(
    paperFillRecordId: string
  ): Promise<PaperFillExecutionRecord> {
    const records = await this.readAll();
    const matches = records.filter(
      (record) => record.paperFillRecordId === paperFillRecordId
    );
    if (matches.length !== 1) {
      throw new Error("paper fill execution does not resolve exactly once");
    }
    return matches[0] as PaperFillExecutionRecord;
  }

  async append(value: unknown): Promise<PaperFillExecutionRecord> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const records = (await this.readHistoryUnderLock()).records;
      const existing = records.find(
        (record) => record.paperFillRecordId === candidate.paperFillRecordId
      );
      if (existing !== undefined) {
        if (!sameSemanticRecord(existing, candidate)) {
          throw new Error("paper fill execution ID collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      if (
        records.some((record) => record.paperFillHash === candidate.paperFillHash)
      ) {
        throw new Error("paper fill execution hash collision");
      }
      if (
        records.some(
          (record) =>
            record.portfolioId === candidate.portfolioId &&
            record.fillId === candidate.fillId
        )
      ) {
        throw new Error("paper fill execution has a duplicate portfolio fill ID");
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readHistoryUnderLock(): Promise<VerifiedPaperFillExecutionHistory> {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return parseVerifiedPaperFillExecutionHistory("");
      }
      throw error;
    }
    return parseVerifiedPaperFillExecutionHistory(raw);
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

/** Parses and independently verifies a complete durable paper-fill log. */
export function parsePaperFillExecutions(
  raw: string
): readonly PaperFillExecutionRecord[] {
  return parseVerifiedPaperFillExecutionHistory(raw).records;
}

export function parseVerifiedPaperFillExecutionHistory(
  raw: string
): VerifiedPaperFillExecutionHistory {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("paper fill execution file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const records: PaperFillExecutionRecord[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const portfolioFillIds = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(
        `paper fill execution file contains corrupt line ${index + 1}`
      );
    }
    let record: PaperFillExecutionRecord;
    try {
      record = parsePaperFillExecutionRecord(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `paper fill execution file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    if (ids.has(record.paperFillRecordId)) {
      throw new Error("paper fill execution file contains a duplicate ID");
    }
    if (hashes.has(record.paperFillHash)) {
      throw new Error("paper fill execution file contains a duplicate hash");
    }
    const portfolioFillId = JSON.stringify([record.portfolioId, record.fillId]);
    if (portfolioFillIds.has(portfolioFillId)) {
      throw new Error(
        "paper fill execution file contains a duplicate portfolio fill ID"
      );
    }
    ids.add(record.paperFillRecordId);
    hashes.add(record.paperFillHash);
    portfolioFillIds.add(portfolioFillId);
    records.push(record);
  }
  const history = Object.freeze({ records: Object.freeze(records) });
  verifiedPaperFillExecutionHistories.add(history);
  return history;
}

export function getVerifiedPaperFillExecutionRecords(
  history: VerifiedPaperFillExecutionHistory
): readonly PaperFillExecutionRecord[] {
  if (!verifiedPaperFillExecutionHistories.has(history)) {
    throw new Error("paper fill execution history is not verified");
  }
  return history.records;
}

function sameSemanticRecord(
  left: PaperFillExecutionRecord,
  right: PaperFillExecutionRecord
): boolean {
  const { createdAt: _leftCreatedAt, ...leftSemantic } = left;
  const { createdAt: _rightCreatedAt, ...rightSemantic } = right;
  return isDeepStrictEqual(leftSemantic, rightSemantic);
}

function cloneRecord(value: unknown): PaperFillExecutionRecord {
  const record = parsePaperFillExecutionRecord(value);
  return parsePaperFillExecutionRecord(JSON.parse(JSON.stringify(record)));
}

async function appendDurableJsonLine(
  path: string,
  value: PaperFillExecutionRecord
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

async function acquireExclusiveLock(input: {
  lockPath: string;
  timeoutMs: number;
  retryDelayMs: number;
}): Promise<() => Promise<void>> {
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error("paper fill execution repository lock is unavailable");
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
            throw new Error("paper fill execution lock ownership changed");
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
        throw new Error("paper fill execution repository lock is unavailable");
      }
      await delay(Math.min(input.retryDelayMs, remainingMs));
    }
  }
}

function isRetryableLockContention(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "EEXIST" ||
      (process.platform === "win32" && error.code === "EPERM"))
  );
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
