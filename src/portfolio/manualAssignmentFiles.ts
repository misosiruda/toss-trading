import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

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

export const manualAssignmentObservationSchema = z.object({
  eventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0)),
  eventsHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type ManualAssignmentObservation = Readonly<z.infer<typeof manualAssignmentObservationSchema>>;
export interface VerifiedManualAssignmentHistory {
  readonly events: readonly ManualAssignmentEvent[];
}
const durableObservations = new WeakMap<VerifiedManualAssignmentHistory, ManualAssignmentObservation>();

/** Only a live repository-issued observation; this does not authorize opening capacity. */
export function getDurableManualAssignmentObservation(history: VerifiedManualAssignmentHistory): ManualAssignmentObservation {
  const observation = durableObservations.get(history);
  if (observation === undefined) throw new Error("manual assignment history lacks a durable observation lease");
  return observation;
}

/** Revalidates a saved prefix against a currently locked source, without issuing another lease. */
export function resolveObservedManualAssignmentHistory(history: VerifiedManualAssignmentHistory, value: unknown): readonly ManualAssignmentEvent[] {
  const current = getDurableManualAssignmentObservation(history);
  const observation = manualAssignmentObservationSchema.parse(value);
  if (Date.parse(observation.observedAt) > Date.parse(current.observedAt)) throw new Error("manual assignment observation is in the future");
  const prefix = history.events.slice(0, observation.eventCount);
  if (prefix.length !== observation.eventCount || hashCanonicalPayload(prefix) !== observation.eventsHash) {
    throw new Error("manual assignment observation does not match durable source prefix");
  }
  return Object.freeze(prefix);
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

  /** Holds the source lock through the consumer; the observation expires on either outcome. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedManualAssignmentHistory) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const { events, observedAt } = await readDurableBoundManualSource(this.eventsPath);
      const history = Object.freeze({ events });
      durableObservations.set(history, Object.freeze({ eventCount: events.length,
        eventsHash: hashCanonicalPayload(events), observedAt }));
      try {
        return await operation(history);
      } finally {
        durableObservations.delete(history);
      }
    });
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
    return parseManualAssignmentHistory(raw);
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

function parseManualAssignmentHistory(raw: string): readonly ManualAssignmentEvent[] {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("manual assignment event file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const events: ManualAssignmentEvent[] = [];
  const ids = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(`manual assignment event file contains corrupt line ${index + 1}`);
    }
    let event: ManualAssignmentEvent;
    try {
      event = parseManualAssignmentEvent(JSON.parse(line));
    } catch (error) {
      throw new Error(`manual assignment event file contains corrupt line ${index + 1}`, { cause: error });
    }
    if (ids.has(event.manualAssignmentEventId)) {
      throw new Error("manual assignment event file contains a duplicate ID");
    }
    ids.add(event.manualAssignmentEventId);
    events.push(event);
  }
  return Object.freeze(events);
}

async function readDurableBoundManualSource(path: string): Promise<{ events: readonly ManualAssignmentEvent[]; observedAt: string }> {
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
      if (isNodeError(recheckError) && recheckError.code === "ENOENT") return { events: Object.freeze([]), observedAt };
      throw recheckError;
    }
    throw new Error("manual assignment source appeared during durable observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("manual assignment source must be a regular file");
    const bytes = await handle.readFile();
    const events = parseManualAssignmentHistory(bytes.toString("utf8"));
    await handle.sync();
    await syncOutputDirectory(dirname(path));
    // Capture the flushed generation before revalidation, not after closing the descriptor.
    const observedAt = new Date().toISOString();
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (bytesRead === 0) throw new Error("manual assignment source changed during durable observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("manual assignment source must be a regular file");
    // Descriptor identities avoid Windows pathname stat dev=0 differences.
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); }
    finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) ||
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size ||
      after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("manual assignment source changed during durable observation");
    }
    return { events, observedAt };
  } finally {
    await handle.close();
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
  const deadline = performance.now() + input.timeoutMs;
  let lastContention: unknown;
  while (true) {
    if (performance.now() >= deadline) {
      throw new Error("manual assignment repository lock is unavailable", { cause: lastContention });
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(input.lockPath, "wx");
    } catch (error) {
      // Retry only lock acquisition. Initialization, repository work and release are not retried.
      if (!isNodeError(error) || !(error.code === "EEXIST" || (process.platform === "win32" && error.code === "EPERM"))) {
        throw error;
      }
      lastContention = error;
      await delay(Math.max(1, Math.min(input.retryDelayMs, deadline - performance.now())));
      continue;
    }
    const token = randomUUID();
    try {
      await handle.writeFile(`${token}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      // A failed token write cannot prove ownership of the current path. Preserve the barrier for recovery.
      await handle.close();
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
