import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildBatchReplayAggregateReport,
  renderBatchReplayAggregateReport
} from "../reports/batchReplayReport.js";
import {
  BATCH_REPLAY_SELECTION_TRIALS_FILE_NAME,
  META_LABEL_EVALUATION_REPORT_FILE_NAME,
  TRIPLE_BARRIER_LABEL_REPORT_FILE_NAME
} from "../storage/artifactPaths.js";
import {
  SELECTION_TRIAL_SCHEMA_VERSION,
  type SelectionTrialRecord,
  type SelectionTrialRunStatus
} from "../replay/selectionTrialLog.js";
import { strategyBucketSchema } from "../domain/schemas.js";
import {
  metaLabelEvaluationReportSchema,
  tripleBarrierLabelArtifactSchema,
  type MetaLabelEvaluationReport,
  type TripleBarrierLabelArtifact
} from "../replay/tripleBarrierLabel.js";
import type { HistoricalUniverseCoverageReport } from "../replay/historicalUniverseCoverage.js";
import type {
  BatchReplayRunRecord,
  BatchReplayRunStatus
} from "../workflows/historicalBatchReplayWorkflow.js";

const args = process.argv.slice(2);
const HISTORICAL_UNIVERSE_COVERAGE_FILE_NAME = "historical-universe-coverage.json";
const runsPath = readRequiredArgValue("--runs-path");
const outputPath = readArgValue("--output-path");
const selectionTrialsPathArg = readOptionalArgValue("--selection-trials-path");
const universeCoveragePathArg = readOptionalArgValue("--universe-coverage-path");
const tripleBarrierLabelPathArg = readOptionalArgValue(
  "--triple-barrier-label-path"
);
const metaLabelEvaluationPathArg = readOptionalArgValue(
  "--meta-label-evaluation-path"
);
const selectionTrialsPath =
  selectionTrialsPathArg ??
  join(dirname(runsPath), BATCH_REPLAY_SELECTION_TRIALS_FILE_NAME);
const universeCoveragePath =
  universeCoveragePathArg ??
  join(dirname(runsPath), HISTORICAL_UNIVERSE_COVERAGE_FILE_NAME);
const tripleBarrierLabelPath =
  tripleBarrierLabelPathArg ??
  join(dirname(runsPath), TRIPLE_BARRIER_LABEL_REPORT_FILE_NAME);
const metaLabelEvaluationPath =
  metaLabelEvaluationPathArg ??
  join(dirname(runsPath), META_LABEL_EVALUATION_REPORT_FILE_NAME);
const targetReturnThresholds = readOptionalNumberListArg(
  "--target-return-thresholds"
);
const expectedSampledCpcvSplitCount = readOptionalNonNegativeIntegerArg(
  "--expected-sampled-cpcv-split-count"
);
const records = await readBatchReplayRunRecords(runsPath);
const selectionTrials = await readOptionalSelectionTrialRecords({
  filePath: selectionTrialsPath,
  required: selectionTrialsPathArg !== undefined
});
const universeCoverageReport = await readOptionalUniverseCoverageReport({
  filePath: universeCoveragePath,
  required: universeCoveragePathArg !== undefined
});
const tripleBarrierLabel = await readOptionalTripleBarrierLabelArtifact({
  filePath: tripleBarrierLabelPath,
  required: tripleBarrierLabelPathArg !== undefined
});
const metaLabelEvaluation = await readOptionalMetaLabelEvaluationReport({
  filePath: metaLabelEvaluationPath,
  required: metaLabelEvaluationPathArg !== undefined
});
const report = buildBatchReplayAggregateReport({
  records,
  generatedAt: new Date(),
  sourceRunsPath: runsPath,
  ...(selectionTrials === null
    ? {}
    : { selectionTrials, sourceSelectionTrialsPath: selectionTrialsPath }),
  ...(universeCoverageReport === null
    ? {}
    : {
        universeCoverageReport,
        sourceUniverseCoveragePath: universeCoveragePath
      }),
  ...(tripleBarrierLabel === null
    ? {}
    : {
        tripleBarrierLabel,
        sourceTripleBarrierLabelPath: tripleBarrierLabelPath
      }),
  ...(metaLabelEvaluation === null
    ? {}
    : {
        metaLabelEvaluation,
        sourceMetaLabelEvaluationPath: metaLabelEvaluationPath
      }),
  ...(targetReturnThresholds === undefined ? {} : { targetReturnThresholds }),
  ...(expectedSampledCpcvSplitCount === undefined
    ? {}
    : { expectedSampledCpcvSplitCount })
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

async function readOptionalUniverseCoverageReport(options: {
  filePath: string;
  required: boolean;
}): Promise<HistoricalUniverseCoverageReport | null> {
  try {
    return await readUniverseCoverageReport(options.filePath);
  } catch (error) {
    if (!options.required && isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function readOptionalMetaLabelEvaluationReport(options: {
  filePath: string;
  required: boolean;
}): Promise<MetaLabelEvaluationReport | null> {
  try {
    return await readMetaLabelEvaluationReport(options.filePath);
  } catch (error) {
    if (!options.required && isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function readOptionalTripleBarrierLabelArtifact(options: {
  filePath: string;
  required: boolean;
}): Promise<TripleBarrierLabelArtifact | null> {
  try {
    return await readTripleBarrierLabelArtifact(options.filePath);
  } catch (error) {
    if (!options.required && isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function readUniverseCoverageReport(
  filePath: string
): Promise<HistoricalUniverseCoverageReport> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid universe coverage JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const normalized = normalizeUniverseCoverageReport(parsed);
  if (!isUniverseCoverageReport(normalized)) {
    throw new Error("invalid universe coverage report");
  }
  return normalized;
}

function normalizeUniverseCoverageReport(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    minAvailableStrategyBucketSymbolCounts:
      value["minAvailableStrategyBucketSymbolCounts"] === undefined
        ? {}
        : value["minAvailableStrategyBucketSymbolCounts"],
    requiredStrategyBuckets:
      value["requiredStrategyBuckets"] === undefined
        ? []
        : value["requiredStrategyBuckets"],
    availableStrategyBuckets:
      value["availableStrategyBuckets"] === undefined
        ? []
        : value["availableStrategyBuckets"],
    availableStrategyBucketSymbolCounts:
      value["availableStrategyBucketSymbolCounts"] === undefined
        ? {}
        : value["availableStrategyBucketSymbolCounts"],
    missingRequiredStrategyBuckets:
      value["missingRequiredStrategyBuckets"] === undefined
        ? []
        : value["missingRequiredStrategyBuckets"],
    insufficientAvailableStrategyBucketSymbolCounts:
      value["insufficientAvailableStrategyBucketSymbolCounts"] === undefined
        ? []
        : value["insufficientAvailableStrategyBucketSymbolCounts"],
    symbolSummaries: Array.isArray(value["symbolSummaries"])
      ? value["symbolSummaries"].map(normalizeUniverseCoverageSymbolSummary)
      : value["symbolSummaries"]
  };
}

function normalizeUniverseCoverageSymbolSummary(value: unknown): unknown {
  if (
    !isRecord(value) ||
    value["strategyBucketSnapshotStatus"] !== undefined
  ) {
    return value;
  }

  return {
    ...value,
    strategyBucketSnapshotStatus:
      typeof value["strategyBucket"] === "string" ? "missing" : "not_applicable"
  };
}

async function readTripleBarrierLabelArtifact(
  filePath: string
): Promise<TripleBarrierLabelArtifact> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid triple-barrier label JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const result = tripleBarrierLabelArtifactSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("invalid triple-barrier label artifact");
  }
  return result.data;
}

async function readMetaLabelEvaluationReport(
  filePath: string
): Promise<MetaLabelEvaluationReport> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `invalid meta-label evaluation JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const result = metaLabelEvaluationReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("invalid meta-label evaluation report");
  }
  return result.data;
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

function isUniverseCoverageReport(
  value: unknown
): value is HistoricalUniverseCoverageReport {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["mode"] === "paper_only" &&
    typeof value["universeId"] === "string" &&
    (value["status"] === "available" || value["status"] === "insufficient") &&
    typeof value["rangeStart"] === "string" &&
    typeof value["rangeEnd"] === "string" &&
    isNonNegativeInteger(value["universeSymbolCount"]) &&
    isNonNegativeInteger(value["requiredSymbolCount"]) &&
    isNonNegativeInteger(value["optionalSymbolCount"]) &&
    isNonNegativeInteger(value["availableSymbolCount"]) &&
    isNonNegativeInteger(value["availableRequiredSymbolCount"]) &&
    isNonNegativeInteger(value["availableOptionalSymbolCount"]) &&
    isNonNegativeInteger(value["corruptLineCount"]) &&
    isRecord(value["minAvailableStrategyBucketSymbolCounts"]) &&
    Array.isArray(value["requiredStrategyBuckets"]) &&
    Array.isArray(value["availableStrategyBuckets"]) &&
    Array.isArray(value["missingRequiredSymbols"]) &&
    Array.isArray(value["missingOptionalSymbols"]) &&
    Array.isArray(value["insufficientRequiredSymbols"]) &&
    Array.isArray(value["insufficientOptionalSymbols"]) &&
    Array.isArray(value["missingRequiredMarkets"]) &&
    Array.isArray(value["missingRequiredAssetTypes"]) &&
    Array.isArray(value["missingRequiredStrategyBuckets"]) &&
    Array.isArray(value["insufficientAvailableMarketSymbolCounts"]) &&
    Array.isArray(value["insufficientAvailableAssetTypeSymbolCounts"]) &&
    Array.isArray(
      value["insufficientAvailableStrategyBucketSymbolCounts"]
    ) &&
    isRecord(value["availableMarketSymbolCounts"]) &&
    isRecord(value["availableAssetTypeSymbolCounts"]) &&
    isRecord(value["availableStrategyBucketSymbolCounts"]) &&
    Array.isArray(value["issues"]) &&
    value["issues"].every((issue) => typeof issue === "string")
  );
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
    record.trialSchemaVersion === SELECTION_TRIAL_SCHEMA_VERSION &&
    typeof record.trialId === "string" &&
    typeof record.batchId === "string" &&
    typeof record.runId === "string" &&
    typeof record.runIndex === "number" &&
    typeof record.runSeed === "string" &&
    isSelectionTrialStatus(record.status) &&
    typeof record.startedAt === "string" &&
    isNullableString(record.completedAt) &&
    isNullableString(record.skippedAt) &&
    isNullableString(record.failedAt) &&
    isRecord(record.window) &&
    isRecord(record.marketRegime) &&
    typeof record.marketRegime["label"] === "string" &&
    isSelectionTrialDecisionProvider(record.decisionProvider) &&
    isSelectionTrialConfig(record.config) &&
    isSelectionTrialOutcome(record.outcome) &&
    isSelectionTrialSelection(record.selection) &&
    isRecord(record.researchManifest)
  );
}

function isSelectionTrialDecisionProvider(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["mode"] === "string" &&
    isNullableString(value["promptPolicy"]) &&
    isNullableString(value["promptVersion"]) &&
    isNullableSha256Hash(value["promptHash"]) &&
    isSha256Hash(value["metadataHash"])
  );
}

function isSelectionTrialConfig(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNullableSha256Hash(value["configHash"]) &&
    isSha256Hash(value["riskPolicyHash"]) &&
    isSha256Hash(value["allocationPolicyHash"]) &&
    isSha256Hash(value["marketRegimeAllocationPolicyHash"]) &&
    isSha256Hash(value["exitPolicyHash"]) &&
    (value["strategyPreset"] === undefined ||
      isNullableString(value["strategyPreset"])) &&
    (value["candidateStrategyBucket"] === undefined ||
      isNullableStrategyBucket(value["candidateStrategyBucket"])) &&
    (value["replayCadence"] === undefined ||
      isNullableSelectionTrialReplayCadence(value["replayCadence"])) &&
    isNullableString(value["riskProfile"]) &&
    value["selectionMetric"] === "total_return_ratio"
  );
}

function isNullableSelectionTrialReplayCadence(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isPositiveInteger(value["stepSeconds"]) &&
      (value["everyNSteps"] === null ||
        isPositiveInteger(value["everyNSteps"])) &&
      typeof value["candidateChangedOnly"] === "boolean" &&
      isReplayDecisionFrequency(value["decisionFrequency"]) &&
      (value["maxDecisionCalls"] === null ||
        isPositiveInteger(value["maxDecisionCalls"])) &&
      Number.isInteger(value["timezoneOffsetMinutes"]))
  );
}

function isReplayDecisionFrequency(value: unknown): boolean {
  return (
    value === "every_tick" ||
    value === "once_per_day" ||
    value === "once_per_week"
  );
}

function isNullableStrategyBucket(value: unknown): boolean {
  return value === null || strategyBucketSchema.safeParse(value).success;
}

function isSelectionTrialOutcome(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNullableNumber(value["totalReturnRatio"]) &&
    isNullableNumber(value["finalVirtualNetWorthKrw"]) &&
    isNonNegativeInteger(value["tradeCount"]) &&
    isNonNegativeInteger(value["aiDecisionFailureCount"]) &&
    isNonNegativeInteger(value["rejectedCount"]) &&
    isNullableString(value["skipReason"]) &&
    isNullableString(value["error"]) &&
    isNullableString(value["reportPath"])
  );
}

function isSelectionTrialSelection(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["selected"] === "boolean" &&
    isNullableString(value["selectedBy"]) &&
    isNullableString(value["selectedAt"]) &&
    isNullableString(value["selectionReason"])
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNullableSha256Hash(
  value: unknown
): value is `sha256:${string}` | null {
  return value === null || isSha256Hash(value);
}

function isSha256Hash(value: unknown): value is `sha256:${string}` {
  return (
    typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)
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

function readOptionalArgValue(name: string): string | undefined {
  const value = readArgValue(name);
  if (value === undefined && args.includes(name)) {
    throw new Error(`${name} requires a value`);
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

function readOptionalNonNegativeIntegerArg(name: string): number | undefined {
  const raw = readArgValue(name);
  if (raw === undefined && args.includes(name)) {
    throw new Error(`${name} requires a value`);
  }
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
