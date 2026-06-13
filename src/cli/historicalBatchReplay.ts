import "../config/loadEnv.js";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readHistoricalCodexDecisionEnv } from "./codexDecisionEnv.js";
import {
  parsePaperRiskProfileName,
  resolvePaperRiskProfile
} from "../paper/riskProfile.js";
import type { Market } from "../domain/schemas.js";
import {
  CodexHistoricalReplayDecisionProvider,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";
import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import { runHistoricalBatchReplay } from "../workflows/historicalBatchReplayWorkflow.js";

const args = process.argv.slice(2);
const everyNSteps = readOptionalNumberArg("--every-n-steps");
const decisionFrequency = readDecisionFrequencyArg();
const maxDecisionCalls = readOptionalNumberArg("--max-decision-calls");
const useCodexAi = args.includes("--use-codex-ai");
const maxCodexCallsPerRun = readNumberArg("--max-codex-calls-per-run", 5);
const requiredSymbols = readRequiredSymbols();
const windowSamplingMode = readWindowSamplingModeArg();
const targetRegimes = readTargetRegimesArg();
const codexDecisionEnv = readHistoricalCodexDecisionEnv();
const maxNewPositionsOverride = readOptionalNumberArg("--max-new-positions");
const maxBudgetPerSymbolOverride = readOptionalNumberArg(
  "--max-budget-per-symbol-krw"
);
const riskProfile = resolvePaperRiskProfile({
  name: parsePaperRiskProfileName(readArgValue("--risk-profile")),
  ...(maxNewPositionsOverride === undefined
    ? {}
    : { maxNewPositions: maxNewPositionsOverride }),
  ...(maxBudgetPerSymbolOverride === undefined
    ? {}
    : { maxBudgetPerSymbolKrw: maxBudgetPerSymbolOverride })
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

const codexDelegate = useCodexAi
  ? new CodexCliDecisionProvider(
      withHistoricalReplayPrompt({
        enabled: true,
        codexPath: process.env.CODEX_EXEC_PATH ?? "codex",
        sandbox: "read-only",
        timeoutMs: Number(process.env.CODEX_EXEC_TIMEOUT_SECONDS ?? 300) * 1000,
        maxRunsPerDay: codexDecisionEnv.maxRunsPerDay,
        allowWebSearch: codexDecisionEnv.allowWebSearch,
        ...(codexDecisionEnv.outputSchemaPath === undefined
          ? {}
          : { outputSchemaPath: codexDecisionEnv.outputSchemaPath })
      })
    )
  : null;

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
  initialCashKrw: readNumberArg("--initial-cash-krw", 1_000_000),
  packetIdPrefix: readArgValue("--packet-id-prefix") ?? "packet_batch_replay",
  packetExpiresInSeconds: readNumberArg("--packet-expires-in-seconds", 60),
  maxCandidates: readNumberArg("--max-candidates", 10),
  maxSnapshotAgeSeconds: readNumberArg("--max-snapshot-age-seconds", 300),
  minWindowSnapshots: readNumberArg("--min-window-snapshots", 1),
  minSnapshotsPerRequiredSymbol: readNumberArg("--min-snapshots-per-symbol", 1),
  ...(requiredSymbols === undefined ? {} : { requiredSymbols }),
  windowSamplingMode,
  ...(targetRegimes === undefined ? {} : { targetRegimes }),
  ...(codexDelegate === null
    ? {}
    : {
        decisionProviderFactory: () =>
          new CodexHistoricalReplayDecisionProvider(codexDelegate, {
            maxCallsPerReplay: maxCodexCallsPerRun
          }),
        decisionProviderMetadata: {
          mode: "codex_cli" as const,
          maxCallsPerRun: maxCodexCallsPerRun,
          sandbox: "read-only" as const,
          allowWebSearch: codexDecisionEnv.allowWebSearch
        }
      }),
  constraints: riskProfile.constraints,
  riskProfile: riskProfile.name,
  riskPolicy: riskProfile.riskPolicy
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
      runCount: result.runCount,
      completedCount: result.completedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      decisionProvider: useCodexAi ? "codex_cli" : "deterministic_fixture",
      riskProfile: riskProfile.name,
      windowSamplingMode,
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

function readRequiredSymbols():
  | Array<{ market: Market; symbol: string }>
  | undefined {
  const raw = readArgValue("--required-symbols");
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  return raw.split(",").map((value) => {
    const [market, symbol] = value.split(":");
    if ((market !== "KR" && market !== "US") || !symbol) {
      throw new Error("--required-symbols must use MARKET:SYMBOL entries");
    }
    return { market, symbol };
  });
}
