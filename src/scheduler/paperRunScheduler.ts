import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import type { AuditEvent } from "../domain/schemas.js";
import {
  runPaperDecisionOnce,
  type DecisionProvider,
  type PaperRunOnceResult
} from "../workflows/paperRunOnce.js";
import { JsonFileStore } from "../storage/fileStore.js";
import { createStoragePaths, FileAuditLog } from "../storage/repositories.js";

export type PaperRunTrigger = "scheduled" | "manual";

export type PaperSchedulerSkipReason =
  | "SCHEDULER_DISABLED"
  | "BEFORE_SCHEDULED_TIME"
  | "RUN_BUDGET_EXCEEDED"
  | "CONCURRENT_RUN"
  | "BACKOFF_ACTIVE";

export interface PaperSchedulerConfig {
  enabled: boolean;
  storageBaseDir: string;
  statePath: string;
  lockPath: string;
  maxRunsPerDay: number;
  scheduledTimeKst: string;
  failureBackoffSeconds: number;
  lockTtlSeconds: number;
}

export interface PaperSchedulerRunOptions {
  trigger: PaperRunTrigger;
  now: Date;
}

export interface PaperSchedulerRunResult {
  status: "completed" | "failed" | "skipped";
  reason: string | null;
  jobResult: PaperRunOnceResult | null;
  auditEventId: string | null;
}

export interface PaperRunJob {
  run(now: Date): Promise<PaperRunOnceResult>;
}

export interface PaperSchedulerPaths {
  statePath: string;
  lockPath: string;
}

const paperSchedulerStateSchema = z
  .object({
    dayKey: z.string().min(1),
    runsUsed: z.number().int().nonnegative(),
    lastRunAt: z.string().optional(),
    lastFailureAt: z.string().optional(),
    nextAllowedAt: z.string().optional()
  })
  .strict();

type PaperSchedulerState = z.infer<typeof paperSchedulerStateSchema>;

export class PaperRunOnceSchedulerJob implements PaperRunJob {
  constructor(
    private readonly options: {
      storageBaseDir: string;
      provider: DecisionProvider | CodexCliDecisionProvider;
      initialCashKrw: number;
    }
  ) {}

  run(now: Date): Promise<PaperRunOnceResult> {
    return runPaperDecisionOnce({
      storageBaseDir: this.options.storageBaseDir,
      provider: this.options.provider,
      now,
      initialCashKrw: this.options.initialCashKrw
    });
  }
}

export class PaperRunScheduler {
  private readonly stateStore: JsonFileStore<PaperSchedulerState>;
  private readonly lock: FileRunLock;
  private readonly auditLog: FileAuditLog;

  constructor(
    private readonly config: PaperSchedulerConfig,
    private readonly job: PaperRunJob
  ) {
    this.stateStore = new JsonFileStore(
      config.statePath,
      paperSchedulerStateSchema,
      "paperSchedulerState"
    );
    this.lock = new FileRunLock(config.lockPath, config.lockTtlSeconds);
    this.auditLog = new FileAuditLog(
      createStoragePaths(config.storageBaseDir).auditLogPath
    );
  }

  async run(options: PaperSchedulerRunOptions): Promise<PaperSchedulerRunResult> {
    if (!this.config.enabled) {
      return skipped("SCHEDULER_DISABLED");
    }

    if (
      options.trigger === "scheduled" &&
      !isAtOrAfterKstTime(options.now, this.config.scheduledTimeKst)
    ) {
      return skipped("BEFORE_SCHEDULED_TIME");
    }

    const state = await this.readState(options.now);
    if (state.nextAllowedAt && Date.parse(state.nextAllowedAt) > options.now.getTime()) {
      return skipped("BACKOFF_ACTIVE");
    }

    if (state.runsUsed >= this.config.maxRunsPerDay) {
      return skipped("RUN_BUDGET_EXCEEDED");
    }

    const lease = await this.lock.acquire(options.now);
    if (!lease) {
      return skipped("CONCURRENT_RUN");
    }

    try {
      const startedState = consumeRun(state, options.now);
      await this.stateStore.write(startedState);

      const jobResult = await this.job.run(options.now);
      if (jobResult.status === "failed") {
        const failedState = markFailure(
          startedState,
          options.now,
          this.config.failureBackoffSeconds
        );
        await this.stateStore.write(failedState);
        const auditEventId = await this.appendFailureAudit(
          options.now,
          "paper run returned failed status"
        );
        return {
          status: "failed",
          reason: "JOB_FAILED",
          jobResult,
          auditEventId
        };
      }

      await this.stateStore.write(clearBackoff(startedState));
      return {
        status: "completed",
        reason: null,
        jobResult,
        auditEventId: null
      };
    } catch (error) {
      const failedState = markFailure(
        consumeRun(state, options.now),
        options.now,
        this.config.failureBackoffSeconds
      );
      await this.stateStore.write(failedState);
      const auditEventId = await this.appendFailureAudit(
        options.now,
        error instanceof Error ? error.message : String(error)
      );
      return {
        status: "failed",
        reason: "JOB_THROWN",
        jobResult: null,
        auditEventId
      };
    } finally {
      await lease.release();
    }
  }

  private async readState(now: Date): Promise<PaperSchedulerState> {
    const dayKey = kstDayKey(now);
    const stored = await this.stateStore.read();
    if (!stored) {
      return { dayKey, runsUsed: 0 };
    }

    if (stored.dayKey === dayKey) {
      return stored;
    }

    const reset: PaperSchedulerState = { dayKey, runsUsed: 0 };
    if (stored.lastFailureAt !== undefined) {
      reset.lastFailureAt = stored.lastFailureAt;
    }
    if (stored.nextAllowedAt !== undefined) {
      reset.nextAllowedAt = stored.nextAllowedAt;
    }
    return reset;
  }

  private async appendFailureAudit(now: Date, reason: string): Promise<string> {
    const eventId = `audit_scheduled_paper_run_failed_${now.getTime()}`;
    const event: AuditEvent = {
      eventId,
      eventType: "SCHEDULED_PAPER_RUN_FAILED",
      actor: "system",
      summary: `Paper scheduler failed: ${reason}`,
      maskedRefs: [],
      createdAt: now.toISOString()
    };
    await this.auditLog.append(event);
    return eventId;
  }
}

export function createPaperSchedulerPaths(storageBaseDir: string): PaperSchedulerPaths {
  return {
    statePath: join(storageBaseDir, "paper-scheduler-state.json"),
    lockPath: join(storageBaseDir, "paper-run.lock")
  };
}

function skipped(reason: PaperSchedulerSkipReason): PaperSchedulerRunResult {
  return {
    status: "skipped",
    reason,
    jobResult: null,
    auditEventId: null
  };
}

function consumeRun(
  state: PaperSchedulerState,
  now: Date
): PaperSchedulerState {
  const next: PaperSchedulerState = {
    dayKey: state.dayKey,
    runsUsed: state.runsUsed + 1,
    lastRunAt: now.toISOString()
  };
  if (state.lastFailureAt !== undefined) {
    next.lastFailureAt = state.lastFailureAt;
  }
  if (state.nextAllowedAt !== undefined) {
    next.nextAllowedAt = state.nextAllowedAt;
  }
  return next;
}

function markFailure(
  state: PaperSchedulerState,
  now: Date,
  failureBackoffSeconds: number
): PaperSchedulerState {
  return {
    dayKey: state.dayKey,
    runsUsed: state.runsUsed,
    lastRunAt: state.lastRunAt,
    lastFailureAt: now.toISOString(),
    nextAllowedAt: new Date(
      now.getTime() + failureBackoffSeconds * 1000
    ).toISOString()
  };
}

function clearBackoff(state: PaperSchedulerState): PaperSchedulerState {
  const next: PaperSchedulerState = {
    dayKey: state.dayKey,
    runsUsed: state.runsUsed
  };
  if (state.lastRunAt !== undefined) {
    next.lastRunAt = state.lastRunAt;
  }
  return next;
}

class FileRunLock {
  constructor(
    private readonly lockPath: string,
    private readonly lockTtlSeconds: number
  ) {}

  async acquire(now: Date): Promise<{ release: () => Promise<void> } | null> {
    await this.removeStaleLock(now);
    try {
      await mkdir(dirname(this.lockPath), { recursive: true });
      await writeFile(
        this.lockPath,
        `${JSON.stringify({ acquiredAt: now.toISOString() })}\n`,
        {
          encoding: "utf8",
          flag: "wx"
        }
      );
      return {
        release: async () => {
          try {
            await unlink(this.lockPath);
          } catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") {
              throw error;
            }
          }
        }
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        return null;
      }
      throw error;
    }
  }

  private async removeStaleLock(now: Date): Promise<void> {
    try {
      const raw = await readFile(this.lockPath, "utf8");
      const parsed = JSON.parse(raw) as { acquiredAt?: unknown };
      if (typeof parsed.acquiredAt !== "string") {
        return;
      }
      const acquiredAt = Date.parse(parsed.acquiredAt);
      if (
        Number.isFinite(acquiredAt) &&
        acquiredAt + this.lockTtlSeconds * 1000 <= now.getTime()
      ) {
        await unlink(this.lockPath);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      if (error instanceof SyntaxError) {
        return;
      }
      throw error;
    }
  }
}

function kstDayKey(now: Date): string {
  const parts = kstDateTimeParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isAtOrAfterKstTime(now: Date, scheduledTimeKst: string): boolean {
  const parts = kstDateTimeParts(now);
  return `${parts.hour}:${parts.minute}` >= scheduledTimeKst;
}

function kstDateTimeParts(now: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value])
  );

  return {
    year: parts["year"] ?? "0000",
    month: parts["month"] ?? "00",
    day: parts["day"] ?? "00",
    hour: parts["hour"] ?? "00",
    minute: parts["minute"] ?? "00"
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
