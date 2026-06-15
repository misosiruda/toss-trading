import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWithSchema,
  virtualDecisionSchema,
  type MarketPacket,
  type VirtualPortfolio
} from "../domain/schemas.js";
import {
  buildPaperExitPolicyDecision,
  createPaperExitPolicyState,
  normalizePaperExitPolicy
} from "./exitPolicy.js";

test("normalizePaperExitPolicy returns null when no rule is enabled", () => {
  assert.equal(normalizePaperExitPolicy(undefined), null);
  assert.equal(normalizePaperExitPolicy({}), null);
});

test("normalizePaperExitPolicy rejects invalid ratios", () => {
  assert.throws(
    () => normalizePaperExitPolicy({ stopLossRatio: 1.5 }),
    /stopLossRatio/
  );
  assert.throws(
    () => normalizePaperExitPolicy({ rebalanceMaxPositionWeightRatio: 0 }),
    /rebalanceMaxPositionWeightRatio/
  );
});

test("buildPaperExitPolicyDecision creates reduce-only take-profit sell-all decisions", () => {
  const decision = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 120 }),
    portfolio: portfolio({
      positions: [position({ averagePriceKrw: 100, quantity: 10 })]
    }),
    policy: { takeProfitRatio: 0.15 }
  });

  assert.ok(decision);
  const parsed = parseWithSchema(
    virtualDecisionSchema,
    decision,
    "virtualDecision"
  );

  assert.equal(parsed.policyVersion, "paper_exit_policy_v1");
  assert.equal(parsed.decisions[0]?.action, "VIRTUAL_SELL");
  assert.equal(parsed.decisions[0]?.reduceOnly, true);
  assert.equal(parsed.decisions[0]?.sellAll, true);
  assert.equal(parsed.decisions[0]?.sellRatio, undefined);
  assert.match(parsed.decisions[0]?.thesis ?? "", /take-profit/);
});

test("buildPaperExitPolicyDecision supports partial take-profit and trailing stop", () => {
  const state = createPaperExitPolicyState();
  const heldPortfolio = portfolio({
    positions: [position({ averagePriceKrw: 100, quantity: 10 })]
  });
  const policy = {
    takeProfitRatio: 0.15,
    takeProfitMode: "partial_then_trail" as const,
    takeProfitSellRatio: 0.5,
    trailingStopFromPeakRatio: 0.08
  };

  const partial = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 120 }),
    portfolio: heldPortfolio,
    policy,
    state
  });

  assert.ok(partial);
  assert.equal(partial.decisions[0]?.sellAll, undefined);
  assert.equal(partial.decisions[0]?.sellRatio, 0.5);
  assert.match(partial.decisions[0]?.thesis ?? "", /partial take-profit/);

  const repeat = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 130 }),
    portfolio: heldPortfolio,
    policy,
    state
  });
  assert.equal(repeat, null);

  const peak = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 140 }),
    portfolio: heldPortfolio,
    policy,
    state
  });
  assert.equal(peak, null);

  const trailing = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 128 }),
    portfolio: heldPortfolio,
    policy,
    state
  });
  assert.ok(trailing);
  assert.equal(trailing.decisions[0]?.sellAll, true);
  assert.equal(trailing.decisions[0]?.sellRatio, undefined);
  assert.match(trailing.decisions[0]?.thesis ?? "", /trailing stop/);
});

test("buildPaperExitPolicyDecision prioritizes stop-loss before other exits", () => {
  const decision = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 80 }),
    portfolio: portfolio({
      positions: [position({ averagePriceKrw: 100, quantity: 10 })]
    }),
    policy: {
      takeProfitRatio: 0.15,
      stopLossRatio: 0.1,
      rebalanceMaxPositionWeightRatio: 0.5
    }
  });

  assert.ok(decision);
  assert.equal(decision.decisions[0]?.sellAll, true);
  assert.match(decision.decisions[0]?.thesis ?? "", /stop-loss/);
  assert.equal(
    decision.decisions[0]?.riskFactors.includes(
      "paper_exit_reason:stop_loss"
    ),
    true
  );
});

test("buildPaperExitPolicyDecision creates target-weight rebalance decisions", () => {
  const decision = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 100 }),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [position({ averagePriceKrw: 80, quantity: 10 })]
    }),
    policy: { rebalanceMaxPositionWeightRatio: 0.5 }
  });

  assert.ok(decision);
  assert.equal(decision.decisions[0]?.action, "VIRTUAL_SELL");
  assert.equal(decision.decisions[0]?.reduceOnly, true);
  assert.equal(decision.decisions[0]?.targetWeightPct, 0.5);
  assert.equal(decision.decisions[0]?.sellAll, undefined);
});

test("buildPaperExitPolicyDecision skips unavailable sell candidates", () => {
  const decision = buildPaperExitPolicyDecision({
    packet: packet({ lastPriceKrw: 120, sellEligible: false }),
    portfolio: portfolio({
      positions: [position({ averagePriceKrw: 100, quantity: 10 })]
    }),
    policy: { takeProfitRatio: 0.15 }
  });

  assert.equal(decision, null);
});

function portfolio(
  overrides: Partial<VirtualPortfolio> = {}
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00",
    ...overrides
  };
}

function position(input: {
  averagePriceKrw: number;
  quantity: number;
}): VirtualPortfolio["positions"][number] {
  return {
    market: "KR",
    symbol: "005930",
    quantity: input.quantity,
    averagePriceKrw: input.averagePriceKrw,
    marketValueKrw: Math.round(input.quantity * input.averagePriceKrw),
    updatedAt: "2025-01-02T09:00:00+09:00"
  };
}

function packet(input: {
  lastPriceKrw: number;
  sellEligible?: boolean;
}): MarketPacket {
  return {
    packetId: "packet_exit_policy_001",
    mode: "paper_only",
    generatedAt: "2025-01-02T09:00:00+09:00",
    expiresAt: "2025-01-02T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: input.lastPriceKrw,
        ranking: 1,
        reasonCodes: ["HISTORICAL_REPLAY"],
        sourceRefs: ["fixture:005930"],
        featureRefs: ["candidate.KR.005930.lastPriceKrw"],
        sellEligible: input.sellEligible ?? true,
        collectedAt: "2025-01-02T09:00:00+09:00",
        staleAfter: "2025-01-02T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}
