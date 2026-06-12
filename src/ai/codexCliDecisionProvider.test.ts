import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { MarketPacket } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  VIRTUAL_DECISION_SCHEMA_VERSION,
  VIRTUAL_RISK_POLICY_VERSION
} from "../paper/decisionIdentity.js";
import { CodexCliDecisionProvider } from "./codexCliDecisionProvider.js";
import {
  buildPaperDecisionPrompt,
  PAPER_DECISION_PROMPT_VERSION
} from "./decisionPrompt.js";
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
  packetHash: createMarketPacketHash(packet()),
  promptVersion: PAPER_DECISION_PROMPT_VERSION,
  modelId: "codex-cli-unspecified",
  schemaVersion: VIRTUAL_DECISION_SCHEMA_VERSION,
  policyVersion: VIRTUAL_RISK_POLICY_VERSION,
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
      claimSupport: [
        {
          claim: "Compact packet supports a virtual buy.",
          dataRefs: ["source_001"]
        }
      ],
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
      outputSchemaPath: "schemas/virtual-decision.schema.json",
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
    "schemas/virtual-decision.schema.json"
  ]);
  assert.equal(runner.calls[0]?.args.includes("--search"), false);
  assert.equal(result.command?.promptVersion, PAPER_DECISION_PROMPT_VERSION);
  assert.match(runner.calls[0]?.args.at(-1) ?? "", /Use only the packetHash/);
  assert.match(runner.calls[0]?.args.at(-1) ?? "", /Do not run shell commands/);
  assert.match(runner.calls[0]?.options.stdin ?? "", /"packetHash":"sha256:/);
  assert.match(
    runner.calls[0]?.options.stdin ?? "",
    /"promptVersion":"paper-v10"/
  );
  assert.match(
    runner.calls[0]?.options.stdin ?? "",
    /"modelId":"codex-cli-unspecified"/
  );
  assert.match(runner.calls[0]?.options.stdin ?? "", /"marketPacket":/);
  assert.match(runner.calls[0]?.options.stdin ?? "", /"packetId":"packet_001"/);
});

test("paper decision prompt requires paper-only guarded output", () => {
  const prompt = buildPaperDecisionPrompt();

  assert.match(prompt, /paper-only trading analyst/);
  assert.match(prompt, /packetHash, promptVersion, modelId/);
  assert.match(prompt, /top-level packetHash exactly/);
  assert.match(prompt, /policyVersion exactly/);
  assert.match(prompt, /Return only a virtual_decision JSON object/);
  assert.match(prompt, /do not call tossctl/);
  assert.match(prompt, /Do not run shell commands/);
  assert.match(prompt, /Prefer VIRTUAL_HOLD/);
  assert.match(prompt, /Use candidate score and reasonCodes/);
  assert.match(prompt, /buyEligible, sellEligible/);
  assert.match(prompt, /featureScores/);
  assert.match(prompt, /backend-normalized feature value metadata/);
  assert.match(prompt, /Do not propose VIRTUAL_BUY when buyEligible is false/);
  assert.match(prompt, /Non-hold decisions are allowed/);
  assert.match(prompt, /dataRefs copied from the candidate sourceRefs/);
  assert.match(prompt, /featureRefs copied from that same candidate/);
  assert.match(prompt, /claimSupport entries/);
  assert.match(prompt, /claimSupport dataRef/);
  assert.match(prompt, /include holdReasonCode/);
  assert.match(prompt, /INSUFFICIENT_EVIDENCE/);
  assert.match(prompt, /Do not include holdReasonCode on VIRTUAL_BUY/);
  assert.match(prompt, /natural-language fields in Korean/);
  assert.match(prompt, /machine-readable English identifiers/);
  assert.match(prompt, /Never present the output as financial advice/);
});

test("virtual decision output schema artifact constrains actions", async () => {
  const raw = await readFile("schemas/virtual-decision.schema.json", "utf8");
  const schema = JSON.parse(raw) as {
    additionalProperties?: boolean;
    properties?: {
      decisions?: {
        required?: string[];
        items?: {
          additionalProperties?: boolean;
          allOf?: unknown[];
          required?: string[];
          properties?: {
            action?: { enum?: string[] };
            holdReasonCode?: { enum?: string[] };
            featureRefs?: { type?: string; items?: { type?: string } };
            claimSupport?: {
              type?: string;
              minItems?: number;
              items?: {
                additionalProperties?: boolean;
                required?: string[];
                anyOf?: unknown[];
                properties?: {
                  claim?: { type?: string };
                  dataRefs?: { type?: string; minItems?: number };
                  featureRefs?: { type?: string; minItems?: number };
                };
              };
            };
            sellRatio?: { maximum?: number };
            reduceOnly?: { type?: string };
          };
        };
      };
    };
  };

  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties?.decisions?.required, undefined);
  assert.equal(
    (schema as { required?: string[] }).required?.includes("packetHash"),
    true
  );
  assert.equal(
    (schema as { required?: string[] }).required?.includes("promptVersion"),
    true
  );
  assert.equal(
    (schema as { required?: string[] }).required?.includes("modelId"),
    true
  );
  assert.equal(
    (schema as { required?: string[] }).required?.includes("schemaVersion"),
    true
  );
  assert.equal(
    (schema as { required?: string[] }).required?.includes("policyVersion"),
    true
  );
  assert.equal(schema.properties?.decisions?.items?.additionalProperties, false);
  assert.equal(
    schema.properties?.decisions?.items?.required?.includes("claimSupport"),
    true
  );
  assert.deepEqual(schema.properties?.decisions?.items?.properties?.action?.enum, [
    "VIRTUAL_BUY",
    "VIRTUAL_SELL",
    "VIRTUAL_HOLD"
  ]);
  assert.deepEqual(
    schema.properties?.decisions?.items?.properties?.holdReasonCode?.enum,
    [
      "INSUFFICIENT_EVIDENCE",
      "STALE_DATA",
      "CONTRADICTORY_SIGNALS",
      "POLICY_BLOCKED",
      "PORTFOLIO_CONFLICT",
      "NO_POSITION_TO_SELL",
      "NOT_IN_CANDIDATES",
      "LOW_LIQUIDITY"
    ]
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.sellRatio?.maximum,
    1
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.reduceOnly?.type,
    "boolean"
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.featureRefs?.type,
    "array"
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.featureRefs?.items?.type,
    "string"
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.claimSupport?.type,
    "array"
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.claimSupport?.minItems,
    1
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.claimSupport?.items
      ?.additionalProperties,
    false
  );
  assert.deepEqual(
    schema.properties?.decisions?.items?.properties?.claimSupport?.items
      ?.required,
    ["claim"]
  );
  assert.equal(
    schema.properties?.decisions?.items?.properties?.claimSupport?.items?.anyOf
      ?.length,
    2
  );
  assert.equal(schema.properties?.decisions?.items?.allOf?.length, 3);
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

test("valid JSON is extracted from Codex CLI stdout logs", async () => {
  const runner = new FakeRunner({
    exitCode: 0,
    stdout: [
      "OpenAI Codex v0.130.0-alpha.5",
      "session id: fixture",
      validDecisionJson,
      "tokens used",
      "1234"
    ].join("\n"),
    stderr: "",
    timedOut: false
  });

  const result = await provider(runner).decide(packet());

  assert.equal(result.failure, null);
  assert.equal(result.decision?.packetId, "packet_001");
  assert.equal(result.decision?.decisions[0]?.symbol, "005930");
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
