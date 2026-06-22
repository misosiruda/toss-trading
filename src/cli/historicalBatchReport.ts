import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildBatchReplayAggregateReport,
  renderBatchReplayAggregateReport
} from "../reports/batchReplayReport.js";
import {
  BATCH_REPLAY_SELECTION_TRIALS_FILE_NAME
} from "../storage/artifactPaths.js";
import type {
  SelectionTrialRecord,
  SelectionTrialRunStatus
} from "../replay/selectionTrialLog.js";
import type {
  BatchReplayRunRecord,
  BatchReplayRunStatus
} from "../workflows/historicalBatchReplayWorkflow.js";

const args = process.argv.slice(2);
const runsPath = readRequiredArgValue("--runs-path");
const outputPath = readArgValue("--output-path");
const selectionTrialsPathArg = readArgValue("--selection-trials-path");
const selectionTrialsPath =
  selectionTrialsPathArg ?? join(dirname(runsPath), BATCH_REPLAY_SELECTION_TRIALS_FILE_NAME);
const targetReturnThresholds = readOptionalNumberListArg(
  "--target-return-thresholds"
);
const records = await readBatchReplayRunRecords(runsPath);
const selectionTrials = await readOptionalSelectionTrialRecords({
  filePath: selectionTrialsPath,
  required: selectionTrialsPathArg !== undefined
});
const report = buildBatchReplayAggregateReport({
  records,
  generatedAt: new Date(),
  sourceRunsPath: runsPath,
  ...(selectionTrials === null
    ? {}
    : { selectionTrials, sourceSelectionTrialsPath: selectionTrialsPath }),
  ...(targetReturnThresholds === undefined ? {} : { targetReturnThresholds })
});

if (outputPath !== undefined) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(renderBatchReplayAggregateReport(report));
if (outputPath !== undefined) {
  console.log(`report_path=${outputPath}`);
}

async function readBatchReplayRunRecords(
  filePath: string
): Promise<BatchReplayRunRecord[]> {
  const raw = await readFile(filePath, "utf8");
  const records: BatchReplayRunRecord[] = [];
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `invalid batch replay run JSON at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!isBatchReplayRunRecord(parsed)) {
      throw new Error(`invalid batch replay run record at line ${index + 1}`);
    }
    records.push(parsed);
  }

  return records;
}

async function readOptionalSelectionTrialRecords(options: {
  filePath: string;
  required: boolean;
}): Promise<SelectionTrialRecord[] | null> {
  try {
    return await readSelectionTrialRecords(options.filePath);
  } catch (error) {
    if (!options.required && isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function readSelectionTrialRecords(
  filePath: string
): Promise<SelectionTrialRecord[]> {
  const raw = await readFile(filePath, "utf8");
  const records: SelectionTrialRecord[] = [];
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `invalid selection trial JSON at line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!isSelectionTrialRecord(parsed)) {
      throw new Error(`invalid selection trial record at line ${index + 1}`);
    }
    records.push(parsed);
  }

  return records;
}

function isBatchReplayRunRecord(value: unknown): value is BatchReplayRunRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<BatchReplayRunRecord>;
  return (
    record.mode === "paper_only" &&
    typeof record.batchId === "string" &&
    typeof record.runId === "string" &&
    typeof record.runIndex === "number" &&
    isRunStatus(record.status) &&
    typeof record.marketRegime === "object" &&
    record.marketRegime !== null &&
    typeof record.marketRegime.label === "string" &&
    typeof record.dataAvailability === "object" &&
    record.dataAvailability !== null &&
    typeof record.window === "object" &&
    record.window !== null
  );
}

function isRunStatus(value: unknown): value is BatchReplayRunStatus {
  return (
    value === "completed" ||
    value === "completed_with_failures" ||
    value === "skipped" ||
    value === "failed"
  );
}

function isSelectionTrialRecord(
  value: unknown
): value is SelectionTrialRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<SelectionTrialRecord>;
  return (
    record.mode === "paper_only" &&
    typeof record.trialId === "string" &&
    typeof record.batchId === "string" &&
    typeof record.runId === "string" &&
    typeof record.runIndex === "number" &&
    isSelectionTrialStatus(record.status) &&
    typeof record.decisionProvider === "object" &&
    record.decisionProvider !== null &&
    typeof record.config === "object" &&
    record.config !== null &&
    typeof record.outcome === "object" &&
    record.outcome !== null &&
    typeof record.selection === "object" &&
    record.selection !== null
  );
}

function isSelectionTrialStatus(
  value: unknown
): value is SelectionTrialRunStatus {
  return (
    value === "completed" ||
    value === "completed_with_failures" ||
    value === "skipped" ||
    value === "failed"
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
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

function readOptionalNumberListArg(name: string): number[] | undefined {
  const raw = readArgValue(name);
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  return raw.split(",").map((value) => {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${name} must contain non-negative numbers`);
    }
    return parsed;
  });
}
