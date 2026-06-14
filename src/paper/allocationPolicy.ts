import type { VirtualPortfolio } from "../domain/schemas.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export interface PaperAllocationPolicy {
  policyName: string;
  targetExposureRatio: number;
  minCashReserveRatio: number;
  maxBudgetPerDecisionRatio: number;
  maxSymbolExposureRatio: number;
}

export interface PaperAllocationSnapshot extends PaperAllocationPolicy {
  currentExposureRatio: number;
  currentCashRatio: number;
  targetCashRatio: number;
  targetExposureGapRatio: number;
  targetExposureGapKrw: number;
  maxAdditionalBuyBudgetKrw: number;
  maxBudgetPerDecisionKrw: number;
  maxSymbolExposureKrw: number;
  minCashReserveKrw: number;
}

export function buildPaperAllocationSnapshot(input: {
  portfolio: VirtualPortfolio;
  policy: PaperAllocationPolicy;
}): PaperAllocationSnapshot {
  const netWorthKrw = virtualNetWorthKrw(input.portfolio);
  const positionMarketValueKrw = positionMarketValue(input.portfolio);
  const currentExposureRatio =
    netWorthKrw <= 0 ? 0 : boundedRatio(positionMarketValueKrw / netWorthKrw);
  const currentCashRatio =
    netWorthKrw <= 0 ? 0 : boundedRatio(input.portfolio.cashKrw / netWorthKrw);
  const targetExposureRatio = boundedRatio(input.policy.targetExposureRatio);
  const minCashReserveRatio = boundedRatio(input.policy.minCashReserveRatio);
  const targetPositionValueKrw = Math.round(netWorthKrw * targetExposureRatio);
  const minCashReserveKrw = Math.round(netWorthKrw * minCashReserveRatio);
  const cashAvailableAfterReserve = Math.max(
    0,
    input.portfolio.cashKrw - minCashReserveKrw
  );
  const targetExposureGapKrw = Math.max(
    0,
    targetPositionValueKrw - positionMarketValueKrw
  );

  return {
    policyName: input.policy.policyName,
    targetExposureRatio,
    minCashReserveRatio,
    maxBudgetPerDecisionRatio: boundedRatio(
      input.policy.maxBudgetPerDecisionRatio
    ),
    maxSymbolExposureRatio: boundedRatio(input.policy.maxSymbolExposureRatio),
    currentExposureRatio: roundRatio(currentExposureRatio),
    currentCashRatio: roundRatio(currentCashRatio),
    targetCashRatio: roundRatio(1 - targetExposureRatio),
    targetExposureGapRatio: roundRatio(
      Math.max(0, targetExposureRatio - currentExposureRatio)
    ),
    targetExposureGapKrw,
    maxAdditionalBuyBudgetKrw: Math.min(
      cashAvailableAfterReserve,
      targetExposureGapKrw
    ),
    maxBudgetPerDecisionKrw: Math.round(
      netWorthKrw * input.policy.maxBudgetPerDecisionRatio
    ),
    maxSymbolExposureKrw: Math.round(
      netWorthKrw * input.policy.maxSymbolExposureRatio
    ),
    minCashReserveKrw
  };
}

export function portfolioExposureRatio(portfolio: VirtualPortfolio): number {
  const netWorthKrw = virtualNetWorthKrw(portfolio);
  if (netWorthKrw <= 0) {
    return 0;
  }
  return boundedRatio(positionMarketValue(portfolio) / netWorthKrw);
}

export function positionMarketValue(portfolio: VirtualPortfolio): number {
  return portfolio.positions.reduce(
    (sum, position) =>
      sum +
      (position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)),
    0
  );
}

function boundedRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
