import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  buildBatchReplayAggregateReport,
  renderBatchReplayAggregateReport
} from "../reports/batchReplayReport.js";
import type {
  BatchReplayRunRecord,
  BatchReplayRunStatus
} from "../workflows/historicalBatchReplayWorkflow.js";

const args = process.argv.slice(2);
const runsPath = readRequiredArgValue("--runs-path");
const outputPath = readArgValue("--output-path");
const records = await readBatchReplayRunRecords(runsPath);
const report = buildBatchReplayAggregateReport({
  records,
  generatedAt: new Date(),
  sourceRunsPath: runsPath
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
  return value === "completed" || value === "skipped" || value === "failed";
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
