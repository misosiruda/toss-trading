import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { createPaperCostModel } from "../paper/costModel.js";
import { normalizePaperExitPolicy, type PaperExitPolicy } from "../paper/exitPolicy.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import { resolvePaperRiskProfile } from "../paper/riskProfile.js";
import type { ReplayWindowSelection } from "../replay/replayWindowSampler.js";

const TIMEZONE_OFFSET_MINUTES = 540;
const DEFAULT_BATCH_RUN_COUNT = 5;
const MAX_BATCH_RUN_COUNT = 20;
const MAX_DECISION_CALLS = 100;
const MAX_CODEX_CALLS_PER_RUN = 31;
const DEFAULT_DASHBOARD_TICK_DELAY_MS = 0;
const MAX_DASHBOARD_TICK_DELAY_MS = 5_000;

const paperSimulationConfigSchema = z.object({
  mode: z.literal("paper_only"),
  runType: z.enum(["single_replay", "batch_replay"]),
  runCount: z.number().int().min(1).max(MAX_BATCH_RUN_COUNT).optional(),
  sourceDataDir: z.string().min(1).max(240),
  universe: z.object({
    preset: z.string().min(1).max(80),
    market: z.enum(["mixed_global", "kr", "us"])
  }),
  window: z.object({
    mode: z.enum(["random_month", "fixed_range"]),
    seed: z.string().min(1).max(120),
    startAt: z.string().min(1).max(80),
    endAt: z.string().min(1).max(80),
    windowMonths: z.number().int().min(1).max(12)
  }),
  samplingPolicy: z.object({
    decisionFrequency: z.enum(["every_tick", "once_per_day", "once_per_week"]),
    stepSeconds: z.number().int().min(60).max(2_592_000),
    maxDecisionCalls: z.number().int().min(1).max(MAX_DECISION_CALLS),
    maxCodexCallsPerRun: z
      .number()
      .int()
      .min(0)
      .max(MAX_CODEX_CALLS_PER_RUN)
  }),
  capital: z.object({
    initialCashKrw: z.number().int().min(100_000).max(10_000_000_000)
  }),
  decisionProvider: z.object({
    mode: z.enum(["dry_run_fixture", "codex_paper_only"]),
    modelId: z.string().min(1).max(120),
    outputSchema: z.literal("schemas/virtual-decision.schema.json")
  }),
  riskProfile: z.enum(["conservative", "balanced", "aggressive_paper"]),
  paperExitPolicy: z.enum(["none", "take_profit_stop_loss", "rebalance_threshold"]),
  costModel: z.enum(["standard", "high_cost"]),
  benchmarkPolicy: z.enum(["cash_equal_weight_initial_hold", "cash_only"])
});

export type PaperSimulationRunConfig = z.infer<
  typeof paperSimulationConfigSchema
>;

export class PaperSimulationRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function parsePaperSimulationRunConfig(
  value: unknown
): PaperSimulationRunConfig {
  if (typeof value === "object" && value !== null && "portfolioPolicy" in value) {
    throw new PaperSimulationRequestError(
      "portfolioPolicy: saved PortfolioPolicy execution is not supported by paper simulations",
      400,
      "unsupported_simulation_portfolio_policy"
    );
  }
  const result = paperSimulationConfigSchema.safeParse(value);
  if (!result.success) {
    throw new PaperSimulationRequestError(
      formatSimulationConfigIssues(result.error.issues),
      400,
      "invalid_simulation_config"
    );
  }

  validateSimulationConfig(result.data);
  return result.data;
}

function formatSimulationConfigIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>
): string {
  return issues.map(formatSimulationConfigIssue).join("; ");
}

function formatSimulationConfigIssue(issue: {
  path: PropertyKey[];
  message: string;
}): string {
  const path = issue.path.map(String).join(".") || "config";
  if (path === "runCount" && issue.message.includes("<=20")) {
    return "runCount: Runs must be 20 or lower";
  }
  if (
    path === "samplingPolicy.maxCodexCallsPerRun" &&
    issue.message.includes(`<=${MAX_CODEX_CALLS_PER_RUN}`)
  ) {
    return "samplingPolicy.maxCodexCallsPerRun: Max Codex calls must be 31 or lower";
  }
  return `${path}: ${issue.message}`;
}

function validateSimulationConfig(config: PaperSimulationRunConfig): void {
  assertSafeDataDir(config.sourceDataDir);
  const unsupported = [
    [config.costModel !== "standard", "costModel", "only standard (existing workflow execution defaults) is supported", "cost_model"],
    [config.benchmarkPolicy !== "cash_equal_weight_initial_hold", "benchmarkPolicy", "reports always compute cash, equal-weight and initial-portfolio benchmarks", "benchmark_policy"]
  ] as const;
  for (const [rejected, field, reason, code] of unsupported) {
    if (rejected) {
      throw new PaperSimulationRequestError(
        `${field}: ${reason}`,
        400,
        `unsupported_simulation_${code}`
      );
    }
  }

  const start = parseSimulationDate(config.window.startAt, false);
  const end = parseSimulationDate(config.window.endAt, true);
  if (start.getTime() > end.getTime()) {
    throw new PaperSimulationRequestError(
      "window.startAt must be before or equal to window.endAt",
      400,
      "invalid_simulation_window"
    );
  }

  if (
    config.decisionProvider.mode === "codex_paper_only" &&
    config.samplingPolicy.maxCodexCallsPerRun <= 0
  ) {
    throw new PaperSimulationRequestError(
      "Codex paper-only provider requires maxCodexCallsPerRun greater than 0",
      400,
      "invalid_codex_call_limit"
    );
  }
}

function dashboardTickDelayMs(env: NodeJS.ProcessEnv): number {
  const raw = env.PAPER_SIMULATION_TICK_DELAY_MS;
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_DASHBOARD_TICK_DELAY_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new PaperSimulationRequestError(
      "PAPER_SIMULATION_TICK_DELAY_MS must be a non-negative integer",
      400,
      "invalid_simulation_tick_delay"
    );
  }
  if (parsed > MAX_DASHBOARD_TICK_DELAY_MS) {
    throw new PaperSimulationRequestError(
      `PAPER_SIMULATION_TICK_DELAY_MS must be ${MAX_DASHBOARD_TICK_DELAY_MS} or lower`,
      400,
      "invalid_simulation_tick_delay"
    );
  }
  return parsed;
}

function assertDecisionProviderIsAllowed(
  config: PaperSimulationRunConfig,
  env: NodeJS.ProcessEnv
): void {
  if (config.decisionProvider.mode !== "codex_paper_only") {
    return;
  }
  if ((env.AI_DECISION_MODE ?? "paper_only") !== "paper_only") {
    throw new PaperSimulationRequestError(
      "AI_DECISION_MODE must be paper_only for dashboard-created Codex simulations",
      400,
      "invalid_ai_decision_mode"
    );
  }
  if (env.AI_DECISION_ENABLED !== "true") {
    throw new PaperSimulationRequestError(
      "AI_DECISION_ENABLED=true is required before starting Codex paper-only simulations",
      400,
      "codex_provider_disabled"
    );
  }
}

function assertSafeDataDir(value: string): void {
  if (isAbsolute(value) || value.includes("\0")) {
    throw new PaperSimulationRequestError(
      "sourceDataDir must be a relative data path",
      400,
      "invalid_source_data_dir"
    );
  }

  const cwd = resolve(process.cwd());
  const dataRoot = resolve(cwd, "data");
  const target = resolve(cwd, value);
  const path = relative(dataRoot, target);
  if (path === "" || (!!path && !path.startsWith("..") && !isAbsolute(path))) {
    return;
  }

  throw new PaperSimulationRequestError(
    "sourceDataDir must stay under the project data directory",
    400,
    "invalid_source_data_dir"
  );
}

function runCountFor(config: PaperSimulationRunConfig): number {
  if (config.runType === "single_replay") {
    return 1;
  }
  return config.runCount ?? DEFAULT_BATCH_RUN_COUNT;
}

function parseSimulationDate(value: string, endOfDay: boolean): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`
    : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    throw new PaperSimulationRequestError(
      "simulation window dates must be valid dates",
      400,
      "invalid_simulation_date"
    );
  }
  return date;
}

function fixedReplayWindow(
  config: PaperSimulationRunConfig
): ReplayWindowSelection {
  const start = parseSimulationDate(config.window.startAt, false);
  const end = parseSimulationDate(config.window.endAt, true);
  const startAt = start.toISOString();
  const endAt = end.toISOString();
  return {
    seed: config.window.seed,
    rangeStart: startAt,
    rangeEnd: endAt,
    windowMonths: config.window.windowMonths,
    timezoneOffsetMinutes: TIMEZONE_OFFSET_MINUTES,
    candidateCount: 1,
    selectedCandidateIndex: 0,
    selectedMonth: localDatePart(start, TIMEZONE_OFFSET_MINUTES).slice(0, 7),
    localStartDate: localDatePart(start, TIMEZONE_OFFSET_MINUTES),
    localEndDate: localDatePart(end, TIMEZONE_OFFSET_MINUTES),
    startAt,
    endAt
  };
}

function localDatePart(date: Date, timezoneOffsetMinutes: number): string {
  return new Date(date.getTime() + timezoneOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

function paperExitPolicyFromConfig(
  value: PaperSimulationRunConfig["paperExitPolicy"]
): PaperExitPolicy | undefined {
  if (value === "take_profit_stop_loss") {
    return {
      takeProfitRatio: 0.15,
      stopLossRatio: 0.08
    };
  }
  if (value === "rebalance_threshold") {
    return {
      rebalanceMaxPositionWeightRatio: 0.4
    };
  }
  return undefined;
}

function allocationPolicyForSimulation(input: {
  policy: PaperAllocationPolicy;
  market: PaperSimulationRunConfig["universe"]["market"];
}): PaperAllocationPolicy {
  if (input.market !== "mixed_global") {
    return input.policy;
  }

  const halfTarget = Math.round(input.policy.targetExposureRatio * 500_000) / 1_000_000;
  return {
    ...input.policy,
    marketTargetExposureRatios: {
      KR: halfTarget,
      US: Math.round((input.policy.targetExposureRatio - halfTarget) * 1_000_000) / 1_000_000
    }
  };
}

export interface PaperSimulationConfigNotice {
  field: string;
  code: string;
  message: string;
}

/** No file reads, provider construction, runner admission or persistence. */
export function resolvePaperSimulationConfig(
  body: unknown,
  env: NodeJS.ProcessEnv
) {
  const requestedConfig = parsePaperSimulationRunConfig(body);
  const config = requestedConfig;
  assertDecisionProviderIsAllowed(config, env);
  const useCodexAi = config.decisionProvider.mode === "codex_paper_only";
  const riskProfile = resolvePaperRiskProfile({
    name: config.riskProfile,
    initialCashKrw: config.capital.initialCashKrw
  });
  const effectiveConfig = {
    mode: config.mode,
    runType: config.runType,
    runCount: runCountFor(config),
    sourceDataDir: config.sourceDataDir,
    universe: {
      selection: "source_snapshots" as const,
      presetApplied: false as const,
      marketFilterApplied: false as const,
      allocationMode: config.universe.market === "mixed_global"
        ? "split_target_kr_us" as const
        : "risk_profile_default" as const
    },
    window: {
      mode: config.window.mode,
      seed: config.window.seed,
      rangeStartAt: parseSimulationDate(config.window.startAt, false).toISOString(),
      rangeEndAt: parseSimulationDate(config.window.endAt, true).toISOString(),
      windowMonths: config.window.mode === "random_month" ? config.window.windowMonths : null,
      fixedWindow: config.window.mode === "fixed_range" ? fixedReplayWindow(config) : null,
      timezoneOffsetMinutes: TIMEZONE_OFFSET_MINUTES
    },
    samplingPolicy: {
      ...config.samplingPolicy,
      maxCodexCallsPerRun: useCodexAi ? config.samplingPolicy.maxCodexCallsPerRun : 0
    },
    capital: config.capital,
    decisionProvider: {
      mode: config.decisionProvider.mode,
      modelId: useCodexAi ? config.decisionProvider.modelId : null,
      outputSchema: useCodexAi ? config.decisionProvider.outputSchema : null
    },
    riskProfile: riskProfile.name,
    constraints: riskProfile.constraints,
    riskPolicy: riskProfile.riskPolicy,
    allocationPolicy: allocationPolicyForSimulation({
      policy: riskProfile.allocationPolicy,
      market: config.universe.market
    }),
    paperExitPolicy: normalizePaperExitPolicy(paperExitPolicyFromConfig(config.paperExitPolicy)),
    costModel: createPaperCostModel(undefined),
    benchmarkPolicy: {
      mode: "fixed_report_benchmarks" as const,
      names: ["cashOnly", "equalWeightBuyAndHold", "initialPortfolioBuyAndHold"] as const,
      equalWeightAvailability: "requires_priced_replay_packet" as const
    },
    portfolioPolicyApplied: false as const,
    tickDelayMs: dashboardTickDelayMs(env)
  };
  const notices: PaperSimulationConfigNotice[] = [
    { field: "universe.preset", code: "preset_not_applied", message: "The preset is retained request metadata; source snapshots determine the available symbols, without preset filtering." },
    { field: "universe.market", code: "allocation_only", message: "Market changes allocation targets only: mixed_global splits KR/US targets; kr and us retain risk-profile defaults. No market symbol filter is applied." },
    { field: "costModel", code: "workflow_execution_defaults", message: "standard means the existing workflow execution defaults shown in effectiveConfig.costModel, not a separate commission/slippage preset." },
    { field: "benchmarkPolicy", code: "fixed_report_benchmarks", message: "Reports compute cash, equal-weight and initial-portfolio benchmarks; equal-weight can be unavailable without a priced replay packet." }
  ];
  if (!useCodexAi) {
    notices.push({ field: "decisionProvider", code: "fixture_provider", message: "Fixture decisions use no external model, output schema file or Codex calls. Source data kind is not inferred from this provider." });
  }
  if (config.runType === "single_replay" && config.runCount !== undefined && config.runCount !== 1) {
    notices.push({ field: "runCount", code: "single_run_count", message: "single_replay always executes one replay." });
  }
  if (config.window.mode === "fixed_range") {
    notices.push({ field: "window.windowMonths", code: "fixed_range_metadata_only", message: "Fixed dates determine the replay interval; windowMonths is retained only in fixed-window metadata." });
  }
  return { requestedConfig, effectiveConfig, notices };
}

export type PaperSimulationEffectiveConfig = ReturnType<typeof resolvePaperSimulationConfig>["effectiveConfig"];

export function validatePaperSimulationCandidate(body: unknown, env: NodeJS.ProcessEnv) {
  return {
    schemaVersion: "paper_simulation_validation.v1" as const,
    mode: "paper_only" as const,
    status: "valid" as const,
    readOnly: true as const,
    storageMutationEnabled: false as const,
    liveTradingEnabled: false as const,
    orderPlacementEnabled: false as const,
    replayRunnerStarted: false as const,
    dataAvailabilityChecked: false as const,
    sourceDataKind: "unknown" as const,
    ...resolvePaperSimulationConfig(body, env)
  };
}
