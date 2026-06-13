import "../config/loadEnv.js";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readHistoricalCodexDecisionEnv } from "./codexDecisionEnv.js";
import { assessHistoricalDataAvailability } from "../replay/historicalDataAvailability.js";
import {
  CodexHistoricalReplayDecisionProvider,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { selectReplayWindow } from "../replay/replayWindowSampler.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { renderHistoricalReplayReport } from "../reports/historicalReplayReport.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import type { Market } from "../domain/schemas.js";

const VALUE_OPTION_NAMES = new Set([
  "--data-dir",
  "--timezone-offset-minutes",
  "--random-window-from",
  "--random-window-to",
  "--random-window-seed",
  "--window-months",
  "--start-at",
  "--end-at",
  "--step-seconds",
  "--every-n-steps",
  "--max-decision-calls",
  "--max-codex-calls",
  "--max-candidates",
  "--max-snapshot-age-seconds",
  "--initial-cash-krw",
  "--decision-frequency",
  "--speed-multiplier",
  "--packet-id-prefix",
  "--packet-expires-in-seconds",
  "--max-new-positions",
  "--max-budget-per-symbol-krw",
  "--min-window-snapshots",
  "--min-snapshots-per-symbol",
  "--required-symbols",
  "--run-id",
  "--batch-id",
  "--batch-run-index"
]);

const args = process.argv.slice(2);
const positionalArgs = collectPositionalArgs(args);
const dryRun = args.includes("--dry-run");
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const timezoneOffsetMinutes = readNumberArg("--timezone-offset-minutes", 540);
const replayWindow = args.includes("--random-window")
  ? selectReplayWindow({
      rangeStart: readDateArg("--random-window-from"),
      rangeEnd: readDateArg("--random-window-to"),
      seed: readRequiredArgValue("--random-window-seed"),
      windowMonths: readNumberArg("--window-months", 1),
      timezoneOffsetMinutes
    })
  : null;

if (args.includes("--print-window-only")) {
  if (replayWindow === null) {
    throw new Error("--print-window-only requires --random-window");
  }
  console.log(JSON.stringify(replayWindow, null, 2));
  process.exit(0);
}

const startAt =
  replayWindow === null
    ? readDateArg("--start-at", positionalArgs[1])
    : new Date(replayWindow.startAt);
const endAt =
  replayWindow === null
    ? readDateArg("--end-at", positionalArgs[2])
    : new Date(replayWindow.endAt);
const checkDataAvailability = args.includes("--check-data-availability");
const requireDataAvailability = args.includes("--require-data-availability");
const stepSeconds = readNumberArg("--step-seconds", 60, positionalArgs[3]);
const everyNSteps = readOptionalNumberArg("--every-n-steps", positionalArgs[4]);
const maxDecisionCalls = readOptionalNumberArg("--max-decision-calls");
const maxCodexCalls = readNumberArg("--max-codex-calls", 10);
const maxCandidates = readNumberArg("--max-candidates", 10);
const maxSnapshotAgeSeconds = readNumberArg("--max-snapshot-age-seconds", 300);
const initialCashKrw = readNumberArg("--initial-cash-krw", 1_000_000);
const runId = readArgValue("--run-id");
const batchId = readArgValue("--batch-id");
const batchRunIndex = readOptionalNumberArg("--batch-run-index");
const decisionFrequencyArg = readArgValue("--decision-frequency");
const decisionFrequency =
  decisionFrequencyArg === "once_per_day" ||
  decisionFrequencyArg === "once_per_week"
    ? decisionFrequencyArg
    : "every_tick";
const codexDecisionEnv = readHistoricalCodexDecisionEnv();

if (checkDataAvailability || requireDataAvailability) {
  const availabilityReport = await readHistoricalDataAvailabilityReport();
  if (checkDataAvailability) {
    console.log(JSON.stringify(availabilityReport, null, 2));
    process.exit(availabilityReport.status === "available" ? 0 : 1);
  }
  if (availabilityReport.status !== "available") {
    throw new Error(
      `historical data availability insufficient: ${availabilityReport.issues.join(", ")}`
    );
  }
}

if (!dryRun && (process.env.AI_DECISION_MODE ?? "paper_only") !== "paper_only") {
  throw new Error("AI_DECISION_MODE must be paper_only for historical replay");
}

const samplingPolicy = new ReplaySamplingPolicy({
  ...(everyNSteps === undefined ? {} : { everyNSteps }),
  ...(maxDecisionCalls === undefined ? {} : { maxDecisionCalls }),
  candidateChangedOnly: process.argv.includes("--candidate-changed-only"),
  decisionFrequency,
  timezoneOffsetMinutes
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
          maxRunsPerDay: codexDecisionEnv.maxRunsPerDay,
          allowWebSearch: codexDecisionEnv.allowWebSearch,
          ...(codexDecisionEnv.outputSchemaPath === undefined
            ? {}
            : { outputSchemaPath: codexDecisionEnv.outputSchemaPath })
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
  initialCashKrw,
  packetIdPrefix: readArgValue("--packet-id-prefix") ?? "packet_historical",
  packetExpiresInSeconds: readNumberArg("--packet-expires-in-seconds", 60),
  maxCandidates,
  maxSnapshotAgeSeconds,
  ...(runId === undefined ? {} : { runId }),
  ...(batchId === undefined ? {} : { batchId }),
  ...(batchRunIndex === undefined ? {} : { batchRunIndex }),
  ...(replayWindow === null ? {} : { windowSelection: replayWindow }),
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

function collectPositionalArgs(values: string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value.startsWith("--")) {
      if (VALUE_OPTION_NAMES.has(value) && values[index + 1] !== undefined) {
        index += 1;
      }
      continue;
    }
    positional.push(value);
  }
  return positional;
}

async function readHistoricalDataAvailabilityReport() {
  const paths = createStoragePaths(dataDir);
  const result = await new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  ).readAll();
  const requiredSymbols = readRequiredSymbols();

  return assessHistoricalDataAvailability({
    snapshots: result.records,
    windowStart: startAt,
    windowEnd: endAt,
    corruptLineCount: result.corruptLineCount,
    minWindowSnapshots: readNumberArg("--min-window-snapshots", 1),
    minSnapshotsPerRequiredSymbol: readNumberArg(
      "--min-snapshots-per-symbol",
      1
    ),
    ...(requiredSymbols === undefined ? {} : { requiredSymbols })
  });
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
