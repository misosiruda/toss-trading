import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualRiskDecision, VirtualTrade } from "../domain/schemas.js";
import { buildReplayRiskPolicySummary } from "./replayRiskPolicySummary.js";

test("replay risk policy summary separates dynamic cash reserve and hedge rejects", () => {
  const summary = buildReplayRiskPolicySummary({
    riskDecisions: [
      riskDecision({
        riskDecisionId: "risk_dynamic_001",
        symbol: "005930",
        rejectCodes: [
          "VIRTUAL_REGIME_CASH_RESERVE_BREACHED",
          "VIRTUAL_MAX_BUDGET_PER_DECISION_EXCEEDED"
        ]
      }),
      riskDecision({
        riskDecisionId: "risk_hedge_001",
        symbol: "252670",
        rejectCodes: [
          "VIRTUAL_HEDGE_NOT_REDUCE_RISK",
          "VIRTUAL_HEDGE_METADATA_MISSING"
        ]
      }),
      riskDecision({
        riskDecisionId: "risk_other_001",
        symbol: "000660",
        rejectCodes: ["VIRTUAL_MAX_SYMBOL_EXPOSURE_EXCEEDED"]
      })
    ]
  });

  assert.equal(summary.dynamicCashReserve.rejectedCount, 1);
  assert.deepEqual(summary.dynamicCashReserve.affectedSymbols, ["005930"]);
  assert.deepEqual(summary.dynamicCashReserve.rejectCodes, {
    VIRTUAL_REGIME_CASH_RESERVE_BREACHED: 1
  });
  assert.equal(summary.hedge.rejectedCount, 1);
  assert.deepEqual(summary.hedge.affectedSymbols, ["252670"]);
  assert.deepEqual(summary.hedge.rejectCodes, {
    VIRTUAL_HEDGE_METADATA_MISSING: 1,
    VIRTUAL_HEDGE_NOT_REDUCE_RISK: 1
  });
});

test("replay risk policy summary aggregates hedge trade notional and cost", () => {
  const summary = buildReplayRiskPolicySummary({
    riskDecisions: [],
    trades: [
      trade({
        tradeId: "trade_hedge_buy",
        action: "VIRTUAL_BUY",
        amountKrw: 50_000,
        strategyBucket: "hedge",
        feeKrw: 10,
        taxKrw: 2,
        slippageKrw: 3,
        spreadCostKrw: 4,
        impactCostKrw: 5,
        totalCostKrw: 999
      }),
      trade({
        tradeId: "trade_hedge_sell",
        action: "VIRTUAL_SELL",
        amountKrw: 20_000,
        strategyBucket: "hedge",
        totalCostKrw: 7
      }),
      trade({
        tradeId: "trade_long_buy",
        action: "VIRTUAL_BUY",
        amountKrw: 100_000,
        strategyBucket: "long_term",
        totalCostKrw: 100
      })
    ]
  });

  assert.equal(summary.hedge.hedgeTradeCount, 2);
  assert.equal(summary.hedge.hedgeBuyAmountKrw, 50_000);
  assert.equal(summary.hedge.hedgeCostKrw, 31);
});

function riskDecision(input: {
  riskDecisionId: string;
  symbol: string;
  rejectCodes: string[];
}): VirtualRiskDecision {
  return {
    riskDecisionId: input.riskDecisionId,
    packetId: `packet_${input.riskDecisionId}`,
    symbol: input.symbol,
    approved: false,
    rejectCodes: input.rejectCodes,
    checkedRules: ["fixture_rule"],
    createdAt: "2025-01-02T09:00:00+09:00"
  };
}

function trade(
  input: Pick<
    VirtualTrade,
    "tradeId" | "action" | "amountKrw" | "strategyBucket"
  > &
    Partial<
      Pick<
        VirtualTrade,
        | "feeKrw"
        | "taxKrw"
        | "slippageKrw"
        | "spreadCostKrw"
        | "impactCostKrw"
        | "totalCostKrw"
      >
    >
): VirtualTrade {
  return {
    tradeId: input.tradeId,
    packetId: `packet_${input.tradeId}`,
    decisionId: `decision_${input.tradeId}`,
    market: "KR",
    symbol: input.strategyBucket === "hedge" ? "252670" : "005930",
    action: input.action,
    quantity: 1,
    priceKrw: input.amountKrw,
    amountKrw: input.amountKrw,
    ...(input.feeKrw === undefined ? {} : { feeKrw: input.feeKrw }),
    ...(input.taxKrw === undefined ? {} : { taxKrw: input.taxKrw }),
    ...(input.slippageKrw === undefined
      ? {}
      : { slippageKrw: input.slippageKrw }),
    ...(input.spreadCostKrw === undefined
      ? {}
      : { spreadCostKrw: input.spreadCostKrw }),
    ...(input.impactCostKrw === undefined
      ? {}
      : { impactCostKrw: input.impactCostKrw }),
    ...(input.totalCostKrw === undefined
      ? {}
      : { totalCostKrw: input.totalCostKrw }),
    strategyBucket: input.strategyBucket,
    status: "VIRTUAL_FILLED",
    executedAt: "2025-01-02T09:00:00+09:00"
  };
}
