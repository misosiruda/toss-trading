import { z } from "zod";

import { assetClassSchema, assetTypeSchema, marketSchema, replayResearchManifestSchema, strategyBucketSchema } from "../domain/schemas.js";
import type { HistoricalReplayReport } from "../reports/historicalReplayReport.js";
import { historicalReplayRunConfigurationSchema } from "../replay/historicalReplayAuditLog.js";
import { replayRiskPolicySummarySchema } from "../replay/replayRiskPolicySummary.js";

const number = z.number();
const optionalNumber = number.nullable();
const count = number.int().nonnegative();
const nonnegative = number.nonnegative();
const text = z.string().min(1);
const strings = z.array(z.string());
const strategyBucketKey = strategyBucketSchema.or(z.literal("unknown"));
const assetTypeKey = assetTypeSchema.or(z.literal("UNKNOWN"));
const assetClassKey = assetClassSchema.or(z.literal("UNKNOWN"));
function numericFields<K extends string, T extends z.ZodType>(keys: readonly K[], schema: T) {
  return Object.fromEntries(keys.map((key) => [key, schema])) as { [P in K]: T };
}
const costs = numericFields(["feeKrw", "taxKrw", "slippageKrw", "spreadCostKrw", "impactCostKrw", "totalCostKrw"] as const, nonnegative);
const liquidity = {
  filledCount: count, partialFillCount: count, notModeledLiquidityCount: count,
  averageParticipationRate: optionalNumber, maxParticipationRate: optionalNumber, costModelVersions: strings
};
const benchmark = z.object({ initialNetWorthKrw: nonnegative, finalNetWorthKrw: nonnegative,
  totalReturnRatio: optionalNumber, maxDrawdownRatio: optionalNumber, tickVolatilityRatio: optionalNumber,
  turnoverRatio: optionalNumber, feeDragKrw: nonnegative }).strict();
const comparison = z.object({
  benchmarkName: z.enum(["cashOnly", "equalWeightBuyAndHold", "initialPortfolioBuyAndHold"]),
  benchmarkAvailable: z.boolean(),
  ...numericFields(["finalNetWorthDeltaKrw", "totalReturnDeltaRatio", "maxDrawdownDeltaRatio", "tickVolatilityDeltaRatio",
    "turnoverDeltaRatio", "feeDragDeltaKrw"] as const, optionalNumber)
}).strict();
const metricStatus = z.enum(["computed", "not_applicable", "insufficient_sample", "missing_selection_context", "not_implemented"]);
const sharpeEstimate = z.object({ metric: z.enum(["sample_sharpe", "lo_adjusted_sharpe", "deflated_sharpe_ratio"]),
  status: metricStatus, value: optionalNumber, standardError: optionalNumber,
  confidenceInterval95: z.object({ lower: number, upper: number }).strict().nullable(),
  benchmarkSharpeRatio: optionalNumber, methodNotes: strings }).strict();
const timeline = z.object({ simulatedAt: z.iso.datetime(), cashKrw: nonnegative, positionCount: count,
  positionMarketValueKrw: nonnegative, virtualNetWorthKrw: nonnegative }).strict();

// Zod optional members include undefined, while legacy interfaces use exact optional properties.
type SchemaOutput<T> = T extends readonly (infer E)[] ? SchemaOutput<E>[] : T extends object
  ? { [K in keyof T]: SchemaOutput<T[K]> | ({} extends Pick<T, K> ? undefined : never) } : T;

/** Storage acceptance of the existing report shape only; no financial/statistical recalculation. */
export const paperExperimentReportSchema = z.object({
  title: text, mode: z.literal("paper_only"), generatedAt: z.iso.datetime(),
  simulatedRange: z.object({ startAt: z.iso.datetime().nullable(), endAt: z.iso.datetime().nullable(), tickCount: count }).strict(),
  replaySummary: z.object(numericFields(["packetCount", "decisionProviderCallCount", "decisionSkippedCount",
    "decisionRecordCount", "decisionItemCount", "tradeCount", "rejectedCount"] as const, count)).strict(),
  allocationPolicy: historicalReplayRunConfigurationSchema.shape.allocationPolicy,
  paperExitPolicy: historicalReplayRunConfigurationSchema.shape.paperExitPolicy.unwrap().required({ takeProfitMode: true }).nullable(),
  portfolio: z.object({ initialCashKrw: nonnegative, finalCashKrw: nonnegative, finalPositionCount: count,
    finalPositionMarketValueKrw: nonnegative, finalVirtualNetWorthKrw: nonnegative }).strict(),
  portfolioConstruction: z.object(numericFields(["avgExposureRatio", "avgCashRatio", "maxExposureRatio", "minExposureRatio",
    "timeInMarketRatio", "finalCashRatio", "finalPositionRatio", "targetExposureRatio", "averageTargetExposureGapRatio",
    "finalTargetExposureGapRatio"] as const, optionalNumber)).strict(),
  analytics: z.object({ mode: z.literal("paper_only"), cashKrw: nonnegative.nullable(), positionMarketValueKrw: nonnegative,
    virtualNetWorthKrw: nonnegative.nullable(), cashAllocationRatio: optionalNumber, positionAllocationRatio: optionalNumber,
    positionCount: count, symbolAllocations: z.array(z.object({ market: marketSchema, symbol: text, assetType: assetTypeSchema.nullable(),
      quantity: nonnegative, marketValueKrw: nonnegative, allocationRatio: optionalNumber }).strict()),
    symbolExposures: z.array(z.object({ key: text, market: marketSchema, symbol: text, grossExposureKrw: nonnegative,
      netExposureKrw: number, exposureRatio: number, positionCount: count, strategyBuckets: z.array(strategyBucketKey),
      assetTypes: z.array(assetTypeKey), assetClasses: z.array(assetClassKey) }).strict()),
    exposureByMarket: z.record(marketSchema, nonnegative), exposureByAssetType: z.record(assetTypeKey, nonnegative),
    exposureByAssetClass: z.record(assetClassKey, nonnegative), exposureByStrategyBucket: z.record(strategyBucketKey, nonnegative),
    unknownMetadataExposureKrw: nonnegative, unknownMetadataExposureRatio: nonnegative,
    virtualPnl: z.object({ realizedPnlKrw: optionalNumber, unrealizedPnlKrw: optionalNumber, note: text }).strict(),
    decisionTradeLinkage: z.object(numericFields(["decisionItemCount", "filledTradeCount", "linkedDecisionItemCount",
      "unlinkedDecisionItemCount", "tradeWithoutDecisionCount"] as const, count)).strict(), disclaimer: text
  }).strict(),
  decisionOutcome: z.object({ byAction: z.record(z.string(), count), averageConfidence: optionalNumber, symbols: strings }).strict(),
  tradeSummary: z.object({ tradeCount: count, virtualBuyAmountKrw: nonnegative, virtualSellAmountKrw: nonnegative, symbols: strings }).strict(),
  costSummary: z.object({ ...costs, ...liquidity, byStrategyBucket: z.array(z.object({
    strategyBucket: strategyBucketSchema.or(z.literal("UNKNOWN")), tradeCount: count, ...costs,
    ...liquidity, averageCostPerTradeKrw: nonnegative
  }).strict()) }).strict(),
  advancedPerformance: z.object({ formulaVersion: z.literal("performance_metrics.v1"), sampleCount: count,
    ...numericFields(["hitRatio", "profitFactor", "averageWinRatio", "averageLossRatio", "tailLossRatio", "sharpeRatio",
      "initialNetWorthKrw", "finalNetWorthKrw", "totalReturnRatio", "grossTotalReturnRatio", "costAdjustedTotalReturnRatio",
      "costDragRatio", "cagrRatio", "maxDrawdownRatio", "calmarRatio", "exposureAdjustedReturnRatio"] as const, optionalNumber),
    sharpeAnnualizationStatus: z.literal("not_annualized"), warnings: strings
  }).strict(),
  sharpeValidation: z.object({ schemaVersion: z.literal("sharpe_validation.v1"), status: z.enum(["available", "unavailable"]),
    sample: z.object({ returnSampleCount: count, minimumSampleCount: count,
      returnFrequency: z.enum(["per_sample", "daily", "weekly", "monthly", "unknown"]),
      annualizationStatus: z.enum(["not_annualized", "annualized", "unavailable"]),
      annualizationFactor: optionalNumber, riskFreeRateRatio: optionalNumber }).strict(),
    distribution: z.object({ meanReturnRatio: optionalNumber, volatilityRatio: optionalNumber, skewness: optionalNumber,
      excessKurtosis: optionalNumber, autocorrelation: z.object({ maxLag: count, lagCount: count,
        coefficients: z.array(z.object({ lag: count, coefficient: optionalNumber }).strict()),
        adjustmentStatus: z.enum(["not_required", "candidate_not_computed", "computed", "unavailable"]) }).strict() }).strict(),
    metrics: z.object({ sampleSharpe: sharpeEstimate, loAdjustedSharpe: sharpeEstimate, deflatedSharpeRatio: sharpeEstimate,
      probabilisticSharpeRatio: z.object({ metric: z.literal("probabilistic_sharpe_ratio"), status: metricStatus,
        probability: optionalNumber, benchmarkSharpeRatio: optionalNumber, methodNotes: strings }).strict() }).strict(),
    selectionContext: z.object({ candidateCount: count.nullable(), trialCount: count.nullable(), trialSharpeRatioStandardDeviation: optionalNumber,
      selectedByMetric: z.string().nullable(), multipleTestingAdjustment: z.enum(["none", "candidate_count", "trial_log", "unknown"]) }).strict(),
    warnings: z.array(z.object({ code: z.enum(["INSUFFICIENT_RETURN_SAMPLES", "ZERO_RETURN_VOLATILITY", "SERIAL_CORRELATION_NOT_ADJUSTED",
      "NON_IID_RETURN_SAMPLE", "SKEW_OR_KURTOSIS_UNAVAILABLE", "SELECTION_CONTEXT_MISSING", "MULTIPLE_TESTING_CONTEXT_MISSING",
      "SHARPE_VALIDATION_NOT_IMPLEMENTED"]), severity: z.enum(["info", "warning"]), message: text }).strict())
  }).strict(),
  riskSummary: z.object({ approvedCount: count, rejectedCount: count, meaningfulRejectCount: count, dustRejectCount: count,
    rejectCodes: z.record(z.string(), count), policySummary: replayRiskPolicySummarySchema }).strict(),
  samplingSummary: z.object({ policy: historicalReplayRunConfigurationSchema.shape.samplingPolicy,
    decisionsRequested: count, decisionsSkipped: count, skipReasons: z.record(z.string(), count) }).strict(),
  reproducibility: replayResearchManifestSchema.omit({ mode: true, runId: true, batchId: true, createdAt: true, universeSnapshotDate: true })
    .extend({ status: z.literal("available"), manifestPath: text, warnings: strings }).strict(),
  benchmarks: z.object({ strategy: benchmark, cashOnly: benchmark, equalWeightBuyAndHold: benchmark.nullable(),
    initialPortfolioBuyAndHold: benchmark, comparisons: z.object({ strategyVsCashOnly: comparison,
      strategyVsEqualWeightBuyAndHold: comparison, strategyVsInitialPortfolioBuyAndHold: comparison }).strict(), notes: strings }).strict(),
  sourceWarningSummary: z.object({ warningCount: count, futureSnapshotWarningCount: count, staleSnapshotWarningCount: count,
    recentWarnings: strings, lookaheadGuardStatus: z.enum(["future_snapshots_excluded", "no_future_snapshot_warnings"]) }).strict(),
  portfolioTimeline: z.array(timeline), disclaimer: text
}).strict() satisfies z.ZodType<SchemaOutput<HistoricalReplayReport>>;
