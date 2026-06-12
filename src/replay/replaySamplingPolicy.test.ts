import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket } from "../domain/schemas.js";
import { ReplaySamplingPolicy } from "./replaySamplingPolicy.js";

test("replay sampling allows every N steps deterministically", () => {
  const policy = new ReplaySamplingPolicy({ everyNSteps: 2 });

  const first = policy.evaluate(packet(), context(0, "2025-01-02T00:00:00.000Z"));
  const second = policy.evaluate(packet(), context(1, "2025-01-02T00:01:00.000Z"));
  const third = policy.evaluate(packet(), context(2, "2025-01-02T00:02:00.000Z"));

  assert.equal(first.shouldEvaluate, true);
  assert.equal(second.shouldEvaluate, false);
  assert.equal(second.reason, "STEP_INTERVAL_SKIPPED");
  assert.equal(third.shouldEvaluate, true);
  assert.equal(third.decisionCallsUsed, 2);
});

test("replay sampling skips unchanged candidates when requested", () => {
  const policy = new ReplaySamplingPolicy({ candidateChangedOnly: true });

  const first = policy.evaluate(packet(), context(0, "2025-01-02T00:00:00.000Z"));
  const second = policy.evaluate(
    packet({ packetId: "packet_other" }),
    context(1, "2025-01-02T00:01:00.000Z")
  );
  const third = policy.evaluate(
    packet({}, { lastPriceKrw: 71_000 }),
    context(2, "2025-01-02T00:02:00.000Z")
  );

  assert.equal(first.shouldEvaluate, true);
  assert.equal(second.shouldEvaluate, false);
  assert.equal(second.reason, "CANDIDATES_UNCHANGED");
  assert.equal(third.shouldEvaluate, true);
  assert.equal(third.decisionCallsUsed, 2);
});

test("replay sampling limits daily decisions by simulated local date", () => {
  const policy = new ReplaySamplingPolicy({
    decisionFrequency: "once_per_day",
    timezoneOffsetMinutes: 540
  });

  const first = policy.evaluate(packet(), context(0, "2025-01-02T00:00:00.000Z"));
  const second = policy.evaluate(
    packet({ packetId: "packet_same_day" }, { symbol: "000660" }),
    context(1, "2025-01-02T01:00:00.000Z")
  );
  const third = policy.evaluate(
    packet({ packetId: "packet_next_day" }, { symbol: "035420" }),
    context(2, "2025-01-03T00:00:00.000Z")
  );

  assert.equal(first.shouldEvaluate, true);
  assert.equal(second.shouldEvaluate, false);
  assert.equal(second.reason, "FREQUENCY_WINDOW_ALREADY_EVALUATED");
  assert.equal(third.shouldEvaluate, true);
});

test("replay sampling limits weekly decisions", () => {
  const policy = new ReplaySamplingPolicy({
    decisionFrequency: "once_per_week",
    timezoneOffsetMinutes: 540
  });

  const first = policy.evaluate(packet(), context(0, "2025-01-02T00:00:00.000Z"));
  const second = policy.evaluate(
    packet({ packetId: "packet_same_week" }, { symbol: "000660" }),
    context(1, "2025-01-03T00:00:00.000Z")
  );
  const third = policy.evaluate(
    packet({ packetId: "packet_next_week" }, { symbol: "035420" }),
    context(2, "2025-01-06T00:00:00.000Z")
  );

  assert.equal(first.shouldEvaluate, true);
  assert.equal(second.shouldEvaluate, false);
  assert.equal(second.reason, "FREQUENCY_WINDOW_ALREADY_EVALUATED");
  assert.equal(third.shouldEvaluate, true);
});

test("replay sampling enforces max decision calls", () => {
  const policy = new ReplaySamplingPolicy({ maxDecisionCalls: 1 });

  const first = policy.evaluate(packet(), context(0, "2025-01-02T00:00:00.000Z"));
  const second = policy.evaluate(
    packet({ packetId: "packet_budget" }, { symbol: "000660" }),
    context(1, "2025-01-02T00:01:00.000Z")
  );

  assert.equal(first.shouldEvaluate, true);
  assert.equal(second.shouldEvaluate, false);
  assert.equal(second.reason, "DECISION_CALL_BUDGET_EXHAUSTED");
  assert.equal(second.decisionCallsUsed, 1);
});

function context(stepIndex: number, simulatedAt: string) {
  return {
    simulatedAt: new Date(simulatedAt),
    tick: {
      stepIndex,
      simulatedAt,
      epochMs: Date.parse(simulatedAt)
    }
  };
}

function packet(
  overrides: Partial<MarketPacket> = {},
  candidateOverrides: Partial<MarketPacket["candidates"][number]> = {}
): MarketPacket {
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
        staleAfter: "2025-01-02T00:05:00.000Z",
        ...candidateOverrides
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    ...overrides
  };
}
