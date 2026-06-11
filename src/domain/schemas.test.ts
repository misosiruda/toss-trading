import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFresh,
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
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["RANKING", "FLOW_POSITIVE"],
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
  assert.equal(packet.candidates[0]?.sourceRefs[0], "external_snapshot_001");
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
