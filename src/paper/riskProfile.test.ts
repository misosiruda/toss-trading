import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import { PaperOrderEngine } from "./orderEngine.js";
import {
  parsePaperRiskProfileName,
  resolvePaperRiskProfile
} from "./riskProfile.js";

const now = new Date("2026-06-13T09:00:00+09:00");

test("paper risk profile keeps conservative defaults compatible", () => {
  const profile = resolvePaperRiskProfile();

  assert.equal(profile.name, "conservative");
  assert.deepEqual(profile.constraints, {
    maxNewPositions: 3,
    maxBudgetPerSymbolKrw: 100_000,
    allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
  });
  assert.equal(profile.riskPolicy.maxBudgetPerDecisionKrw, 100_000);
  assert.equal(profile.riskPolicy.maxSymbolExposureKrw, 100_000);
  assert.equal(profile.riskPolicy.maxPositionWeightRatio, 0.35);
  assert.equal(profile.riskPolicy.minCashReserveRatio, 0.1);
});

test("paper risk profile exposes aggressive paper-only limits", () => {
  const profile = resolvePaperRiskProfile({ name: "aggressive_paper" });

  assert.equal(profile.name, "aggressive_paper");
  assert.equal(profile.constraints.maxNewPositions, 5);
  assert.equal(profile.constraints.maxBudgetPerSymbolKrw, 400_000);
  assert.equal(profile.riskPolicy.maxBudgetPerDecisionKrw, 400_000);
  assert.equal(profile.riskPolicy.maxSymbolExposureKrw, 600_000);
  assert.equal(profile.riskPolicy.targetExposureRatio, 0.85);
  assert.equal(profile.riskPolicy.maxPositionWeightRatio, 0.65);
  assert.equal(profile.riskPolicy.minCashReserveRatio, 0.05);
  assert.equal(profile.allocationPolicy.targetExposureRatio, 0.85);
  assert.equal(profile.allocationPolicy.maxBudgetPerDecisionRatio, 0.2);
  assert.equal(profile.allocationPolicy.maxSymbolExposureRatio, 0.3);
});

test("paper risk profile applies explicit CLI budget override to policy", () => {
  const profile = resolvePaperRiskProfile({
    name: "aggressive_paper",
    maxBudgetPerSymbolKrw: 500_000
  });

  assert.equal(profile.constraints.maxBudgetPerSymbolKrw, 500_000);
  assert.equal(profile.riskPolicy.maxBudgetPerDecisionKrw, 500_000);
  assert.equal(profile.riskPolicy.maxSymbolExposureKrw, 750_000);
});

test("paper risk profile scales aggressive paper limits from initial cash", () => {
  const profile = resolvePaperRiskProfile({
    name: "aggressive_paper",
    initialCashKrw: 10_000_000
  });

  assert.equal(profile.constraints.maxBudgetPerSymbolKrw, 2_000_000);
  assert.equal(profile.riskPolicy.maxBudgetPerDecisionKrw, 2_000_000);
  assert.equal(profile.riskPolicy.maxSymbolExposureKrw, 3_000_000);
  assert.equal(profile.riskPolicy.targetExposureRatio, 0.85);
  assert.equal(profile.riskPolicy.minCashReserveRatio, 0.05);
});

test("paper risk profile rejects unknown names", () => {
  assert.throws(
    () => parsePaperRiskProfileName("unsupported"),
    /--risk-profile must be one of/
  );
});

test("paper risk profile parser trims explicit names", () => {
  assert.equal(
    parsePaperRiskProfileName(" aggressive_paper "),
    "aggressive_paper"
  );
});

test("aggressive paper profile permits larger paper-only buy fill", () => {
  const conservative = resolvePaperRiskProfile();
  const aggressive = resolvePaperRiskProfile({ name: "aggressive_paper" });
  const engine = new PaperOrderEngine();

  const conservativeResult = engine.execute({
    packet: packet(conservative.constraints),
    portfolio: portfolio(),
    decision: decision(400_000),
    riskPolicy: { ...conservative.riskPolicy, now }
  });
  const aggressiveResult = engine.execute({
    packet: packet(aggressive.constraints),
    portfolio: portfolio(),
    decision: decision(400_000),
    riskPolicy: { ...aggressive.riskPolicy, now }
  });

  assert.equal(conservativeResult.riskDecision.approved, true);
  assert.equal(conservativeResult.trade?.amountKrw, 100_000);
  assert.equal(aggressiveResult.riskDecision.approved, true);
  assert.equal(aggressiveResult.trade?.amountKrw, 400_000);
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-13T08:59:00+09:00"
  };
}

function packet(constraints: MarketPacket["constraints"]): MarketPacket {
  return {
    packetId: "packet_profile_001",
    mode: "paper_only",
    generatedAt: "2026-06-13T08:59:00+09:00",
    expiresAt: "2026-06-13T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: 100_000,
        reasonCodes: ["PROFILE_TEST"],
        sourceRefs: ["fixture:profile"],
        collectedAt: "2026-06-13T08:59:00+09:00",
        staleAfter: "2026-06-13T09:05:00+09:00"
      }
    ],
    constraints
  };
}

function decision(budgetKrw: number): VirtualDecisionItem {
  return {
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    confidence: 0.7,
    budgetKrw,
    thesis: "Paper-only profile test decision.",
    riskFactors: ["Profile test risk."],
    dataRefs: ["fixture:profile"],
    expiresAt: "2026-06-13T09:05:00+09:00"
  };
}
