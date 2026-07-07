import type { DynamicCashReservePolicy } from "../paper/dynamicCashReservePolicy.js";
import type { PaperExitPolicy } from "../paper/exitPolicy.js";
import type { MarketRegimeAllocationPolicy } from "../paper/marketRegimeAllocationPolicy.js";
import type { PaperRiskProfileName } from "../paper/riskProfile.js";
import type { ReplayDecisionFrequency } from "./replaySamplingPolicy.js";

export const STRATEGY_REPLAY_PRESET_NAMES = [
  "long_term",
  "swing",
  "short_term",
  "regime_cash"
] as const;

export type StrategyReplayPresetName =
  (typeof STRATEGY_REPLAY_PRESET_NAMES)[number];

export interface StrategyReplayPreset {
  name: StrategyReplayPresetName;
  riskProfile: PaperRiskProfileName;
  windowMonths: number;
  stepSeconds: number;
  decisionFrequency: ReplayDecisionFrequency;
  maxDecisionCalls: number;
  maxCodexCallsPerRun: number;
  maxSnapshotAgeSeconds: number;
  minWindowSnapshots: number;
  minSnapshotsPerRequiredSymbol: number;
  paperExitPolicy?: PaperExitPolicy | undefined;
  marketRegimeAllocationPolicy?: MarketRegimeAllocationPolicy | undefined;
  dynamicCashReservePolicy?: DynamicCashReservePolicy | undefined;
}

const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;
const TWO_WEEKS_SECONDS = 14 * DAY_SECONDS;

const STRATEGY_REPLAY_PRESETS: Record<
  StrategyReplayPresetName,
  StrategyReplayPreset
> = {
  long_term: {
    name: "long_term",
    riskProfile: "balanced",
    windowMonths: 6,
    stepSeconds: WEEK_SECONDS,
    decisionFrequency: "once_per_week",
    maxDecisionCalls: 26,
    maxCodexCallsPerRun: 26,
    maxSnapshotAgeSeconds: TWO_WEEKS_SECONDS,
    minWindowSnapshots: 4,
    minSnapshotsPerRequiredSymbol: 2,
    paperExitPolicy: {
      takeProfitMode: "partial_then_trail",
      takeProfitRatio: 0.25,
      takeProfitSellRatio: 0.33,
      trailingStopFromPeakRatio: 0.12,
      stopLossRatio: 0.15,
      rebalanceMaxPositionWeightRatio: 0.45
    }
  },
  swing: {
    name: "swing",
    riskProfile: "aggressive_paper",
    windowMonths: 2,
    stepSeconds: DAY_SECONDS,
    decisionFrequency: "once_per_day",
    maxDecisionCalls: 12,
    maxCodexCallsPerRun: 12,
    maxSnapshotAgeSeconds: TWO_WEEKS_SECONDS,
    minWindowSnapshots: 4,
    minSnapshotsPerRequiredSymbol: 2,
    paperExitPolicy: {
      takeProfitMode: "partial_then_trail",
      takeProfitRatio: 0.12,
      takeProfitSellRatio: 0.5,
      trailingStopFromPeakRatio: 0.06,
      stopLossRatio: 0.06,
      rebalanceMaxPositionWeightRatio: 0.45
    }
  },
  short_term: {
    name: "short_term",
    riskProfile: "aggressive_paper",
    windowMonths: 1,
    stepSeconds: DAY_SECONDS,
    decisionFrequency: "once_per_day",
    maxDecisionCalls: 22,
    maxCodexCallsPerRun: 22,
    maxSnapshotAgeSeconds: TWO_WEEKS_SECONDS,
    minWindowSnapshots: 4,
    minSnapshotsPerRequiredSymbol: 2,
    paperExitPolicy: {
      takeProfitMode: "full_exit",
      takeProfitRatio: 0.06,
      stopLossRatio: 0.03,
      rebalanceMaxPositionWeightRatio: 0.35
    }
  },
  regime_cash: {
    name: "regime_cash",
    riskProfile: "balanced",
    windowMonths: 3,
    stepSeconds: DAY_SECONDS,
    decisionFrequency: "once_per_week",
    maxDecisionCalls: 13,
    maxCodexCallsPerRun: 13,
    maxSnapshotAgeSeconds: TWO_WEEKS_SECONDS,
    minWindowSnapshots: 4,
    minSnapshotsPerRequiredSymbol: 2,
    marketRegimeAllocationPolicy: {
      lookbackDays: 20,
      minSymbols: 1,
      minSnapshotsPerSymbol: 2
    },
    dynamicCashReservePolicy: {
      lookbackDays: 20,
      minSymbols: 1,
      minSnapshotsPerSymbol: 2,
      highVolatilityReturnThreshold: 0.08,
      highVolatilityCashReserveRatio: 0.3
    },
    paperExitPolicy: {
      takeProfitMode: "partial_then_trail",
      takeProfitRatio: 0.15,
      takeProfitSellRatio: 0.5,
      trailingStopFromPeakRatio: 0.08,
      stopLossRatio: 0.08,
      rebalanceMaxPositionWeightRatio: 0.45
    }
  }
};

export function parseStrategyReplayPresetName(
  value: string | undefined
): StrategyReplayPresetName | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().replaceAll("-", "_");
  if (isStrategyReplayPresetName(normalized)) {
    return normalized;
  }

  throw new Error(
    `--strategy-preset must be one of ${STRATEGY_REPLAY_PRESET_NAMES.join(", ")}`
  );
}

export function resolveStrategyReplayPreset(
  name: StrategyReplayPresetName
): StrategyReplayPreset {
  return STRATEGY_REPLAY_PRESETS[name];
}

function isStrategyReplayPresetName(
  value: string
): value is StrategyReplayPresetName {
  return STRATEGY_REPLAY_PRESET_NAMES.some((name) => name === value);
}
