import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import {
  createPortfolioPolicyActivatedEvent,
  createPortfolioPolicyRetiredEvent,
  parsePortfolioPolicyActivationEvent,
  resolveActiveRuntimePortfolioPolicyAsOf,
  validateRuntimePortfolioPolicyActivationHistory,
  type ActiveRuntimePortfolioPolicy,
  type PortfolioPolicyActivatedEvent,
  type PortfolioPolicyActivationEvent,
  type PortfolioPolicyRetiredEvent
} from "./runtimePortfolioPolicyActivation.js";

export const PORTFOLIO_POLICY_ACTIVATION_FILE_NAME =
  "portfolio-policy-activations.jsonl";

export interface RuntimePortfolioPolicyActivationFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export interface AppendPortfolioPolicyActivatedInput {
  policy: unknown;
  supersedesActivationId?: string;
  createdAt: string;
}

export interface AppendPortfolioPolicyRetiredInput {
  portfolioId: string;
  retiredActivationId: string;
  reasonCode: string;
  createdAt: string;
}

export function createRuntimePortfolioPolicyActivationPaths(baseDir: string): {
  eventsPath: string;
  lockPath: string;
} {
  const eventsPath = join(baseDir, PORTFOLIO_POLICY_ACTIVATION_FILE_NAME);
  return {
    eventsPath,
    lockPath: join(baseDir, `.${PORTFOLIO_POLICY_ACTIVATION_FILE_NAME}.lock`)
  };
}

/**
 * Strict append-only filesystem repository for paper-only policy activation.
 *
 * Every cooperative process serializes read-validate-append through the same
 * exclusive lock file. A torn JSONL line or an abandoned lock is reported as
 * corruption/unavailability and is never guessed away automatically.
 */
export class RuntimePortfolioPolicyActivationFileRepository {
  private readonly eventsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;
  private readonly policies: readonly unknown[];
  private readonly dependencies: ImmutablePolicyDependencyRepository;

  constructor(
    baseDir: string,
    policies: readonly unknown[],
    dependencies: ImmutablePolicyDependencyRepository,
    options: RuntimePortfolioPolicyActivationFileRepositoryOptions = {}
  ) {
    const paths = createRuntimePortfolioPolicyActivationPaths(baseDir);
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
    this.policies = Object.freeze([...policies]);
    this.dependencies = dependencies;
  }

  async readAll(): Promise<readonly PortfolioPolicyActivationEvent[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async resolveActiveAsOf(
    portfolioId: string,
    asOf: string
  ): Promise<ActiveRuntimePortfolioPolicy> {
    const events = await this.readAll();
    return resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId,
      asOf,
      events,
      policies: this.policies,
      dependencies: this.dependencies
    });
  }

  async appendActivated(
    input: AppendPortfolioPolicyActivatedInput
  ): Promise<PortfolioPolicyActivatedEvent> {
    return this.withLock(async () => {
      const events = await this.readAllUnderLock();
      const candidate = createPortfolioPolicyActivatedEvent({
        policy: input.policy,
        activationSequence: nextSequence(events, policyPortfolioId(input.policy)),
        ...(input.supersedesActivationId === undefined
          ? {}
          : { supersedesActivationId: input.supersedesActivationId }),
        createdAt: input.createdAt
      });
      const retry = events.find(
        (event): event is PortfolioPolicyActivatedEvent =>
          event.eventType === "activated" &&
          sameActivatedAppendInput(event, candidate)
      );
      if (retry !== undefined) {
        await syncDurableJsonFile(this.eventsPath);
        return retry;
      }
      this.validateHistory([...events, candidate], candidate.portfolioId);
      await appendDurableJsonLine(this.eventsPath, candidate);
      return candidate;
    });
  }

  async appendRetired(
    input: AppendPortfolioPolicyRetiredInput
  ): Promise<PortfolioPolicyRetiredEvent> {
    return this.withLock(async () => {
      const events = await this.readAllUnderLock();
      const portfolioId = canonicalPortfolioId(input.portfolioId);
      const candidate = createPortfolioPolicyRetiredEvent({
        ...input,
        portfolioId,
        activationSequence: nextSequence(events, portfolioId)
      });
      const retry = events.find(
        (event): event is PortfolioPolicyRetiredEvent =>
          event.eventType === "retired" &&
          sameRetiredAppendInput(event, candidate)
      );
      if (retry !== undefined) {
        await syncDurableJsonFile(this.eventsPath);
        return retry;
      }
      this.validateHistory([...events, candidate], candidate.portfolioId);
      await appendDurableJsonLine(this.eventsPath, candidate);
      return candidate;
    });
  }

  private async readAllUnderLock(): Promise<readonly PortfolioPolicyActivationEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.eventsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Object.freeze([]);
      }
      throw error;
    }
    if (raw.length > 0 && !raw.endsWith("\n")) {
      throw new Error("portfolio policy activation file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
    lines.pop();
    const events: PortfolioPolicyActivationEvent[] = [];
    const eventIds = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) {
        throw new Error(
          `portfolio policy activation file contains corrupt line ${index + 1}`
        );
      }
      let event: PortfolioPolicyActivationEvent;
      try {
        event = parsePortfolioPolicyActivationEvent(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `portfolio policy activation file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
      const eventId =
        event.eventType === "activated"
          ? event.activationId
          : event.retirementEventId;
      if (eventIds.has(eventId)) {
        throw new Error("portfolio policy activation file contains a duplicate event ID");
      }
      eventIds.add(eventId);
      events.push(event);
    }
    for (const portfolioId of new Set(
      events.map((event) => event.portfolioId)
    )) {
      this.validateHistory(events, portfolioId);
    }
    return Object.freeze(events);
  }

  private validateHistory(
    events: readonly PortfolioPolicyActivationEvent[],
    portfolioId: string
  ): void {
    validateRuntimePortfolioPolicyActivationHistory({
      portfolioId,
      events,
      policies: this.policies,
      dependencies: this.dependencies
    });
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

function policyPortfolioId(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("runtime portfolio policy must be an object");
  }
  const portfolioId = (value as Record<string, unknown>).portfolioId;
  if (typeof portfolioId !== "string") {
    throw new Error("runtime portfolio policy portfolioId must be a string");
  }
  return portfolioId;
}

function canonicalPortfolioId(value: string): string {
  if (typeof value !== "string") {
    throw new Error("portfolioId must be a string");
  }
  const portfolioId = value.trim();
  if (portfolioId.length === 0 || portfolioId.length > 160) {
    throw new Error("portfolioId must contain between 1 and 160 characters");
  }
  return portfolioId;
}

function nextSequence(
  events: readonly PortfolioPolicyActivationEvent[],
  portfolioId: string
): number {
  return (
    events.filter((event) => event.portfolioId === portfolioId).length + 1
  );
}

function sameActivatedAppendInput(
  left: PortfolioPolicyActivatedEvent,
  right: PortfolioPolicyActivatedEvent
): boolean {
  return (
    left.portfolioId === right.portfolioId &&
    left.policyRecordId === right.policyRecordId &&
    left.policyId === right.policyId &&
    left.policyVersion === right.policyVersion &&
    left.policyHash === right.policyHash &&
    left.policyLineageHash === right.policyLineageHash &&
    left.supersedesActivationId === right.supersedesActivationId &&
    left.effectiveFrom === right.effectiveFrom &&
    left.createdAt === right.createdAt
  );
}

function sameRetiredAppendInput(
  left: PortfolioPolicyRetiredEvent,
  right: PortfolioPolicyRetiredEvent
): boolean {
  return (
    left.portfolioId === right.portfolioId &&
    left.retiredActivationId === right.retiredActivationId &&
    left.reasonCode === right.reasonCode &&
    left.effectiveFrom === right.effectiveFrom &&
    left.createdAt === right.createdAt
  );
}

async function appendDurableJsonLine(
  path: string,
  event: PortfolioPolicyActivationEvent
): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
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
      throw new Error(
        "portfolio policy activation repository lock is unavailable"
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
            throw new Error("portfolio policy activation lock ownership changed");
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
        throw new Error(
          "portfolio policy activation repository lock is unavailable"
        );
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
