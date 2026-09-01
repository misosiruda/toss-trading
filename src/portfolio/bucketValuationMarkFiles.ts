import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  type BucketValuationMarkRecord,
  parseBucketValuationMarkRecord
} from "./bucketValuationMark.js";

export const BUCKET_VALUATION_MARK_RECORDS_FILE_NAME =
  "bucket-valuation-mark-records.jsonl";

export interface BucketValuationMarkFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createBucketValuationMarkPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, BUCKET_VALUATION_MARK_RECORDS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${BUCKET_VALUATION_MARK_RECORDS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for immutable bucket valuation origins. */
export class BucketValuationMarkFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: BucketValuationMarkFileRepositoryOptions = {}
  ) {
    const paths = createBucketValuationMarkPaths(baseDir);
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

  async readAll(): Promise<readonly BucketValuationMarkRecord[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async resolveById(
    bucketValuationMarkRecordId: string
  ): Promise<BucketValuationMarkRecord> {
    const records = await this.readAll();
    const matches = records.filter(
      (record) =>
        record.bucketValuationMarkRecordId === bucketValuationMarkRecordId
    );
    if (matches.length !== 1) {
      throw new Error("bucket valuation mark does not resolve exactly once");
    }
    return matches[0] as BucketValuationMarkRecord;
  }

  async append(value: unknown): Promise<BucketValuationMarkRecord> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const records = await this.readAllUnderLock();
      const existing = records.find(
        (record) =>
          record.bucketValuationMarkRecordId ===
          candidate.bucketValuationMarkRecordId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("bucket valuation mark record ID collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      if (
        records.some(
          (record) => originKey(record) === originKey(candidate)
        )
      ) {
        throw new Error("bucket valuation mark origin collision");
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readAllUnderLock(): Promise<readonly BucketValuationMarkRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Object.freeze([]);
      }
      throw error;
    }
    if (raw.length > 0 && !raw.endsWith("\n")) {
      throw new Error("bucket valuation mark file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
    lines.pop();
    const records: BucketValuationMarkRecord[] = [];
    const ids = new Set<string>();
    const origins = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) {
        throw new Error(
          `bucket valuation mark file contains corrupt line ${index + 1}`
        );
      }
      let record: BucketValuationMarkRecord;
      try {
        record = parseBucketValuationMarkRecord(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `bucket valuation mark file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
      if (ids.has(record.bucketValuationMarkRecordId)) {
        throw new Error("bucket valuation mark file contains a duplicate ID");
      }
      const origin = originKey(record);
      if (origins.has(origin)) {
        throw new Error("bucket valuation mark file contains a duplicate origin");
      }
      ids.add(record.bucketValuationMarkRecordId);
      origins.add(origin);
      records.push(record);
    }
    return Object.freeze(records);
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

function originKey(record: BucketValuationMarkRecord): string {
  return JSON.stringify([record.portfolioId, record.bucket, record.asOf]);
}

function cloneRecord(value: unknown): BucketValuationMarkRecord {
  const record = parseBucketValuationMarkRecord(value);
  return parseBucketValuationMarkRecord(JSON.parse(JSON.stringify(record)));
}

async function appendDurableJsonLine(
  path: string,
  value: BucketValuationMarkRecord
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
      throw new Error("bucket valuation mark repository lock is unavailable");
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
            throw new Error("bucket valuation mark lock ownership changed");
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
        throw new Error("bucket valuation mark repository lock is unavailable");
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
