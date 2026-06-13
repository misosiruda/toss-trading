import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";

test("historical replay availability CLI keeps named option values out of positional fallback", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-availability-cli-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      dataDir,
      "2025-02-01T00:00:00+09:00",
      "2025-02-28T23:59:59.999+09:00",
      "60",
      "--check-data-availability",
      "--min-window-snapshots",
      "1",
      "--required-symbols",
      "KR:005930",
      "--min-snapshots-per-symbol",
      "1"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string };
  assert.equal(report.status, "available");
});

test("historical replay CLI writes batch run metadata", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-batch-metadata-cli-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--dry-run",
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T09:00:00+09:00",
      "--end-at",
      "2025-02-03T09:00:00+09:00",
      "--step-seconds",
      "60",
      "--batch-id",
      "batch-smoke",
      "--batch-run-index",
      "2",
      "--run-id",
      "batch-smoke-run-002"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(
    readFileSync(join(dataDir, "historical-replay-run-metadata.json"), "utf8")
  ) as Record<string, unknown>;
  const identity = metadata["identity"] as Record<string, unknown>;
  const window = metadata["window"] as Record<string, unknown>;

  assert.equal(identity["runId"], "batch-smoke-run-002");
  assert.equal(identity["batchId"], "batch-smoke");
  assert.equal(identity["runIndex"], 2);
  assert.equal(window["source"], "explicit");
  assert.equal(window["startAt"], "2025-02-03T00:00:00.000Z");
});

test("historical batch replay CLI writes batch manifest and aggregate report", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-cli-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-cli-output-")
  );
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReplay.js"),
      "--source-data-dir",
      sourceDataDir,
      "--output-dir",
      outputBaseDir,
      "--batch-id",
      "batch-cli",
      "--seed",
      "seed-001",
      "--runs",
      "1",
      "--random-window-from",
      "2025-02-01T00:00:00+09:00",
      "--random-window-to",
      "2025-02-28T23:59:59.999+09:00",
      "--step-seconds",
      "604800",
      "--max-snapshot-age-seconds",
      String(31 * 24 * 60 * 60),
      "--risk-profile",
      "aggressive_paper"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const manifest = JSON.parse(
    readFileSync(String(output["manifestPath"]), "utf8")
  ) as Record<string, unknown>;
  const runRecords = readFileSync(String(output["runsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(output["status"], "completed");
  assert.equal(output["completedCount"], 1);
  assert.equal(output["riskProfile"], "aggressive_paper");
  assert.equal(manifest["batchId"], "batch-cli");
  assert.equal(manifest["riskProfile"], "aggressive_paper");
  assert.equal(runRecords[0]?.["status"], "completed");
  const runMetadata = JSON.parse(
    readFileSync(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const runConfiguration = runMetadata["configuration"] as Record<
    string,
    unknown
  >;
  const runConstraints = runConfiguration["constraints"] as Record<
    string,
    unknown
  >;
  assert.equal(runConfiguration["riskProfile"], "aggressive_paper");
  assert.equal(runConstraints["maxNewPositions"], 5);
  assert.equal(runConstraints["maxBudgetPerSymbolKrw"], 400_000);

  const aggregateReportPath = join(
    outputBaseDir,
    "batch-cli",
    "batch-replay-aggregate-report.json"
  );
  const reportResult = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      String(output["runsPath"]),
      "--output-path",
      aggregateReportPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(reportResult.status, 0, reportResult.stderr);
  assert.match(reportResult.stdout, /Batch Replay Paper Aggregate Report/);
  assert.match(reportResult.stdout, /paper-only/);
  const aggregateReport = JSON.parse(
    readFileSync(aggregateReportPath, "utf8")
  ) as Record<string, unknown>;
  const summary = aggregateReport["summary"] as Record<string, unknown>;

  assert.equal(aggregateReport["mode"], "paper_only");
  assert.equal(summary["runCount"], 1);
  assert.equal(summary["completedCount"], 1);
  assert.equal(output["decisionProvider"], "deterministic_fixture");
  assert.equal(output["maxCodexCallsPerRun"], null);
  assert.equal(
    (manifest["decisionProvider"] as Record<string, unknown>)["mode"],
    "deterministic_fixture"
  );
});

test("historical batch replay CLI requires explicit AI enable for Codex AI", () => {
  const result = spawnSync(
    process.execPath,
    [join("dist", "cli", "historicalBatchReplay.js"), "--use-codex-ai"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        AI_DECISION_MODE: "paper_only",
        AI_DECISION_ENABLED: "false"
      }
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--use-codex-ai requires the AI decision provider to be enabled/
  );
});

test("historical batch replay CLI rejects invalid per-run Codex call cap", () => {
  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReplay.js"),
      "--use-codex-ai",
      "--max-codex-calls-per-run",
      "0"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        AI_DECISION_MODE: "paper_only",
        AI_DECISION_ENABLED: "true"
      }
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--max-codex-calls-per-run must be a positive integer/
  );
});

function snapshot(
  snapshotId: string,
  symbol: string
): HistoricalMarketSnapshot {
  const observedAt = "2025-02-03T09:00:00+09:00";
  return {
    snapshotId,
    market: "KR",
    symbol,
    observedAt,
    interval: "1m",
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}
