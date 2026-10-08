import { z } from "zod";
import { optionalSettings as optional, settingsArray as array, settingsBoolean as boolean,
  settingsEnum as enumeration, settingsNumber as number, settingsObject as object, settingsString as string } from "./replaySettingsSnapshotShape.js";

export const REPLAY_SETTINGS_SNAPSHOT_VERSION = "replay_settings_snapshot.v1";
export const REPLAY_SETTINGS_SNAPSHOT_LIMITS = Object.freeze({
  jsonBytes: 4_194_304, envelopeBytes: 4_259_840, universeMembers: 20_000, cooldownEntries: 2_048,
  allowedActions: 128, riskMapKeys: 6, regimeMapKeys: 5, marketMapKeys: 2,
  textUnits: 120, timeUnits: 80, reasonUnits: 512, depth: 4
});
// Separate inspection budgets do not expand the frozen recording contract.
export const REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS = Object.freeze({
  perStringUnits: 4_096, totalStringUnits: 16_777_216, visitedValues: 500_000, arrayEntries: 100_000
});
const limits = REPLAY_SETTINGS_SNAPSHOT_LIMITS;
const text = string(limits.textUnits);
const market = enumeration(["KR", "US"]);
const action = enumeration(["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]);
const bucket = enumeration(["long_term", "swing", "short_term", "intraday", "hedge"]);
const n = optional(number);
const bucketMap = object({ long_term: n, swing: n, short_term: n, intraday: n, hedge: n, unknown: n });
const regimeMap = object({ bull: n, bear: n, sideways: n, mixed: n, insufficient_data: n });
const marketMap = object({ KR: n, US: n });
const cooldown = object({ market: optional(market), symbol: text, action: optional(action),
  activeUntil: string(limits.timeUnits), reason: optional(string(limits.reasonUnits)) });
const dynamicCashReserve = object({
  lookbackDays: number, minSymbols: n, minSnapshotsPerSymbol: n, bullReturnThreshold: n, bearReturnThreshold: n,
  sidewaysAbsReturnThreshold: n, breadthThreshold: n, minimumCashReserveRatioFloor: n,
  regimeCashReserveRatios: optional(regimeMap), highVolatilityReturnThreshold: n, highVolatilityCashReserveRatio: n
});
const risk = object({
  maxBudgetPerDecisionKrw: n, maxSymbolExposureKrw: n, targetExposureRatio: n, maxPositionWeightRatio: n,
  maxSectorExposureKrw: n, maxSectorExposureRatio: n, maxCountryExposureKrw: n, maxCountryExposureRatio: n,
  maxCurrencyExposureKrw: n, maxCurrencyExposureRatio: n, maxUnknownMetadataExposureKrw: n,
  maxUnknownMetadataExposureRatio: n, minCashReserveRatio: n, minCashReserveKrw: n,
  maxStrategyBucketExposureKrw: optional(bucketMap), maxStrategyBucketExposureRatio: optional(bucketMap),
  maxBucketTurnoverKrw: optional(bucketMap), maxBucketTurnoverRatio: optional(bucketMap),
  cooldownEntries: optional(array(cooldown, limits.cooldownEntries)), dynamicCashReservePolicy: optional(dynamicCashReserve),
  hedgePolicy: optional(object({ maxGrossExposureKrw: n, maxGrossExposureRatio: n, requireHedgeBucket: optional(boolean) }))
}, ["now", "dynamicCashReserveMarketRegime"]);
const execution = object({
  fillPriceRule: optional(enumeration(["current_candidate_last_price"])), slippageBps: n, feeBps: n, taxBps: n,
  halfSpreadBps: n, fillRatio: n, allowFractionalShares: optional(boolean), maxVolumeParticipationRate: n,
  minLiquidityFillRatio: n, rejectStaleLiquidity: optional(boolean), marketImpactBpsPerParticipationRate: n
});
const allocation = object({
  policyName: text, targetExposureRatio: number, minCashReserveRatio: number, maxBudgetPerDecisionRatio: number,
  maxSymbolExposureRatio: number, deploymentRampDays: n, rampDayIndex: n, maxInitialDeploymentRatio: n,
  maxDailyGrossBuyRatio: n, maxInitialOpenPositions: n, maxNewPositionsPerDay: n, maxConcurrentPositions: n,
  positionSlotRampDays: n, marketTargetExposureRatios: optional(marketMap)
});
const regimeAllocation = object({
  lookbackDays: number, policyNameSuffix: optional(text), minSymbols: n, minSnapshotsPerSymbol: n,
  bullReturnThreshold: n, bearReturnThreshold: n, sidewaysAbsReturnThreshold: n, breadthThreshold: n,
  regimeWeights: optional(regimeMap)
});
const exit = object({
  takeProfitRatio: n, stopLossRatio: n, rebalanceMaxPositionWeightRatio: n,
  takeProfitMode: optional(enumeration(["full_exit", "partial_then_trail"])), takeProfitSellRatio: n, trailingStopFromPeakRatio: n
});
const member = object({ market, symbol: text,
  lifecycleStatus: optional(enumeration(["active", "suspended", "delisted", "unknown"])),
  lifecycleStatusSource: optional(enumeration(["explicit", "defaulted"]))
}, ["sourceSymbol", "name", "assetType", "assetClass", "region", "riskTags", "strategyBucket", "sector", "segment", "required", "tags"]);
const universe = object({ symbols: array(member, limits.universeMembers) },
  ["mode", "universeId", "snapshotDate", "description", "disclaimer"]);

// Frozen v1: no upstream schemas, defaults, coercion, normalization, or trimming.
export const replaySettingsSnapshotDataSchema = object({
  packetIdPrefix: text, packetExpiresInSeconds: number, maxCandidates: number, maxSnapshotAgeSeconds: number,
  candidateStrategyBucket: optional(bucket), tickDelayMs: n,
  constraints: object({ maxNewPositions: number, maxBudgetPerSymbolKrw: number, allowedActions: array(action, limits.allowedActions) }),
  executionPolicy: optional(execution), riskPolicy: optional(risk), allocationPolicy: optional(allocation),
  marketRegimeAllocationPolicy: optional(regimeAllocation), paperExitPolicy: optional(exit), universeManifest: optional(universe)
});
type PresentSettings<T> = T extends (infer Item)[] ? PresentSettings<Item>[]
  : T extends object ? { [Key in keyof T]: PresentSettings<Exclude<T[Key], undefined>> } : T;
// Preflight rejects own undefined; this preserves optional omission without widening present consumer values.
export type ReplaySettingsSnapshot = PresentSettings<z.infer<typeof replaySettingsSnapshotDataSchema>>;
