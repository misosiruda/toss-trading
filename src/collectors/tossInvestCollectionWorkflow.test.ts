import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner
} from "../ai/processRunner.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileTossInvestSourceStore
} from "../storage/repositories.js";
import {
  collectTossInvestReadOnlySources,
  parseTossInvestCollectionConfig
} from "./tossInvestCollectionWorkflow.js";

class FakeRunner implements ProcessRunner {
  calls: Array<{
    command: string;
    args: readonly string[];
    options: ProcessRunOptions;
  }> = [];

  constructor(private readonly results: ProcessRunResult[]) {}

  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions
  ): Promise<ProcessRunResult> {
    this.calls.push({ command, args, options });
    return (
      this.results.shift() ?? {
        exitCode: 0,
        stdout: "{}",
        stderr: "",
        timedOut: false
      }
    );
  }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-collector-workflow-"));
}

test("disabled TossInvest collection does not execute runner or save sources", async () => {
  const dir = await tempDir();
  const runner = new FakeRunner([]);
  const summary = await collectTossInvestReadOnlySources({
    storageBaseDir: dir,
    runner,
    config: {
      enabled: false,
      tossctlPath: "tossctl",
      timeoutMs: 10_000,
      commands: [{ commandKey: "market.ranking" }]
    },
    now: new Date("2026-06-11T09:00:00+09:00")
  });
  const paths = createStoragePaths(dir);
  const sources = await new FileTossInvestSourceStore(
    paths.tossInvestSourcesPath
  ).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(summary.status, "skipped");
  assert.equal(summary.savedCount, 0);
  assert.equal(runner.calls.length, 0);
  assert.equal(sources.records.length, 0);
  assert.equal(audit.records[0]?.eventType, "TOSSINVEST_COLLECTION_SKIPPED");
});

test("collection runs allowlisted commands and saves masked source payloads", async () => {
  const dir = await tempDir();
  const runner = new FakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({
        items: [
          {
            symbol: "005930",
            accountNumber: "1234-5678-901234",
            orderId: "ord_abcdef123456"
          }
        ]
      }),
      stderr: "",
      timedOut: false
    }
  ]);

  const summary = await collectTossInvestReadOnlySources({
    storageBaseDir: dir,
    runner,
    config: {
      enabled: true,
      tossctlPath: "tossctl",
      timeoutMs: 10_000,
      commands: [{ commandKey: "market.ranking" }]
    },
    now: new Date("2026-06-11T09:00:00+09:00")
  });
  const paths = createStoragePaths(dir);
  const sources = await new FileTossInvestSourceStore(
    paths.tossInvestSourcesPath
  ).readAll();

  assert.equal(summary.status, "completed");
  assert.equal(summary.okCount, 1);
  assert.equal(summary.savedCount, 1);
  assert.deepEqual(runner.calls[0]?.args, ["market", "ranking", "--output", "json"]);
  assert.equal(JSON.stringify(sources.records).includes("1234-5678-901234"), false);
  assert.equal(JSON.stringify(sources.records).includes("ord_abcdef123456"), false);
});

test("collection skips mutation command keys before runner execution", async () => {
  const dir = await tempDir();
  const runner = new FakeRunner([]);

  const summary = await collectTossInvestReadOnlySources({
    storageBaseDir: dir,
    runner,
    config: {
      enabled: true,
      tossctlPath: "tossctl",
      timeoutMs: 10_000,
      commands: [{ commandKey: "order.place" }, { commandKey: "market.signals" }]
    },
    now: new Date("2026-06-11T09:00:00+09:00")
  });

  assert.equal(summary.blockedCount, 1);
  assert.deepEqual(summary.skippedCommands, ["order.place"]);
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(runner.calls[0]?.args, ["market", "signals", "--output", "json"]);
});

test("collection persists degraded command result for later source health", async () => {
  const dir = await tempDir();
  const runner = new FakeRunner([
    {
      exitCode: 1,
      stdout: "",
      stderr: "network failed",
      timedOut: false
    }
  ]);

  const summary = await collectTossInvestReadOnlySources({
    storageBaseDir: dir,
    runner,
    config: {
      enabled: true,
      tossctlPath: "tossctl",
      timeoutMs: 10_000,
      commands: [{ commandKey: "market.signals" }]
    },
    now: new Date("2026-06-11T09:00:00+09:00")
  });
  const paths = createStoragePaths(dir);
  const sources = await new FileTossInvestSourceStore(
    paths.tossInvestSourcesPath
  ).readAll();

  assert.equal(summary.degradedCount, 1);
  assert.equal(sources.records[0]?.status, "degraded");
  assert.equal(sources.records[0]?.error?.code, "COMMAND_FAILED");
});

test("collection config parser keeps safe disabled default", () => {
  const config = parseTossInvestCollectionConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.tossctlPath, "tossctl");
  assert.deepEqual(
    config.commands.map((command) => command.commandKey),
    ["market.ranking", "market.signals"]
  );
});
