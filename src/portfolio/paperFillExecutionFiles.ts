import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import {
  resolveVerifiedPortfolioActionRiskDecisionOrigin,
  type VerifiedPortfolioActionRiskDecisionHistory
} from "./portfolioActionRiskDecisionFiles.js";

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
const persistedPaperFillExecutionHistories =
  new WeakSet<VerifiedPaperFillExecutionHistory>();
const persistedPaperFillMetadata = new WeakMap<VerifiedPaperFillExecutionHistory, {
  appendedAtById: ReadonlyMap<string, string>;
  riskOriginById: ReadonlyMap<string, PersistedRiskOrigin>;
  lastEntryHash: string | null;
}>();

const fileEntrySchema = z.object({
  schemaVersion: z.literal("paper_fill_execution_entry.v1"),
  record: z.unknown(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousEntryHash: sha256HashSchema.nullable(),
  entryHash: sha256HashSchema
}).strict();

const riskOriginSchema = z.object({
  riskDecisionId: z.string().min(1).max(240),
  riskDecisionHash: sha256HashSchema,
  commitHash: sha256HashSchema,
  appendedAt: offsetQualifiedIsoDateTimeSchema
}).strict();

type PersistedRiskOrigin = Readonly<z.infer<typeof riskOriginSchema>>;

const riskBoundFileEntrySchema = fileEntrySchema.extend({
  schemaVersion: z.literal("paper_fill_execution_entry.v2"),
  riskOrigin: riskOriginSchema
}).strict();

const commitMarkerSchema = z.object({
  schemaVersion: z.literal("paper_fill_execution_commit.v1"),
  entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema,
  commitHash: sha256HashSchema
}).strict();

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
    return this.#appendRecord(value, null);
  }

  /** Records causal persistence provenance only, not final execution approval. */
  async appendWithRiskOrigin(
    value: unknown,
    riskDecisionHistory: VerifiedPortfolioActionRiskDecisionHistory,
    riskDecisionId: string
  ): Promise<PaperFillExecutionRecord> {
    // Only a history actually issued by the Risk repository can mint a receipt.
    // Resolve it before the fill is persisted; never retrofit an existing fill.
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(riskDecisionHistory, riskDecisionId);
    const riskOrigin = Object.freeze({
      riskDecisionId: origin.record.riskDecisionId,
      riskDecisionHash: origin.record.riskDecisionHash,
      commitHash: origin.commitHash,
      appendedAt: origin.appendedAt
    });
    return this.#appendRecord(value, riskOrigin);
  }

  async #appendRecord(value: unknown, riskOrigin: PersistedRiskOrigin | null): Promise<PaperFillExecutionRecord> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const history = await this.readHistoryUnderLock();
      const records = history.records;
      const existing = records.find(
        (record) => record.paperFillRecordId === candidate.paperFillRecordId
      );
      if (existing !== undefined) {
        if (!sameSemanticRecord(existing, candidate)) {
          throw new Error("paper fill execution ID collision");
        }
        if (riskOrigin !== null && !isDeepStrictEqual(
          persistedPaperFillMetadata.get(history)!.riskOriginById.get(existing.paperFillRecordId), riskOrigin
        )) {
          throw new Error("paper fill risk origin cannot be added or replaced after persistence");
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
      const appendStartedAt = new Date().toISOString();
      if (Date.parse(appendStartedAt) < Date.parse(candidate.createdAt)) {
        throw new Error("paper fill cannot be appended before creation");
      }
      const commonPayload = {
        record: candidate,
        appendStartedAt,
        previousEntryHash: persistedPaperFillMetadata.get(history)!.lastEntryHash
      };
      const payload = riskOrigin === null
        ? { schemaVersion: "paper_fill_execution_entry.v1" as const, ...commonPayload }
        : { schemaVersion: "paper_fill_execution_entry.v2" as const, ...commonPayload, riskOrigin };
      const entryHash = hashCanonicalPayload(payload);
      await appendDurableJsonLine(this.recordsPath, { ...payload, entryHash });
      // Sample only after the record and directory durability operations complete.
      // A crash before the marker leaves an incomplete pair, never an origin.
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) {
        throw new Error("paper fill clock moved backwards during append");
      }
      const marker = {
        schemaVersion: "paper_fill_execution_commit.v1" as const,
        entryHash,
        committedAt
      };
      await appendDurableJsonLine(this.recordsPath, {
        ...marker, commitHash: hashCanonicalPayload(marker)
      });
      return candidate;
    });
  }

  private async readHistoryUnderLock(): Promise<VerifiedPaperFillExecutionHistory> {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        raw = "";
      } else {
        throw error;
      }
    }
    const { history, appendedAtById, riskOriginById, lastEntryHash } = parsePaperFillExecutionLog(raw);
    persistedPaperFillExecutionHistories.add(history);
    persistedPaperFillMetadata.set(history, { appendedAtById, riskOriginById, lastEntryHash });
    return history;
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
  return parsePaperFillExecutionLog(raw).history;
}

function parsePaperFillExecutionLog(raw: string) {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("paper fill execution file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const records: PaperFillExecutionRecord[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const portfolioFillIds = new Set<string>();
  const appendedAtById = new Map<string, string>();
  const riskOriginById = new Map<string, PersistedRiskOrigin>();
  let lastEntryHash: string | null = null;
  let hasVersionedEntry = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) {
      throw new Error(
        `paper fill execution file contains corrupt line ${index + 1}`
      );
    }
    let record: PaperFillExecutionRecord;
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === "object" && "schemaVersion" in value) {
        const entry = value.schemaVersion === "paper_fill_execution_entry.v2"
          ? riskBoundFileEntrySchema.parse(value) : fileEntrySchema.parse(value);
        record = parsePaperFillExecutionRecord(entry.record);
        const payload = {
          schemaVersion: entry.schemaVersion, record, appendStartedAt: entry.appendStartedAt,
          previousEntryHash: entry.previousEntryHash,
          ...("riskOrigin" in entry ? { riskOrigin: entry.riskOrigin } : {})
        };
        if (entry.previousEntryHash !== lastEntryHash ||
          entry.entryHash !== hashCanonicalPayload(payload) ||
          !isDeepStrictEqual(value, { ...payload, entryHash: entry.entryHash }) ||
          Date.parse(entry.appendStartedAt) < Date.parse(record.createdAt)) {
          throw new Error("paper fill append origin mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[++index] ?? "");
        const marker = commitMarkerSchema.parse(markerValue);
        const commitPayload = {
          schemaVersion: marker.schemaVersion,
          entryHash: marker.entryHash,
          committedAt: marker.committedAt
        };
        if (marker.entryHash !== entry.entryHash ||
          marker.commitHash !== hashCanonicalPayload(commitPayload) ||
          !isDeepStrictEqual(markerValue, { ...commitPayload, commitHash: marker.commitHash }) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt)) {
          throw new Error("paper fill durable commit origin mismatch");
        }
        appendedAtById.set(record.paperFillRecordId, marker.committedAt);
        if ("riskOrigin" in entry) riskOriginById.set(record.paperFillRecordId, Object.freeze(entry.riskOrigin));
        lastEntryHash = marker.commitHash;
        hasVersionedEntry = true;
      } else {
        if (hasVersionedEntry) throw new Error("legacy fill cannot follow versioned entry");
        record = parsePaperFillExecutionRecord(value);
        // A legacy prefix participates in the chain, but gains no invented timestamp.
        lastEntryHash = hashCanonicalPayload({
          schemaVersion: "paper_fill_execution_legacy_prefix.v1",
          record, previousEntryHash: lastEntryHash
        });
      }
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
  return { history, appendedAtById, riskOriginById, lastEntryHash };
}

export function getVerifiedPaperFillExecutionRecords(
  history: VerifiedPaperFillExecutionHistory
): readonly PaperFillExecutionRecord[] {
  if (!verifiedPaperFillExecutionHistories.has(history)) {
    throw new Error("paper fill execution history is not verified");
  }
  return history.records;
}

/** Requires a history read through the repository, not merely parsed JSONL. */
export function getPersistedPaperFillExecutionRecords(
  history: VerifiedPaperFillExecutionHistory
): readonly PaperFillExecutionRecord[] {
  if (!persistedPaperFillExecutionHistories.has(history)) {
    throw new Error("paper fill execution history is not repository verified");
  }
  return getVerifiedPaperFillExecutionRecords(history);
}

export function resolvePersistedPaperFillExecutionOrigin(
  history: VerifiedPaperFillExecutionHistory,
  paperFillRecordId: string
): Readonly<{ record: PaperFillExecutionRecord; appendedAt: string; riskOrigin: PersistedRiskOrigin | null }> {
  const matches = getPersistedPaperFillExecutionRecords(history)
    .filter((record) => record.paperFillRecordId === paperFillRecordId);
  if (matches.length !== 1) {
    throw new Error("paper fill execution does not resolve exactly once");
  }
  const appendedAt = persistedPaperFillMetadata.get(history)?.appendedAtById.get(paperFillRecordId);
  if (appendedAt === undefined) {
    throw new Error("paper fill append origin is unavailable; legacy record requires review");
  }
  const riskOrigin = persistedPaperFillMetadata.get(history)!.riskOriginById.get(paperFillRecordId) ?? null;
  return Object.freeze({ record: matches[0]!, appendedAt, riskOrigin });
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
  value: z.infer<typeof fileEntrySchema> | z.infer<typeof riskBoundFileEntrySchema> | z.infer<typeof commitMarkerSchema>
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
