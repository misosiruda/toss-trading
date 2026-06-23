import { z } from "zod";

import type { VirtualRiskDecision, VirtualTrade } from "../domain/schemas.js";

const DYNAMIC_CASH_RESERVE_REJECT_CODES = [
  "VIRTUAL_REGIME_CASH_RESERVE_BREACHED"
] as const;

const HEDGE_REJECT_CODES = [
  "VIRTUAL_HEDGE_NOT_REDUCE_RISK",
  "VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED",
  "VIRTUAL_HEDGE_METADATA_MISSING"
] as const;

const replayPolicyRejectSummarySchema = z
  .object({
    rejectedCount: z.number().int().nonnegative(),
    affectedSymbols: z.array(z.string().trim().min(1)),
    rejectCodes: z.record(z.string().trim().min(1), z.number().int().nonnegative())
  })
  .strict();

export const replayRiskPolicySummarySchema = z
  .object({
    dynamicCashReserve: replayPolicyRejectSummarySchema,
    hedge: replayPolicyRejectSummarySchema.extend({
      hedgeTradeCount: z.number().int().nonnegative(),
      hedgeBuyAmountKrw: z.number().nonnegative(),
      hedgeCostKrw: z.number().nonnegative()
    })
  })
  .strict();

export type ReplayPolicyRejectSummary = z.infer<
  typeof replayPolicyRejectSummarySchema
>;
export type ReplayRiskPolicySummary = z.infer<
  typeof replayRiskPolicySummarySchema
>;

export function buildReplayRiskPolicySummary(input: {
  riskDecisions: VirtualRiskDecision[];
  trades?: VirtualTrade[];
}): ReplayRiskPolicySummary {
  const trades = input.trades ?? [];

  return {
    dynamicCashReserve: summarizeRejectCodes({
      riskDecisions: input.riskDecisions,
      targetRejectCodes: DYNAMIC_CASH_RESERVE_REJECT_CODES
    }),
    hedge: {
      ...summarizeRejectCodes({
        riskDecisions: input.riskDecisions,
        targetRejectCodes: HEDGE_REJECT_CODES
      }),
      hedgeTradeCount: trades.filter(isHedgeTrade).length,
      hedgeBuyAmountKrw: trades
        .filter(
          (trade) => isHedgeTrade(trade) && trade.action === "VIRTUAL_BUY"
        )
        .reduce((sum, trade) => sum + trade.amountKrw, 0),
      hedgeCostKrw: trades.filter(isHedgeTrade).reduce(sumTradeCost, 0)
    }
  };
}

function summarizeRejectCodes(input: {
  riskDecisions: VirtualRiskDecision[];
  targetRejectCodes: readonly string[];
}): ReplayPolicyRejectSummary {
  const targetRejectCodes = new Set(input.targetRejectCodes);
  const rejectCodes: Record<string, number> = {};
  const affectedSymbols = new Set<string>();
  let rejectedCount = 0;

  for (const decision of input.riskDecisions) {
    const matchedCodes = decision.rejectCodes.filter((code) =>
      targetRejectCodes.has(code)
    );
    if (matchedCodes.length === 0) {
      continue;
    }

    rejectedCount += 1;
    if (decision.symbol !== undefined) {
      affectedSymbols.add(decision.symbol);
    }
    for (const code of matchedCodes) {
      rejectCodes[code] = (rejectCodes[code] ?? 0) + 1;
    }
  }

  return {
    rejectedCount,
    affectedSymbols: Array.from(affectedSymbols).sort(),
    rejectCodes
  };
}

function isHedgeTrade(trade: VirtualTrade): boolean {
  return trade.strategyBucket === "hedge";
}

function sumTradeCost(total: number, trade: VirtualTrade): number {
  const componentTotal =
    (trade.feeKrw ?? 0) +
    (trade.taxKrw ?? 0) +
    (trade.slippageKrw ?? 0) +
    (trade.spreadCostKrw ?? 0) +
    (trade.impactCostKrw ?? 0);
  return total + (componentTotal > 0 ? componentTotal : trade.totalCostKrw ?? 0);
}
