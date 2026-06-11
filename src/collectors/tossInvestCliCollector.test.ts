import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner
} from "../ai/processRunner.js";
import { TossInvestCliReadOnlyCollector } from "./tossInvestCliCollector.js";

class FakeRunner implements ProcessRunner {
  calls: Array<{
    command: string;
    args: readonly string[];
    options: ProcessRunOptions;
  }> = [];

  constructor(private readonly result: ProcessRunResult) {}

  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions
  ): Promise<ProcessRunResult> {
    this.calls.push({ command, args, options });
    return this.result;
  }
}

function collector(runner: FakeRunner, enabled = true) {
  return new TossInvestCliReadOnlyCollector(
    {
      enabled,
      tossctlPath: "tossctl",
      timeoutMs: 10_000
    },
    { runner }
  );
}

test("allowlisted command executes with JSON output flag", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: JSON.stringify({ ok: true }),
    stderr: "",
    timedOut: false
  });

  const result = await collector(runner).collect({
    commandKey: "market.ranking",
    args: ["--market", "KR"]
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.data, { ok: true });
  assert.equal(runner.calls[0]?.command, "tossctl");
  assert.deepEqual(runner.calls[0]?.args, [
    "market",
    "ranking",
    "--market",
    "KR",
    "--output",
    "json"
  ]);
});

test("non-allowlisted order command is blocked before runner executes", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: "{}",
    stderr: "",
    timedOut: false
  });

  const result = await collector(runner).collect({
    commandKey: "order.place"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "COMMAND_NOT_ALLOWED");
  assert.equal(runner.calls.length, 0);
});

test("execute flag is blocked before runner executes", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: "{}",
    stderr: "",
    timedOut: false
  });

  const result = await collector(runner).collect({
    commandKey: "quote.get",
    args: ["--symbol", "005930", "--execute"]
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "MUTATION_BLOCKED");
  assert.equal(runner.calls.length, 0);
});

test("collector disabled blocks execution", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: "{}",
    stderr: "",
    timedOut: false
  });

  const result = await collector(runner, false).collect({
    commandKey: "quote.get"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "COLLECTOR_DISABLED");
  assert.equal(runner.calls.length, 0);
});

test("timeout returns degraded source status", async () => {
  const runner = new FakeRunner({
    exitCode: null,
    stdout: "",
    stderr: "timeout",
    timedOut: true
  });

  const result = await collector(runner).collect({
    commandKey: "market.signals"
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.error?.code, "COMMAND_TIMEOUT");
});

test("invalid JSON returns degraded source status", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: "not-json",
    stderr: "",
    timedOut: false
  });

  const result = await collector(runner).collect({
    commandKey: "quote.get"
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.error?.code, "INVALID_JSON");
});
