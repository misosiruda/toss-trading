import "../config/loadEnv.js";

import { readFileSync } from "node:fs";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readCodexDecisionProviderConfig } from "./codexDecisionEnv.js";
import {
  parsePaperRiskProfileName,
  resolvePaperRiskProfile
} from "../paper/riskProfile.js";
import { normalizePaperExitPolicy } from "../paper/exitPolicy.js";
import {
  assessHistoricalDataAvailability,
  type HistoricalDataAvailabilityCalendarOptions,
  type HistoricalDataAvailabilityCalendarRule
} from "../replay/historicalDataAvailability.js";
import {
  parseHistoricalUniverseManifest,
  requiredSymbolsFromHistoricalUniverse
} from "../replay/historicalUniverseCoverage.js";
import {
  parseMarketCalendarFixtures,
  type MarketCalendarTimezone
} from "../replay/marketCalendar.js";
import {
  CodexHistoricalReplayDecisionProvider,
  historicalReplayCodexProviderMetadata,
  resolveHistoricalReplayPromptPolicy,
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
  "--risk-profile",
  "--paper-take-profit-ratio",
  "--paper-stop-loss-ratio",
  "--paper-rebalance-max-position-weight-ratio",
  "--paper-take-profit-mode",
  "--paper-take-profit-sell-ratio",
  "--paper-trailing-stop-from-peak-ratio",
  "--max-new-positions",
  "--max-budget-per-symbol-krw",
  "--min-window-snapshots",
  "--min-snapshots-per-symbol",
  "--required-symbols",
  "--universe-path",
  "--calendar-fixtures-path",
  "--calendar-rule",
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
const codexDecisionConfig = readCodexDecisionProviderConfig(process.env, {
  defaultMaxRunsPerDay: 5,
  ephemeral: true
});
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
const historicalPromptPolicy = resolveHistoricalReplayPromptPolicy({
  riskProfile: riskProfile.name
});

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

const historicalCodexDecisionConfig = withHistoricalReplayPrompt(
  codexDecisionConfig,
  { riskProfile: riskProfile.name }
);
const decisionProvider = dryRun
  ? undefined
  : new CodexHistoricalReplayDecisionProvider(
      new CodexCliDecisionProvider(historicalCodexDecisionConfig),
      { maxCallsPerReplay: maxCodexCalls }
    );
const decisionProviderMetadata = dryRun
  ? undefined
  : historicalReplayCodexProviderMetadata({
      config: historicalCodexDecisionConfig,
      maxCallsPerRun: maxCodexCalls,
      promptPolicy: historicalPromptPolicy
    });

const result = await runHistoricalReplayWorkflow({
  storageBaseDir: dataDir,
  clock: new SimulatedClock({
    startAt,
    endAt,
    stepSeconds,
    speedMultiplier: readNumberArg("--speed-multiplier", 1)
  }),
  ...(decisionProvider === undefined ? {} : { decisionProvider }),
  ...(decisionProviderMetadata === undefined ? {} : { decisionProviderMetadata }),
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
  constraints: riskProfile.constraints,
  riskProfile: riskProfile.name,
  riskPolicy: riskProfile.riskPolicy,
  allocationPolicy: riskProfile.allocationPolicy,
  ...(paperExitPolicy === undefined ? {} : { paperExitPolicy })
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
  const calendarValidation = readCalendarValidationOptions();

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
    ...(requiredSymbols === undefined ? {} : { requiredSymbols }),
    ...(calendarValidation === undefined ? {} : { calendarValidation })
  });
}

function readCalendarValidationOptions():
  | HistoricalDataAvailabilityCalendarOptions
  | undefined {
  const fixturesPath = readCalendarFixturesPathArg();
  const rules = readCalendarRules();

  if (fixturesPath === undefined) {
    if (rules.length > 0) {
      throw new Error("--calendar-rule requires --calendar-fixtures-path");
    }
    return undefined;
  }
  if (fixturesPath.trim().length === 0) {
    throw new Error("--calendar-fixtures-path must not be empty");
  }
  if (rules.length === 0) {
    throw new Error(
      "--calendar-fixtures-path requires at least one --calendar-rule"
    );
  }

  return {
    fixtures: readCalendarFixtures(fixturesPath),
    rules
  };
}

function readCalendarFixturesPathArg(): string | undefined {
  const index = args.indexOf("--calendar-fixtures-path");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--calendar-fixtures-path requires a value");
  }
  return value;
}

function readCalendarFixtures(path: string) {
  const raw = readFileSync(path, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("--calendar-fixtures-path must not be empty");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("--calendar-fixtures-path must contain fixture array");
    }
    return parseMarketCalendarFixtures(parsed);
  }

  const values = trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(
          `invalid calendar fixture JSONL at line ${index + 1}`
        );
      }
    });
  return parseMarketCalendarFixtures(values);
}

function readCalendarRules(): HistoricalDataAvailabilityCalendarRule[] {
  return readArgValues("--calendar-rule").map(parseCalendarRuleArg);
}

function parseCalendarRuleArg(
  value: string
): HistoricalDataAvailabilityCalendarRule {
  const [market, exchange, timezone, extra] = value.split(":");
  if (
    extra !== undefined ||
    (market !== "KR" && market !== "US") ||
    exchange === undefined ||
    exchange.trim().length === 0 ||
    timezone === undefined
  ) {
    throw new Error(
      "--calendar-rule must use MARKET:EXCHANGE:TIMEZONE format"
    );
  }
  return {
    market,
    exchange,
    timezone: parseMarketCalendarTimezoneArg(timezone)
  };
}

function parseMarketCalendarTimezoneArg(
  value: string
): MarketCalendarTimezone {
  if (value === "Asia/Seoul" || value === "America/New_York") {
    return value;
  }
  throw new Error(
    "--calendar-rule timezone must be Asia/Seoul or America/New_York"
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

function readArgValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
  }
  return values;
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
