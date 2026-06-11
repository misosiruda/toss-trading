import assert from "node:assert/strict";
import test from "node:test";

import { PaperOrderEngine } from "./orderEngine.js";
import { VirtualLedger } from "./ledger.js";
import type {
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";

const now = new Date("2026-06-11T09:00:00+09:00");

test("VirtualLedger records filled paper trades immutably", () => {
  const result = new PaperOrderEngine().execute({
    packet: packet(),
    portfolio: portfolio(),
    decision: decision(),
    riskPolicy: { now }
  });

  assert.ok(result.trade);

  const ledger = new VirtualLedger();
  ledger.record({
    trade: result.trade,
    riskDecision: result.riskDecision,
    resultingPortfolio: result.portfolio
  });

  const entries = ledger.list();
  entries[0]!.resultingPortfolio.cashKrw = 0;

  assert.equal(ledger.list()[0]?.resultingPortfolio.cashKrw, 930_000);
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T08:59:00+09:00"
  };
}

function packet(): MarketPacket {
  return {
    packetId: "packet_ledger_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T08:59:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: 70_000,
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
    }
  };
}

function decision(): VirtualDecisionItem {
  return {
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    confidence: 0.7,
    budgetKrw: 70_000,
    thesis: "Paper-only buy fixture.",
    riskFactors: ["Fixture risk."],
    dataRefs: ["external_snapshot_001"],
    expiresAt: "2026-06-11T09:05:00+09:00"
  };
}
