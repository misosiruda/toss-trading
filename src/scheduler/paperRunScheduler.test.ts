import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  createStoragePaths,
  FileAuditLog
} from "../storage/repositories.js";
import {
  createPaperSchedulerPaths,
  PaperRunScheduler,
  type PaperRunJob,
  type PaperSchedulerConfig
} from "./paperRunScheduler.js";

const marketClose = new Date("2026-06-11T06:40:00.000Z");

async function createTempStorageBaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-scheduler-test-"));
}

function config(
  storageBaseDir: string,
  overrides: Partial<PaperSchedulerConfig> = {}
): PaperSchedulerConfig {
  const paths = createPaperSchedulerPaths(storageBaseDir);
  return {
    enabled: true,
    storageBaseDir,
    statePath: paths.statePath,
    lockPath: paths.lockPath,
    maxRunsPerDay: 1,
    scheduledTimeKst: "15:40",
    failureBackoffSeconds: 900,
    lockTtlSeconds: 900,
    ...overrides
  };
}

class FakeJob implements PaperRunJob {
  calls = 0;

  constructor(private readonly status: "completed" | "failed" = "completed") {}

  async run() {
    this.calls += 1;
    return {
      status: this.status,
      report: `fake ${this.status}`,
      packetId: "packet_fake_001",
      tradeCount: this.status === "completed" ? 1 : 0,
      auditEventIds: []
    };
  }
}

test("scheduler enforces max runs per KST day", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const job = new FakeJob();
  const scheduler = new PaperRunScheduler(config(storageBaseDir), job);

  const first = await scheduler.run({ trigger: "scheduled", now: marketClose });
  const second = await scheduler.run({
    trigger: "scheduled",
    now: new Date("2026-06-11T07:00:00.000Z")
  });

  assert.equal(first.status, "completed");
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "RUN_BUDGET_EXCEEDED");
  assert.equal(job.calls, 1);
});

test("scheduler blocks concurrent run when lock file exists", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createPaperSchedulerPaths(storageBaseDir);
  await writeFile(
    paths.lockPath,
    `${JSON.stringify({ acquiredAt: marketClose.toISOString() })}\n`,
    "utf8"
  );
  const job = new FakeJob();
  const scheduler = new PaperRunScheduler(config(storageBaseDir), job);

  const result = await scheduler.run({ trigger: "scheduled", now: marketClose });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "CONCURRENT_RUN");
  assert.equal(job.calls, 0);
});

test("failed scheduler run appends audit event and activates backoff", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const job = new FakeJob("failed");
  const scheduler = new PaperRunScheduler(
    config(storageBaseDir, { maxRunsPerDay: 3 }),
    job
  );

  const first = await scheduler.run({ trigger: "manual", now: marketClose });
  const second = await scheduler.run({
    trigger: "manual",
    now: new Date("2026-06-11T06:41:00.000Z")
  });
  const audit = await new FileAuditLog(
    createStoragePaths(storageBaseDir).auditLogPath
  ).readAll();

  assert.equal(first.status, "failed");
  assert.equal(first.reason, "JOB_FAILED");
  assert.equal(first.auditEventId?.startsWith("audit_scheduled_paper_run_failed_"), true);
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "BACKOFF_ACTIVE");
  assert.equal(audit.records[0]?.eventType, "SCHEDULED_PAPER_RUN_FAILED");
  assert.equal(job.calls, 1);
});

test("disabled scheduler does not run provider job", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const job = new FakeJob();
  const scheduler = new PaperRunScheduler(
    config(storageBaseDir, { enabled: false }),
    job
  );

  const result = await scheduler.run({ trigger: "manual", now: marketClose });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "SCHEDULER_DISABLED");
  assert.equal(job.calls, 0);
});

test("scheduled trigger waits until configured market close time", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const job = new FakeJob();
  const scheduler = new PaperRunScheduler(config(storageBaseDir), job);

  const result = await scheduler.run({
    trigger: "scheduled",
    now: new Date("2026-06-11T06:20:00.000Z")
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "BEFORE_SCHEDULED_TIME");
  assert.equal(job.calls, 0);
});
