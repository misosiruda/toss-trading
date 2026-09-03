import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  parseBucketSelectionRequest,
  type BucketSelectionRequest
} from "./bucketSelectionRequest.js";

export const BUCKET_SELECTION_REQUESTS_FILE_NAME =
  "bucket-selection-requests.jsonl";

export interface BucketSelectionRequestFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createBucketSelectionRequestPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, BUCKET_SELECTION_REQUESTS_FILE_NAME),
    lockPath: join(baseDir, `.${BUCKET_SELECTION_REQUESTS_FILE_NAME}.lock`)
  };
}

/** Strict append-only storage for immutable bucket selection requests. */
export class BucketSelectionRequestFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: BucketSelectionRequestFileRepositoryOptions = {}
  ) {
    const paths = createBucketSelectionRequestPaths(baseDir);
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

  async readAll(): Promise<readonly BucketSelectionRequest[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async resolveById(requestId: string): Promise<BucketSelectionRequest> {
    const requests = await this.readAll();
    const matches = requests.filter((request) => request.requestId === requestId);
    if (matches.length !== 1) {
      throw new Error("bucket selection request does not resolve exactly once");
    }
    return matches[0] as BucketSelectionRequest;
  }

  async append(value: unknown): Promise<BucketSelectionRequest> {
    const candidate = cloneRequest(value);
    return this.withLock(async () => {
      const requests = await this.readAllUnderLock();
      const existing = requests.find(
        (request) => request.requestId === candidate.requestId
      );
      if (existing !== undefined) {
        if (!sameSemanticRequest(existing, candidate)) {
          throw new Error("bucket selection request ID collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      const origin = requestOrigin(candidate);
      if (requests.some((request) => requestOrigin(request) === origin)) {
        throw new Error("bucket selection request origin collision");
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readAllUnderLock(): Promise<readonly BucketSelectionRequest[]> {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Object.freeze([]);
      }
      throw error;
    }
    return parseBucketSelectionRequests(raw);
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

/** Parses and independently verifies a complete durable request log. */
export function parseBucketSelectionRequests(
  raw: string
): readonly BucketSelectionRequest[] {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("bucket selection request file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const requests: BucketSelectionRequest[] = [];
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(
        `bucket selection request file contains corrupt line ${index + 1}`
      );
    }
    let request: BucketSelectionRequest;
    try {
      request = parseBucketSelectionRequest(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `bucket selection request file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    if (ids.has(request.requestId)) {
      throw new Error("bucket selection request file contains a duplicate ID");
    }
    const origin = requestOrigin(request);
    if (origins.has(origin)) {
      throw new Error(
        "bucket selection request file contains a duplicate origin"
      );
    }
    ids.add(request.requestId);
    origins.add(origin);
    requests.push(request);
  }
  return Object.freeze(requests);
}

function sameSemanticRequest(
  left: BucketSelectionRequest,
  right: BucketSelectionRequest
): boolean {
  const { createdAt: _leftCreatedAt, ...leftSemantic } = left;
  const { createdAt: _rightCreatedAt, ...rightSemantic } = right;
  return isDeepStrictEqual(leftSemantic, rightSemantic);
}

function requestOrigin(request: BucketSelectionRequest): string {
  return JSON.stringify([request.cycleId, request.bucket]);
}

function cloneRequest(value: unknown): BucketSelectionRequest {
  const request = parseBucketSelectionRequest(value);
  return parseBucketSelectionRequest(JSON.parse(JSON.stringify(request)));
}

async function appendDurableJsonLine(
  path: string,
  value: BucketSelectionRequest
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
      throw new Error("bucket selection request repository lock is unavailable");
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
            throw new Error("bucket selection request lock ownership changed");
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
          "bucket selection request repository lock is unavailable"
        );
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
