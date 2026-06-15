import type { Market, VirtualPortfolio } from "../domain/schemas.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export type PaperMarketTargetExposureRatios = Partial<Record<Market, number>>;

export interface PaperAllocationPolicy {
  policyName: string;
  targetExposureRatio: number;
  minCashReserveRatio: number;
  maxBudgetPerDecisionRatio: number;
  maxSymbolExposureRatio: number;
  marketTargetExposureRatios?: PaperMarketTargetExposureRatios;
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
  marketAllocations?: PaperMarketAllocationSnapshotByMarket;
}

export type PaperMarketAllocationSnapshotByMarket = Partial<
  Record<Market, PaperMarketAllocationSnapshot>
>;

export interface PaperMarketAllocationSnapshot {
  market: Market;
  targetExposureRatio: number;
  currentExposureRatio: number;
  targetExposureGapRatio: number;
  targetExposureGapKrw: number;
  maxAdditionalBuyBudgetKrw: number;
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
  const marketAllocations = buildMarketAllocations({
    portfolio: input.portfolio,
    policy: input.policy,
    netWorthKrw,
    cashAvailableAfterReserve
  });

  const snapshot: PaperAllocationSnapshot = {
    policyName: input.policy.policyName,
    targetExposureRatio,
    minCashReserveRatio,
    maxBudgetPerDecisionRatio: boundedRatio(
      input.policy.maxBudgetPerDecisionRatio
    ),
    maxSymbolExposureRatio: boundedRatio(input.policy.maxSymbolExposureRatio),
    ...(input.policy.marketTargetExposureRatios === undefined
      ? {}
      : {
          marketTargetExposureRatios: normalizeMarketTargetExposureRatios(
            input.policy.marketTargetExposureRatios
          )
        }),
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

  return Object.keys(marketAllocations).length === 0
    ? snapshot
    : { ...snapshot, marketAllocations };
}

export function portfolioExposureRatio(portfolio: VirtualPortfolio): number {
  const netWorthKrw = virtualNetWorthKrw(portfolio);
  if (netWorthKrw <= 0) {
    return 0;
  }
  return boundedRatio(positionMarketValue(portfolio) / netWorthKrw);
}

export function positionMarketValue(portfolio: VirtualPortfolio): number {
  return positionMarketValueForMarket(portfolio);
}

function buildMarketAllocations(input: {
  portfolio: VirtualPortfolio;
  policy: PaperAllocationPolicy;
  netWorthKrw: number;
  cashAvailableAfterReserve: number;
}): PaperMarketAllocationSnapshotByMarket {
  const targets = normalizeMarketTargetExposureRatios(
    input.policy.marketTargetExposureRatios ?? {}
  );
  const allocations: PaperMarketAllocationSnapshotByMarket = {};

  for (const [market, targetExposureRatio] of Object.entries(targets)) {
    const marketKey = market as Market;
    const currentMarketValueKrw = positionMarketValueForMarket(
      input.portfolio,
      marketKey
    );
    const currentExposureRatio =
      input.netWorthKrw <= 0
        ? 0
        : boundedRatio(currentMarketValueKrw / input.netWorthKrw);
    const targetMarketValueKrw = Math.round(
      input.netWorthKrw * targetExposureRatio
    );
    const targetExposureGapKrw = Math.max(
      0,
      targetMarketValueKrw - currentMarketValueKrw
    );

    allocations[marketKey] = {
      market: marketKey,
      targetExposureRatio,
      currentExposureRatio: roundRatio(currentExposureRatio),
      targetExposureGapRatio: roundRatio(
        Math.max(0, targetExposureRatio - currentExposureRatio)
      ),
      targetExposureGapKrw,
      maxAdditionalBuyBudgetKrw: Math.min(
        input.cashAvailableAfterReserve,
        targetExposureGapKrw
      )
    };
  }

  return allocations;
}

function normalizeMarketTargetExposureRatios(
  targets: PaperMarketTargetExposureRatios
): PaperMarketTargetExposureRatios {
  const normalized: PaperMarketTargetExposureRatios = {};
  for (const [market, value] of Object.entries(targets)) {
    normalized[market as Market] = roundRatio(boundedRatio(value));
  }
  return normalized;
}

function positionMarketValueForMarket(
  portfolio: VirtualPortfolio,
  market?: Market
): number {
  return portfolio.positions.reduce(
    (sum, position) => {
      if (market !== undefined && position.market !== market) {
        return sum;
      }
      return (
        sum +
        (position.marketValueKrw ??
          Math.round(position.quantity * position.averagePriceKrw))
      );
    },
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
