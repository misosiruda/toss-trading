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

test("VirtualRiskEngine rejects buy decisions that breach cash reserve", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet({
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 1_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 950_000 }),
    policy: {
      now,
      maxBudgetPerDecisionKrw: 1_000_000,
      maxSymbolExposureKrw: 1_000_000,
      maxPositionWeightRatio: 1,
      minCashReserveRatio: 0.1
    }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_CASH_RESERVE_BREACHED"));
  assert.ok(risk.checkedRules.includes("cash_reserve"));
});

test("VirtualRiskEngine rejects buy decisions that exceed NAV weight", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet({
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 1_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 400_000 }),
    policy: {
      now,
      maxBudgetPerDecisionKrw: 1_000_000,
      maxSymbolExposureKrw: 1_000_000,
      maxPositionWeightRatio: 0.35
    }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_POSITION_WEIGHT_EXCEEDED"));
  assert.ok(risk.checkedRules.includes("position_weight"));
});

test("VirtualRiskEngine rejects buy decisions that exceed target exposure", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet({
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 1_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }),
    portfolio: portfolio({
      cashKrw: 300_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          quantity: 7,
          averagePriceKrw: 100_000,
          marketValueKrw: 700_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 200_000 }),
    policy: {
      now,
      maxBudgetPerDecisionKrw: 1_000_000,
      maxSymbolExposureKrw: 1_000_000,
      targetExposureRatio: 0.8,
      maxPositionWeightRatio: 1,
      minCashReserveRatio: 0.05
    }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_TARGET_EXPOSURE_EXCEEDED"));
  assert.ok(risk.checkedRules.includes("target_exposure"));
});

test("VirtualRiskEngine rejects active symbol action cooldowns", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 70_000 }),
    policy: {
      now,
      cooldownEntries: [
        {
          market: "KR",
          symbol: "005930",
          action: "VIRTUAL_BUY",
          activeUntil: "2026-06-11T09:30:00+09:00",
          reason: "post_reject"
        }
      ]
    }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_COOLDOWN_ACTIVE"));
  assert.ok(risk.checkedRules.includes("cooldown"));
});

test("VirtualRiskEngine exempts reduce-only sells from cooldown", () => {
  const risk = new VirtualRiskEngine().evaluate({
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
      budgetKrw: 0,
      sellRatio: 0.5,
      reduceOnly: true,
      thesis: "Paper-only sell fixture."
    }),
    policy: {
      now,
      cooldownEntries: [
        {
          market: "KR",
          symbol: "005930",
          action: "VIRTUAL_SELL",
          activeUntil: "2026-06-11T09:30:00+09:00",
          reason: "post_fill"
        }
      ]
    }
  });

  assert.equal(risk.approved, true);
  assert.equal(risk.rejectCodes.includes("VIRTUAL_COOLDOWN_ACTIVE"), false);
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

test("VirtualRiskEngine approves hold decisions without candidate price", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet({
      candidates: [
        {
          market: "US",
          symbol: "TSLA",
          name: "Tesla",
          ranking: 1,
          reasonCodes: ["RANKING"],
          sourceRefs: ["external_ranking_001"],
          collectedAt: "2026-06-11T08:59:00+09:00",
          staleAfter: "2026-06-11T09:05:00+09:00"
        }
      ]
    }),
    portfolio: portfolio(),
    decision: decision({
      market: "US",
      symbol: "TSLA",
      action: "VIRTUAL_HOLD",
      budgetKrw: 0,
      thesis: "Paper-only hold fixture.",
      riskFactors: [],
      dataRefs: ["external_ranking_001"]
    }),
    policy: { now }
  });

  assert.equal(risk.approved, true);
  assert.equal(risk.rejectCodes.includes("VIRTUAL_PRICE_MISSING"), false);
});

test("VirtualRiskEngine rejects decisions outside packet candidates", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({
      symbol: "999999",
      action: "VIRTUAL_HOLD",
      budgetKrw: 0,
      thesis: "Paper-only hold fixture.",
      riskFactors: [],
      dataRefs: ["external_snapshot_missing"]
    }),
    policy: { now }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_CANDIDATE_NOT_FOUND"));
});

test("VirtualRiskEngine does not report zero-price sells as amount exceeded", () => {
  const risk = new VirtualRiskEngine().evaluate({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          lastPriceKrw: 0
        }
      ]
    }),
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
    policy: { now }
  });

  assert.equal(risk.approved, false);
  assert.ok(risk.rejectCodes.includes("VIRTUAL_PRICE_MISSING"));
  assert.ok(risk.rejectCodes.includes("VIRTUAL_SELL_AMOUNT_REQUIRED"));
  assert.equal(risk.rejectCodes.includes("VIRTUAL_SELL_AMOUNT_EXCEEDED"), false);
});

test("PaperOrderEngine fills valid virtual buy decisions", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          market: "KR",
          symbol: "005930",
          name: "Sample ETF",
          assetType: "ETF",
          assetClass: "equity",
          region: "KR",
          riskTags: ["sector_concentrated"],
          strategyBucket: "swing",
          lastPriceKrw: 70_000,
          ranking: 1,
          reasonCodes: ["RANKING"],
          sourceRefs: ["external_snapshot_001"],
          collectedAt: "2026-06-11T08:59:00+09:00",
          staleAfter: "2026-06-11T09:05:00+09:00"
        }
      ]
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 70_000 }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.status, "VIRTUAL_FILLED");
  assert.equal(result.portfolio.cashKrw, 930_000);
  assert.equal(result.portfolio.positions[0]?.quantity, 1);
  assert.equal(result.portfolio.positions[0]?.averagePriceKrw, 70_000);
  assert.equal(result.portfolio.positions[0]?.assetType, "ETF");
  assert.equal(result.portfolio.positions[0]?.assetClass, "equity");
  assert.equal(result.portfolio.positions[0]?.region, "KR");
  assert.deepEqual(result.portfolio.positions[0]?.riskTags, [
    "sector_concentrated"
  ]);
  assert.equal(result.portfolio.positions[0]?.strategyBucket, "swing");
  assert.equal(result.trade?.strategyBucket, "swing");
});

test("PaperOrderEngine preserves held strategy bucket when adding to a position", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          strategyBucket: "swing"
        }
      ]
    }),
    portfolio: portfolio({
      positions: [
        {
          market: "KR",
          symbol: "005930",
          strategyBucket: "long_term",
          quantity: 1,
          averagePriceKrw: 70_000,
          marketValueKrw: 70_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 10_000 }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.portfolio.positions[0]?.strategyBucket, "long_term");
  assert.equal(result.trade?.strategyBucket, "long_term");
});

test("PaperOrderEngine records buy fill costs with slippage and fees", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 70_000 }),
    riskPolicy: { now },
    executionPolicy: {
      slippageBps: 10,
      feeBps: 10
    }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.sourcePriceKrw, 70_000);
  assert.equal(result.trade?.priceKrw, 70_070);
  assert.equal(result.trade?.grossAmountKrw, 70_000);
  assert.equal(result.trade?.feeKrw, 70);
  assert.equal(result.trade?.netAmountKrw, 70_070);
  assert.equal(result.trade?.slippageKrw, 70);
  assert.equal(result.trade?.spreadCostKrw, 0);
  assert.equal(result.trade?.impactCostKrw, 0);
  assert.equal(result.trade?.totalCostKrw, 140);
  assert.equal(result.trade?.costModelVersion, "paper_cost_model.v2");
  assert.equal(result.trade?.fillStatus, "filled");
  assert.equal(result.trade?.liquidityStatus, "not_modeled");
  assert.equal(result.trade?.requestedNotionalKrw, 70_000);
  assert.equal(result.trade?.filledNotionalKrw, 70_000);
  assert.equal(result.portfolio.cashKrw, 929_930);
  assert.equal(result.portfolio.positions[0]?.marketPriceKrw, 70_000);
  assert.equal(result.portfolio.positions[0]?.unrealizedPnlKrw, -140);
});

test("PaperOrderEngine records partial fills when volume participation caps notional", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          volume: 10,
          averageVolume: 10
        }
      ],
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 1_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 700_000 }),
    riskPolicy: {
      now,
      maxBudgetPerDecisionKrw: 1_000_000,
      maxSymbolExposureKrw: 1_000_000,
      maxPositionWeightRatio: 1,
      minCashReserveRatio: 0
    }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.fillStatus, "partial");
  assert.equal(result.trade?.liquidityStatus, "partial");
  assert.equal(result.trade?.requestedNotionalKrw, 700_000);
  assert.equal(result.trade?.filledNotionalKrw, 70_000);
  assert.equal(result.trade?.participationRate, 0.1);
  assert.equal(result.trade?.maxParticipationRate, 0.1);
  assert.equal(result.trade?.volume, 10);
  assert.equal(result.trade?.averageVolume, 10);
  assert.equal(result.trade?.quantity, 1);
  assert.equal(result.portfolio.cashKrw, 930_000);
});

test("PaperOrderEngine rejects no-fill liquidity without creating a trade", () => {
  const startingPortfolio = portfolio();
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          volume: 1,
          averageVolume: 1
        }
      ],
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 1_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }),
    portfolio: startingPortfolio,
    decision: decision({ budgetKrw: 700_000 }),
    riskPolicy: {
      now,
      maxBudgetPerDecisionKrw: 1_000_000,
      maxSymbolExposureKrw: 1_000_000,
      maxPositionWeightRatio: 1,
      minCashReserveRatio: 0
    }
  });

  assert.equal(result.riskDecision.approved, false);
  assert.ok(
    result.riskDecision.rejectCodes.includes("VIRTUAL_LIQUIDITY_INSUFFICIENT")
  );
  assert.ok(result.riskDecision.checkedRules.includes("liquidity"));
  assert.equal(result.trade, null);
  assert.deepEqual(result.portfolio, startingPortfolio);
});

test("PaperOrderEngine rejects stale liquidity references", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          volume: 10,
          averageVolume: 10,
          staleAfter: "2026-06-11T08:59:00+09:00"
        }
      ],
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 1_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 700_000 }),
    riskPolicy: {
      now,
      maxBudgetPerDecisionKrw: 1_000_000,
      maxSymbolExposureKrw: 1_000_000,
      maxPositionWeightRatio: 1,
      minCashReserveRatio: 0
    }
  });

  assert.equal(result.riskDecision.approved, false);
  assert.ok(result.riskDecision.rejectCodes.includes("VIRTUAL_LIQUIDITY_STALE"));
  assert.equal(result.trade, null);
});

test("PaperOrderEngine supports whole-share paper fills", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 100_000 }),
    riskPolicy: { now },
    executionPolicy: {
      allowFractionalShares: false
    }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.quantity, 1);
  assert.equal(result.trade?.amountKrw, 70_000);
  assert.equal(result.trade?.fractionalShares, false);
  assert.equal(result.portfolio.cashKrw, 930_000);
});

test("PaperOrderEngine records approved holds without mutating portfolio", () => {
  const startingPortfolio = portfolio();
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          market: "US",
          symbol: "TSLA",
          name: "Tesla",
          ranking: 1,
          reasonCodes: ["RANKING"],
          sourceRefs: ["external_ranking_001"],
          collectedAt: "2026-06-11T08:59:00+09:00",
          staleAfter: "2026-06-11T09:05:00+09:00"
        }
      ]
    }),
    portfolio: startingPortfolio,
    decision: decision({
      market: "US",
      symbol: "TSLA",
      action: "VIRTUAL_HOLD",
      budgetKrw: 0,
      thesis: "Paper-only hold fixture.",
      riskFactors: [],
      dataRefs: ["external_ranking_001"]
    }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade, null);
  assert.deepEqual(result.portfolio, startingPortfolio);
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

test("PaperOrderEngine records sell strategy bucket from held position", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          strategyBucket: "swing"
        }
      ]
    }),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          strategyBucket: "long_term",
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
  assert.equal(result.trade?.strategyBucket, "long_term");
});

test("PaperOrderEngine executes reduce-only sell ratio sizing", () => {
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
      budgetKrw: 0,
      sellRatio: 0.5,
      reduceOnly: true,
      thesis: "Paper-only sell fixture."
    }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.amountKrw, 70_000);
  assert.equal(result.trade?.quantity, 1);
  assert.equal(result.portfolio.cashKrw, 70_000);
  assert.equal(result.portfolio.positions[0]?.quantity, 1);
});

test("PaperOrderEngine clips oversize reduce-only sell quantity", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 70_000,
          marketValueKrw: 70_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      sellQuantity: 2,
      reduceOnly: true,
      thesis: "Paper-only sell fixture."
    }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.amountKrw, 70_000);
  assert.equal(result.trade?.quantity, 1);
  assert.equal(result.portfolio.cashKrw, 70_000);
  assert.equal(result.portfolio.positions.length, 0);
});

test("PaperOrderEngine records sell realized pnl after costs", () => {
  const result = new PaperOrderEngine().execute({
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
      budgetKrw: 70_000,
      thesis: "Paper-only sell fixture."
    }),
    riskPolicy: { now },
    executionPolicy: {
      feeBps: 10,
      taxBps: 20
    }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.grossAmountKrw, 70_000);
  assert.equal(result.trade?.feeKrw, 70);
  assert.equal(result.trade?.taxKrw, 140);
  assert.equal(result.trade?.netAmountKrw, 69_790);
  assert.equal(result.trade?.realizedPnlKrw, 9_790);
  assert.equal(result.portfolio.cashKrw, 69_790);
  assert.equal(result.portfolio.positions.length, 0);
});

test("PaperOrderEngine snaps full reduce-only exits to the held quantity", () => {
  const heldQuantity = 4.189044038668099;
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          symbol: "028300",
          lastPriceKrw: 84_600
        }
      ]
    }),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "028300",
          quantity: heldQuantity,
          averagePriceKrw: 93_100,
          marketValueKrw: Math.round(heldQuantity * 84_600),
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      symbol: "028300",
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      sellAll: true,
      reduceOnly: true,
      thesis: "Paper-only full exit fixture."
    }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.trade?.quantity, heldQuantity);
  assert.equal(result.portfolio.positions.length, 0);
});

test("PaperOrderEngine closes sellAll dust positions without a trade", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          symbol: "028300",
          lastPriceKrw: 84_600
        }
      ]
    }),
    portfolio: portfolio({
      cashKrw: 0,
      positions: [
        {
          market: "KR",
          symbol: "028300",
          quantity: 0.00000001,
          averagePriceKrw: 93_100,
          marketValueKrw: 0,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({
      symbol: "028300",
      action: "VIRTUAL_SELL",
      budgetKrw: 0,
      sellAll: true,
      reduceOnly: true,
      thesis: "Paper-only dust close fixture."
    }),
    riskPolicy: { now }
  });

  assert.equal(result.riskDecision.approved, true);
  assert.equal(result.riskDecision.rejectCodes.includes("VIRTUAL_SELL_AMOUNT_REQUIRED"), false);
  assert.equal(result.trade, null);
  assert.equal(result.noOpReason, "NO_OP_EXIT_DUST_CLOSED");
  assert.equal(result.portfolio.positions.length, 0);
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
