import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readCodexDecisionProviderConfig } from "../cli/codexDecisionEnv.js";
import {
  historicalReplayCodexProviderMetadata,
  resolveHistoricalReplayPromptPolicy,
  CodexHistoricalReplayDecisionProvider,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";
import {
  createBatchReplayRootDirForStorage,
  safeArtifactPathPart
} from "../storage/artifactPaths.js";
import {
  runHistoricalBatchReplay,
  type BatchReplayResult
} from "../workflows/historicalBatchReplayWorkflow.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";

import {
  resolvePaperSimulationConfig,
  PaperSimulationRequestError,
  type PaperSimulationRunConfig,
  type PaperSimulationEffectiveConfig,
  type PaperSimulationConfigNotice
} from "./paperSimulationConfig.js";
export { parsePaperSimulationRunConfig, PaperSimulationRequestError } from "./paperSimulationConfig.js";
export type { PaperSimulationRunConfig } from "./paperSimulationConfig.js";

export const PAPER_SIMULATION_CREATE_ROUTE = "/paper/simulations";
export const PAPER_SIMULATION_MUTATION_HEADER_NAME = "x-toss-trading-operation";
export const PAPER_SIMULATION_CREATE_OPERATION = "paper-simulation-create";

export const PAPER_SIMULATION_VALIDATION_ROUTE = "/paper/simulations/validate";
export const PAPER_SIMULATION_VALIDATION_OPERATION = "paper-simulation-validate";

export interface PaperSimulationRunnerInput {
  simulationRunId: string;
  batchId: string;
  storageBaseDir: string;
  createdAt: Date;
  tickDelayMs: number;
  config: PaperSimulationRunConfig;
  effectiveConfig: PaperSimulationEffectiveConfig;
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
  requestedConfig: PaperSimulationRunConfig;
  effectiveConfig: PaperSimulationEffectiveConfig;
  notices: PaperSimulationConfigNotice[];
  dataAvailabilityChecked: false;
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

export function isPaperSimulationMutationRoute(pathname: string): boolean {
  return pathname === PAPER_SIMULATION_CREATE_ROUTE;
}

export function createPaperSimulationRun(
  body: unknown,
  options: LocalOperationsServerOptions
): PaperSimulationCreateResponse {
  const { requestedConfig: config, effectiveConfig, notices } =
    resolvePaperSimulationConfig(body, options.env ?? process.env);
  const tickDelayMs = effectiveConfig.tickDelayMs;

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
    effectiveConfig,
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
    requestedRunCount: effectiveConfig.runCount,
    sourceDataDir: config.sourceDataDir,
    outputBaseDir,
    activeUrl: "/dashboard/virtual",
    historyUrl: "/dashboard/virtual/simulations",
    readOnlyLiveTrading: true,
    requestedConfig: config,
    effectiveConfig,
    notices,
    dataAvailabilityChecked: false,
    disclaimer:
      "Paper-only simulation accepted. This cannot place live orders and is not investment advice."
  };
}

async function runPaperSimulationFromConfig(
  input: PaperSimulationRunnerInput
): Promise<PaperSimulationRunnerResult> {
  const config = input.effectiveConfig;
  const paperExitPolicy = config.paperExitPolicy;
  const useCodexAi = config.decisionProvider.mode === "codex_paper_only";
  const promptPolicy = resolveHistoricalReplayPromptPolicy({
    riskProfile: config.riskProfile
  });
  const codexDecisionProviderConfig = useCodexAi
    ? withHistoricalReplayPrompt(
        {
          ...readCodexDecisionProviderConfig(process.env, {
            enabled: true,
            maxRunsPerDay: config.samplingPolicy.maxCodexCallsPerRun,
            ephemeral: true
          }),
          modelId: config.decisionProvider.modelId!,
          outputSchemaPath: config.decisionProvider.outputSchema!,
          ignoreUserConfig: true,
          disabledFeatures: ["plugins", "apps"]
        },
        { riskProfile: config.riskProfile }
      )
    : null;
  const result = await runHistoricalBatchReplay({
    sourceDataDir: config.sourceDataDir,
    outputBaseDir: createBatchReplayRootDirForStorage(input.storageBaseDir),
    batchId: input.batchId,
    seed: config.window.seed,
    runCount: config.runCount,
    rangeStart: new Date(config.window.rangeStartAt),
    rangeEnd: new Date(config.window.rangeEndAt),
    ...(config.window.mode === "fixed_range"
      ? {
          fixedWindow: config.window.fixedWindow!,
          windowSamplingMode: "fixed_range" as const
        }
      : {
          windowMonths: config.window.windowMonths!,
          windowSamplingMode: "random" as const
        }),
    timezoneOffsetMinutes: config.window.timezoneOffsetMinutes,
    generatedAt: input.createdAt,
    stepSeconds: config.samplingPolicy.stepSeconds,
    speedMultiplier: 1,
    tickDelayMs: config.tickDelayMs,
    wallClockTimestamps: true,
    decisionFrequency: config.samplingPolicy.decisionFrequency,
    maxDecisionCalls: config.samplingPolicy.maxDecisionCalls,
    initialCashKrw: config.capital.initialCashKrw,
    packetIdPrefix: `packet_${safeArtifactPathPart(input.batchId, "simulation")}`,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 86_400,
    ...(paperExitPolicy === null ? {} : { paperExitPolicy }),
    executionPolicy: config.costModel.executionPolicy,
    ...(useCodexAi
      ? {
          decisionProviderFactory: () =>
            new CodexHistoricalReplayDecisionProvider(
              new CodexCliDecisionProvider(codexDecisionProviderConfig!),
              {
                maxCallsPerReplay:
                  config.samplingPolicy.maxCodexCallsPerRun
              }
            ),
          decisionProviderMetadata: historicalReplayCodexProviderMetadata({
            config: codexDecisionProviderConfig!,
            maxCallsPerRun: config.samplingPolicy.maxCodexCallsPerRun,
            promptPolicy
          })
        }
      : {}),
    constraints: config.constraints,
    riskProfile: config.riskProfile,
    riskPolicy: config.riskPolicy,
    allocationPolicy: config.allocationPolicy
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
