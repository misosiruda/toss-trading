import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  type PortfolioActionRiskDecision,
  parsePortfolioActionRiskDecision
} from "./portfolioActionRiskDecision.js";
import {
  hashCanonicalPayload,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

export const PORTFOLIO_ACTION_RISK_DECISION_RECORDS_FILE_NAME =
  "portfolio-action-risk-decision-records.jsonl";

export interface PortfolioActionRiskDecisionFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

const verifiedPortfolioActionRiskDecisionHistories =
  new WeakSet<VerifiedPortfolioActionRiskDecisionHistory>();
const verifiedPortfolioActionRiskDecisionMetadata =
  new WeakMap<VerifiedPortfolioActionRiskDecisionHistory, VerifiedHistoryMetadata>();

export interface VerifiedPortfolioActionRiskDecisionHistory {
  records: readonly PortfolioActionRiskDecision[];
}

export interface VerifiedPortfolioActionRiskDecisionOrigin {
  record: PortfolioActionRiskDecision;
  appendedAt: string;
}

interface VerifiedHistoryMetadata {
  appendedAtById: ReadonlyMap<string, string>;
  lastEntryHash: string | null;
}

const portfolioActionRiskDecisionFileEntrySchema = z
  .object({
    record: z.unknown(),
    appendedAt: offsetQualifiedIsoDateTimeSchema,
    previousEntryHash: sha256HashSchema.nullable(),
    entryHash: sha256HashSchema
  })
  .strict();

interface PortfolioActionRiskDecisionFileEntry {
  record: PortfolioActionRiskDecision;
  appendedAt: string;
  previousEntryHash: string | null;
  entryHash: string;
}

const committedEntrySchema = z.object({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v2"),
  record: z.unknown(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousEntryHash: sha256HashSchema.nullable(),
  entryHash: sha256HashSchema
}).strict();

const commitMarkerSchema = z.object({
  schemaVersion: z.literal("portfolio_action_risk_decision_commit.v1"),
  entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema,
  commitHash: sha256HashSchema
}).strict();

interface ParsedRiskDecisionEntry {
  record: PortfolioActionRiskDecision;
  committedAt: string | null;
  tailHash: string;
}

export function createPortfolioActionRiskDecisionPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, PORTFOLIO_ACTION_RISK_DECISION_RECORDS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${PORTFOLIO_ACTION_RISK_DECISION_RECORDS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for immutable Risk Engine decisions. */
export class PortfolioActionRiskDecisionFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: PortfolioActionRiskDecisionFileRepositoryOptions = {}
  ) {
    const paths = createPortfolioActionRiskDecisionPaths(baseDir);
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

  async readAll(): Promise<readonly PortfolioActionRiskDecision[]> {
    return this.withLock(async () => (await this.readHistoryUnderLock()).records);
  }

  async readVerifiedHistory(): Promise<VerifiedPortfolioActionRiskDecisionHistory> {
    return this.withLock(async () => this.readHistoryUnderLock());
  }

  async resolveById(riskDecisionId: string): Promise<PortfolioActionRiskDecision> {
    const records = await this.readAll();
    const matches = records.filter(
      (record) => record.riskDecisionId === riskDecisionId
    );
    if (matches.length !== 1) {
      throw new Error("portfolio action risk decision does not resolve exactly once");
    }
    return matches[0] as PortfolioActionRiskDecision;
  }

  async append(value: unknown): Promise<PortfolioActionRiskDecision> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const history = await this.readHistoryUnderLock();
      const records = history.records;
      const existing = records.find(
        (record) => record.riskDecisionId === candidate.riskDecisionId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("portfolio action risk decision ref collision");
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      const candidateOrigin = originKey(candidate);
      if (records.some((record) => originKey(record) === candidateOrigin)) {
        throw new Error("portfolio action risk decision hash collision");
      }
      const metadata = getVerifiedHistoryMetadata(history);
      const entry = createPortfolioActionRiskDecisionFileEntry({
        record: candidate,
        appendStartedAt: new Date().toISOString(),
        previousEntryHash: metadata.lastEntryHash
      });
      await appendDurableJsonLine(this.recordsPath, entry);
      // Sample availability only after the record and directory sync complete.
      // The second append binds that post-record-fsync time to this exact entry.
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(entry.appendStartedAt)) {
        throw new Error("portfolio action risk decision clock moved backwards during append");
      }
      const marker = {
        schemaVersion: "portfolio_action_risk_decision_commit.v1" as const,
        entryHash: entry.entryHash,
        committedAt
      };
      await appendDurableJsonLine(this.recordsPath, {
        ...marker, commitHash: hashCanonicalPayload(marker)
      });
      return candidate;
    });
  }

  private async readHistoryUnderLock(): Promise<VerifiedPortfolioActionRiskDecisionHistory> {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return createVerifiedPortfolioActionRiskDecisionHistory([]);
      }
      throw error;
    }
    return createVerifiedPortfolioActionRiskDecisionHistory(
      parsePortfolioActionRiskDecisionEntries(raw)
    );
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

/** Parses and independently verifies a complete durable risk-decision log. */
export function parsePortfolioActionRiskDecisions(
  raw: string
): readonly PortfolioActionRiskDecision[] {
  return Object.freeze(
    parsePortfolioActionRiskDecisionEntries(raw).map((entry) => entry.record)
  );
}

function parsePortfolioActionRiskDecisionEntries(
  raw: string
): readonly ParsedRiskDecisionEntry[] {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("portfolio action risk decision file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const entries: ParsedRiskDecisionEntry[] = [];
  const refs = new Set<string>();
  const origins = new Set<string>();
  let previousEntryHash: string | null = null;
  let hasCommittedEntry = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) {
      throw new Error(
        `portfolio action risk decision file contains corrupt line ${index + 1}`
      );
    }
    let entry: ParsedRiskDecisionEntry;
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === "object" && "schemaVersion" in value) {
        const parsed = committedEntrySchema.parse(value);
        const record = parsePortfolioActionRiskDecision(parsed.record);
        const payload = {
          schemaVersion: parsed.schemaVersion, record,
          appendStartedAt: parsed.appendStartedAt,
          previousEntryHash: parsed.previousEntryHash
        };
        if (parsed.previousEntryHash !== previousEntryHash ||
          parsed.entryHash !== hashCanonicalPayload(payload) ||
          !isDeepStrictEqual(value, { ...payload, entryHash: parsed.entryHash }) ||
          Date.parse(parsed.appendStartedAt) < Date.parse(record.decidedAt)) {
          throw new Error("portfolio action risk decision entry origin mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[++index] ?? "");
        const marker = commitMarkerSchema.parse(markerValue);
        const markerPayload = {
          schemaVersion: marker.schemaVersion,
          entryHash: marker.entryHash,
          committedAt: marker.committedAt
        };
        if (marker.entryHash !== parsed.entryHash ||
          marker.commitHash !== hashCanonicalPayload(markerPayload) ||
          !isDeepStrictEqual(markerValue, { ...markerPayload, commitHash: marker.commitHash }) ||
          Date.parse(marker.committedAt) < Date.parse(parsed.appendStartedAt)) {
          throw new Error("portfolio action risk decision durable commit origin mismatch");
        }
        entry = { record, committedAt: marker.committedAt, tailHash: marker.commitHash };
        hasCommittedEntry = true;
      } else {
        if (hasCommittedEntry) throw new Error("legacy risk decision cannot follow committed entries");
        const legacy = parsePortfolioActionRiskDecisionFileEntry(value, previousEntryHash);
        // Legacy pre-write timestamps cannot prove durability, including on retry.
        entry = { record: legacy.record, committedAt: null, tailHash: legacy.entryHash };
      }
    } catch (error) {
      throw new Error(
        `portfolio action risk decision file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    const record = entry.record;
    if (refs.has(record.riskDecisionId)) {
      throw new Error("portfolio action risk decision file contains a duplicate ref");
    }
    const origin = originKey(record);
    if (origins.has(origin)) {
      throw new Error(
        "portfolio action risk decision file contains a duplicate hash"
      );
    }
    refs.add(record.riskDecisionId);
    origins.add(origin);
    entries.push(entry);
    previousEntryHash = entry.tailHash;
  }
  return Object.freeze(entries);
}

export function getVerifiedPortfolioActionRiskDecisions(
  history: VerifiedPortfolioActionRiskDecisionHistory
): readonly PortfolioActionRiskDecision[] {
  if (!verifiedPortfolioActionRiskDecisionHistories.has(history)) {
    throw new Error("portfolio action risk decision history is not verified");
  }
  return history.records;
}

export function resolveVerifiedPortfolioActionRiskDecisionOrigin(
  history: VerifiedPortfolioActionRiskDecisionHistory,
  riskDecisionId: string
): VerifiedPortfolioActionRiskDecisionOrigin {
  const records = getVerifiedPortfolioActionRiskDecisions(history);
  const matches = records.filter((record) => record.riskDecisionId === riskDecisionId);
  if (matches.length !== 1) {
    throw new Error("portfolio action risk decision does not resolve exactly once");
  }
  const metadata = getVerifiedHistoryMetadata(history);
  const appendedAt = metadata.appendedAtById.get(riskDecisionId);
  if (appendedAt === undefined) {
    throw new Error("portfolio action risk decision durable origin is unavailable; legacy record requires review");
  }
  return deepFreeze({
    record: matches[0] as PortfolioActionRiskDecision,
    appendedAt
  });
}

function createVerifiedPortfolioActionRiskDecisionHistory(
  entries: readonly ParsedRiskDecisionEntry[]
): VerifiedPortfolioActionRiskDecisionHistory {
  const records = entries.map((entry) => entry.record);
  const history = Object.freeze({ records: Object.freeze([...records]) });
  verifiedPortfolioActionRiskDecisionHistories.add(history);
  verifiedPortfolioActionRiskDecisionMetadata.set(history, {
    appendedAtById: new Map(
      entries.filter((entry) => entry.committedAt !== null)
        .map((entry) => [entry.record.riskDecisionId, entry.committedAt!])
    ),
    lastEntryHash: entries.at(-1)?.tailHash ?? null
  });
  return history;
}

function getVerifiedHistoryMetadata(
  history: VerifiedPortfolioActionRiskDecisionHistory
): VerifiedHistoryMetadata {
  const metadata = verifiedPortfolioActionRiskDecisionMetadata.get(history);
  if (metadata === undefined) {
    throw new Error("portfolio action risk decision history is not verified");
  }
  return metadata;
}

function createPortfolioActionRiskDecisionFileEntry(input: {
  record: PortfolioActionRiskDecision;
  appendStartedAt: string;
  previousEntryHash: string | null;
}): z.infer<typeof committedEntrySchema> {
  if (Date.parse(input.appendStartedAt) < Date.parse(input.record.decidedAt)) {
    throw new Error("portfolio action risk decision cannot be appended before decision time");
  }
  const payload = {
    schemaVersion: "portfolio_action_risk_decision_entry.v2" as const,
    record: input.record,
    appendStartedAt: input.appendStartedAt,
    previousEntryHash: input.previousEntryHash
  };
  return deepFreeze({
    ...payload,
    entryHash: hashCanonicalPayload(payload)
  });
}

function parsePortfolioActionRiskDecisionFileEntry(
  value: unknown,
  expectedPreviousEntryHash: string | null
): PortfolioActionRiskDecisionFileEntry {
  const parsed = portfolioActionRiskDecisionFileEntrySchema.parse(value);
  const record = parsePortfolioActionRiskDecision(parsed.record);
  const canonical = {
    record,
    appendedAt: parsed.appendedAt,
    previousEntryHash: parsed.previousEntryHash,
    entryHash: parsed.entryHash
  };
  if (!isDeepStrictEqual(value, canonical)) {
    throw new Error("portfolio action risk decision file entry must already be canonical");
  }
  if (canonical.previousEntryHash !== expectedPreviousEntryHash) {
    throw new Error("portfolio action risk decision file predecessor mismatch");
  }
  if (Date.parse(canonical.appendedAt) < Date.parse(record.decidedAt)) {
    throw new Error("portfolio action risk decision cannot be appended before decision time");
  }
  const expectedEntryHash = hashCanonicalPayload({
    record,
    appendedAt: canonical.appendedAt,
    previousEntryHash: canonical.previousEntryHash
  });
  if (canonical.entryHash !== expectedEntryHash) {
    throw new Error("portfolio action risk decision file entry hash mismatch");
  }
  return deepFreeze(canonical);
}

function originKey(record: PortfolioActionRiskDecision): string {
  return record.riskDecisionHash;
}

function cloneRecord(value: unknown): PortfolioActionRiskDecision {
  const record = parsePortfolioActionRiskDecision(value);
  return parsePortfolioActionRiskDecision(JSON.parse(JSON.stringify(record)));
}

async function appendDurableJsonLine(
  path: string,
  value: unknown
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
      throw new Error("portfolio action risk decision repository lock is unavailable");
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
            throw new Error("portfolio action risk decision lock ownership changed");
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
        throw new Error("portfolio action risk decision repository lock is unavailable");
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
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
