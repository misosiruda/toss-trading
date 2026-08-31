import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import {
  validateRuntimePortfolioPolicyDependencies,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";

export const RUNTIME_PORTFOLIO_POLICY_RECORDS_FILE_NAME =
  "runtime-portfolio-policy-records.jsonl";

export interface RuntimePortfolioPolicyFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export type RuntimePortfolioPolicyGenerationRead =
  | {
      status: "ok";
      records: readonly unknown[];
      value: readonly RuntimePortfolioPolicyRecord[];
    }
  | {
      status: "invalid";
      records: readonly unknown[];
      error: unknown;
    };

export function createRuntimePortfolioPolicyPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  const recordsPath = join(baseDir, RUNTIME_PORTFOLIO_POLICY_RECORDS_FILE_NAME);
  return {
    recordsPath,
    lockPath: join(baseDir, `.${RUNTIME_PORTFOLIO_POLICY_RECORDS_FILE_NAME}.lock`)
  };
}

/**
 * Strict append-only filesystem repository for normalized paper-only policies.
 *
 * Reads reject partial or corrupt history. Appends rehash the complete policy,
 * resolve every immutable dependency, and serialize cooperative processes with
 * an exclusive lock before the durable write is acknowledged.
 */
export class RuntimePortfolioPolicyFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly dependencies: ImmutablePolicyDependencyRepository;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    dependencies: ImmutablePolicyDependencyRepository,
    options: RuntimePortfolioPolicyFileRepositoryOptions = {}
  ) {
    const paths = createRuntimePortfolioPolicyPaths(baseDir);
    this.recordsPath = paths.recordsPath;
    this.lockPath = paths.lockPath;
    this.dependencies = dependencies;
    this.lockTimeoutMs = positiveInteger(
      options.lockTimeoutMs ?? 5_000,
      "lockTimeoutMs"
    );
    this.lockRetryDelayMs = positiveInteger(
      options.lockRetryDelayMs ?? 10,
      "lockRetryDelayMs"
    );
  }

  async readAll(): Promise<readonly RuntimePortfolioPolicyRecord[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async readGeneration(): Promise<RuntimePortfolioPolicyGenerationRead> {
    return this.withLock(async () => this.readGenerationUnderLock());
  }

  async append(value: unknown): Promise<RuntimePortfolioPolicyRecord> {
    const parsed = validateRuntimePortfolioPolicyDependencies(
      value,
      this.dependencies
    );
    const candidate = validateRuntimePortfolioPolicyDependencies(
      JSON.parse(JSON.stringify(parsed)),
      this.dependencies
    );
    return this.withLock(async () => {
      const records = await this.readAllUnderLock();
      const existing = records.find(
        (record) =>
          record.runtimePolicyRecordId === candidate.runtimePolicyRecordId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("runtime portfolio policy record ID collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readRawRecordsUnderLock(): Promise<readonly unknown[]> {
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
      throw new Error("runtime portfolio policy file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
    lines.pop();
    const records: unknown[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) {
        throw new Error(
          `runtime portfolio policy file contains corrupt line ${index + 1}`
        );
      }
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `runtime portfolio policy file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
    }
    return Object.freeze(records);
  }

  private validateRawRecords(
    records: readonly unknown[]
  ): readonly RuntimePortfolioPolicyRecord[] {
    const policies: RuntimePortfolioPolicyRecord[] = [];
    const recordIds = new Set<string>();
    for (const [index, value] of records.entries()) {
      let record: RuntimePortfolioPolicyRecord;
      try {
        record = validateRuntimePortfolioPolicyDependencies(
          value,
          this.dependencies
        );
      } catch (error) {
        throw new Error(
          `runtime portfolio policy file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
      if (recordIds.has(record.runtimePolicyRecordId)) {
        throw new Error(
          "runtime portfolio policy file contains a duplicate record ID"
        );
      }
      recordIds.add(record.runtimePolicyRecordId);
      policies.push(record);
    }
    return Object.freeze(policies);
  }

  private async readGenerationUnderLock(): Promise<RuntimePortfolioPolicyGenerationRead> {
    const records = await this.readRawRecordsUnderLock();
    try {
      return Object.freeze({
        status: "ok" as const,
        records,
        value: this.validateRawRecords(records)
      });
    } catch (error) {
      return Object.freeze({ status: "invalid" as const, records, error });
    }
  }

  private async readAllUnderLock(): Promise<readonly RuntimePortfolioPolicyRecord[]> {
    const generation = await this.readGenerationUnderLock();
    if (generation.status === "invalid") {
      throw generation.error;
    }
    return generation.value;
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

async function appendDurableJsonLine(
  path: string,
  record: RuntimePortfolioPolicyRecord
): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
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
      throw new Error("runtime portfolio policy repository lock is unavailable");
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
            throw new Error("runtime portfolio policy lock ownership changed");
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
        throw new Error("runtime portfolio policy repository lock is unavailable");
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
