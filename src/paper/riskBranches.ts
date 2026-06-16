import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import { normalizeVirtualDecision } from "./decisionNormalizer.js";
import { isSellAllDustClose } from "./dustPosition.js";
import {
  minimumCashReserveKrw,
  virtualNetWorthKrw,
  type VirtualRiskPolicy,
  type VirtualRiskRejectCode
} from "./riskPolicy.js";

export interface VirtualRiskBranchInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
  policy: VirtualRiskPolicy;
  candidate: MarketCandidate | undefined;
}

export function evaluateVirtualBuyRiskBranch(
  input: VirtualRiskBranchInput
): VirtualRiskRejectCode[] {
  const rejectCodes: VirtualRiskRejectCode[] = [];
  const notionalKrw = normalizeVirtualDecision(input).targetNotionalKrw;

  if (notionalKrw > input.portfolio.cashKrw) {
    rejectCodes.push("VIRTUAL_CASH_EXCEEDED");
  }

  if (
    input.portfolio.cashKrw - notionalKrw <
    minimumCashReserveKrw(input.portfolio, input.policy)
  ) {
    rejectCodes.push("VIRTUAL_CASH_RESERVE_BREACHED");
  }

  if (notionalKrw > input.policy.maxBudgetPerDecisionKrw) {
    rejectCodes.push("VIRTUAL_BUDGET_EXCEEDED");
  }

  const netWorthKrw = virtualNetWorthKrw(input.portfolio);
  if (
    input.policy.targetExposureRatio !== undefined &&
    netWorthKrw > 0 &&
    (portfolioExposureKrw(input.portfolio) + notionalKrw) / netWorthKrw >
      input.policy.targetExposureRatio
  ) {
    rejectCodes.push("VIRTUAL_TARGET_EXPOSURE_EXCEEDED");
  }

  const currentExposure = currentSymbolExposureKrw(
    input.portfolio,
    input.decision
  );
  if (currentExposure + notionalKrw > input.policy.maxSymbolExposureKrw) {
    rejectCodes.push("VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED");
  }

  if (
    netWorthKrw > 0 &&
    (currentExposure + notionalKrw) / netWorthKrw >
      input.policy.maxPositionWeightRatio
  ) {
    rejectCodes.push("VIRTUAL_POSITION_WEIGHT_EXCEEDED");
  }

  return rejectCodes;
}

export function evaluateVirtualSellRiskBranch(
  input: VirtualRiskBranchInput
): VirtualRiskRejectCode[] {
  const rejectCodes: VirtualRiskRejectCode[] = [];
  const position = input.portfolio.positions.find(
    (item) =>
      item.market === input.decision.market &&
      item.symbol === input.decision.symbol
  );
  const notionalKrw = normalizeVirtualDecision(input).targetNotionalKrw;

  if (position === undefined) {
    rejectCodes.push("VIRTUAL_POSITION_NOT_FOUND");
    return rejectCodes;
  }

  if (
    notionalKrw <= 0 &&
    !isSellAllDustClose({
      decision: input.decision,
      position,
      priceKrw: input.candidate?.lastPriceKrw
    })
  ) {
    rejectCodes.push("VIRTUAL_SELL_AMOUNT_REQUIRED");
    return rejectCodes;
  }

  if (input.candidate?.lastPriceKrw !== undefined) {
    const positionValue = Math.round(
      position.quantity * input.candidate.lastPriceKrw
    );
    if (notionalKrw > positionValue) {
      rejectCodes.push("VIRTUAL_SELL_AMOUNT_EXCEEDED");
    }
  }

  return rejectCodes;
}

function currentSymbolExposureKrw(
  portfolio: VirtualPortfolio,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): number {
  const position = portfolio.positions.find(
    (item) => item.market === decision.market && item.symbol === decision.symbol
  );
  if (position === undefined) {
    return 0;
  }

  return (
    position.marketValueKrw ??
    Math.round(position.quantity * position.averagePriceKrw)
  );
}

function portfolioExposureKrw(portfolio: VirtualPortfolio): number {
  return portfolio.positions.reduce(
    (sum, position) =>
      sum +
      (position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)),
    0
  );
}
