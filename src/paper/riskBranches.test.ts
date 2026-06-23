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

test("buy risk branch rejects sector exposure breaches", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          sector: "Technology"
        }),
        candidate({
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 500_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          quantity: 4,
          averagePriceKrw: 100_000,
          marketValueKrw: 400_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxSectorExposureRatio: 0.5
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_SECTOR_EXPOSURE_EXCEEDED"
  ]);
});

test("buy risk branch fails closed when held sector metadata is unavailable", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 500_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          quantity: 4,
          averagePriceKrw: 100_000,
          marketValueKrw: 400_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxSectorExposureRatio: 0.9
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch rejects country exposure breaches", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          symbol: "SPY",
          market: "US",
          assetType: "ETF",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          strategyBucket: "long_term",
          sector: "Index"
        }),
        candidate({
          market: "US",
          assetType: "STOCK",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 600_000,
      positions: [
        {
          market: "US",
          symbol: "SPY",
          assetType: "ETF",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          strategyBucket: "long_term",
          quantity: 4,
          averagePriceKrw: 100_000,
          marketValueKrw: 400_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ market: "US", budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxCountryExposureRatio: 0.45
      }
    }),
    candidate: candidate({
      market: "US",
      assetType: "STOCK",
      assetClass: "equity",
      region: "US",
      riskTags: ["currency_exposed"],
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_COUNTRY_EXPOSURE_EXCEEDED"
  ]);
});

test("buy risk branch fails closed when country metadata is unavailable", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          sector: "Technology"
        }),
        candidate({
          assetType: "STOCK",
          assetClass: "equity",
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 550_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          quantity: 45,
          averagePriceKrw: 10_000,
          marketValueKrw: 450_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxCountryExposureRatio: 0.5
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch rejects currency exposure breaches", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          symbol: "AAPL",
          market: "US",
          assetType: "STOCK",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          strategyBucket: "long_term",
          sector: "Technology"
        }),
        candidate({
          market: "US",
          assetType: "STOCK",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 700_000,
      positions: [
        {
          market: "US",
          symbol: "AAPL",
          assetType: "STOCK",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          strategyBucket: "long_term",
          quantity: 2,
          averagePriceKrw: 100_000,
          marketValueKrw: 200_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ market: "US", budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxCurrencyExposureRatio: 0.3
      }
    }),
    candidate: candidate({
      market: "US",
      assetType: "STOCK",
      assetClass: "equity",
      region: "US",
      riskTags: ["currency_exposed"],
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_CURRENCY_EXPOSURE_EXCEEDED"
  ]);
});

test("buy risk branch fails closed when buy currency metadata is unavailable", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          assetType: "STOCK",
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 70_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxCurrencyExposureRatio: 0.9
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch fails closed when held currency metadata is unavailable", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          symbol: "000660",
          assetType: "STOCK",
          strategyBucket: "long_term",
          sector: "Technology"
        }),
        candidate({
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "swing",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 700_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          assetType: "STOCK",
          strategyBucket: "long_term",
          quantity: 2,
          averagePriceKrw: 100_000,
          marketValueKrw: 200_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxCurrencyExposureRatio: 0.9
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      strategyBucket: "swing",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch rejects excessive unknown metadata exposure", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 900_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          quantity: 1,
          averagePriceKrw: 50_000,
          marketValueKrw: 50_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 60_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxUnknownMetadataExposureRatio: 0.1
      }
    }),
    candidate: candidate()
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch rejects bucket budget breaches", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio({
      cashKrw: 750_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          quantity: 1,
          averagePriceKrw: 250_000,
          marketValueKrw: 250_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxStrategyBucketExposureRatio: { long_term: 0.3 }
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      strategyBucket: "long_term",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_BUCKET_BUDGET_EXCEEDED"
  ]);
});

test("buy risk branch fails closed when buy bucket metadata is unavailable", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 40_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxBucketTurnoverKrw: { intraday: 50_000 }
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch fails closed when held bucket metadata is unavailable", () => {
  const input = {
    packet: packet({
      candidates: [
        candidate({
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          strategyBucket: "long_term",
          sector: "Technology"
        })
      ]
    }),
    portfolio: portfolio({
      cashKrw: 700_000,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          quantity: 2,
          averagePriceKrw: 100_000,
          marketValueKrw: 200_000,
          updatedAt: "2026-06-14T08:59:00+09:00"
        }
      ]
    }),
    decision: decision({ budgetKrw: 100_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxStrategyBucketExposureRatio: { long_term: 0.9 }
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      strategyBucket: "long_term",
      sector: "Technology"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_EXPOSURE_METADATA_MISSING"
  ]);
});

test("buy risk branch rejects bucket turnover breaches", () => {
  const input = {
    packet: packet(),
    portfolio: portfolio(),
    decision: decision({ budgetKrw: 80_000 }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 1_000_000,
      policy: {
        now,
        maxBudgetPerDecisionKrw: 1_000_000,
        maxSymbolExposureKrw: 1_000_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        maxBucketTurnoverKrw: { intraday: 50_000 }
      }
    }),
    candidate: candidate({
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      strategyBucket: "intraday",
      sector: "Trading"
    })
  };

  assert.deepEqual(evaluateVirtualBuyRiskBranch(input), [
    "VIRTUAL_BUCKET_TURNOVER_EXCEEDED"
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

test("sell risk branch does not mark zero-price candidates as amount exceeded", () => {
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
      budgetKrw: 70_000,
      thesis: "Paper-only sell fixture."
    }),
    policy: createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: 100_000,
      policy: { now }
    }),
    candidate: candidate({ lastPriceKrw: 0 })
  };

  assert.deepEqual(evaluateVirtualSellRiskBranch(input), []);
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

function packet(overrides: Partial<MarketPacket> = {}): MarketPacket {
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
    },
    ...overrides
  };
}

function candidate(overrides: Partial<MarketCandidate> = {}): MarketCandidate {
  return {
    market: "KR",
    symbol: "005930",
    name: "Sample Corp",
    lastPriceKrw: 70_000,
    ranking: 1,
    reasonCodes: ["RISK_BRANCH"],
    sourceRefs: ["fixture:risk-branch"],
    collectedAt: "2026-06-14T08:59:00+09:00",
    staleAfter: "2026-06-14T09:05:00+09:00",
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
    thesis: "Paper-only risk branch fixture.",
    riskFactors: ["Fixture risk."],
    dataRefs: ["fixture:risk-branch"],
    expiresAt: "2026-06-14T09:05:00+09:00",
    ...overrides
  };
}
