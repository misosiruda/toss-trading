import type {
  HistoricalMarketSnapshot,
  Market
} from "../domain/schemas.js";
import {
  classifyMarketRegimeByMarket,
  type MarketRegimeClassifierOptions,
  type MarketRegimeLabel,
  type MarketRegimesByMarket
} from "../analytics/marketRegimeClassifier.js";
import type {
  PaperAllocationPolicy,
  PaperMarketTargetExposureRatios
} from "./allocationPolicy.js";

export interface MarketRegimeAllocationPolicy {
  lookbackDays: number;
  policyNameSuffix?: string;
  minSymbols?: number;
  minSnapshotsPerSymbol?: number;
  bullReturnThreshold?: number;
  bearReturnThreshold?: number;
  sidewaysAbsReturnThreshold?: number;
  breadthThreshold?: number;
  regimeWeights?: Partial<Record<MarketRegimeLabel, number>>;
}

export interface MarketRegimeAllocationResult {
  allocationPolicy: PaperAllocationPolicy;
  marketRegimesByMarket: MarketRegimesByMarket;
  marketTargetExposureRatios: PaperMarketTargetExposureRatios;
  windowStart: string;
  windowEnd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLICY_NAME_SUFFIX = "_market_regime";
const DEFAULT_REGIME_WEIGHTS: Record<MarketRegimeLabel, number> = {
  bull: 1.4,
  mixed: 1,
  sideways: 0.8,
  insufficient_data: 0.5,
  bear: 0.35
};

export function buildMarketRegimeAllocationPolicy(input: {
  basePolicy: PaperAllocationPolicy;
  snapshots: HistoricalMarketSnapshot[];
  simulatedAt: Date;
  policy: MarketRegimeAllocationPolicy;
}): MarketRegimeAllocationResult {
  validatePolicy(input.policy);
  validateDate(input.simulatedAt, "simulatedAt");

  const windowEnd = input.simulatedAt;
  const windowStart = new Date(
    windowEnd.getTime() - input.policy.lookbackDays * DAY_MS
  );
  const classifierOptions: MarketRegimeClassifierOptions = {
    snapshots: input.snapshots,
    windowStart,
    windowEnd,
    ...(input.policy.minSymbols === undefined
      ? {}
      : { minSymbols: input.policy.minSymbols }),
    ...(input.policy.minSnapshotsPerSymbol === undefined
      ? {}
      : { minSnapshotsPerSymbol: input.policy.minSnapshotsPerSymbol }),
    ...(input.policy.bullReturnThreshold === undefined
      ? {}
      : { bullReturnThreshold: input.policy.bullReturnThreshold }),
    ...(input.policy.bearReturnThreshold === undefined
      ? {}
      : { bearReturnThreshold: input.policy.bearReturnThreshold }),
    ...(input.policy.sidewaysAbsReturnThreshold === undefined
      ? {}
      : {
          sidewaysAbsReturnThreshold:
            input.policy.sidewaysAbsReturnThreshold
        }),
    ...(input.policy.breadthThreshold === undefined
      ? {}
      : { breadthThreshold: input.policy.breadthThreshold })
  };
  const marketRegimesByMarket = classifyMarketRegimeByMarket(
    classifierOptions
  );
  const marketTargetExposureRatios = deriveMarketTargetExposureRatios({
    marketRegimesByMarket,
    totalTargetExposureRatio: input.basePolicy.targetExposureRatio,
    ...(input.policy.regimeWeights === undefined
      ? {}
      : { regimeWeights: input.policy.regimeWeights })
  });
  const policyNameSuffix =
    input.policy.policyNameSuffix ?? DEFAULT_POLICY_NAME_SUFFIX;

  return {
    allocationPolicy: withMarketTargetExposureRatios({
      basePolicy: {
        ...input.basePolicy,
        policyName: `${input.basePolicy.policyName}${policyNameSuffix}`
      },
      marketTargetExposureRatios
    }),
    marketRegimesByMarket,
    marketTargetExposureRatios,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString()
  };
}

export function deriveMarketTargetExposureRatios(input: {
  marketRegimesByMarket: MarketRegimesByMarket;
  totalTargetExposureRatio: number;
  regimeWeights?: Partial<Record<MarketRegimeLabel, number>>;
}): PaperMarketTargetExposureRatios {
  const regimeWeights = {
    ...DEFAULT_REGIME_WEIGHTS,
    ...(input.regimeWeights ?? {})
  };
  const weightedMarkets = Object.entries(input.marketRegimesByMarket)
    .flatMap(([market, regime]) => {
      if (regime === undefined) {
        return [];
      }
      const rawWeight = Math.max(0, regimeWeights[regime.label] ?? 0);
      return rawWeight <= 0 ? [] : [{ market: market as Market, rawWeight }];
    })
    .sort((left, right) => left.market.localeCompare(right.market));
  const totalWeight = weightedMarkets.reduce(
    (sum, item) => sum + item.rawWeight,
    0
  );

  if (totalWeight <= 0 || weightedMarkets.length === 0) {
    return {};
  }

  const totalTargetExposureRatio = boundedRatio(input.totalTargetExposureRatio);
  const ratios: PaperMarketTargetExposureRatios = {};
  let assignedRatio = 0;

  weightedMarkets.forEach((item, index) => {
    const isLast = index === weightedMarkets.length - 1;
    const targetRatio = isLast
      ? roundRatio(Math.max(0, totalTargetExposureRatio - assignedRatio))
      : roundRatio(
          (totalTargetExposureRatio * item.rawWeight) / totalWeight
        );
    ratios[item.market] = targetRatio;
    assignedRatio = roundRatio(assignedRatio + targetRatio);
  });

  return ratios;
}

function withMarketTargetExposureRatios(input: {
  basePolicy: PaperAllocationPolicy;
  marketTargetExposureRatios: PaperMarketTargetExposureRatios;
}): PaperAllocationPolicy {
  if (Object.keys(input.marketTargetExposureRatios).length === 0) {
    return input.basePolicy;
  }

  return {
    ...input.basePolicy,
    marketTargetExposureRatios: input.marketTargetExposureRatios
  };
}

function validatePolicy(policy: MarketRegimeAllocationPolicy): void {
  if (!Number.isInteger(policy.lookbackDays) || policy.lookbackDays <= 0) {
    throw new Error("lookbackDays must be a positive integer");
  }
  validateOptionalPositiveInteger(policy.minSymbols, "minSymbols");
  validateOptionalPositiveInteger(
    policy.minSnapshotsPerSymbol,
    "minSnapshotsPerSymbol"
  );
}

function validateOptionalPositiveInteger(
  value: number | undefined,
  label: string
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
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
