import "../config/loadEnv.js";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import {
  CodexHistoricalReplayDecisionProvider,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { renderHistoricalReplayReport } from "../reports/historicalReplayReport.js";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";

const args = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith("-"));
const dryRun = args.includes("--dry-run");
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const startAt = readDateArg("--start-at", positionalArgs[1]);
const endAt = readDateArg("--end-at", positionalArgs[2]);
const stepSeconds = readNumberArg("--step-seconds", 60, positionalArgs[3]);
const everyNSteps = readOptionalNumberArg("--every-n-steps", positionalArgs[4]);
const maxDecisionCalls = readOptionalNumberArg("--max-decision-calls");
const maxCodexCalls = readNumberArg("--max-codex-calls", 10);
const maxCandidates = readNumberArg("--max-candidates", 10);
const maxSnapshotAgeSeconds = readNumberArg("--max-snapshot-age-seconds", 300);
const initialCashKrw = readNumberArg("--initial-cash-krw", 1_000_000);
const decisionFrequencyArg = readArgValue("--decision-frequency");
const decisionFrequency =
  decisionFrequencyArg === "once_per_day" ||
  decisionFrequencyArg === "once_per_week"
    ? decisionFrequencyArg
    : "every_tick";
const outputSchemaOption =
  process.env.AI_DECISION_OUTPUT_SCHEMA_PATH === undefined
    ? {}
    : { outputSchemaPath: process.env.AI_DECISION_OUTPUT_SCHEMA_PATH };

if (!dryRun && (process.env.AI_DECISION_MODE ?? "paper_only") !== "paper_only") {
  throw new Error("AI_DECISION_MODE must be paper_only for historical replay");
}

const samplingPolicy = new ReplaySamplingPolicy({
  ...(everyNSteps === undefined ? {} : { everyNSteps }),
  ...(maxDecisionCalls === undefined ? {} : { maxDecisionCalls }),
  candidateChangedOnly: process.argv.includes("--candidate-changed-only"),
  decisionFrequency,
  timezoneOffsetMinutes: readNumberArg("--timezone-offset-minutes", 540)
});

const decisionProvider = dryRun
  ? undefined
  : new CodexHistoricalReplayDecisionProvider(
      new CodexCliDecisionProvider(
        withHistoricalReplayPrompt({
          enabled: process.env.AI_DECISION_ENABLED === "true",
          codexPath: process.env.CODEX_EXEC_PATH ?? "codex",
          sandbox: "read-only",
          timeoutMs: Number(process.env.CODEX_EXEC_TIMEOUT_SECONDS ?? 300) * 1000,
          maxRunsPerDay: Number(process.env.AI_DECISION_MAX_RUNS_PER_DAY ?? 5),
          allowWebSearch: process.env.CODEX_ALLOW_WEB_SEARCH === "true",
          ...outputSchemaOption
        })
      ),
      { maxCallsPerReplay: maxCodexCalls }
    );

const result = await runHistoricalReplayWorkflow({
  storageBaseDir: dataDir,
  clock: new SimulatedClock({
    startAt,
    endAt,
    stepSeconds,
    speedMultiplier: readNumberArg("--speed-multiplier", 1)
  }),
  ...(decisionProvider === undefined ? {} : { decisionProvider }),
  samplingPolicy,
  generatedAt: new Date(),
  initialCashKrw,
  packetIdPrefix: readArgValue("--packet-id-prefix") ?? "packet_historical",
  packetExpiresInSeconds: readNumberArg("--packet-expires-in-seconds", 60),
  maxCandidates,
  maxSnapshotAgeSeconds,
  constraints: {
    maxNewPositions: readNumberArg("--max-new-positions", 3),
    maxBudgetPerSymbolKrw: readNumberArg("--max-budget-per-symbol-krw", 100_000),
    allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
  }
});

console.log(renderHistoricalReplayReport(result.report));
console.log(`report_path=${result.reportPath}`);

function readDateArg(name: string, positionalFallback?: string): Date {
  const raw = readArgValue(name) ?? positionalFallback;
  if (!raw) {
    throw new Error(`${name} is required`);
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
}

function readNumberArg(
  name: string,
  fallback: number,
  positionalFallback?: string
): number {
  const parsed = readOptionalNumberArg(name, positionalFallback);
  return parsed ?? fallback;
}

function readOptionalNumberArg(
  name: string,
  positionalFallback?: string
): number | undefined {
  const raw = readArgValue(name) ?? positionalFallback;
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function readArgValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
