import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualPortfolio } from "../domain/schemas.js";
import {
  createMockMarketPacket,
  MarketPacketBuilder,
  type MarketCandidateDraft
} from "./packetBuilder.js";

const generatedAt = new Date("2026-06-11T09:00:00+09:00");

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T08:59:00+09:00"
  };
}

function builder(maxCandidates = 2): MarketPacketBuilder {
  return new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });
}

function candidate(symbol: string, ranking: number): MarketCandidateDraft {
  return {
    market: "KR",
    symbol,
    name: `Sample ${symbol}`,
    lastPriceKrw: 10_000,
    ranking,
    reasonCodes: ["MOCK"],
    sourceRefs: [`source_${symbol}`]
  };
}

test("MarketPacketBuilder trims candidates to maxCandidates", () => {
  const result = builder(2).build({
    portfolio: portfolio(),
    candidates: [candidate("000003", 3), candidate("000001", 1), candidate("000002", 2)]
  });

  assert.deepEqual(
    result.packet.candidates.map((item) => item.symbol),
    ["000001", "000002"]
  );
});

test("MarketPacketBuilder preserves held candidates beyond maxCandidates", () => {
  const result = builder(2).build({
    portfolio: {
      ...portfolio(),
      positions: [
        {
          market: "KR",
          symbol: "000003",
          quantity: 1,
          averagePriceKrw: 10_000,
          marketValueKrw: 10_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    },
    candidates: [
      candidate("000001", 1),
      candidate("000002", 2),
      candidate("000003", 3)
    ]
  });

  assert.deepEqual(
    result.packet.candidates.map((item) => item.symbol),
    ["000001", "000002", "000003"]
  );
  const held = result.packet.candidates.find(
    (item) => item.symbol === "000003"
  )!;
  assert.equal(held.positionExists, true);
  assert.equal(held.sellEligible, true);
});

test("MarketPacketBuilder sets packet expiry from ttl", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [candidate("005930", 1)]
  });

  assert.equal(result.packet.generatedAt, "2026-06-11T00:00:00.000Z");
  assert.equal(result.packet.expiresAt, "2026-06-11T00:05:00.000Z");
  assert.equal(result.packet.candidates[0]?.staleAfter, result.packet.expiresAt);
});

test("MarketPacketBuilder excludes candidates missing source refs with warning", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [
      candidate("005930", 1),
      {
        market: "KR",
        symbol: "000000",
        ranking: 2
      }
    ]
  });

  assert.equal(result.packet.candidates.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /missing sourceRefs/);
});

test("MarketPacketBuilder includes virtual portfolio snapshot", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [candidate("005930", 1)]
  });

  assert.equal(result.packet.virtualPortfolio.cashKrw, 1_000_000);
  assert.equal(result.packet.virtualPortfolio.portfolioId, "virtual_default");
});

test("MarketPacketBuilder adds deterministic candidate action eligibility", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [candidate("005930", 1)]
  });

  const normalized = result.packet.candidates[0]!;
  assert.equal(normalized.buyEligible, true);
  assert.equal(normalized.sellEligible, false);
  assert.equal(normalized.positionExists, false);
  assert.equal(normalized.cooldownActive, false);
  assert.equal(normalized.budgetTierAllowed, "LARGE");
  assert.deepEqual(normalized.blockedReasonCodes, ["POSITION_NOT_FOUND"]);
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.005930.lastPriceKrw"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.005930.buyEligible"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.005930.collectedAt"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.005930.staleAfter"),
    true
  );
  assert.deepEqual(normalized.dataRefs, ["candidate.KR.005930.source.0"]);
  assert.deepEqual(normalized.sourceRefs, ["source_005930"]);
  assert.equal(
    normalized.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.005930.ranking" &&
        featureScore.score === 100 &&
        featureScore.scoreType === "RANKING" &&
        featureScore.reasonCode === "RANKING_WITHIN_PACKET"
    ),
    true
  );
  assert.equal(
    normalized.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.005930.sellEligible" &&
        featureScore.score === 0 &&
        featureScore.scoreType === "POLICY" &&
        featureScore.reasonCode === "SELL_BLOCKED"
    ),
    true
  );
  assert.equal(
    normalized.featureScores?.every((featureScore) =>
      normalized.featureRefs?.includes(featureScore.featureRef)
    ),
    true
  );
});

test("MarketPacketBuilder preserves asset taxonomy and feature refs", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [
      {
        ...candidate("069500", 1),
        name: "KODEX 200 ETF",
        assetType: "ETF",
        assetClass: "equity",
        region: "KR",
        riskTags: ["sector_concentrated"],
        strategyBucket: "swing"
      }
    ]
  });

  const normalized = result.packet.candidates[0]!;
  assert.equal(normalized.assetType, "ETF");
  assert.equal(normalized.assetClass, "equity");
  assert.equal(normalized.region, "KR");
  assert.deepEqual(normalized.riskTags, ["sector_concentrated"]);
  assert.equal(normalized.strategyBucket, "swing");
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.069500.assetType"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.069500.assetClass"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.069500.region"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.069500.riskTags"),
    true
  );
  assert.equal(
    normalized.featureRefs?.includes("candidate.KR.069500.strategyBucket"),
    true
  );
  assert.equal(
    normalized.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.069500.strategyBucket" &&
        featureScore.score === 100 &&
        featureScore.scoreType === "AVAILABILITY" &&
        featureScore.reasonCode === "STRATEGY_BUCKET_AVAILABLE"
    ),
    true
  );
});

test("MarketPacketBuilder blocks new buys when max new positions is reached", () => {
  const result = new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates: 2,
    constraints: {
      maxNewPositions: 1,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  }).build({
    portfolio: {
      ...portfolio(),
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
    },
    candidates: [candidate("005930", 1), candidate("000660", 2)]
  });

  const existing = result.packet.candidates.find(
    (item) => item.symbol === "005930"
  )!;
  const newCandidate = result.packet.candidates.find(
    (item) => item.symbol === "000660"
  )!;

  assert.equal(existing.buyEligible, true);
  assert.equal(existing.sellEligible, true);
  assert.equal(existing.positionExists, true);
  assert.equal(newCandidate.buyEligible, false);
  assert.equal(newCandidate.sellEligible, false);
  assert.equal(
    newCandidate.blockedReasonCodes?.includes("MAX_NEW_POSITIONS_REACHED"),
    true
  );
  assert.equal(
    newCandidate.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.000660.buyEligible" &&
        featureScore.score === 0 &&
        featureScore.reasonCode === "BUY_BLOCKED"
    ),
    true
  );
  assert.equal(
    newCandidate.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.000660.budgetTierAllowed" &&
        featureScore.score === 0 &&
        featureScore.reasonCode === "BUDGET_TIER_NONE"
    ),
    true
  );
});

test("MarketPacketBuilder includes allocation snapshot and blocks buys at target exposure", () => {
  const result = new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates: 2,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 200_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    allocationPolicy: {
      policyName: "fixture_allocation",
      targetExposureRatio: 0.8,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3
    }
  }).build({
    portfolio: {
      ...portfolio(),
      cashKrw: 100_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 90,
          averagePriceKrw: 10_000,
          marketValueKrw: 900_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    },
    candidates: [candidate("000660", 1)]
  });

  assert.equal(result.packet.portfolioAllocation?.targetExposureRatio, 0.8);
  assert.equal(result.packet.portfolioAllocation?.currentExposureRatio, 0.9);
  assert.equal(result.packet.portfolioAllocation?.maxAdditionalBuyBudgetKrw, 0);
  assert.equal(result.packet.candidates[0]?.buyEligible, false);
  assert.equal(
    result.packet.candidates[0]?.blockedReasonCodes?.includes(
      "TARGET_EXPOSURE_REACHED"
    ),
    true
  );
  assert.equal(result.packet.candidates[0]?.budgetTierAllowed, "NONE");
});

test("MarketPacketBuilder blocks buys when candidate market target is reached", () => {
  const result = new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates: 2,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 200_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    allocationPolicy: {
      policyName: "market_aware_allocation",
      targetExposureRatio: 0.8,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3,
      marketTargetExposureRatios: {
        KR: 0.1,
        US: 0.5
      }
    }
  }).build({
    portfolio: {
      ...portfolio(),
      cashKrw: 800_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 20,
          averagePriceKrw: 10_000,
          marketValueKrw: 200_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    },
    candidates: [
      candidate("000660", 1),
      { ...candidate("AAPL", 2), market: "US" }
    ]
  });

  const krCandidate = result.packet.candidates.find(
    (item) => item.market === "KR"
  )!;
  const usCandidate = result.packet.candidates.find(
    (item) => item.market === "US"
  )!;

  assert.equal(
    result.packet.portfolioAllocation?.marketAllocations?.KR
      ?.maxAdditionalBuyBudgetKrw,
    0
  );
  assert.equal(krCandidate.buyEligible, false);
  assert.equal(
    krCandidate.blockedReasonCodes?.includes(
      "MARKET_TARGET_EXPOSURE_REACHED"
    ),
    true
  );
  assert.equal(krCandidate.budgetTierAllowed, "NONE");
  assert.equal(usCandidate.buyEligible, true);
  assert.equal(usCandidate.budgetTierAllowed, "LARGE");
});

test("MarketPacketBuilder blocks new buys when scheduled position slots are full", () => {
  const result = new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates: 2,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 200_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    allocationPolicy: {
      policyName: "slot_ramp_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.25,
      deploymentRampDays: 10,
      rampDayIndex: 1,
      maxInitialDeploymentRatio: 0.25,
      maxInitialOpenPositions: 1,
      maxNewPositionsPerDay: 1,
      maxConcurrentPositions: 3,
      positionSlotRampDays: 10
    }
  }).build({
    portfolio: {
      ...portfolio(),
      cashKrw: 800_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 100_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    },
    candidates: [candidate("005930", 1), candidate("000660", 2)]
  });

  const allocation = result.packet.portfolioAllocation;
  const existing = result.packet.candidates.find(
    (item) => item.symbol === "005930"
  )!;
  const newCandidate = result.packet.candidates.find(
    (item) => item.symbol === "000660"
  )!;

  assert.equal(allocation?.scheduledOpenPositionCeiling, 1);
  assert.equal(allocation?.remainingNewPositionSlots, 0);
  assert.equal(existing.buyEligible, true);
  assert.equal(newCandidate.buyEligible, false);
  assert.equal(
    newCandidate.blockedReasonCodes?.includes("MAX_NEW_POSITIONS_REACHED"),
    true
  );
});

test("MarketPacketBuilder preserves US eligibility when KR market slots are full", () => {
  const result = new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates: 3,
    constraints: {
      maxNewPositions: 5,
      maxBudgetPerSymbolKrw: 200_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    allocationPolicy: {
      policyName: "market_slot_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.25,
      deploymentRampDays: 10,
      rampDayIndex: 10,
      maxInitialDeploymentRatio: 0.25,
      maxInitialOpenPositions: 2,
      maxNewPositionsPerDay: 2,
      maxConcurrentPositions: 5,
      positionSlotRampDays: 10,
      marketTargetExposureRatios: {
        KR: 0.425,
        US: 0.425
      }
    }
  }).build({
    portfolio: {
      ...portfolio(),
      cashKrw: 600_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 100_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        },
        {
          market: "KR",
          symbol: "000660",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 100_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        },
        {
          market: "KR",
          symbol: "035900",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 100_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        },
        {
          market: "US",
          symbol: "AMZN",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 100_000,
          updatedAt: "2026-06-11T08:59:00+09:00"
        }
      ]
    },
    candidates: [
      candidate("035900", 1),
      candidate("010140", 2),
      { ...candidate("PLTR", 3), market: "US" }
    ]
  });

  const krCandidate = result.packet.candidates.find(
    (item) => item.market === "KR" && item.symbol === "010140"
  )!;
  const usCandidate = result.packet.candidates.find(
    (item) => item.market === "US"
  )!;

  assert.equal(
    result.packet.portfolioAllocation?.marketAllocations?.KR
      ?.scheduledOpenPositionCeiling,
    3
  );
  assert.equal(
    result.packet.portfolioAllocation?.marketAllocations?.US
      ?.remainingScheduledOpenPositionSlots,
    2
  );
  assert.equal(krCandidate.buyEligible, false);
  assert.equal(
    krCandidate.blockedReasonCodes?.includes("MARKET_POSITION_SLOTS_REACHED"),
    true
  );
  assert.equal(usCandidate.buyEligible, true);
  assert.equal(usCandidate.budgetTierAllowed, "LARGE");
});

test("MarketPacketBuilder drops sensitive extra fields from raw candidate drafts", () => {
  const rawCandidate = {
    ...candidate("005930", 1),
    accountNumber: "1234-5678-901234",
    token: "secret-token"
  };
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [rawCandidate]
  });

  assert.equal("accountNumber" in result.packet.candidates[0]!, false);
  assert.equal("token" in result.packet.candidates[0]!, false);
});

test("createMockMarketPacket creates a valid compact fixture", () => {
  const result = createMockMarketPacket({
    portfolio: portfolio(),
    now: generatedAt
  });

  assert.equal(result.packet.packetId, "packet_mock_001");
  assert.equal(result.packet.candidates.length, 1);
  assert.equal(result.warnings.length, 0);
});
