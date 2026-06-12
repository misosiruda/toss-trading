import assert from "node:assert/strict";
import test from "node:test";

import type {
  CodexCliDecisionResult
} from "../ai/codexCliDecisionProvider.js";
import type { MarketPacket, VirtualDecision } from "../domain/schemas.js";
import {
  buildHistoricalReplayDecisionPrompt,
  CodexHistoricalReplayDecisionProvider,
  HISTORICAL_REPLAY_DECISION_PROMPT_VERSION,
  withHistoricalReplayPrompt
} from "./codexHistoricalDecisionProvider.js";

class FakeDelegate {
  calls: MarketPacket[] = [];

  constructor(private readonly results: CodexCliDecisionResult[]) {}

  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    this.calls.push(packet);
    return (
      this.results.shift() ?? {
        attempted: false,
        decision: null,
        failure: {
          code: "AI_DECISION_FAILED",
          reason: "missing fake result"
        },
        command: null
      }
    );
  }
}

test("historical replay prompt adds no-lookahead boundaries", () => {
  const prompt = buildHistoricalReplayDecisionPrompt();

  assert.match(prompt, /paper-only trading analyst/);
  assert.match(prompt, /packet.generatedAt is the simulated current time/);
  assert.match(prompt, /Do not infer, request, or use market data after/);
  assert.match(prompt, /Do not use future prices/);
  assert.match(prompt, /complete evidence set/);
});

test("historical replay config keeps read-only sandbox and prompt version", () => {
  const config = withHistoricalReplayPrompt({
    enabled: false,
    codexPath: "codex",
    sandbox: "read-only",
    timeoutMs: 300_000,
    maxRunsPerDay: 1,
    allowWebSearch: false
  });

  assert.equal(config.sandbox, "read-only");
  assert.equal(config.promptVersion, HISTORICAL_REPLAY_DECISION_PROMPT_VERSION);
  assert.match(config.prompt ?? "", /Historical replay mode/);
});

test("historical replay codex provider rejects packet mismatches", async () => {
  const delegate = new FakeDelegate([
    {
      attempted: true,
      decision: decision({ packetId: "packet_other" }),
      failure: null,
      command: {
        command: "codex",
        args: ["exec", "--sandbox", "read-only"],
        promptVersion: HISTORICAL_REPLAY_DECISION_PROMPT_VERSION
      }
    }
  ]);
  const provider = new CodexHistoricalReplayDecisionProvider(delegate, {
    maxCallsPerReplay: 2
  });

  const result = await provider.decide(packet(), context());

  assert.equal(result.decision, null);
  assert.equal(result.failure?.code, "AI_DECISION_FAILED");
  assert.match(result.failure?.reason ?? "", /decision_packet_mismatch/);
  assert.equal(delegate.calls.length, 1);
});

test("historical replay codex provider rejects hallucinated data refs", async () => {
  const delegate = new FakeDelegate([
    {
      attempted: true,
      decision: decision({
        decisions: [
          {
            ...decision().decisions[0]!,
            dataRefs: ["historical_snapshot:missing"]
          }
        ]
      }),
      failure: null,
      command: null
    }
  ]);
  const provider = new CodexHistoricalReplayDecisionProvider(delegate, {
    maxCallsPerReplay: 2
  });

  const result = await provider.decide(packet(), context());

  assert.equal(result.decision, null);
  assert.equal(result.failure?.code, "AI_DECISION_FAILED");
  assert.match(
    result.failure?.reason ?? "",
    /VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE/
  );
  assert.equal(delegate.calls.length, 1);
});

test("historical replay codex provider enforces replay call budget", async () => {
  const delegate = new FakeDelegate([
    {
      attempted: true,
      decision: decision(),
      failure: null,
      command: null
    },
    {
      attempted: true,
      decision: decision(),
      failure: null,
      command: null
    }
  ]);
  const provider = new CodexHistoricalReplayDecisionProvider(delegate, {
    maxCallsPerReplay: 1
  });

  const first = await provider.decide(packet(), context());
  const second = await provider.decide(packet(), context());

  assert.equal(first.failure, null);
  assert.equal(second.attempted, false);
  assert.equal(second.failure?.code, "RUN_BUDGET_EXCEEDED");
  assert.equal(delegate.calls.length, 1);
});

function context() {
  return {
    simulatedAt: new Date("2025-01-02T09:00:00+09:00"),
    tick: {
      stepIndex: 0,
      simulatedAt: "2025-01-02T00:00:00.000Z",
      epochMs: Date.parse("2025-01-02T00:00:00.000Z")
    }
  };
}

function packet(): MarketPacket {
  return {
    packetId: "packet_historical_0",
    mode: "paper_only",
    generatedAt: "2025-01-02T00:00:00.000Z",
    expiresAt: "2025-01-02T00:01:00.000Z",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2025-01-02T00:00:00.000Z"
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["HISTORICAL_REPLAY"],
        sourceRefs: ["historical_snapshot:hist_005930"],
        collectedAt: "2025-01-02T00:00:00.000Z",
        staleAfter: "2025-01-02T00:05:00.000Z"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function decision(
  overrides: Partial<VirtualDecision> = {}
): VirtualDecision {
  return {
    packetId: "packet_historical_0",
    summary: "Historical replay Codex fixture.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.6,
        budgetKrw: 70_000,
        thesis: "Historical replay fixture uses current packet evidence.",
        riskFactors: ["Historical replay can diverge from live markets."],
        dataRefs: ["historical_snapshot:hist_005930"],
        expiresAt: "2025-01-02T00:01:00.000Z"
      }
    ],
    ...overrides
  };
}
