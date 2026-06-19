import type { Market, VirtualPortfolio } from "../domain/schemas.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export type PaperMarketTargetExposureRatios = Partial<Record<Market, number>>;

export interface PaperAllocationPolicy {
  policyName: string;
  targetExposureRatio: number;
  minCashReserveRatio: number;
  maxBudgetPerDecisionRatio: number;
  maxSymbolExposureRatio: number;
  deploymentRampDays?: number;
  rampDayIndex?: number;
  maxInitialDeploymentRatio?: number;
  maxDailyGrossBuyRatio?: number;
  maxInitialOpenPositions?: number;
  maxNewPositionsPerDay?: number;
  maxConcurrentPositions?: number;
  positionSlotRampDays?: number;
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
  rampDayIndex?: number;
  deploymentRampDays?: number;
  scheduledExposureCeilingRatio?: number;
  scheduledExposureHeadroomKrw?: number;
  maxDailyGrossBuyRatio?: number;
  maxDailyGrossBuyBudgetKrw?: number;
  opportunityReserveRatio?: number;
  maxInitialDeploymentRatio?: number;
  maxInitialOpenPositions?: number;
  maxNewPositionsPerDay?: number;
  maxConcurrentPositions?: number;
  positionSlotRampDays?: number;
  scheduledOpenPositionCeiling?: number;
  remainingScheduledOpenPositionSlots?: number;
  remainingNewPositionSlots?: number;
  marketAllocations?: PaperMarketAllocationSnapshotByMarket;
}

export type PaperMarketAllocationSnapshotByMarket = Partial<
  Record<Market, PaperMarketAllocationSnapshot>
>;

export interface PaperMarketAllocationSnapshot {
  market: Market;
  targetExposureRatio: number;
  scheduledTargetExposureRatio?: number;
  currentExposureRatio: number;
  targetExposureGapRatio: number;
  targetExposureGapKrw: number;
  maxAdditionalBuyBudgetKrw: number;
  currentOpenPositionCount?: number;
  scheduledOpenPositionCeiling?: number;
  remainingScheduledOpenPositionSlots?: number;
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
  const rampDayIndex = normalizePositiveInteger(input.policy.rampDayIndex);
  const deploymentRampDays = normalizePositiveInteger(
    input.policy.deploymentRampDays
  );
  const maxInitialDeploymentRatio = optionalBoundedRatio(
    input.policy.maxInitialDeploymentRatio
  );
  const scheduledExposureCeilingRatio = scheduledExposureCeiling({
    targetExposureRatio,
    maxInitialDeploymentRatio,
    deploymentRampDays,
    rampDayIndex
  });
  const targetPositionValueKrw = Math.round(netWorthKrw * targetExposureRatio);
  const scheduledPositionValueKrw = Math.round(
    netWorthKrw * scheduledExposureCeilingRatio
  );
  const minCashReserveKrw = Math.round(netWorthKrw * minCashReserveRatio);
  const cashAvailableAfterReserve = Math.max(
    0,
    input.portfolio.cashKrw - minCashReserveKrw
  );
  const targetExposureGapKrw = Math.max(
    0,
    targetPositionValueKrw - positionMarketValueKrw
  );
  const scheduledExposureHeadroomKrw = Math.max(
    0,
    scheduledPositionValueKrw - positionMarketValueKrw
  );
  const maxAdditionalBuyBudgetKrw = Math.min(
    cashAvailableAfterReserve,
    scheduledExposureHeadroomKrw
  );
  const maxDailyGrossBuyRatio = optionalBoundedRatio(
    input.policy.maxDailyGrossBuyRatio
  );
  const maxDailyGrossBuyBudgetKrw =
    maxDailyGrossBuyRatio === undefined
      ? undefined
      : Math.round(netWorthKrw * maxDailyGrossBuyRatio);
  const decisionBudgetCaps = [
    Math.round(netWorthKrw * input.policy.maxBudgetPerDecisionRatio),
    maxAdditionalBuyBudgetKrw
  ];
  if (maxDailyGrossBuyBudgetKrw !== undefined && (rampDayIndex ?? 1) > 1) {
    decisionBudgetCaps.push(maxDailyGrossBuyBudgetKrw);
  }
  const scheduledOpenPositionCeiling = scheduledPositionSlotCeiling({
    maxConcurrentPositions: input.policy.maxConcurrentPositions,
    maxInitialOpenPositions: input.policy.maxInitialOpenPositions,
    positionSlotRampDays: input.policy.positionSlotRampDays,
    deploymentRampDays,
    rampDayIndex
  });
  const remainingScheduledOpenPositionSlots =
    scheduledOpenPositionCeiling === undefined
      ? undefined
      : Math.max(
          0,
          scheduledOpenPositionCeiling - input.portfolio.positions.length
        );
  const remainingNewPositionSlots =
    remainingScheduledOpenPositionSlots === undefined
      ? undefined
      : Math.min(
          remainingScheduledOpenPositionSlots,
          input.policy.maxNewPositionsPerDay ?? remainingScheduledOpenPositionSlots
        );
  const marketAllocations = buildMarketAllocations({
    portfolio: input.portfolio,
    policy: input.policy,
    netWorthKrw,
    cashAvailableAfterReserve,
    scheduledExposureCeilingRatio,
    targetExposureRatio,
    scheduledOpenPositionCeiling
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
    maxAdditionalBuyBudgetKrw,
    maxBudgetPerDecisionKrw: Math.max(0, Math.min(...decisionBudgetCaps)),
    maxSymbolExposureKrw: Math.round(
      netWorthKrw * input.policy.maxSymbolExposureRatio
    ),
    minCashReserveKrw,
    ...(rampDayIndex === undefined ? {} : { rampDayIndex }),
    ...(deploymentRampDays === undefined ? {} : { deploymentRampDays }),
    scheduledExposureCeilingRatio: roundRatio(scheduledExposureCeilingRatio),
    scheduledExposureHeadroomKrw,
    ...(maxDailyGrossBuyRatio === undefined
      ? {}
      : { maxDailyGrossBuyRatio }),
    ...(maxDailyGrossBuyBudgetKrw === undefined
      ? {}
      : { maxDailyGrossBuyBudgetKrw }),
    opportunityReserveRatio: roundRatio(
      Math.max(0, targetExposureRatio - scheduledExposureCeilingRatio)
    ),
    ...(maxInitialDeploymentRatio === undefined
      ? {}
      : { maxInitialDeploymentRatio }),
    ...(input.policy.maxInitialOpenPositions === undefined
      ? {}
      : { maxInitialOpenPositions: input.policy.maxInitialOpenPositions }),
    ...(input.policy.maxNewPositionsPerDay === undefined
      ? {}
      : { maxNewPositionsPerDay: input.policy.maxNewPositionsPerDay }),
    ...(input.policy.maxConcurrentPositions === undefined
      ? {}
      : { maxConcurrentPositions: input.policy.maxConcurrentPositions }),
    ...(input.policy.positionSlotRampDays === undefined
      ? {}
      : { positionSlotRampDays: input.policy.positionSlotRampDays }),
    ...(scheduledOpenPositionCeiling === undefined
      ? {}
      : { scheduledOpenPositionCeiling }),
    ...(remainingScheduledOpenPositionSlots === undefined
      ? {}
      : { remainingScheduledOpenPositionSlots }),
    ...(remainingNewPositionSlots === undefined
      ? {}
      : { remainingNewPositionSlots })
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
  scheduledExposureCeilingRatio: number;
  targetExposureRatio: number;
  scheduledOpenPositionCeiling?: number | undefined;
}): PaperMarketAllocationSnapshotByMarket {
  const targets = normalizeMarketTargetExposureRatios(
    input.policy.marketTargetExposureRatios ?? {}
  );
  const allocations: PaperMarketAllocationSnapshotByMarket = {};
  const totalMarketTargetExposureRatio = Object.values(targets).reduce(
    (sum, value) => sum + value,
    0
  );

  const scheduledScale =
    input.targetExposureRatio <= 0
      ? 0
      : boundedRatio(input.scheduledExposureCeilingRatio / input.targetExposureRatio);

  for (const [market, targetExposureRatio] of Object.entries(targets)) {
    const marketKey = market as Market;
    const scheduledTargetExposureRatio = roundRatio(
      targetExposureRatio * scheduledScale
    );
    const currentMarketValueKrw = positionMarketValueForMarket(
      input.portfolio,
      marketKey
    );
    const currentExposureRatio =
      input.netWorthKrw <= 0
        ? 0
        : boundedRatio(currentMarketValueKrw / input.netWorthKrw);
    const targetMarketValueKrw = Math.round(
      input.netWorthKrw * scheduledTargetExposureRatio
    );
    const currentOpenPositionCount = positionCountForMarket(
      input.portfolio,
      marketKey
    );
    const scheduledOpenPositionCeiling = marketScheduledPositionSlotCeiling({
      scheduledOpenPositionCeiling: input.scheduledOpenPositionCeiling,
      targetExposureRatio,
      totalMarketTargetExposureRatio
    });
    const remainingScheduledOpenPositionSlots =
      scheduledOpenPositionCeiling === undefined
        ? undefined
        : Math.max(0, scheduledOpenPositionCeiling - currentOpenPositionCount);
    const targetExposureGapKrw = Math.max(
      0,
      targetMarketValueKrw - currentMarketValueKrw
    );

    allocations[marketKey] = {
      market: marketKey,
      targetExposureRatio,
      scheduledTargetExposureRatio,
      currentExposureRatio: roundRatio(currentExposureRatio),
      targetExposureGapRatio: roundRatio(
        Math.max(0, scheduledTargetExposureRatio - currentExposureRatio)
      ),
      targetExposureGapKrw,
      maxAdditionalBuyBudgetKrw: Math.min(
        input.cashAvailableAfterReserve,
        targetExposureGapKrw
      ),
      currentOpenPositionCount,
      ...(scheduledOpenPositionCeiling === undefined
        ? {}
        : { scheduledOpenPositionCeiling }),
      ...(remainingScheduledOpenPositionSlots === undefined
        ? {}
        : { remainingScheduledOpenPositionSlots })
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

function positionCountForMarket(
  portfolio: VirtualPortfolio,
  market: Market
): number {
  return portfolio.positions.filter(
    (position) => position.market === market && position.quantity > 0
  ).length;
}

function marketScheduledPositionSlotCeiling(input: {
  scheduledOpenPositionCeiling?: number | undefined;
  targetExposureRatio: number;
  totalMarketTargetExposureRatio: number;
}): number | undefined {
  if (input.scheduledOpenPositionCeiling === undefined) {
    return undefined;
  }
  if (
    input.scheduledOpenPositionCeiling <= 0 ||
    input.targetExposureRatio <= 0 ||
    input.totalMarketTargetExposureRatio <= 0
  ) {
    return 0;
  }

  return Math.max(
    1,
    Math.ceil(
      (input.scheduledOpenPositionCeiling * input.targetExposureRatio) /
        input.totalMarketTargetExposureRatio
    )
  );
}

function boundedRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function optionalBoundedRatio(value: number | undefined): number | undefined {
  return value === undefined ? undefined : boundedRatio(value);
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function scheduledExposureCeiling(input: {
  targetExposureRatio: number;
  maxInitialDeploymentRatio?: number | undefined;
  deploymentRampDays?: number | undefined;
  rampDayIndex?: number | undefined;
}): number {
  if (
    input.maxInitialDeploymentRatio === undefined ||
    input.deploymentRampDays === undefined ||
    input.rampDayIndex === undefined
  ) {
    return input.targetExposureRatio;
  }

  if (input.deploymentRampDays <= 1) {
    return input.targetExposureRatio;
  }

  const rampIndex = Math.min(input.rampDayIndex, input.deploymentRampDays);
  const progress = (rampIndex - 1) / (input.deploymentRampDays - 1);
  return boundedRatio(
    Math.min(
      input.targetExposureRatio,
      input.maxInitialDeploymentRatio +
        (input.targetExposureRatio - input.maxInitialDeploymentRatio) * progress
    )
  );
}

function scheduledPositionSlotCeiling(input: {
  maxConcurrentPositions?: number | undefined;
  maxInitialOpenPositions?: number | undefined;
  positionSlotRampDays?: number | undefined;
  deploymentRampDays?: number | undefined;
  rampDayIndex?: number | undefined;
}): number | undefined {
  if (
    input.maxConcurrentPositions === undefined ||
    input.maxInitialOpenPositions === undefined
  ) {
    return undefined;
  }

  const maxConcurrentPositions = Math.max(
    0,
    Math.floor(input.maxConcurrentPositions)
  );
  const maxInitialOpenPositions = Math.min(
    maxConcurrentPositions,
    Math.max(0, Math.floor(input.maxInitialOpenPositions))
  );
  const rampDays = normalizePositiveInteger(
    input.positionSlotRampDays ?? input.deploymentRampDays
  );
  const rampDayIndex = normalizePositiveInteger(input.rampDayIndex);
  if (
    rampDays === undefined ||
    rampDayIndex === undefined ||
    rampDays <= 1
  ) {
    return maxConcurrentPositions;
  }

  const rampIndex = Math.min(rampDayIndex, rampDays);
  const addedSlots = Math.floor(
    ((rampIndex - 1) * (maxConcurrentPositions - maxInitialOpenPositions)) /
      (rampDays - 1)
  );
  return Math.min(maxConcurrentPositions, maxInitialOpenPositions + addedSlots);
}
