import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

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

export const bucketSelectionRequestObservationSchema = z.object({
  requestCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0)),
  requestsHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type BucketSelectionRequestObservation = Readonly<z.infer<typeof bucketSelectionRequestObservationSchema>>;
export interface VerifiedBucketSelectionRequestHistory {
  readonly requests: readonly BucketSelectionRequest[];
}
const durableObservations = new WeakMap<VerifiedBucketSelectionRequestHistory, BucketSelectionRequestObservation>();

/** Live source observation only, not trigger/policy/gap/capacity or candidate eligibility authority. */
export function getDurableBucketSelectionRequestObservation(history: VerifiedBucketSelectionRequestHistory): BucketSelectionRequestObservation {
  const observation = durableObservations.get(history);
  if (observation === undefined) throw new Error("bucket selection request history lacks a durable observation lease");
  return observation;
}

/** Compares a saved complete-record prefix against the currently locked source. Does not issue a lease. */
export function resolveObservedBucketSelectionRequestHistory(history: VerifiedBucketSelectionRequestHistory, value: unknown): readonly BucketSelectionRequest[] {
  const current = getDurableBucketSelectionRequestObservation(history);
  const observation = bucketSelectionRequestObservationSchema.parse(value);
  if (Date.parse(observation.observedAt) > Date.parse(current.observedAt)) throw new Error("bucket selection request observation is in the future");
  const prefix = history.requests.slice(0, observation.requestCount);
  if (prefix.length !== observation.requestCount || hashCanonicalPayload(prefix) !== observation.requestsHash) {
    throw new Error("bucket selection request observation does not match durable source prefix");
  }
  assertObservationChronology(prefix, observation.observedAt);
  return Object.freeze(prefix);
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

  /** Holds the existing writer lock through the consumer; cloned and expired histories are not leases. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedBucketSelectionRequestHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const { requests, observedAt } = await readDurableBoundRequestSource(this.recordsPath);
      const history = Object.freeze({ requests });
      durableObservations.set(history, Object.freeze({ requestCount: requests.length,
        requestsHash: hashCanonicalPayload(requests), observedAt }));
      try {
        return await operation(history);
      } finally {
        durableObservations.delete(history);
      }
    });
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

async function readDurableBoundRequestSource(path: string): Promise<{ requests: readonly BucketSelectionRequest[]; observedAt: string }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r+");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    await syncOutputDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try {
      await lstat(path);
    } catch (recheckError) {
      if (isNodeError(recheckError) && recheckError.code === "ENOENT") return { requests: Object.freeze([]), observedAt };
      throw recheckError;
    }
    throw new Error("bucket selection request source appeared during durable observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("bucket selection request source must be a regular file");
    const bytes = await handle.readFile();
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("bucket selection request source contains invalid UTF-8");
    const requests = parseBucketSelectionRequests(raw);
    await handle.sync();
    await syncOutputDirectory(dirname(path));
    // Capture the flushed generation before revalidation, not after descriptor close.
    const observedAt = new Date().toISOString();
    assertObservationChronology(requests, observedAt);
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (bytesRead === 0) throw new Error("bucket selection request source changed during durable observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("bucket selection request source must be a regular file");
    // Compare descriptor identities: Windows pathname stat may report a different dev value.
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); }
    finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) ||
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size ||
      after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("bucket selection request source changed during durable observation");
    }
    return { requests, observedAt };
  } finally {
    await handle.close();
  }
}

function assertObservationChronology(requests: readonly BucketSelectionRequest[], observedAt: string): void {
  if (requests.some((request) => Date.parse(request.createdAt) > Date.parse(observedAt))) {
    throw new Error("bucket selection request observation predates a stored request");
  }
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
  const deadline = performance.now() + input.timeoutMs;
  while (true) {
    if (performance.now() >= deadline) {
      throw new Error("bucket selection request repository lock is unavailable");
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(input.lockPath, "wx");
    } catch (error) {
      if (!isRetryableLockContention(error)) {
        throw error;
      }
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new Error(
          "bucket selection request repository lock is unavailable", { cause: error }
        );
      }
      await delay(Math.min(input.retryDelayMs, remainingMs));
      continue;
    }
    const token = randomUUID();
    try {
      await handle.writeFile(`${token}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      // Initialization failure does not prove ownership of the current pathname. Keep it for recovery.
      await handle.close();
      throw error;
    }
    return async () => {
      try {
        const storedToken = await readFile(input.lockPath, "utf8");
        if (storedToken !== `${token}\n`) throw new Error("bucket selection request lock ownership changed");
      } finally {
        await handle.close();
      }
      await unlink(input.lockPath);
      await syncOutputDirectory(dirname(input.lockPath));
    };
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
