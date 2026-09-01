import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  type BucketPositionMarkHeadEvent,
  parseBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import {
  type BucketPositionMarkHeadHistorySnapshot,
  foldBucketPositionMarkHeadHistory
} from "./bucketPositionMarkHeadState.js";

export const BUCKET_POSITION_MARK_HEAD_EVENTS_FILE_NAME =
  "bucket-position-mark-head-events.jsonl";

export interface BucketPositionMarkHeadFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createBucketPositionMarkHeadPaths(baseDir: string): {
  eventsPath: string;
  lockPath: string;
} {
  return {
    eventsPath: join(baseDir, BUCKET_POSITION_MARK_HEAD_EVENTS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${BUCKET_POSITION_MARK_HEAD_EVENTS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for replayable per-position mark-head events. */
export class BucketPositionMarkHeadFileRepository {
  private readonly eventsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: BucketPositionMarkHeadFileRepositoryOptions = {}
  ) {
    const paths = createBucketPositionMarkHeadPaths(baseDir);
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

  async readSnapshot(): Promise<BucketPositionMarkHeadHistorySnapshot> {
    return this.withLock(async () => this.readSnapshotUnderLock());
  }

  async resolveEventById(
    positionMarkHeadEventId: string
  ): Promise<BucketPositionMarkHeadEvent> {
    const snapshot = await this.readSnapshot();
    const matches = snapshot.events.filter(
      (event) => event.positionMarkHeadEventId === positionMarkHeadEventId
    );
    if (matches.length !== 1) {
      throw new Error("position mark head event does not resolve exactly once");
    }
    return matches[0] as BucketPositionMarkHeadEvent;
  }

  async append(value: unknown): Promise<BucketPositionMarkHeadEvent> {
    const candidate = cloneEvent(value);
    return this.withLock(async () => {
      const snapshot = await this.readSnapshotUnderLock();
      const existing = snapshot.events.find(
        (event) =>
          event.positionMarkHeadEventId === candidate.positionMarkHeadEventId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("position mark head event ID collision");
        }
        await syncDurableJsonFile(this.eventsPath);
        return existing;
      }

      foldBucketPositionMarkHeadHistory([...snapshot.events, candidate]);
      await appendDurableJsonLine(this.eventsPath, candidate);
      return candidate;
    });
  }

  private async readSnapshotUnderLock(): Promise<BucketPositionMarkHeadHistorySnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.eventsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return foldBucketPositionMarkHeadHistory([]);
      }
      throw error;
    }
    if (raw.length > 0 && !raw.endsWith("\n")) {
      throw new Error("position mark head event file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
    lines.pop();
    const events: BucketPositionMarkHeadEvent[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) {
        throw new Error(
          `position mark head event file contains corrupt line ${index + 1}`
        );
      }
      try {
        events.push(parseBucketPositionMarkHeadEvent(JSON.parse(line)));
      } catch (error) {
        throw new Error(
          `position mark head event file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
    }
    return foldBucketPositionMarkHeadHistory(events);
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

function cloneEvent(value: unknown): BucketPositionMarkHeadEvent {
  const event = parseBucketPositionMarkHeadEvent(value);
  return parseBucketPositionMarkHeadEvent(JSON.parse(JSON.stringify(event)));
}

async function appendDurableJsonLine(
  path: string,
  value: BucketPositionMarkHeadEvent
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
      throw new Error("position mark head repository lock is unavailable");
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
            throw new Error("position mark head lock ownership changed");
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
        throw new Error("position mark head repository lock is unavailable");
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
