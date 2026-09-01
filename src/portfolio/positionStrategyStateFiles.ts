import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { Market } from "../domain/schemas.js";
import type { InvestmentMandateHistorySnapshot } from "./investmentMandateState.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import {
  type PositionStrategyState,
  parsePositionStrategyState,
  resolvePositionStrategyStateDependencies
} from "./positionStrategyState.js";
import { compareText } from "./runtimePolicyContracts.js";

export const POSITION_STRATEGY_STATE_FILE_NAME =
  "position-strategy-state.json";

const positionStrategyStateDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    states: z.array(z.unknown())
  })
  .strict();

export interface PositionStrategyStateFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export interface PositionStrategyStateScope {
  portfolioId: string;
  market: Market;
  symbol: string;
}

export function createPositionStrategyStatePaths(baseDir: string): {
  statePath: string;
  lockPath: string;
} {
  return {
    statePath: join(baseDir, POSITION_STRATEGY_STATE_FILE_NAME),
    lockPath: join(baseDir, `.${POSITION_STRATEGY_STATE_FILE_NAME}.lock`)
  };
}

/**
 * Durable current-state snapshot guarded by an instrument-scope hash CAS.
 *
 * The mandate repository lock remains held through validation and atomic file
 * replacement, so a mandate retirement or review transition cannot race an
 * assigned state commit. Every read independently rehashes all state variants
 * and resolves assigned lineage against the stable mandate generation.
 */
export class PositionStrategyStateFileRepository {
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    private readonly mandateRepository: InvestmentMandateFileRepository,
    options: PositionStrategyStateFileRepositoryOptions = {}
  ) {
    const paths = createPositionStrategyStatePaths(baseDir);
    this.statePath = paths.statePath;
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

  async readSnapshot(): Promise<readonly PositionStrategyState[]> {
    return this.mandateRepository.withConsistentSnapshot(async (mandates) =>
      this.withLock(async () => this.readSnapshotUnderLocks(mandates))
    );
  }

  async readCurrent(
    scope: PositionStrategyStateScope
  ): Promise<PositionStrategyState | undefined> {
    const states = await this.readSnapshot();
    return states.find((state) => sameScope(state, scope));
  }

  async compareAndSwap(input: {
    expectedPositionStrategyStateHash: string | null;
    value: unknown;
  }): Promise<PositionStrategyState> {
    const candidate = cloneState(input.value);
    return this.mandateRepository.withConsistentSnapshot(async (mandates) =>
      this.withLock(async () => {
        const states = await this.readSnapshotUnderLocks(mandates);
        const existing = states.find((state) => sameScope(state, candidate));
        if (existing !== undefined && isDeepStrictEqual(existing, candidate)) {
          await syncDurableJsonFile(this.statePath);
          return existing;
        }
        const currentHash = existing?.positionStrategyStateHash ?? null;
        if (currentHash !== input.expectedPositionStrategyStateHash) {
          throw new Error("position strategy state compare-and-swap conflict");
        }
        assertStateTransition(existing, candidate);
        resolvePositionStrategyStateDependencies({
          value: candidate,
          mandateRecords: mandates.records,
          mandateEvents: mandates.events
        });
        const nextStates = canonicalStates([
          ...states.filter((state) => !sameScope(state, candidate)),
          candidate
        ]);
        await writeDurableSnapshot(this.statePath, nextStates);
        return candidate;
      })
    );
  }

  private async readSnapshotUnderLocks(
    mandates: InvestmentMandateHistorySnapshot
  ): Promise<readonly PositionStrategyState[]> {
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Object.freeze([]);
      }
      throw error;
    }
    if (!raw.endsWith("\n")) {
      throw new Error("position strategy state file has a torn final write");
    }
    let stored: z.infer<typeof positionStrategyStateDocumentSchema>;
    try {
      stored = positionStrategyStateDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error("position strategy state file contains corrupt JSON", {
        cause: error
      });
    }
    const states = stored.states.map((value) => {
      const resolved = resolvePositionStrategyStateDependencies({
        value,
        mandateRecords: mandates.records,
        mandateEvents: mandates.events
      });
      return resolved.state;
    });
    assertCanonicalStoredStates(states);
    return Object.freeze(states);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const outputDirectory = dirname(this.statePath);
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

function cloneState(value: unknown): PositionStrategyState {
  const state = parsePositionStrategyState(value);
  return parsePositionStrategyState(JSON.parse(JSON.stringify(state)));
}

function assertCanonicalStoredStates(
  states: readonly PositionStrategyState[]
): void {
  const scopes = new Set<string>();
  for (const state of states) {
    const key = scopeKey(state);
    if (scopes.has(key)) {
      throw new Error("position strategy state file contains a duplicate scope");
    }
    scopes.add(key);
  }
  const canonical = canonicalStates(states);
  if (
    canonical.some(
      (state, index) =>
        state.positionStrategyStateHash !==
        states[index]?.positionStrategyStateHash
    )
  ) {
    throw new Error("position strategy state file has non-canonical ordering");
  }
}

function canonicalStates(
  states: readonly PositionStrategyState[]
): readonly PositionStrategyState[] {
  return Object.freeze(
    [...states].sort(
      (left, right) =>
        compareText(left.portfolioId, right.portfolioId) ||
        compareText(left.market, right.market) ||
        compareText(left.symbol, right.symbol)
    )
  );
}

function sameScope(
  left: PositionStrategyState,
  right: PositionStrategyStateScope
): boolean {
  return (
    left.portfolioId === right.portfolioId &&
    left.market === right.market &&
    left.symbol === right.symbol
  );
}

function scopeKey(scope: PositionStrategyStateScope): string {
  return JSON.stringify([scope.portfolioId, scope.market, scope.symbol]);
}

function assertStateTransition(
  previous: PositionStrategyState | undefined,
  next: PositionStrategyState
): void {
  if (previous === undefined) {
    return;
  }
  if (previous.stateKind === "unassigned_legacy") {
    if (next.stateKind === "unassigned_legacy") {
      throw new Error("unassigned legacy position state is immutable");
    }
    return;
  }
  if (next.stateKind !== "assigned") {
    throw new Error("assigned position state cannot return to legacy");
  }
  if (next.openedAt !== previous.openedAt) {
    throw new Error("assigned position openedAt is immutable");
  }
  assertOptionalTimestampDoesNotRegress(
    previous.lastIncreasedAt,
    next.lastIncreasedAt,
    "lastIncreasedAt"
  );
  assertOptionalTimestampDoesNotRegress(
    previous.lastReducedAt,
    next.lastReducedAt,
    "lastReducedAt"
  );
  if (Date.parse(next.lastReviewedAt) < Date.parse(previous.lastReviewedAt)) {
    throw new Error("assigned position lastReviewedAt cannot decrease");
  }
  if (next.peakPriceKrw < previous.peakPriceKrw) {
    throw new Error("assigned position peakPriceKrw cannot decrease");
  }
  if (
    previous.partialTakeProfitExecuted &&
    !next.partialTakeProfitExecuted
  ) {
    throw new Error(
      "assigned position partialTakeProfitExecuted cannot reset"
    );
  }
}

function assertOptionalTimestampDoesNotRegress(
  previous: string | undefined,
  next: string | undefined,
  label: string
): void {
  if (previous === undefined) {
    return;
  }
  if (next === undefined || Date.parse(next) < Date.parse(previous)) {
    throw new Error(`assigned position ${label} cannot decrease`);
  }
}

async function writeDurableSnapshot(
  path: string,
  states: readonly PositionStrategyState[]
): Promise<void> {
  const outputDirectory = dirname(path);
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 1, states }, null, 2)}\n`,
      "utf8"
    );
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await syncOutputDirectory(outputDirectory);
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
      throw new Error("position strategy state repository lock is unavailable");
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
            throw new Error("position strategy state lock ownership changed");
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
        throw new Error("position strategy state repository lock is unavailable");
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
