import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  parsePortfolioPolicyTriggerEvidenceRecord,
  type PortfolioPolicyTriggerEvidenceRecord
} from "./portfolioPolicyTriggerEvidence.js";

export const PORTFOLIO_POLICY_TRIGGER_EVIDENCE_FILE_NAME =
  "portfolio-policy-trigger-evidence-records.jsonl";

export interface PortfolioPolicyTriggerEvidenceFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

const verifiedPolicyTriggerEvidenceHistoryBrand = Symbol(
  "verifiedPolicyTriggerEvidenceHistory"
);

export interface VerifiedPortfolioPolicyTriggerEvidenceHistory {
  records: readonly PortfolioPolicyTriggerEvidenceRecord[];
  readonly [verifiedPolicyTriggerEvidenceHistoryBrand]: true;
}

export function createPortfolioPolicyTriggerEvidencePaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(
      baseDir,
      PORTFOLIO_POLICY_TRIGGER_EVIDENCE_FILE_NAME
    ),
    lockPath: join(
      baseDir,
      `.${PORTFOLIO_POLICY_TRIGGER_EVIDENCE_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for immutable policy-trigger evidence. */
export class PortfolioPolicyTriggerEvidenceFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: PortfolioPolicyTriggerEvidenceFileRepositoryOptions = {}
  ) {
    const paths = createPortfolioPolicyTriggerEvidencePaths(baseDir);
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

  async readAll(): Promise<readonly PortfolioPolicyTriggerEvidenceRecord[]> {
    return this.withLock(async () => (await this.readHistoryUnderLock()).records);
  }

  async readVerifiedHistory(): Promise<VerifiedPortfolioPolicyTriggerEvidenceHistory> {
    return this.withLock(async () => this.readHistoryUnderLock());
  }

  async resolveByRef(
    evidenceRef: string
  ): Promise<PortfolioPolicyTriggerEvidenceRecord> {
    const records = await this.readAll();
    const matches = records.filter(
      (record) => record.evidenceRef === evidenceRef
    );
    if (matches.length !== 1) {
      throw new Error(
        "portfolio policy trigger evidence does not resolve exactly once"
      );
    }
    return matches[0] as PortfolioPolicyTriggerEvidenceRecord;
  }

  async append(value: unknown): Promise<PortfolioPolicyTriggerEvidenceRecord> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const records = (await this.readHistoryUnderLock()).records;
      const existing = records.find(
        (record) => record.evidenceRef === candidate.evidenceRef
      );
      if (existing !== undefined) {
        if (!sameSemanticEvidence(existing, candidate)) {
          throw new Error("portfolio policy trigger evidence ref collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      if (
        records.some(
          (record) => record.evidenceHash === candidate.evidenceHash
        )
      ) {
        throw new Error("portfolio policy trigger evidence hash collision");
      }
      await appendDurableJsonLine(this.recordsPath, candidate);
      return candidate;
    });
  }

  private async readHistoryUnderLock(): Promise<
    VerifiedPortfolioPolicyTriggerEvidenceHistory
  > {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return parseVerifiedPortfolioPolicyTriggerEvidenceHistory("");
      }
      throw error;
    }
    return parseVerifiedPortfolioPolicyTriggerEvidenceHistory(raw);
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

/** Parses and independently verifies a complete durable evidence log. */
export function parsePortfolioPolicyTriggerEvidenceRecords(
  raw: string
): readonly PortfolioPolicyTriggerEvidenceRecord[] {
  return parseVerifiedPortfolioPolicyTriggerEvidenceHistory(raw).records;
}

export function parseVerifiedPortfolioPolicyTriggerEvidenceHistory(
  raw: string
): VerifiedPortfolioPolicyTriggerEvidenceHistory {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error(
      "portfolio policy trigger evidence file has a torn final line"
    );
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const records: PortfolioPolicyTriggerEvidenceRecord[] = [];
  const refs = new Set<string>();
  const hashes = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(
        `portfolio policy trigger evidence file contains corrupt line ${index + 1}`
      );
    }
    let record: PortfolioPolicyTriggerEvidenceRecord;
    try {
      record = parsePortfolioPolicyTriggerEvidenceRecord(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `portfolio policy trigger evidence file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    if (refs.has(record.evidenceRef)) {
      throw new Error(
        "portfolio policy trigger evidence file contains a duplicate ref"
      );
    }
    if (hashes.has(record.evidenceHash)) {
      throw new Error(
        "portfolio policy trigger evidence file contains a duplicate hash"
      );
    }
    refs.add(record.evidenceRef);
    hashes.add(record.evidenceHash);
    records.push(record);
  }
  return Object.freeze({
    records: Object.freeze(records),
    [verifiedPolicyTriggerEvidenceHistoryBrand]: true as const
  });
}

export function getVerifiedPortfolioPolicyTriggerEvidenceRecords(
  history: VerifiedPortfolioPolicyTriggerEvidenceHistory
): readonly PortfolioPolicyTriggerEvidenceRecord[] {
  if (history[verifiedPolicyTriggerEvidenceHistoryBrand] !== true) {
    throw new Error("portfolio policy trigger evidence history is not verified");
  }
  return history.records;
}

function sameSemanticEvidence(
  left: PortfolioPolicyTriggerEvidenceRecord,
  right: PortfolioPolicyTriggerEvidenceRecord
): boolean {
  const { createdAt: _leftCreatedAt, ...leftSemantic } = left;
  const { createdAt: _rightCreatedAt, ...rightSemantic } = right;
  return isDeepStrictEqual(leftSemantic, rightSemantic);
}

function cloneRecord(value: unknown): PortfolioPolicyTriggerEvidenceRecord {
  const record = parsePortfolioPolicyTriggerEvidenceRecord(value);
  return parsePortfolioPolicyTriggerEvidenceRecord(
    JSON.parse(JSON.stringify(record))
  );
}

async function appendDurableJsonLine(
  path: string,
  value: PortfolioPolicyTriggerEvidenceRecord
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
      throw new Error(
        "portfolio policy trigger evidence repository lock is unavailable"
      );
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
            throw new Error(
              "portfolio policy trigger evidence lock ownership changed"
            );
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
          "portfolio policy trigger evidence repository lock is unavailable"
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
