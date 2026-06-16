import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  evaluateVirtualBuyRiskBranch,
  evaluateVirtualSellRiskBranch
} from "./riskBranches.js";
import { createVirtualRiskPolicy } from "./riskPolicy.js";

const now = new Date("2026-06-14T09:00:00+09:00");

test("buy risk branch rejects cash reserve breaches", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio({ cashKrw: 1_000 }),
    decision: decision({ budgetKrw: 950 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000,
        maxSymbolExposureKrw: 1_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.1
      }
    }),
    candidate: candidate()
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_CASH_RESERVE_BREACHED"
  ]);
});

test("buy risk branch rejects target exposure breaches", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 300_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          quantity: 7,
          averagePriceKrw: 100_000,
          marketValueKrw: 700_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 200_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        targetExposureRatio: 0.8,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05
      }
    }),
    candidate: candidate()
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_TARGET_EXPOSURE_EXCEEDED"
  ]);
});

test("sell risk branch requires sizing for non-dust sell decisions", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 2,
          averagePriceKrw: 70_000,
          marketValueKrw: 140_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      thesis: "Paper-only sell fixture."
    }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 100_000,
      policy: { now }
    }),
    candidate: candidate()
  };

  assert.deepEqual(evaluateVirtualSellRiskBranch(input), [
    "VIRTUAL_SELL_AMOUNT_REQUIRED"
  ]);
});

test("sell risk branch allows sellAll dust close without trade sizing", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 0.00000001,
          averagePriceKrw: 70_000,
          marketValueKrw: 0,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      sellAll: true,
      reduceOnly: true,
      thesis: "Paper-only dust close fixture."
    }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 100_000,
      policy: { now }
    }),
    candidate: candidate()
  };

  assert.deepEqual(evaluateVirtualSellRiskBranch(input), []);
});

function portfolio(
  overrides: Partial<VirtualPortfolio> = {}
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-14T08:59:00+09:00",
    ...overrides
  };
}

function packet(): MarketPacket {
  return {
    packetId: "packet_risk_branch_001",
    mode: "paper_only",
    generatedAt: "2026-06-14T08:59:00+09:00",
    expiresAt: "2026-06-14T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [candidate()],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 1_000_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function candidate(): MarketCandidate {
  return {
    market: "KR",
    symbol: "005930",
    name: "Sample Corp",
    lastPriceKrw: 70_000,
    ranking: 1,
    reasonCodes: ["RISK_BRANCH"],
    sourceRefs: ["fixture:risk-branch"],
    collectedAt: "2026-06-14T08:59:00+09:00",
    staleAfter: "2026-06-14T09:05:00+09:00"
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
    thesis: "Paper-only risk branch fixture.",
    riskFactors: ["Fixture risk."],
    dataRefs: ["fixture:risk-branch"],
    expiresAt: "2026-06-14T09:05:00+09:00",
    ...overrides
  };
}
