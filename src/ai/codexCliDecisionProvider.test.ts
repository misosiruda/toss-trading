import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket } from "../domain/schemas.js";
import { CodexCliDecisionProvider } from "./codexCliDecisionProvider.js";
import { InMemoryDailyRunBudget } from "./runBudget.js";
import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner
} from "./processRunner.js";

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

const validDecisionJson = JSON.stringify({
  packetId: "packet_001",
  summary: "Paper-only decision.",
  decisions: [
    {
      market: "KR",
      symbol: "005930",
      action: "VIRTUAL_BUY",
      confidence: 0.6,
      budgetKrw: 70_000,
      thesis: "Compact packet supports a virtual buy.",
      riskFactors: ["Paper risk."],
      dataRefs: ["source_001"],
      expiresAt: "2026-06-11T09:05:00+09:00"
    }
  ]
});

function packet(): MarketPacket {
  return {
    packetId: "packet_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-06-11T09:00:00+09:00"
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: 70_000,
        reasonCodes: ["MOCK"],
        sourceRefs: ["source_001"],
        collectedAt: "2026-06-11T09:00:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function provider(
  runner: FakeRunner,
  overrides: Partial<ConstructorParameters<typeof CodexCliDecisionProvider>[0]> = {},
  budget = new InMemoryDailyRunBudget(3)
) {
  return new CodexCliDecisionProvider(
    {
      enabled: true,
      codexPath: "codex",
      sandbox: "read-only",
      timeoutMs: 300_000,
      maxRunsPerDay: 3,
      allowWebSearch: false,
      outputSchemaPath: "schemas/virtual_decision.schema.json",
      now: () => new Date("2026-06-11T09:00:00Z"),
      ...overrides
    },
    { runner, budget }
  );
}

test("disabled provider does not execute Codex CLI", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: validDecisionJson,
    stderr: "",
    timedOut: false
  });

  const result = await provider(runner, { enabled: false }).decide(packet());

  assert.equal(result.attempted, false);
  assert.equal(result.failure?.code, "AI_DECISION_DISABLED");
  assert.equal(runner.calls.length, 0);
});

test("provider builds read-only codex exec command with output schema", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: validDecisionJson,
    stderr: "",
    timedOut: false
  });

  const result = await provider(runner).decide(packet());

  assert.equal(result.failure, null);
  assert.equal(runner.calls[0]?.command, "codex");
  assert.deepEqual(runner.calls[0]?.args.slice(0, 5), [
    "exec",
    "--sandbox",
    "read-only",
    "--output-schema",
    "schemas/virtual_decision.schema.json"
  ]);
  assert.equal(runner.calls[0]?.args.includes("--search"), false);
  assert.match(runner.calls[0]?.options.stdin ?? "", /"packetId":"packet_001"/);
});

test("timeout is reported as AI_DECISION_FAILED", async () => {
  const runner = new FakeRunner({
    exitCode: null,
    stdout: "",
    stderr: "timeout",
    timedOut: true
  });

  const result = await provider(runner).decide(packet());

  assert.equal(result.failure?.code, "AI_DECISION_FAILED");
  assert.equal(result.failure?.reason, "timeout");
});

test("invalid JSON output does not produce a decision", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: "not-json",
    stderr: "",
    timedOut: false
  });

  const result = await provider(runner).decide(packet());

  assert.equal(result.decision, null);
  assert.equal(result.failure?.code, "AI_DECISION_FAILED");
});

test("valid JSON output is parsed as virtual decision", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: validDecisionJson,
    stderr: "",
    timedOut: false
  });

  const result = await provider(runner).decide(packet());

  assert.equal(result.failure, null);
  assert.equal(result.decision?.decisions[0]?.action, "VIRTUAL_BUY");
});

test("run budget prevents execution after daily limit", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: validDecisionJson,
    stderr: "",
    timedOut: false
  });
  const budget = new InMemoryDailyRunBudget(1);
  const subject = provider(runner, {}, budget);

  await subject.decide(packet());
  const second = await subject.decide(packet());

  assert.equal(second.attempted, false);
  assert.equal(second.failure?.code, "RUN_BUDGET_EXCEEDED");
  assert.equal(runner.calls.length, 1);
});
