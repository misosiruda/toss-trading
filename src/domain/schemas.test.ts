import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFresh,
  historicalMarketSnapshotSchema,
  marketPacketSchema,
  parseWithSchema,
  virtualDecisionSchema
} from "./schemas.js";

const now = "2026-06-11T09:00:00+09:00";
const later = "2026-06-11T09:05:00+09:00";

function validMarketPacket(): unknown {
  return {
    packetId: "packet_20260611_090000",
    mode: "paper_only",
    generatedAt: now,
    expiresAt: later,
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: now
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Sample Corp",
        assetType: "STOCK",
        assetClass: "equity",
        region: "KR",
        riskTags: ["sector_concentrated"],
        sector: "Technology",
        industry: "Semiconductors",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["RANKING", "FLOW_POSITIVE"],
        eventTags: ["earnings"],
        newsRefs: ["news:sample:001"],
        featureRefs: ["candidate.KR.005930.ranking"],
        featureScores: [
          {
            featureRef: "candidate.KR.005930.ranking",
            score: 100,
            scoreType: "RANKING",
            reasonCode: "RANKING_WITHIN_PACKET"
          }
        ],
        dividendYieldPct: 2.4,
        exDividendDate: "2026-12-27",
        dataRefs: ["candidate.KR.005930.source.0"],
        sourceRefs: ["external_snapshot_001"],
        collectedAt: now,
        staleAfter: later
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function validVirtualDecision(): unknown {
  return {
    packetId: "packet_20260611_090000",
    summary: "Paper-only decision for validation fixture.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.62,
        budgetKrw: 50_000,
        thesis: "Ranking and source refs support a small virtual allocation.",
        riskFactors: ["Paper-only fixture risk."],
        dataRefs: ["external_snapshot_001"],
        claimSupport: [
          {
            claim: "Ranking and source refs support a small virtual allocation.",
            dataRefs: ["external_snapshot_001"]
          }
        ],
        expiresAt: later
      }
    ]
  };
}

test("valid market packet fixture passes schema validation", () => {
  const packet = parseWithSchema(
    marketPacketSchema,
    validMarketPacket(),
    "marketPacket"
  );

  assert.equal(packet.mode, "paper_only");
  assert.equal(packet.candidates[0]?.dataRefs?.[0], "candidate.KR.005930.source.0");
  assert.equal(packet.candidates[0]?.sourceRefs[0], "external_snapshot_001");
  assert.equal(packet.candidates[0]?.assetType, "STOCK");
  assert.equal(packet.candidates[0]?.assetClass, "equity");
  assert.equal(packet.candidates[0]?.region, "KR");
  assert.deepEqual(packet.candidates[0]?.riskTags, ["sector_concentrated"]);
  assert.equal(packet.candidates[0]?.sector, "Technology");
  assert.equal(packet.candidates[0]?.industry, "Semiconductors");
  assert.deepEqual(packet.candidates[0]?.eventTags, ["earnings"]);
  assert.deepEqual(packet.candidates[0]?.newsRefs, ["news:sample:001"]);
  assert.deepEqual(packet.candidates[0]?.featureScores, [
    {
      featureRef: "candidate.KR.005930.ranking",
      score: 100,
      scoreType: "RANKING",
      reasonCode: "RANKING_WITHIN_PACKET"
    }
  ]);
  assert.equal(packet.candidates[0]?.dividendYieldPct, 2.4);
  assert.equal(packet.candidates[0]?.exDividendDate, "2026-12-27");
});

test("market packet rejects feature scores outside feature refs", () => {
  const packet = validMarketPacket() as {
    candidates: Array<{
      featureRefs: string[];
      featureScores: Array<{
        featureRef: string;
        score: number;
        scoreType: string;
        reasonCode: string;
      }>;
    }>;
  };
  packet.candidates[0]!.featureScores = [
    {
      featureRef: "candidate.KR.005930.futureReturn",
      score: 100,
      scoreType: "VALUE",
      reasonCode: "FUTURE_RETURN"
    }
  ];

  assert.throws(
    () => parseWithSchema(marketPacketSchema, packet, "marketPacket"),
    /featureScore\.featureRef/
  );
});

test("valid historical market snapshot fixture passes schema validation", () => {
  const snapshot = parseWithSchema(
    historicalMarketSnapshotSchema,
    {
      snapshotId: "hist_kr_005930_20250611_090000",
      market: "KR",
      symbol: "005930",
      name: "Samsung Electronics",
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR",
      observedAt: "2025-06-11T09:00:00+09:00",
      interval: "1m",
      openPriceKrw: 70_000,
      highPriceKrw: 70_500,
      lowPriceKrw: 69_900,
      closePriceKrw: 70_200,
      lastPriceKrw: 70_200,
      volume: 120_000,
      sourceRefs: ["historical_fixture_001"],
      createdAt: "2026-06-11T09:00:00+09:00"
    },
    "historicalMarketSnapshot"
  );

  assert.equal(snapshot.symbol, "005930");
  assert.equal(snapshot.name, "Samsung Electronics");
  assert.equal(snapshot.assetType, "STOCK");
  assert.equal(snapshot.assetClass, "equity");
  assert.equal(snapshot.region, "KR");
  assert.equal(snapshot.interval, "1m");
});

test("historical market snapshot rejects inverted high and low prices", () => {
  assert.throws(
    () =>
      parseWithSchema(
        historicalMarketSnapshotSchema,
        {
          snapshotId: "hist_invalid_prices",
          market: "KR",
          symbol: "005930",
          observedAt: "2025-06-11T09:00:00+09:00",
          interval: "1m",
          highPriceKrw: 69_000,
          lowPriceKrw: 70_000,
          lastPriceKrw: 69_500,
          sourceRefs: ["historical_fixture_001"],
          createdAt: "2026-06-11T09:00:00+09:00"
        },
        "historicalMarketSnapshot"
      ),
    /highPriceKrw/
  );
});

test("invalid virtual action is rejected", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{ action: string }>;
  };
  decision.decisions[0]!.action = "BUY";

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /failed validation/
  );
});

test("missing data ref is rejected", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{ dataRefs: string[] }>;
  };
  decision.decisions[0]!.dataRefs = [];

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /failed validation/
  );
});

test("claim support requires at least one supporting ref", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      claimSupport: Array<{ claim: string; dataRefs?: string[] }>;
    }>;
  };
  decision.decisions[0]!.claimSupport = [{ claim: "Unsupported claim." }];

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /Claim support/
  );
});

test("claim support accepts feature refs as supporting refs", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      featureRefs?: string[];
      claimSupport: Array<{
        claim: string;
        dataRefs?: string[];
        featureRefs?: string[];
      }>;
    }>;
  };
  decision.decisions[0]!.featureRefs = ["candidate.KR.005930.ranking"];
  decision.decisions[0]!.claimSupport = [
    {
      claim: "Ranking feature supports a small virtual allocation.",
      featureRefs: ["candidate.KR.005930.ranking"]
    }
  ];

  const parsed = parseWithSchema(
    virtualDecisionSchema,
    decision,
    "virtualDecision"
  );

  assert.deepEqual(parsed.decisions[0]?.claimSupport?.[0]?.featureRefs, [
    "candidate.KR.005930.ranking"
  ]);
});

test("non-hold decisions require risk factors", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{ riskFactors: string[] }>;
  };
  decision.decisions[0]!.riskFactors = [];

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /risk factor/
  );
});

test("hold decisions accept explicit hold reason code", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      action: string;
      holdReasonCode?: string;
      budgetKrw: number;
      riskFactors: string[];
    }>;
  };
  decision.decisions[0]!.action = "VIRTUAL_HOLD";
  decision.decisions[0]!.holdReasonCode = "INSUFFICIENT_EVIDENCE";
  decision.decisions[0]!.budgetKrw = 0;
  decision.decisions[0]!.riskFactors = [];

  const parsed = parseWithSchema(
    virtualDecisionSchema,
    decision,
    "virtualDecision"
  );

  assert.equal(
    parsed.decisions[0]?.holdReasonCode,
    "INSUFFICIENT_EVIDENCE"
  );
});

test("hold decisions reject unknown hold reason code", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      action: string;
      holdReasonCode?: string;
      budgetKrw: number;
      riskFactors: string[];
    }>;
  };
  decision.decisions[0]!.action = "VIRTUAL_HOLD";
  decision.decisions[0]!.holdReasonCode = "UNKNOWN_REASON";
  decision.decisions[0]!.budgetKrw = 0;
  decision.decisions[0]!.riskFactors = [];

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /failed validation/
  );
});

test("sell decisions require explicit sizing", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      action: string;
      budgetKrw: number;
      riskFactors: string[];
    }>;
  };
  decision.decisions[0]!.action = "VIRTUAL_SELL";
  decision.decisions[0]!.budgetKrw = 0;
  decision.decisions[0]!.riskFactors = ["Paper-only sell sizing risk."];

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /Sell decisions must include/
  );
});

test("sell decisions support reduce-only ratio sizing", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      action: string;
      budgetKrw: number;
      riskFactors: string[];
      sellRatio?: number;
      reduceOnly?: boolean;
    }>;
  };
  decision.decisions[0]!.action = "VIRTUAL_SELL";
  decision.decisions[0]!.budgetKrw = 0;
  decision.decisions[0]!.riskFactors = ["Paper-only sell sizing risk."];
  decision.decisions[0]!.sellRatio = 0.5;
  decision.decisions[0]!.reduceOnly = true;

  const parsed = parseWithSchema(
    virtualDecisionSchema,
    decision,
    "virtualDecision"
  );

  assert.equal(parsed.decisions[0]?.sellRatio, 0.5);
  assert.equal(parsed.decisions[0]?.reduceOnly, true);
});

test("sell decisions reject v2 sizing without reduceOnly true", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      action: string;
      budgetKrw: number;
      riskFactors: string[];
      sellRatio?: number;
    }>;
  };
  decision.decisions[0]!.action = "VIRTUAL_SELL";
  decision.decisions[0]!.budgetKrw = 0;
  decision.decisions[0]!.riskFactors = ["Paper-only sell sizing risk."];
  decision.decisions[0]!.sellRatio = 0.5;

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /reduceOnly to true/
  );
});

test("sell decisions reject explicit non reduce-only intent", () => {
  const decision = validVirtualDecision() as {
    decisions: Array<{
      action: string;
      budgetKrw: number;
      riskFactors: string[];
      sellAll?: boolean;
      reduceOnly?: boolean;
    }>;
  };
  decision.decisions[0]!.action = "VIRTUAL_SELL";
  decision.decisions[0]!.budgetKrw = 0;
  decision.decisions[0]!.riskFactors = ["Paper-only sell sizing risk."];
  decision.decisions[0]!.sellAll = true;
  decision.decisions[0]!.reduceOnly = false;

  assert.throws(
    () => parseWithSchema(virtualDecisionSchema, decision, "virtualDecision"),
    /reduce-only/
  );
});

test("stale timestamp helper rejects expired values", () => {
  assert.throws(
    () =>
      assertFresh(
        "2026-06-11T08:59:59+09:00",
        new Date("2026-06-11T09:00:00+09:00")
      ),
    /stale timestamp/
  );
});
