import assert from "node:assert/strict";
import { prepareReplaySettingsSnapshot, REPLAY_SETTINGS_SNAPSHOT_LIMITS as limits, type ReplaySettingsSnapshot } from "./replaySettingsSnapshot.js";

export function minimalSettings(): ReplaySettingsSnapshot {
  return { packetIdPrefix: "synthetic_packet", packetExpiresInSeconds: 300, maxCandidates: 20, maxSnapshotAgeSeconds: 86_400,
    constraints: { maxNewPositions: 12, maxBudgetPerSymbolKrw: 100_000, allowedActions: ["VIRTUAL_BUY", "VIRTUAL_HOLD"] } };
}
const bucketMap = () => ({ long_term: 1, swing: 2, short_term: 3, intraday: 4, hedge: 5, unknown: 6 });
const regimeMap = () => ({ bull: 1, bear: 2, sideways: 3, mixed: 4, insufficient_data: 5 });
export function allSettings(): ReplaySettingsSnapshot {
  return {
    ...minimalSettings(), candidateStrategyBucket: "swing", tickDelayMs: 0,
    executionPolicy: { fillPriceRule: "current_candidate_last_price", slippageBps: 1.5, feeBps: 2, taxBps: 3,
      halfSpreadBps: 0.5, fillRatio: 0.75, allowFractionalShares: false, maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5 },
    riskPolicy: { maxBudgetPerDecisionKrw: 100_000, maxSymbolExposureKrw: 200_000, targetExposureRatio: 0.8, maxPositionWeightRatio: 0.35,
      maxStrategyBucketExposureKrw: bucketMap(), maxStrategyBucketExposureRatio: bucketMap(), maxBucketTurnoverKrw: bucketMap(),
      maxBucketTurnoverRatio: bucketMap(), maxSectorExposureKrw: 500_000, maxSectorExposureRatio: 0.5, maxCountryExposureKrw: 800_000,
      maxCountryExposureRatio: 0.8, maxCurrencyExposureKrw: 800_000, maxCurrencyExposureRatio: 0.8, maxUnknownMetadataExposureKrw: 50_000,
      maxUnknownMetadataExposureRatio: 0.05, minCashReserveRatio: 0.1, minCashReserveKrw: 0,
      cooldownEntries: [{ market: "KR", symbol: "SYNTH", action: "VIRTUAL_BUY", activeUntil: "not a date", reason: "synthetic cooldown" }],
      dynamicCashReservePolicy: { lookbackDays: 30, minSymbols: 1, minSnapshotsPerSymbol: 2, bullReturnThreshold: 0.03,
        bearReturnThreshold: -0.03, sidewaysAbsReturnThreshold: 0.01, breadthThreshold: 0.6, minimumCashReserveRatioFloor: 0.02,
        regimeCashReserveRatios: regimeMap(), highVolatilityReturnThreshold: 0.08, highVolatilityCashReserveRatio: 0.3 },
      hedgePolicy: { maxGrossExposureKrw: 1_000_000, maxGrossExposureRatio: 1, requireHedgeBucket: true } },
    allocationPolicy: { policyName: "synthetic_allocation", targetExposureRatio: 0.8, minCashReserveRatio: 0.1, maxBudgetPerDecisionRatio: 0.1,
      maxSymbolExposureRatio: 0.2, deploymentRampDays: 10, rampDayIndex: 1, maxInitialDeploymentRatio: 0.2, maxDailyGrossBuyRatio: 0.1,
      maxInitialOpenPositions: 2, maxNewPositionsPerDay: 2, maxConcurrentPositions: 12, positionSlotRampDays: 10,
      marketTargetExposureRatios: { KR: 0.4, US: 0.6 } },
    marketRegimeAllocationPolicy: { lookbackDays: 30, policyNameSuffix: "_regime", minSymbols: 1, minSnapshotsPerSymbol: 2,
      bullReturnThreshold: 0.03, bearReturnThreshold: -0.03, sidewaysAbsReturnThreshold: 0.01, breadthThreshold: 0.6, regimeWeights: regimeMap() },
    paperExitPolicy: { takeProfitRatio: 0.2, stopLossRatio: 0.1, rebalanceMaxPositionWeightRatio: 0.35, takeProfitMode: "partial_then_trail",
      takeProfitSellRatio: 0.5, trailingStopFromPeakRatio: 0.08 },
    universeManifest: { symbols: [{ market: "KR", symbol: "SYNTH", lifecycleStatus: "active", lifecycleStatusSource: "explicit" },
      { market: "US", symbol: "SYNTH", lifecycleStatus: "suspended", lifecycleStatusSource: "defaulted" }] }
  };
}
export function recordedSettings(value: unknown) {
  const observed = prepareReplaySettingsSnapshot(value);
  assert.equal(observed.status, "recorded");
  if (observed.status !== "recorded") throw new Error("Expected recorded synthetic settings");
  return observed;
}
export function settingsAtJsonBytes(bytes: number, kind: "ascii" | "cjk" | "control" = "ascii"): ReplaySettingsSnapshot {
  const value = minimalSettings();
  const members = Array.from({ length: kind === "ascii" ? 20_000 : kind === "cjk" ? 10_000 : 6_000 }, () => ({
    market: "KR" as const, symbol: "SYNTH", lifecycleStatus: "suspended" as const, lifecycleStatusSource: "explicit" as const
  }));
  value.universeManifest = { symbols: members };
  let missing = bytes - Buffer.byteLength(JSON.stringify(value));
  const character = kind === "ascii" ? "X" : kind === "cjk" ? "가" : "\u0001";
  const unit = kind === "ascii" ? 1 : kind === "cjk" ? 3 : 6;
  for (const member of members) {
    const count = Math.min(limits.textUnits - member.symbol.length, Math.floor(missing / unit));
    member.symbol += character.repeat(count);
    missing -= count * unit;
    if (missing > 0 && missing < unit && member.symbol.length + missing <= limits.textUnits) {
      member.symbol += "X".repeat(missing); missing = 0;
    }
    if (missing === 0) break;
  }
  assert.equal(missing, 0, "Exact boundary fixture must use supported fields within string/count limits");
  assert.equal(Buffer.byteLength(JSON.stringify(value)), bytes);
  return value;
}
export type SettingsPath = (string | number)[];
export function leafPaths(value: unknown, prefix: SettingsPath = []): SettingsPath[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, Array.isArray(value) ? Number(key) : key]));
}
export function atPath(value: unknown, path: SettingsPath): unknown {
  return path.reduce<unknown>((current, key) => (current as Record<string | number, unknown>)[key], value);
}
export function replacePath(value: unknown, path: SettingsPath, replacement: unknown): void {
  const parent = atPath(value, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path.at(-1)!] = replacement;
}
