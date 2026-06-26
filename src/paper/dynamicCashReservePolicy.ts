import {
  classifyMarketRegime,
  type MarketRegimeClassification,
  type MarketRegimeClassifierOptions,
  type MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export type DynamicCashReserveReason =
  | "static"
  | "bull"
  | "sideways"
  | "mixed"
  | "bear"
  | "insufficient_data"
  | "high_volatility";

export interface DynamicCashReservePolicy {
  lookbackDays: number;
  minSymbols?: number | undefined;
  minSnapshotsPerSymbol?: number | undefined;
  bullReturnThreshold?: number | undefined;
  bearReturnThreshold?: number | undefined;
  sidewaysAbsReturnThreshold?: number | undefined;
  breadthThreshold?: number | undefined;
  minimumCashReserveRatioFloor?: number | undefined;
  regimeCashReserveRatios?:
    | Partial<Record<MarketRegimeLabel, number>>
    | undefined;
  highVolatilityReturnThreshold?: number | undefined;
  highVolatilityCashReserveRatio?: number | undefined;
}

export interface DynamicCashReserveAssessment {
  minimumCashReserveRatio: number;
  minimumCashReserveKrw: number;
  baseMinimumCashReserveKrw: number;
  marketRegimeLabel: MarketRegimeLabel;
  highVolatility: boolean;
  averageAbsoluteReturnRatio: number | null;
  reason: DynamicCashReserveReason;
}

export interface AssessDynamicCashReserveInput {
  portfolio: VirtualPortfolio;
  baseMinimumCashReserveRatio: number;
  baseMinimumCashReserveKrw: number;
  policy?: DynamicCashReservePolicy | undefined;
  marketRegime?: MarketRegimeClassification | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MINIMUM_CASH_RESERVE_RATIO_FLOOR = 0.02;
const DEFAULT_HIGH_VOLATILITY_RETURN_THRESHOLD = 0.08;
const DEFAULT_HIGH_VOLATILITY_CASH_RESERVE_RATIO = 0.3;
export const DEFAULT_DYNAMIC_CASH_RESERVE_RATIOS: Readonly<
  Record<MarketRegimeLabel, number>
> = {
  bull: DEFAULT_MINIMUM_CASH_RESERVE_RATIO_FLOOR,
  sideways: 0.1,
  mixed: 0.15,
  bear: 0.25,
  insufficient_data: 0.35
};

export function classifyDynamicCashReserveRegime(input: {
  snapshots: HistoricalMarketSnapshot[];
  simulatedAt: Date;
  policy: DynamicCashReservePolicy;
}): MarketRegimeClassification {
  validateDynamicCashReservePolicy(input.policy);
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

  return classifyMarketRegime(classifierOptions);
}

export function assessDynamicCashReserve(
  input: AssessDynamicCashReserveInput
): DynamicCashReserveAssessment | null {
  if (input.policy === undefined) {
    return null;
  }

  validateDynamicCashReservePolicy(input.policy);

  const marketRegimeLabel = input.marketRegime?.label ?? "insufficient_data";
  const regimeRatios = {
    ...DEFAULT_DYNAMIC_CASH_RESERVE_RATIOS,
    ...(input.policy.regimeCashReserveRatios ?? {})
  };
  const floorRatio =
    input.policy.minimumCashReserveRatioFloor ??
    DEFAULT_MINIMUM_CASH_RESERVE_RATIO_FLOOR;
  const averageAbsoluteReturnRatio = averageAbsoluteReturnRatioFor(
    input.marketRegime
  );
  const highVolatility =
    averageAbsoluteReturnRatio !== null &&
    averageAbsoluteReturnRatio >=
      (input.policy.highVolatilityReturnThreshold ??
        DEFAULT_HIGH_VOLATILITY_RETURN_THRESHOLD);
  const regimeRatio = regimeRatios[marketRegimeLabel];
  const highVolatilityRatio = highVolatility
    ? (input.policy.highVolatilityCashReserveRatio ??
        DEFAULT_HIGH_VOLATILITY_CASH_RESERVE_RATIO)
    : 0;
  const minimumCashReserveRatio = boundedRatio(
    Math.max(
      floorRatio,
      input.baseMinimumCashReserveRatio,
      regimeRatio,
      highVolatilityRatio
    )
  );
  const baseMinimumCashReserveKrw = Math.max(
    input.baseMinimumCashReserveKrw,
    Math.round(
      virtualNetWorthKrw(input.portfolio) * input.baseMinimumCashReserveRatio
    )
  );
  const minimumCashReserveKrw = Math.max(
    input.baseMinimumCashReserveKrw,
    Math.round(virtualNetWorthKrw(input.portfolio) * minimumCashReserveRatio)
  );

  return {
    minimumCashReserveRatio,
    minimumCashReserveKrw,
    baseMinimumCashReserveKrw,
    marketRegimeLabel,
    highVolatility,
    averageAbsoluteReturnRatio,
    reason: reserveReason({
      marketRegimeLabel,
      highVolatility,
      minimumCashReserveRatio,
      baseMinimumCashReserveRatio: input.baseMinimumCashReserveRatio
    })
  };
}

function reserveReason(input: {
  marketRegimeLabel: MarketRegimeLabel;
  highVolatility: boolean;
  minimumCashReserveRatio: number;
  baseMinimumCashReserveRatio: number;
}): DynamicCashReserveReason {
  if (input.minimumCashReserveRatio <= input.baseMinimumCashReserveRatio) {
    return "static";
  }

  if (input.highVolatility) {
    return "high_volatility";
  }

  return input.marketRegimeLabel;
}

function averageAbsoluteReturnRatioFor(
  marketRegime: MarketRegimeClassification | undefined
): number | null {
  const returns = marketRegime?.symbolReturns.map((item) =>
    Math.abs(item.returnRatio)
  );
  if (returns === undefined || returns.length === 0) {
    return null;
  }

  return roundRatio(
    returns.reduce((sum, value) => sum + value, 0) / returns.length
  );
}

function validateDynamicCashReservePolicy(
  policy: DynamicCashReservePolicy
): void {
  if (!Number.isInteger(policy.lookbackDays) || policy.lookbackDays <= 0) {
    throw new Error("lookbackDays must be a positive integer");
  }
  validateOptionalPositiveInteger(policy.minSymbols, "minSymbols");
  validateOptionalPositiveInteger(
    policy.minSnapshotsPerSymbol,
    "minSnapshotsPerSymbol"
  );
  validateOptionalRatio(
    policy.minimumCashReserveRatioFloor,
    "minimumCashReserveRatioFloor"
  );
  validateOptionalRatio(
    policy.highVolatilityReturnThreshold,
    "highVolatilityReturnThreshold"
  );
  validateOptionalRatio(
    policy.highVolatilityCashReserveRatio,
    "highVolatilityCashReserveRatio"
  );
  for (const [label, value] of Object.entries(
    policy.regimeCashReserveRatios ?? {}
  )) {
    validateOptionalRatio(value, `regimeCashReserveRatios.${label}`);
  }
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

function validateOptionalRatio(value: number | undefined, label: string): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
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
