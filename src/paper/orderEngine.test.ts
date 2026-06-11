import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import { PaperOrderEngine } from "./orderEngine.js";
import { VirtualRiskEngine } from "./riskEngine.js";

const now = new Date("2026-06-11T09:00:00+09:00");

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
    packetId: "packet_001",
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
    thesis: "Paper-only buy fixture.",
    riskFactors: ["Fixture risk."],
    dataRefs: ["external_snapshot_001"],
    expiresAt: "2026-06-11T09:05:00+09:00",
    ...overrides
  };
}

test("VirtualRiskEngine rejects buy decisions that exceed virtual cash", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet(),
    portfolio: portfolio({ cashKrw: 10_000 }),
    decision: decision({ budgetKrw: 70_000 }),
    policy: { now }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_CASH_EXCEEDED"));
});

test("VirtualRiskEngine rejects max symbol exposure breaches", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet(),
    portfolio: portfolio({
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 70_000,
          marketValueKrw: 80_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 50_000 }),
    policy: { now, maxSymbolExposureKrw: 100_000 }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED"));
});

test("VirtualRiskEngine rejects stale decisions", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ expiresAt: "2026-06-11T08:59:59+09:00" }),
    policy: { now }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_DECISION_STALE"));
});

test("PaperOrderEngine fills valid virtual buy decisions", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 70_000 }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.status, "VIRTUAL_FILLED");
  assert.equal(result.portfolio.cashKrw, 930_000);
  assert.equal(result.portfolio.positions[0]?.quantity, 1);
  assert.equal(result.portfolio.positions[0]?.averagePriceKrw, 70_000);
});

test("PaperOrderEngine updates virtual position on sell", () => {
  const result = new PaperOrderEngine().execute({
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
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      action: "VIRTUAL_SELL",
      budgetKrw: 70_000,
      thesis: "Paper-only sell fixture."
    }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.action, "VIRTUAL_SELL");
  assert.equal(result.portfolio.cashKrw, 70_000);
  assert.equal(result.portfolio.positions[0]?.quantity, 1);
});

test("PaperOrderEngine does not mutate portfolio when risk rejects", () => {
  const startingPortfolio = portfolio({ cashKrw: 10_000 });
  const result = new PaperOrderEngine().execute({
    packet: packet(),
    portfolio: startingPortfolio,
    decision: decision({ budgetKrw: 70_000 }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, false);
  assert.equal(result.trade, null);
  assert.deepEqual(result.portfolio, startingPortfolio);
});
