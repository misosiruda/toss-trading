import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";

import {
  type ManualAssignmentEvent,
  parseInvestmentMandateRecord,
  parseManualAssignmentEvent
} from "./investmentMandate.js";
import {
  type ResolvedManualAssignmentPolicyBinding,
  type ResolvedManualMandateAssignmentBinding,
  resolveManualAssignmentPolicyBinding,
  resolveManualMandateAssignmentBinding
} from "./manualAssignmentResolver.js";

export const MANUAL_ASSIGNMENT_EVENTS_FILE_NAME =
  "manual-assignment-events.jsonl";

export interface ManualAssignmentFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export function createManualAssignmentPaths(baseDir: string): {
  eventsPath: string;
  lockPath: string;
} {
  return {
    eventsPath: join(baseDir, MANUAL_ASSIGNMENT_EVENTS_FILE_NAME),
    lockPath: join(baseDir, `.${MANUAL_ASSIGNMENT_EVENTS_FILE_NAME}.lock`)
  };
}

/** Strict append-only storage for independently hashed manual authorization. */
export class ManualAssignmentFileRepository {
  private readonly eventsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: ManualAssignmentFileRepositoryOptions = {}
  ) {
    const paths = createManualAssignmentPaths(baseDir);
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
  }

  async readAll(): Promise<readonly ManualAssignmentEvent[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  async resolveById(manualAssignmentEventId: string): Promise<ManualAssignmentEvent> {
    const events = await this.readAll();
    const matches = events.filter(
      (event) => event.manualAssignmentEventId === manualAssignmentEventId
    );
    if (matches.length !== 1) {
      throw new Error("manual assignment event does not resolve exactly once");
    }
    return matches[0] as ManualAssignmentEvent;
  }

  async append(value: unknown): Promise<ManualAssignmentEvent> {
    const candidate = cloneEvent(value);
    return this.withLock(async () => {
      const events = await this.readAllUnderLock();
      const existing = events.find(
        (event) =>
          event.manualAssignmentEventId === candidate.manualAssignmentEventId
      );
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, candidate)) {
          throw new Error("manual assignment event ID collision");
        }
        await syncDurableJsonFile(this.eventsPath);
        return existing;
      }
      await appendDurableJsonLine(this.eventsPath, candidate);
      return candidate;
    });
  }

  async resolvePolicyBinding(input: {
    manualAssignmentEventId: string;
    activePolicy: unknown;
    selectionPolicy: unknown;
  }): Promise<ResolvedManualAssignmentPolicyBinding> {
    const event = await this.resolveById(input.manualAssignmentEventId);
    return resolveManualAssignmentPolicyBinding({
      value: event,
      activePolicy: input.activePolicy,
      selectionPolicy: input.selectionPolicy
    });
  }

  async resolveMandateBinding(
    mandate: unknown
  ): Promise<ResolvedManualMandateAssignmentBinding> {
    const parsedMandate = parseInvestmentMandateRecord(mandate);
    if (parsedMandate.assignmentSource !== "manual_policy") {
      throw new Error("manual assignment cannot bind a selector mandate");
    }
    const event = await this.resolveById(
      parsedMandate.manualAssignmentEventId
    );
    return resolveManualMandateAssignmentBinding({
      mandate: parsedMandate,
      manualAssignmentEvent: event
    });
  }

  private async readAllUnderLock(): Promise<readonly ManualAssignmentEvent[]> {
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
      throw new Error("manual assignment event file has a torn final line");
    }
    const lines = raw.split(/\r?\n/);
    lines.pop();
    const events: ManualAssignmentEvent[] = [];
    const ids = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) {
        throw new Error(
          `manual assignment event file contains corrupt line ${index + 1}`
        );
      }
      let event: ManualAssignmentEvent;
      try {
        event = parseManualAssignmentEvent(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `manual assignment event file contains corrupt line ${index + 1}`,
          { cause: error }
        );
      }
      if (ids.has(event.manualAssignmentEventId)) {
        throw new Error("manual assignment event file contains a duplicate ID");
      }
      ids.add(event.manualAssignmentEventId);
      events.push(event);
    }
    return Object.freeze(events);
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

function cloneEvent(value: unknown): ManualAssignmentEvent {
  const event = parseManualAssignmentEvent(value);
  return parseManualAssignmentEvent(JSON.parse(JSON.stringify(event)));
}

async function appendDurableJsonLine(
  path: string,
  value: ManualAssignmentEvent
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
      throw new Error("manual assignment repository lock is unavailable");
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
            throw new Error("manual assignment lock ownership changed");
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
        throw new Error("manual assignment repository lock is unavailable");
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
