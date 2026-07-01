import "../config/loadEnv.js";

import { readFileSync } from "node:fs";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { summarizeCodexCliDecisionFailure } from "../ai/codexFailureSummary.js";
import { readCalendarValidationOptionsFromArgs } from "./calendarValidationArgs.js";
import { readCodexDecisionProviderConfig } from "./codexDecisionEnv.js";
import {
  parsePaperRiskProfileName,
  resolvePaperRiskProfile
} from "../paper/riskProfile.js";
import type { DynamicCashReservePolicy } from "../paper/dynamicCashReservePolicy.js";
import { normalizePaperExitPolicy } from "../paper/exitPolicy.js";
import type { MarketRegimeAllocationPolicy } from "../paper/marketRegimeAllocationPolicy.js";
import type { Market, MarketPacket } from "../domain/schemas.js";
import {
  parseHistoricalUniverseManifest,
  requiredSymbolsFromHistoricalUniverse
} from "../replay/historicalUniverseCoverage.js";
import {
  CodexHistoricalReplayDecisionProvider,
  historicalReplayCodexProviderMetadata,
  resolveHistoricalReplayPromptPolicy,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";
import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import {
  validationSplitAssignmentSchema,
  type ValidationSplitAssignment
} from "../replay/validationProtocol.js";
import { runHistoricalBatchReplay } from "../workflows/historicalBatchReplayWorkflow.js";

const args = process.argv.slice(2);
const everyNSteps = readOptionalNumberArg("--every-n-steps");
const decisionFrequency = readDecisionFrequencyArg();
const maxDecisionCalls = readOptionalNumberArg("--max-decision-calls");
const useCodexAi = args.includes("--use-codex-ai");
const maxCodexCallsPerRun = readNumberArg("--max-codex-calls-per-run", 5);
const requiredSymbols = readRequiredSymbols();
const calendarValidation = readCalendarValidationOptionsFromArgs(args);
const windowSamplingMode = readWindowSamplingModeArg();
const targetRegimes = readTargetRegimesArg();
const validationSplitsPath = readArgValue("--validation-splits-path");
const validationSplitAssignments = readValidationSplitAssignmentsArg();
const effectiveWindowSamplingMode =
  validationSplitAssignments === undefined ? windowSamplingMode : "fixed_range";
const initialCashKrw = readNumberArg("--initial-cash-krw", 1_000_000);
const maxNewPositionsOverride = readOptionalNumberArg("--max-new-positions");
const maxBudgetPerSymbolOverride = readOptionalNumberArg(
  "--max-budget-per-symbol-krw"
);
const riskProfile = resolvePaperRiskProfile({
  name: parsePaperRiskProfileName(readArgValue("--risk-profile")),
  initialCashKrw,
  ...(maxNewPositionsOverride === undefined
    ? {}
    : { maxNewPositions: maxNewPositionsOverride }),
  ...(maxBudgetPerSymbolOverride === undefined
    ? {}
    : { maxBudgetPerSymbolKrw: maxBudgetPerSymbolOverride })
});
const paperExitPolicy = readPaperExitPolicyArg();
const marketRegimeAllocationPolicy = readMarketRegimeAllocationPolicyArg();
const dynamicCashReservePolicy = readDynamicCashReservePolicyArg();
const riskPolicy =
  dynamicCashReservePolicy === undefined
    ? riskProfile.riskPolicy
    : {
        ...riskProfile.riskPolicy,
        dynamicCashReservePolicy
      };
const historicalPromptPolicy = resolveHistoricalReplayPromptPolicy({
  riskProfile: riskProfile.name
});

if (useCodexAi && (process.env.AI_DECISION_MODE ?? "paper_only") !== "paper_only") {
  throw new Error("AI_DECISION_MODE must be paper_only for batch replay Codex AI");
}

if (useCodexAi && process.env.AI_DECISION_ENABLED !== "true") {
  throw new Error("--use-codex-ai requires the AI decision provider to be enabled");
}

if (
  useCodexAi &&
  (!Number.isInteger(maxCodexCallsPerRun) || maxCodexCallsPerRun <= 0)
) {
  throw new Error("--max-codex-calls-per-run must be a positive integer");
}

const createCodexDelegate = (): CodexCliDecisionProvider =>
  new CodexCliDecisionProvider(createHistoricalCodexDecisionConfig());

const createHistoricalCodexDecisionConfig = () =>
    withHistoricalReplayPrompt(
      readCodexDecisionProviderConfig(process.env, {
        enabled: true,
        maxRunsPerDay: maxCodexCallsPerRun,
        ephemeral: true
      }),
      { riskProfile: riskProfile.name }
    );

if (useCodexAi && !args.includes("--skip-codex-preflight")) {
  await assertCodexPreflight(createCodexDelegate());
}

const result = await runHistoricalBatchReplay({
  sourceDataDir:
    readArgValue("--source-data-dir") ?? readArgValue("--data-dir") ?? "data/paper",
  outputBaseDir: readArgValue("--output-dir") ?? "data/batch-replay",
  batchId: readRequiredArgValue("--batch-id"),
  seed: readRequiredArgValue("--seed"),
  runCount: readNumberArg("--runs", 1),
  rangeStart: readDateArg("--random-window-from"),
  rangeEnd: readDateArg("--random-window-to"),
  windowMonths: readNumberArg("--window-months", 1),
  timezoneOffsetMinutes: readNumberArg("--timezone-offset-minutes", 540),
  stepSeconds: readNumberArg("--step-seconds", 60),
  speedMultiplier: readNumberArg("--speed-multiplier", 1),
  ...(everyNSteps === undefined ? {} : { everyNSteps }),
  candidateChangedOnly: args.includes("--candidate-changed-only"),
  ...(decisionFrequency === undefined ? {} : { decisionFrequency }),
  ...(maxDecisionCalls === undefined ? {} : { maxDecisionCalls }),
  initialCashKrw,
  packetIdPrefix: readArgValue("--packet-id-prefix") ?? "packet_batch_replay",
  packetExpiresInSeconds: readNumberArg("--packet-expires-in-seconds", 60),
  maxCandidates: readNumberArg("--max-candidates", 10),
  maxSnapshotAgeSeconds: readNumberArg("--max-snapshot-age-seconds", 300),
  minWindowSnapshots: readNumberArg("--min-window-snapshots", 1),
  minSnapshotsPerRequiredSymbol: readNumberArg("--min-snapshots-per-symbol", 1),
  ...(requiredSymbols === undefined ? {} : { requiredSymbols }),
  ...(calendarValidation === undefined ? {} : { calendarValidation }),
  windowSamplingMode,
  ...(targetRegimes === undefined ? {} : { targetRegimes }),
  ...(validationSplitAssignments === undefined
    ? {}
    : { validationSplitAssignments }),
  ...(paperExitPolicy === undefined ? {} : { paperExitPolicy }),
  ...(marketRegimeAllocationPolicy === undefined
    ? {}
    : { marketRegimeAllocationPolicy }),
  ...(useCodexAi
    ? {
        decisionProviderFactory: () =>
          new CodexHistoricalReplayDecisionProvider(
            createCodexDelegate(),
            {
              maxCallsPerReplay: maxCodexCallsPerRun
            }
          ),
        decisionProviderMetadata: historicalReplayCodexProviderMetadata({
          config: createHistoricalCodexDecisionConfig(),
          maxCallsPerRun: maxCodexCallsPerRun,
          promptPolicy: historicalPromptPolicy
        })
      }
    : {}),
  constraints: riskProfile.constraints,
  riskProfile: riskProfile.name,
  riskPolicy,
  allocationPolicy: riskProfile.allocationPolicy
});

console.log(
  JSON.stringify(
    {
      mode: result.mode,
      batchId: result.batchId,
      status: result.status,
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      runsPath: result.runsPath,
      selectionTrialsPath: result.selectionTrialsPath,
      runCount: result.runCount,
      completedCount: result.completedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      decisionProvider: useCodexAi ? "codex_cli" : "deterministic_fixture",
      riskProfile: riskProfile.name,
      dynamicCashReservePolicy: dynamicCashReservePolicy ?? null,
      paperExitPolicy: paperExitPolicy ?? null,
      marketRegimeAllocationPolicy: marketRegimeAllocationPolicy ?? null,
      windowSamplingMode: effectiveWindowSamplingMode,
      validationSplitsPath: validationSplitsPath ?? null,
      maxCodexCallsPerRun: useCodexAi ? maxCodexCallsPerRun : null
    },
    null,
    2
  )
);

function readDateArg(name: string): Date {
  const raw = readRequiredArgValue(name);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
}

function readNumberArg(name: string, fallback: number): number {
  return readOptionalNumberArg(name) ?? fallback;
}

function readOptionalNumberArg(name: string): number | undefined {
  const raw = readArgValue(name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function readDecisionFrequencyArg() {
  const value = readArgValue("--decision-frequency");
  if (
    value === undefined ||
    value === "every_tick" ||
    value === "once_per_day" ||
    value === "once_per_week"
  ) {
    return value;
  }
  throw new Error(
    "--decision-frequency must be every_tick, once_per_day, or once_per_week"
  );
}

function readWindowSamplingModeArg() {
  const value = readArgValue("--window-sampling");
  if (
    value === undefined ||
    value === "random" ||
    value === "balanced_regime"
  ) {
    return value ?? "random";
  }
  throw new Error("--window-sampling must be random or balanced_regime");
}

function readTargetRegimesArg(): MarketRegimeLabel[] | undefined {
  const raw = readArgValue("--target-regimes");
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  return raw.split(",").map((value) => {
    const label = value.trim();
    if (
      label === "bull" ||
      label === "bear" ||
      label === "sideways" ||
      label === "mixed" ||
      label === "insufficient_data"
    ) {
      return label;
    }
    throw new Error(
      "--target-regimes must contain bull, bear, sideways, mixed, or insufficient_data"
    );
  });
}

function readArgValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }

  return value;
}

function readRequiredArgValue(name: string): string {
  const value = readArgValue(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readPaperExitPolicyArg() {
  const takeProfitRatio = readOptionalNumberArg("--paper-take-profit-ratio");
  const stopLossRatio = readOptionalNumberArg("--paper-stop-loss-ratio");
  const rebalanceMaxPositionWeightRatio = readOptionalNumberArg(
    "--paper-rebalance-max-position-weight-ratio"
  );
  const takeProfitMode = readTakeProfitModeArg();
  const takeProfitSellRatio = readOptionalNumberArg(
    "--paper-take-profit-sell-ratio"
  );
  const trailingStopFromPeakRatio = readOptionalNumberArg(
    "--paper-trailing-stop-from-peak-ratio"
  );
  const normalized = normalizePaperExitPolicy({
    ...(takeProfitRatio === undefined ? {} : { takeProfitRatio }),
    ...(stopLossRatio === undefined ? {} : { stopLossRatio }),
    ...(rebalanceMaxPositionWeightRatio === undefined
      ? {}
      : { rebalanceMaxPositionWeightRatio }),
    ...(takeProfitMode === undefined ? {} : { takeProfitMode }),
    ...(takeProfitSellRatio === undefined ? {} : { takeProfitSellRatio }),
    ...(trailingStopFromPeakRatio === undefined
      ? {}
      : { trailingStopFromPeakRatio })
  });
  return normalized ?? undefined;
}

function readMarketRegimeAllocationPolicyArg():
  | MarketRegimeAllocationPolicy
  | undefined {
  if (!args.includes("--market-regime-allocation")) {
    return undefined;
  }

  const lookbackDays = readNumberArg(
    "--market-regime-allocation-lookback-days",
    20
  );
  if (!Number.isInteger(lookbackDays) || lookbackDays <= 0) {
    throw new Error(
      "--market-regime-allocation-lookback-days must be a positive integer"
    );
  }

  return {
    lookbackDays,
    minSymbols: readNumberArg("--market-regime-min-symbols", 1),
    minSnapshotsPerSymbol: readNumberArg(
      "--market-regime-min-snapshots-per-symbol",
      2
    )
  };
}

function readDynamicCashReservePolicyArg():
  | DynamicCashReservePolicy
  | undefined {
  if (!args.includes("--dynamic-cash-reserve")) {
    return undefined;
  }

  const lookbackDays = readNumberArg(
    "--dynamic-cash-reserve-lookback-days",
    20
  );
  if (!Number.isInteger(lookbackDays) || lookbackDays <= 0) {
    throw new Error(
      "--dynamic-cash-reserve-lookback-days must be a positive integer"
    );
  }

  return {
    lookbackDays,
    minSymbols: readNumberArg("--dynamic-cash-reserve-min-symbols", 1),
    minSnapshotsPerSymbol: readNumberArg(
      "--dynamic-cash-reserve-min-snapshots-per-symbol",
      2
    ),
    highVolatilityReturnThreshold: readNumberArg(
      "--dynamic-cash-reserve-high-volatility-return-threshold",
      0.08
    ),
    highVolatilityCashReserveRatio: readNumberArg(
      "--dynamic-cash-reserve-high-volatility-ratio",
      0.3
    )
  };
}

function readTakeProfitModeArg() {
  const raw = readArgValue("--paper-take-profit-mode");
  if (raw === undefined) {
    return undefined;
  }
  if (raw === "full_exit" || raw === "partial_then_trail") {
    return raw;
  }
  throw new Error(
    "--paper-take-profit-mode must be full_exit or partial_then_trail"
  );
}

function readRequiredSymbols():
  | Array<{ market: Market; symbol: string }>
  | undefined {
  const values: Array<{ market: Market; symbol: string }> = [];
  const universePath = readArgValue("--universe-path");
  if (universePath !== undefined) {
    const universe = parseHistoricalUniverseManifest(
      JSON.parse(readFileSync(universePath, "utf8"))
    );
    values.push(
      ...requiredSymbolsFromHistoricalUniverse(universe, {
        includeOptional: args.includes("--require-optional-universe-symbols")
      })
    );
  }

  const raw = readArgValue("--required-symbols");
  if (raw !== undefined && raw.trim().length > 0) {
    values.push(
      ...raw.split(",").map((value) => {
        const [market, symbol] = value.split(":");
        const parsedMarket: Market | undefined =
          market === "KR" ? "KR" : market === "US" ? "US" : undefined;
        if (parsedMarket === undefined || !symbol) {
          throw new Error("--required-symbols must use MARKET:SYMBOL entries");
        }
        return { market: parsedMarket, symbol };
      })
    );
  }

  return values.length === 0 ? undefined : dedupeSymbols(values);
}

function readValidationSplitAssignmentsArg():
  | ValidationSplitAssignment[]
  | undefined {
  if (validationSplitsPath === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(validationSplitsPath, "utf8")) as unknown;
  const rawAssignments =
    Array.isArray(parsed) || typeof parsed !== "object" || parsed === null
      ? parsed
      : (parsed as { assignments?: unknown }).assignments;
  if (!Array.isArray(rawAssignments)) {
    throw new Error("--validation-splits-path must contain an assignment array");
  }

  return rawAssignments.map((assignment, index) => {
    try {
      return validationSplitAssignmentSchema.parse(assignment);
    } catch (error) {
      throw new Error(
        `invalid validation split assignment at index ${index}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  });
}

function dedupeSymbols(
  values: Array<{ market: Market; symbol: string }>
): Array<{ market: Market; symbol: string }> {
  const byKey = new Map<string, { market: Market; symbol: string }>();
  for (const value of values) {
    byKey.set(`${value.market}:${value.symbol}`, value);
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const marketDiff = left.market.localeCompare(right.market);
    return marketDiff === 0
      ? left.symbol.localeCompare(right.symbol)
      : marketDiff;
  });
}

async function assertCodexPreflight(
  provider: CodexCliDecisionProvider
): Promise<void> {
  const result = await provider.decide(codexPreflightPacket());
  if (result.failure !== null || result.decision === null) {
    throw new Error(
      `Codex AI preflight failed: ${summarizeCodexCliDecisionFailure(
        result.failure
      )}`
    );
  }
}

function codexPreflightPacket(): MarketPacket {
  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + 60_000);
  return {
    packetId: "packet_codex_preflight",
    mode: "paper_only",
    generatedAt: generatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    virtualPortfolio: {
      portfolioId: "virtual_preflight",
      cashKrw: 0,
      positions: [],
      updatedAt: generatedAt.toISOString()
    },
    candidates: [],
    constraints: {
      maxNewPositions: 0,
      maxBudgetPerSymbolKrw: 0,
      allowedActions: ["VIRTUAL_HOLD"]
    }
  };
}
