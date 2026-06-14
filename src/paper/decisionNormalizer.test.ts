import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import { normalizeVirtualDecision } from "./decisionNormalizer.js";

test("normalizer caps buy notional by packet policy", () => {
  const order = normalizeVirtualDecision({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 150_000 })
  });

  assert.equal(order.action, "VIRTUAL_BUY");
  assert.equal(order.targetNotionalKrw, 100_000);
  assert.equal(order.quantity, 100_000 / 70_000);
  assert.equal(order.reduceOnly, false);
  assert.deepEqual(order.normalizationNotes, ["BUY_BUDGET_CAPPED_BY_PACKET_POLICY"]);
});

test("normalizer derives sell notional from reduce-only ratio", () => {
  const order = normalizeVirtualDecision({
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 4,
          averagePriceKrw: 60_000,
          marketValueKrw: 280_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      sellRatio: 0.5,
      reduceOnly: true
    })
  });

  assert.equal(order.action, "VIRTUAL_SELL");
  assert.equal(order.targetNotionalKrw, 140_000);
  assert.equal(order.quantity, 2);
  assert.equal(order.reduceOnly, true);
});

test("normalizer caps buy notional by portfolio allocation budget", () => {
  const order = normalizeVirtualDecision({
    packet: packet({
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 500_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      portfolioAllocation: {
        policyName: "fixture_allocation",
        targetExposureRatio: 0.8,
        minCashReserveRatio: 0.05,
        maxBudgetPerDecisionRatio: 0.2,
        maxSymbolExposureRatio: 0.3,
        currentExposureRatio: 0.7,
        currentCashRatio: 0.3,
        targetCashRatio: 0.2,
        targetExposureGapRatio: 0.1,
        targetExposureGapKrw: 100_000,
        maxAdditionalBuyBudgetKrw: 80_000,
        maxBudgetPerDecisionKrw: 200_000,
        maxSymbolExposureKrw: 300_000,
        minCashReserveKrw: 50_000
      }
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 300_000 })
  });

  assert.equal(order.targetNotionalKrw, 80_000);
  assert.deepEqual(order.normalizationNotes, [
    "BUY_BUDGET_CAPPED_BY_PACKET_POLICY",
    "BUY_BUDGET_CAPPED_BY_TARGET_EXPOSURE"
  ]);
});

test("normalizer clips oversize sell quantity to available position", () => {
  const order = normalizeVirtualDecision({
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 60_000,
          marketValueKrw: 70_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      sellQuantity: 2,
      reduceOnly: true
    })
  });

  assert.equal(order.targetNotionalKrw, 70_000);
  assert.equal(order.quantity, 1);
  assert.deepEqual(order.normalizationNotes, [
    "SELL_CLIPPED_TO_AVAILABLE_POSITION"
  ]);
});

test("normalizer keeps hold as zero-notional reduce-only order", () => {
  const order = normalizeVirtualDecision({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({
      action: "VIRTUAL_HOLD",
      holdReasonCode: "INSUFFICIENT_EVIDENCE",
      budgetKrw: 0,
      riskFactors: []
    })
  });

  assert.equal(order.targetNotionalKrw, 0);
  assert.equal(order.quantity, null);
  assert.equal(order.reduceOnly, true);
});

function portfolio(overrides: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T08:59:00+09:00",
    ...overrides
  };
}

function packet(overrides: Partial<MarketPacket> = {}): MarketPacket {
  return {
    packetId: "packet_normalizer_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T08:59:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Sample Corp",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["RANKING"],
        sourceRefs: ["external_snapshot_001"],
        collectedAt: "2026-06-11T08:59:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
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

function decision(
  overrides: Partial<VirtualDecisionItem> = {}
): VirtualDecisionItem {
  return {
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    confidence: 0.7,
    budgetKrw: 70_000,
    thesis: "Paper-only decision fixture.",
    riskFactors: ["Fixture risk."],
    dataRefs: ["external_snapshot_001"],
    expiresAt: "2026-06-11T09:05:00+09:00",
    ...overrides
  };
}
