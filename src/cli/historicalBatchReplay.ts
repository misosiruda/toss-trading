import "../config/loadEnv.js";

import type { Market } from "../domain/schemas.js";
import { runHistoricalBatchReplay } from "../workflows/historicalBatchReplayWorkflow.js";

const args = process.argv.slice(2);
const everyNSteps = readOptionalNumberArg("--every-n-steps");
const decisionFrequency = readDecisionFrequencyArg();
const maxDecisionCalls = readOptionalNumberArg("--max-decision-calls");
const requiredSymbols = readRequiredSymbols();

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
  constraints: {
    maxNewPositions: readNumberArg("--max-new-positions", 3),
    maxBudgetPerSymbolKrw: readNumberArg("--max-budget-per-symbol-krw", 100_000),
    allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
  }
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
      failedCount: result.failedCount
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
