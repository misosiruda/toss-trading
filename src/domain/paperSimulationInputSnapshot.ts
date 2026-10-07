import { z } from "zod";

// Frozen admission v1 grammar: never import current resolver defaults or normalize stored history.
const text = (max: number) => z.string().min(1).max(max);
const ratio = z.number().min(0).max(1);
const nonnegative = z.number().nonnegative();
const count = z.number().int().nonnegative();
const runType = z.enum(["single_replay", "batch_replay"]);
const profile = z.enum(["conservative", "balanced", "aggressive_paper"]);
const sampling = z.object({
  decisionFrequency: z.enum(["every_tick", "once_per_day", "once_per_week"]),
  stepSeconds: z.number().int().min(60).max(2_592_000),
  maxDecisionCalls: z.number().int().min(1).max(100), maxCodexCallsPerRun: z.number().int().min(0).max(31)
}).strict();
const capital = z.object({ initialCashKrw: z.number().int().min(100_000).max(10_000_000_000) }).strict();
const costs = z.object({ feeBps: nonnegative, taxBps: nonnegative, slippageBps: nonnegative }).strict();
const requested = z.object({
  mode: z.literal("paper_only"), runType, runCount: z.number().int().min(1).max(20).optional(),
  sourceDataDir: text(240),
  universe: z.object({ preset: text(80), market: z.enum(["mixed_global", "kr", "us"]) }).strict(),
  window: z.object({ mode: z.enum(["random_month", "fixed_range"]), seed: text(120),
    startAt: text(80), endAt: text(80), windowMonths: z.number().int().min(1).max(12) }).strict(),
  samplingPolicy: sampling, capital,
  decisionProvider: z.object({ mode: z.enum(["dry_run_fixture", "codex_paper_only"]), modelId: text(120),
    outputSchema: z.literal("schemas/virtual-decision.schema.json") }).strict(),
  riskProfile: profile, paperExitPolicy: z.enum(["none", "take_profit_stop_loss", "rebalance_threshold"]),
  costModel: z.literal("standard"), executionCosts: costs.optional(),
  benchmarkPolicy: z.literal("cash_equal_weight_initial_hold")
}).strict();
const fixedWindow = z.object({
  seed: text(120), rangeStart: z.iso.datetime(), rangeEnd: z.iso.datetime(),
  windowMonths: z.number().int().min(1).max(12), timezoneOffsetMinutes: z.literal(540),
  candidateCount: z.literal(1), selectedCandidateIndex: z.literal(0), selectedMonth: text(7),
  localStartDate: text(10), localEndDate: text(10), startAt: z.iso.datetime(), endAt: z.iso.datetime()
}).strict();
const executionPolicy = costs.extend({
  fillPriceRule: z.literal("current_candidate_last_price"), halfSpreadBps: nonnegative,
  fillRatio: nonnegative, allowFractionalShares: z.boolean(), maxVolumeParticipationRate: ratio,
  minLiquidityFillRatio: ratio, rejectStaleLiquidity: z.boolean(), marketImpactBpsPerParticipationRate: nonnegative
}).strict();
const costModel = z.object({
  modelVersion: z.literal("paper_cost_model.v5"), executionModelVersion: z.literal("execution_simulator.v4"),
  fillModel: z.literal("simple_fill_ratio_with_participation_cap"), feeModel: z.literal("fixed_bps"),
  taxModel: z.literal("sell_tax_bps"), slippageModel: z.literal("linear_bps"),
  spreadModel: z.enum(["not_modeled", "fixed_half_spread_bps"]),
  marketImpactModel: z.enum(["not_modeled", "linear_participation_bps"]),
  volatilityAdjustmentModel: z.literal("not_modeled"), liquidityModel: z.literal("conservative_when_available"),
  executionPolicy,
  costComponents: z.object({ fee: z.literal("fee_bps"), tax: z.literal("sell_tax_bps"),
    slippage: z.literal("slippage_bps"), spread: z.enum(["not_modeled", "half_spread_bps"]),
    marketImpact: z.enum(["not_modeled", "participation_rate_bps"]), volatilityAdjustment: z.literal("not_modeled") }).strict(),
  assumptions: z.array(text(500)).max(16)
}).strict();
const allocation = z.object({
  policyName: text(100), targetExposureRatio: ratio, minCashReserveRatio: ratio,
  maxBudgetPerDecisionRatio: ratio, maxSymbolExposureRatio: ratio,
  deploymentRampDays: count.optional(), rampDayIndex: count.optional(),
  maxInitialDeploymentRatio: ratio.optional(), maxDailyGrossBuyRatio: ratio.optional(),
  maxInitialOpenPositions: count.optional(), maxNewPositionsPerDay: count.optional(),
  maxConcurrentPositions: count.optional(), positionSlotRampDays: count.optional(),
  marketTargetExposureRatios: z.object({ KR: ratio.optional(), US: ratio.optional() }).strict().optional()
}).strict();
const effective = z.object({
  mode: z.literal("paper_only"), runType, runCount: z.number().int().min(1).max(20), sourceDataDir: text(240),
  universe: z.object({ selection: z.literal("source_snapshots"), presetApplied: z.literal(false),
    marketFilterApplied: z.literal(false), allocationMode: z.enum(["split_target_kr_us", "risk_profile_default"]) }).strict(),
  window: z.object({ mode: z.enum(["random_month", "fixed_range"]), seed: text(120),
    rangeStartAt: z.iso.datetime(), rangeEndAt: z.iso.datetime(),
    windowMonths: z.number().int().min(1).max(12).nullable(), fixedWindow: fixedWindow.nullable(),
    timezoneOffsetMinutes: z.literal(540) }).strict(),
  samplingPolicy: sampling, capital,
  decisionProvider: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("dry_run_fixture"), modelId: z.null(), outputSchema: z.null() }).strict(),
    z.object({ mode: z.literal("codex_paper_only"), modelId: text(120), outputSchema: z.literal("schemas/virtual-decision.schema.json") }).strict()
  ]),
  riskProfile: profile,
  constraints: z.object({ maxNewPositions: count, maxBudgetPerSymbolKrw: count,
    allowedActions: z.array(z.enum(["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"])).min(1).max(3) }).strict(),
  riskPolicy: z.object({ maxBudgetPerDecisionKrw: count, maxSymbolExposureKrw: count,
    targetExposureRatio: ratio, maxPositionWeightRatio: ratio, minCashReserveRatio: ratio, minCashReserveKrw: count }).strict(),
  allocationPolicy: allocation,
  paperExitPolicy: z.object({ takeProfitMode: z.enum(["full_exit", "partial_then_trail"]),
    takeProfitRatio: z.number().gt(0).max(10).optional(), stopLossRatio: z.number().gt(0).max(1).optional(),
    rebalanceMaxPositionWeightRatio: z.number().gt(0).max(1).optional(),
    takeProfitSellRatio: z.number().gt(0).max(1).optional(), trailingStopFromPeakRatio: z.number().gt(0).max(1).optional()
  }).strict().nullable(),
  costModel,
  benchmarkPolicy: z.object({ mode: z.literal("fixed_report_benchmarks"),
    names: z.tuple([z.literal("cashOnly"), z.literal("equalWeightBuyAndHold"), z.literal("initialPortfolioBuyAndHold")]),
    equalWeightAvailability: z.literal("requires_priced_replay_packet") }).strict(),
  portfolioPolicyApplied: z.literal(false), tickDelayMs: z.number().int().min(0).max(5000)
}).strict();

export const paperSimulationInputSnapshotSchema = z.object({
  requestedConfig: requested, effectiveConfig: effective,
  notices: z.array(z.object({ field: text(80), code: text(80), message: text(600) }).strict()).min(4).max(7)
}).strict();
export type PaperSimulationInputSnapshot = z.infer<typeof paperSimulationInputSnapshotSchema>;
