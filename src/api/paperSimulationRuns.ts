import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readCodexDecisionProviderConfig } from "../cli/codexDecisionEnv.js";
import {
  parsePaperRiskProfileName,
  resolvePaperRiskProfile
} from "../paper/riskProfile.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import type { PaperExitPolicy } from "../paper/exitPolicy.js";
import {
  resolveHistoricalReplayPromptPolicy,
  CodexHistoricalReplayDecisionProvider,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";
import type { ReplayWindowSelection } from "../replay/replayWindowSampler.js";
import {
  createBatchReplayRootDirForStorage,
  safeArtifactPathPart
} from "../storage/artifactPaths.js";
import {
  runHistoricalBatchReplay,
  type BatchReplayResult
} from "../workflows/historicalBatchReplayWorkflow.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";

export const PAPER_SIMULATION_CREATE_ROUTE = "/paper/simulations";
export const PAPER_SIMULATION_MUTATION_HEADER_NAME = "x-toss-trading-operation";
export const PAPER_SIMULATION_CREATE_OPERATION = "paper-simulation-create";

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

export interface PaperSimulationRunnerInput {
  simulationRunId: string;
  batchId: string;
  storageBaseDir: string;
  createdAt: Date;
  tickDelayMs: number;
  config: PaperSimulationRunConfig;
}

export interface PaperSimulationRunnerResult {
  mode: "paper_only";
  simulationRunId: string;
  batchId: string;
  status: BatchReplayResult["status"];
  outputDir: string;
  manifestPath: string;
  runsPath: string;
}

export type PaperSimulationRunner = (
  input: PaperSimulationRunnerInput
) => Promise<PaperSimulationRunnerResult>;

export interface PaperSimulationCreateResponse {
  mode: "paper_only";
  mutation: "paper_simulation_create";
  status: "accepted";
  simulationRunId: string;
  batchId: string;
  runType: PaperSimulationRunConfig["runType"];
  requestedRunCount: number;
  sourceDataDir: string;
  outputBaseDir: string;
  activeUrl: string;
  historyUrl: string;
  readOnlyLiveTrading: true;
  disclaimer: string;
}

interface InFlightPaperSimulationRun {
  simulationRunId: string;
  startedAt: string;
  promise: Promise<PaperSimulationRunnerResult>;
}

const inFlightRunsByOptions = new WeakMap<
  LocalOperationsServerOptions,
  InFlightPaperSimulationRun
>();

export class PaperSimulationRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function isPaperSimulationMutationRoute(pathname: string): boolean {
  return pathname === PAPER_SIMULATION_CREATE_ROUTE;
}

export function parsePaperSimulationRunConfig(
  value: unknown
): PaperSimulationRunConfig {
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

export function createPaperSimulationRun(
  body: unknown,
  options: LocalOperationsServerOptions
): PaperSimulationCreateResponse {
  const config = parsePaperSimulationRunConfig(body);
  const env = options.env ?? process.env;
  assertDecisionProviderIsAllowed(config, env);
  const tickDelayMs = dashboardTickDelayMs(env);

  const current = inFlightRunsByOptions.get(options);
  if (current !== undefined) {
    throw new PaperSimulationRequestError(
      `paper simulation already running: ${current.simulationRunId}`,
      409,
      "paper_simulation_already_running"
    );
  }

  const createdAt = options.now?.() ?? new Date();
  const simulationRunId = simulationRunIdFor(config, createdAt);
  const outputBaseDir = createBatchReplayRootDirForStorage(
    options.storageBaseDir
  );
  const runnerInput: PaperSimulationRunnerInput = {
    simulationRunId,
    batchId: simulationRunId,
    storageBaseDir: options.storageBaseDir,
    createdAt,
    tickDelayMs,
    config
  };
  const runner = options.paperSimulationRunner ?? runPaperSimulationFromConfig;
  const promise = Promise.resolve().then(() => runner(runnerInput));

  inFlightRunsByOptions.set(options, {
    simulationRunId,
    startedAt: createdAt.toISOString(),
    promise
  });
  void promise
    .catch(() => undefined)
    .finally(() => {
      const latest = inFlightRunsByOptions.get(options);
      if (latest?.simulationRunId === simulationRunId) {
        inFlightRunsByOptions.delete(options);
      }
    });

  return {
    mode: "paper_only",
    mutation: "paper_simulation_create",
    status: "accepted",
    simulationRunId,
    batchId: simulationRunId,
    runType: config.runType,
    requestedRunCount: runCountFor(config),
    sourceDataDir: config.sourceDataDir,
    outputBaseDir,
    activeUrl: "/dashboard/virtual",
    historyUrl: "/dashboard/virtual/simulations",
    readOnlyLiveTrading: true,
    disclaimer:
      "Paper-only simulation accepted. This cannot place live orders and is not investment advice."
  };
}

async function runPaperSimulationFromConfig(
  input: PaperSimulationRunnerInput
): Promise<PaperSimulationRunnerResult> {
  const config = input.config;
  const riskProfile = resolvePaperRiskProfile({
    name: parsePaperRiskProfileName(config.riskProfile),
    initialCashKrw: config.capital.initialCashKrw
  });
  const paperExitPolicy = paperExitPolicyFromConfig(config.paperExitPolicy);
  const useCodexAi = config.decisionProvider.mode === "codex_paper_only";
  const promptPolicy = resolveHistoricalReplayPromptPolicy({
    riskProfile: riskProfile.name
  });
  const result = await runHistoricalBatchReplay({
    sourceDataDir: config.sourceDataDir,
    outputBaseDir: createBatchReplayRootDirForStorage(input.storageBaseDir),
    batchId: input.batchId,
    seed: config.window.seed,
    runCount: runCountFor(config),
    rangeStart: parseSimulationDate(config.window.startAt, false),
    rangeEnd: parseSimulationDate(config.window.endAt, true),
    ...(config.window.mode === "fixed_range"
      ? {
          fixedWindow: fixedReplayWindow(config),
          windowSamplingMode: "fixed_range" as const
        }
      : {
          windowMonths: config.window.windowMonths,
          windowSamplingMode: "random" as const
        }),
    timezoneOffsetMinutes: TIMEZONE_OFFSET_MINUTES,
    generatedAt: input.createdAt,
    stepSeconds: config.samplingPolicy.stepSeconds,
    speedMultiplier: 1,
    tickDelayMs: input.tickDelayMs,
    wallClockTimestamps: true,
    decisionFrequency: config.samplingPolicy.decisionFrequency,
    maxDecisionCalls: config.samplingPolicy.maxDecisionCalls,
    initialCashKrw: config.capital.initialCashKrw,
    packetIdPrefix: `packet_${safeArtifactPathPart(input.batchId, "simulation")}`,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 86_400,
    ...(paperExitPolicy === undefined ? {} : { paperExitPolicy }),
    ...(useCodexAi
      ? {
          decisionProviderFactory: () =>
            new CodexHistoricalReplayDecisionProvider(
              new CodexCliDecisionProvider(
                withHistoricalReplayPrompt(
                  {
                    ...readCodexDecisionProviderConfig(process.env, {
                      enabled: true,
                      maxRunsPerDay:
                        config.samplingPolicy.maxCodexCallsPerRun,
                      ephemeral: true
                    }),
                    modelId: config.decisionProvider.modelId,
                    outputSchemaPath: config.decisionProvider.outputSchema,
                    ignoreUserConfig: true,
                    disabledFeatures: ["plugins", "apps"]
                  },
                  { riskProfile: riskProfile.name }
                )
              ),
              {
                maxCallsPerReplay:
                  config.samplingPolicy.maxCodexCallsPerRun
              }
            ),
          decisionProviderMetadata: {
            mode: "codex_cli" as const,
            maxCallsPerRun: config.samplingPolicy.maxCodexCallsPerRun,
            sandbox: "read-only" as const,
            allowWebSearch:
              readCodexDecisionProviderConfig(process.env).allowWebSearch,
            promptPolicy: promptPolicy.name,
            promptVersion: promptPolicy.promptVersion
          }
        }
      : {}),
    constraints: riskProfile.constraints,
    riskProfile: riskProfile.name,
    riskPolicy: riskProfile.riskPolicy,
    allocationPolicy: allocationPolicyForSimulation({
      policy: riskProfile.allocationPolicy,
      market: config.universe.market
    })
  });

  return {
    mode: "paper_only",
    simulationRunId: input.simulationRunId,
    batchId: result.batchId,
    status: result.status,
    outputDir: result.outputDir,
    manifestPath: result.manifestPath,
    runsPath: result.runsPath
  };
}

function validateSimulationConfig(config: PaperSimulationRunConfig): void {
  assertSafeDataDir(config.sourceDataDir);

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

function simulationRunIdFor(
  config: PaperSimulationRunConfig,
  createdAt: Date
): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  const seed = safeArtifactPathPart(config.window.seed, "seed").slice(0, 32);
  return safeArtifactPathPart(`paper_sim_${timestamp}_${seed}`, "paper_sim");
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
