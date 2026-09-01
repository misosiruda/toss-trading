import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  type SourcePriceEvidenceRecord,
  parseSourcePriceEvidenceRecord
} from "./sourcePriceEvidence.js";

export const SOURCE_PRICE_EVIDENCE_RECORDS_FILE_NAME =
  "source-price-evidence-records.jsonl";

export interface SourcePriceEvidenceFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createSourcePriceEvidencePaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, SOURCE_PRICE_EVIDENCE_RECORDS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${SOURCE_PRICE_EVIDENCE_RECORDS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for immutable typed source-price evidence. */
export class SourcePriceEvidenceFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: SourcePriceEvidenceFileRepositoryOptions = {}
  ) {
    const paths = createSourcePriceEvidencePaths(baseDir);
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

  async readAll(): Promise<readonly SourcePriceEvidenceRecord[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async resolveByRef(evidenceRef: string): Promise<SourcePriceEvidenceRecord> {
    const records = await this.readAll();
    const matches = records.filter(
      (record) => record.evidenceRef === evidenceRef
    );
    if (matches.length !== 1) {
      throw new Error("source price evidence does not resolve exactly once");
    }
    return matches[0] as SourcePriceEvidenceRecord;
  }

  async append(value: unknown): Promise<SourcePriceEvidenceRecord> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const records = await this.readAllUnderLock();
      const existing = records.find(
        (record) => record.evidenceRef === candidate.evidenceRef
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("source price evidence ref collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      const candidateOrigin = originKey(candidate);
      if (records.some((record) => originKey(record) === candidateOrigin)) {
        throw new Error("source price evidence origin collision");
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readAllUnderLock(): Promise<
    readonly SourcePriceEvidenceRecord[]
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
    if (raw.length > 0 && !raw.endsWith("\n")) {
      throw new Error("source price evidence file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
    lines.pop();
    const records: SourcePriceEvidenceRecord[] = [];
    const refs = new Set<string>();
    const origins = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) {
        throw new Error(
          `source price evidence file contains corrupt line ${index + 1}`
        );
      }
      let record: SourcePriceEvidenceRecord;
      try {
        record = parseSourcePriceEvidenceRecord(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `source price evidence file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
      if (refs.has(record.evidenceRef)) {
        throw new Error("source price evidence file contains a duplicate ref");
      }
      const origin = originKey(record);
      if (origins.has(origin)) {
        throw new Error(
          "source price evidence file contains a duplicate origin"
        );
      }
      refs.add(record.evidenceRef);
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

function originKey(record: SourcePriceEvidenceRecord): string {
  return JSON.stringify([
    record.sourceContractId,
    record.market,
    record.symbol,
    record.priceField,
    Date.parse(record.observedAt)
  ]);
}

function cloneRecord(value: unknown): SourcePriceEvidenceRecord {
  const record = parseSourcePriceEvidenceRecord(value);
  return parseSourcePriceEvidenceRecord(JSON.parse(JSON.stringify(record)));
}

async function appendDurableJsonLine(
  path: string,
  value: SourcePriceEvidenceRecord
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
      throw new Error("source price evidence repository lock is unavailable");
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
            throw new Error("source price evidence lock ownership changed");
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
        throw new Error("source price evidence repository lock is unavailable");
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
