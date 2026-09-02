import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";

export const PORTFOLIO_SIZING_SNAPSHOTS_FILE_NAME =
  "portfolio-sizing-snapshots.jsonl";

export interface PortfolioSizingSnapshotFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createPortfolioSizingSnapshotPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, PORTFOLIO_SIZING_SNAPSHOTS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${PORTFOLIO_SIZING_SNAPSHOTS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for valuation-resolved sizing snapshots. */
export class PortfolioSizingSnapshotFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: PortfolioSizingSnapshotFileRepositoryOptions = {}
  ) {
    const paths = createPortfolioSizingSnapshotPaths(baseDir);
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

  async readAll(): Promise<readonly PortfolioSizingSnapshot[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async resolveById(
    portfolioSnapshotId: string
  ): Promise<PortfolioSizingSnapshot> {
    const snapshots = await this.readAll();
    const matches = snapshots.filter(
      (snapshot) => snapshot.portfolioSnapshotId === portfolioSnapshotId
    );
    if (matches.length !== 1) {
      throw new Error("portfolio sizing snapshot does not resolve exactly once");
    }
    return matches[0] as PortfolioSizingSnapshot;
  }

  async append(value: unknown): Promise<PortfolioSizingSnapshot> {
    const candidate = cloneResolvedSnapshot(value);
    return this.withLock(async () => {
      const snapshots = await this.readAllUnderLock();
      const existing = snapshots.find(
        (snapshot) =>
          snapshot.portfolioSnapshotId === candidate.portfolioSnapshotId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("portfolio sizing snapshot ID collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      const origin = snapshotOrigin(candidate);
      if (snapshots.some((snapshot) => snapshotOrigin(snapshot) === origin)) {
        throw new Error("portfolio sizing snapshot origin collision");
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readAllUnderLock(): Promise<
    readonly PortfolioSizingSnapshot[]
  > {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Object.freeze([]);
      }
      throw error;
    }
    return parsePortfolioSizingSnapshots(raw);
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

/** Parses and independently resolves a complete durable snapshot log. */
export function parsePortfolioSizingSnapshots(
  raw: string
): readonly PortfolioSizingSnapshot[] {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("portfolio sizing snapshot file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const snapshots: PortfolioSizingSnapshot[] = [];
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(
        `portfolio sizing snapshot file contains corrupt line ${index + 1}`
      );
    }
    let snapshot: PortfolioSizingSnapshot;
    try {
      snapshot = resolvePortfolioSizingSnapshot(JSON.parse(line)).snapshot;
    } catch (error) {
      throw new Error(
        `portfolio sizing snapshot file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    if (ids.has(snapshot.portfolioSnapshotId)) {
      throw new Error("portfolio sizing snapshot file contains a duplicate ID");
    }
    const origin = snapshotOrigin(snapshot);
    if (origins.has(origin)) {
      throw new Error(
        "portfolio sizing snapshot file contains a duplicate origin"
      );
    }
    ids.add(snapshot.portfolioSnapshotId);
    origins.add(origin);
    snapshots.push(snapshot);
  }
  return Object.freeze(snapshots);
}

function snapshotOrigin(snapshot: PortfolioSizingSnapshot): string {
  return JSON.stringify([
    snapshot.portfolioId,
    snapshot.portfolioVersion,
    snapshot.policyHash,
    Date.parse(snapshot.asOf)
  ]);
}

function cloneResolvedSnapshot(value: unknown): PortfolioSizingSnapshot {
  const snapshot = resolvePortfolioSizingSnapshot(value).snapshot;
  return resolvePortfolioSizingSnapshot(
    JSON.parse(JSON.stringify(snapshot))
  ).snapshot;
}

async function appendDurableJsonLine(
  path: string,
  value: PortfolioSizingSnapshot
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
      throw new Error("portfolio sizing snapshot repository lock is unavailable");
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
            throw new Error("portfolio sizing snapshot lock ownership changed");
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
          "portfolio sizing snapshot repository lock is unavailable"
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
