import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";

import {
  type BucketEquityEvent,
  parseBucketEquityEvent
} from "./bucketEquity.js";
import {
  type BucketEquityHistorySnapshot,
  foldBucketEquityHistory
} from "./bucketEquityState.js";

export const BUCKET_EQUITY_EVENTS_FILE_NAME = "bucket-equity-events.jsonl";

export interface BucketEquityFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createBucketEquityPaths(baseDir: string): {
  eventsPath: string;
  lockPath: string;
} {
  return {
    eventsPath: join(baseDir, BUCKET_EQUITY_EVENTS_FILE_NAME),
    lockPath: join(baseDir, `.${BUCKET_EQUITY_EVENTS_FILE_NAME}.lock`)
  };
}

/** Strict append-only storage whose current states are rebuilt by replay. */
export class BucketEquityFileRepository {
  private readonly eventsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: BucketEquityFileRepositoryOptions = {}
  ) {
    const paths = createBucketEquityPaths(baseDir);
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

  async readSnapshot(): Promise<BucketEquityHistorySnapshot> {
    return this.withConsistentSnapshot((snapshot) => snapshot);
  }

  async append(value: unknown): Promise<BucketEquityEvent> {
    const candidate = cloneEvent(value);
    return this.withLock(async () => {
      const snapshot = await this.readSnapshotUnderLock();
      const existing = snapshot.events.find(
        (event) => event.bucketEquityEventId === candidate.bucketEquityEventId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("bucket equity event ID collision");
        }
        await syncDurableJsonFile(this.eventsPath);
        return existing;
      }
      foldBucketEquityHistory([...snapshot.events, candidate]);
      await appendDurableJsonLine(this.eventsPath, candidate);
      return candidate;
    });
  }

  async withConsistentSnapshot<T>(
    operation: (snapshot: BucketEquityHistorySnapshot) => Promise<T> | T
  ): Promise<T> {
    return this.withLock(async () => operation(await this.readSnapshotUnderLock()));
  }

  private async readSnapshotUnderLock(): Promise<BucketEquityHistorySnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.eventsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return foldBucketEquityHistory([]);
      }
      throw error;
    }
    if (raw.length > 0 && !raw.endsWith("\n")) {
      throw new Error("bucket equity event file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
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

function cloneEvent(value: unknown): BucketEquityEvent {
  const event = parseBucketEquityEvent(value);
  return parseBucketEquityEvent(JSON.parse(JSON.stringify(event)));
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
