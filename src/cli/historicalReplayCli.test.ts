import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { buildTripleBarrierLabelArtifact } from "../replay/tripleBarrierLabel.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import {
  historicalReplayCodexProviderMetadata,
  resolveHistoricalReplayPromptPolicy,
  withHistoricalReplayPrompt
} from "../replay/codexHistoricalDecisionProvider.js";

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

test("historical replay availability CLI applies calendar fixture validation", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-calendar-cli-"));
  const calendarPath = join(dataDir, "market-calendar.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_calendar", "005930"))}\n`,
    "utf8"
  );
  writeFileSync(
    calendarPath,
    JSON.stringify([calendarFixture({ isHoliday: false })]),
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T00:00:00+09:00",
      "--end-at",
      "2025-02-03T23:59:59.999+09:00",
      "--check-data-availability",
      "--calendar-fixtures-path",
      calendarPath,
      "--calendar-rule",
      "KR:KRX:Asia/Seoul"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    status: string;
    calendarValidation: {
      fixtureCount: number;
      ruleCount: number;
      checkedSnapshotCount: number;
      rejectedSnapshotCount: number;
    };
  };
  assert.equal(report.status, "available");
  assert.equal(report.calendarValidation.fixtureCount, 1);
  assert.equal(report.calendarValidation.ruleCount, 1);
  assert.equal(report.calendarValidation.checkedSnapshotCount, 1);
  assert.equal(report.calendarValidation.rejectedSnapshotCount, 0);
});

test("historical replay availability CLI fails closed for holiday calendar fixtures", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-calendar-cli-"));
  const calendarPath = join(dataDir, "market-calendar.jsonl");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_holiday", "005930"))}\n`,
    "utf8"
  );
  writeFileSync(
    calendarPath,
    `${JSON.stringify(calendarFixture({ isHoliday: true }))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T00:00:00+09:00",
      "--end-at",
      "2025-02-03T23:59:59.999+09:00",
      "--check-data-availability",
      "--calendar-fixtures-path",
      calendarPath,
      "--calendar-rule",
      "KR:KRX:Asia/Seoul"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout) as {
    status: string;
    issues: string[];
    calendarValidation: {
      rejectedSnapshotCount: number;
      warningCounts: Record<string, number>;
    };
  };
  assert.equal(report.status, "insufficient");
  assert.deepEqual(report.issues, ["CALENDAR_HOLIDAY_SAMPLE"]);
  assert.equal(report.calendarValidation.rejectedSnapshotCount, 1);
  assert.equal(
    report.calendarValidation.warningCounts["CALENDAR_HOLIDAY_SAMPLE"],
    1
  );
});

test("historical replay availability CLI rejects calendar rules without fixture path", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-calendar-cli-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_calendar_rule", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T00:00:00+09:00",
      "--end-at",
      "2025-02-03T23:59:59.999+09:00",
      "--check-data-availability",
      "--calendar-rule",
      "KR:KRX:Asia/Seoul"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--calendar-rule requires --calendar-fixtures-path/);
});

test("historical replay availability CLI applies FX fixture validation", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-fx-cli-"));
  const fxPath = join(dataDir, "fx-fixtures.jsonl");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(
      snapshot("hist_spy_fx", "SPY", {
        market: "US",
        observedAt: "2025-02-03T14:30:00.000Z",
        sourceRefs: [
          "fixture:hist_spy_fx",
          "yahoo_fx:KRW=X:2025-02-02"
        ]
      })
    )}\n`,
    "utf8"
  );
  writeFileSync(
    fxPath,
    `${JSON.stringify(
      fxFixture({ staleAfter: "2025-02-03T00:00:00.000Z" })
    )}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T00:00:00.000Z",
      "--end-at",
      "2025-02-03T23:59:59.999Z",
      "--check-data-availability",
      "--fx-fixtures-path",
      fxPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout) as {
    status: string;
    issues: string[];
    fxValidation: {
      rejectedSnapshotCount: number;
      warningCounts: Record<string, number>;
    };
  };
  assert.equal(report.status, "insufficient");
  assert.deepEqual(report.issues, ["VIRTUAL_FX_STALE"]);
  assert.equal(report.fxValidation.rejectedSnapshotCount, 1);
  assert.equal(report.fxValidation.warningCounts["VIRTUAL_FX_STALE"], 1);
});

test("historical replay availability CLI rejects FX required markets without fixture path", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-fx-cli-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_spy_fx_required", "SPY"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T00:00:00.000Z",
      "--end-at",
      "2025-02-03T23:59:59.999Z",
      "--check-data-availability",
      "--fx-required-market",
      "US"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--fx-required-market requires --fx-fixtures-path/);
});

test("historical replay CLI writes batch run metadata", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-batch-metadata-cli-"));
  const universePath = join(dataDir, "universe.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(snapshot("hist_005930_001", "005930")),
      JSON.stringify(snapshot("hist_000660_001", "000660"))
    ].join("\n") + "\n",
    "utf8"
  );
  writeFileSync(universePath, JSON.stringify(universe()), "utf8");

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
      "--paper-take-profit-ratio",
      "0.15",
      "--batch-id",
      "batch-smoke",
      "--batch-run-index",
      "2",
      "--run-id",
      "batch-smoke-run-002",
      "--universe-path",
      universePath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(
    readFileSync(join(dataDir, "historical-replay-run-metadata.json"), "utf8")
  ) as Record<string, unknown>;
  const manifest = JSON.parse(
    readFileSync(
      join(dataDir, "historical-replay-research-manifest.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
  const identity = metadata["identity"] as Record<string, unknown>;
  const window = metadata["window"] as Record<string, unknown>;
  const configuration = metadata["configuration"] as Record<string, unknown>;
  const paperExitPolicy = configuration["paperExitPolicy"] as Record<
    string,
    unknown
  >;

  assert.equal(identity["runId"], "batch-smoke-run-002");
  assert.equal(identity["batchId"], "batch-smoke");
  assert.equal(identity["runIndex"], 2);
  assert.equal(window["source"], "explicit");
  assert.equal(window["startAt"], "2025-02-03T00:00:00.000Z");
  assert.equal(paperExitPolicy["takeProfitRatio"], 0.15);
  assert.equal(manifest["universeSnapshotDate"], "2025-01-01");
});

test("historical replay CLI records Codex provider metadata in research manifest", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-codex-manifest-cli-"));
  const fakeCodexDir = mkdtempSync(join(tmpdir(), "fake-codex-cli-"));
  createFakeCodexExecScript(fakeCodexDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "dist", "cli", "historicalReplay.js"),
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T09:00:00+09:00",
      "--end-at",
      "2025-02-03T09:00:00+09:00",
      "--step-seconds",
      "60",
      "--max-codex-calls",
      "1"
    ],
    {
      cwd: fakeCodexDir,
      encoding: "utf8",
      env: {
        ...process.env,
        AI_DECISION_MODE: "paper_only",
        AI_DECISION_ENABLED: "true",
        CODEX_EXEC_PATH: process.execPath,
        CODEX_EXEC_TIMEOUT_SECONDS: "5",
        CODEX_ALLOW_WEB_SEARCH: "false",
        CODEX_DECISION_ALLOW_WEB_SEARCH: "false"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const historicalPromptPolicy = resolveHistoricalReplayPromptPolicy();
  const expectedCodexPromptHash = createReplayResearchHash(
    historicalReplayCodexProviderMetadata({
      config: withHistoricalReplayPrompt(
        {
          enabled: true,
          codexPath: process.execPath,
          sandbox: "read-only",
          timeoutMs: 5_000,
          maxRunsPerDay: 5,
          allowWebSearch: false,
          ephemeral: true
        },
        {}
      ),
      maxCallsPerRun: 1,
      promptPolicy: historicalPromptPolicy
    })
  );
  const sameVersionDifferentPromptHash = createReplayResearchHash({
    ...historicalReplayCodexProviderMetadata({
      config: withHistoricalReplayPrompt(
        {
          enabled: true,
          codexPath: process.execPath,
          sandbox: "read-only",
          timeoutMs: 5_000,
          maxRunsPerDay: 5,
          allowWebSearch: false,
          ephemeral: true
        },
        {}
      ),
      maxCallsPerRun: 1,
      promptPolicy: historicalPromptPolicy
    }),
    promptText: `${historicalPromptPolicy.prompt}\nextra prompt boundary`
  });
  const deterministicFixturePromptHash = createReplayResearchHash({
    mode: "deterministic_fixture",
    promptPolicy: null,
    promptVersion: null
  });
  const manifest = JSON.parse(
    readFileSync(
      join(dataDir, "historical-replay-research-manifest.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
  const metadata = JSON.parse(
    readFileSync(join(dataDir, "historical-replay-run-metadata.json"), "utf8")
  ) as Record<string, unknown>;
  const manifestInMetadata = metadata["researchManifest"] as Record<
    string,
    unknown
  >;

  assert.equal(manifest["promptHash"], expectedCodexPromptHash);
  assert.notEqual(manifest["promptHash"], sameVersionDifferentPromptHash);
  assert.notEqual(manifest["promptHash"], deterministicFixturePromptHash);
  assert.equal(manifestInMetadata["promptHash"], manifest["promptHash"]);
  assert.deepEqual(manifest["warnings"], []);
});

test("historical batch replay CLI writes batch manifest and aggregate report", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-cli-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-cli-output-")
  );
  const universePath = join(sourceDataDir, "universe.json");
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(snapshot("hist_005930_001", "005930")),
      JSON.stringify(snapshot("hist_000660_001", "000660"))
    ].join("\n") + "\n",
    "utf8"
  );
  writeFileSync(universePath, JSON.stringify(universe()), "utf8");

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
      "aggressive_paper",
      "--dynamic-cash-reserve",
      "--dynamic-cash-reserve-lookback-days",
      "10",
      "--paper-take-profit-ratio",
      "0.15",
      "--paper-stop-loss-ratio",
      "0.08",
      "--paper-rebalance-max-position-weight-ratio",
      "0.55",
      "--universe-path",
      universePath,
      "--window-sampling",
      "balanced_regime",
      "--target-regimes",
      "insufficient_data"
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
  const trialRecords = readFileSync(String(output["selectionTrialsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(output["status"], "completed");
  assert.equal(output["completedCount"], 1);
  assert.equal(output["riskProfile"], "aggressive_paper");
  assert.deepEqual(output["dynamicCashReservePolicy"], {
    lookbackDays: 10,
    minSymbols: 1,
    minSnapshotsPerSymbol: 2,
    highVolatilityReturnThreshold: 0.08,
    highVolatilityCashReserveRatio: 0.3
  });
  assert.deepEqual(output["paperExitPolicy"], {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08,
    rebalanceMaxPositionWeightRatio: 0.55
  });
  assert.equal(output["windowSamplingMode"], "balanced_regime");
  assert.equal(manifest["batchId"], "batch-cli");
  assert.equal(manifest["riskProfile"], "aggressive_paper");
  assert.deepEqual(manifest["paperExitPolicy"], {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08,
    rebalanceMaxPositionWeightRatio: 0.55
  });
  assert.equal(
    (manifest["windowSampling"] as Record<string, unknown>)["mode"],
    "balanced_regime"
  );
  assert.equal(runRecords[0]?.["status"], "completed");
  assert.equal(trialRecords[0]?.["status"], "completed");
  assert.equal(trialRecords[0]?.["trialSchemaVersion"], "selection_trial.v1");
  assert.equal(
    (runRecords[0]?.["windowSampling"] as Record<string, unknown>)["targetRegime"],
    "insufficient_data"
  );
  const runMetadata = JSON.parse(
    readFileSync(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const runResearchManifest = JSON.parse(
    readFileSync(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-research-manifest.json"
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
  const runRiskPolicy = runConfiguration["riskPolicy"] as Record<
    string,
    unknown
  >;
  assert.equal(runConfiguration["riskProfile"], "aggressive_paper");
  assert.equal(runResearchManifest["universeSnapshotDate"], "2025-01-01");
  assert.deepEqual(runConfiguration["paperExitPolicy"], {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08,
    rebalanceMaxPositionWeightRatio: 0.55
  });
  assert.equal(runConstraints["maxNewPositions"], 5);
  assert.equal(runConstraints["maxBudgetPerSymbolKrw"], 400_000);
  assert.deepEqual(runRiskPolicy["dynamicCashReservePolicy"], {
    lookbackDays: 10,
    minSymbols: 1,
    minSnapshotsPerSymbol: 2,
    highVolatilityReturnThreshold: 0.08,
    highVolatilityCashReserveRatio: 0.3
  });

  const aggregateReportPath = join(
    outputBaseDir,
    "batch-cli",
    "batch-replay-aggregate-report.json"
  );
  const tripleBarrierLabelPath = join(
    outputBaseDir,
    "batch-cli",
    "triple-barrier-label-report.json"
  );
  const metaLabelEvaluationPath = join(
    outputBaseDir,
    "batch-cli",
    "meta-label-evaluation-report.json"
  );
  writeFileSync(
    tripleBarrierLabelPath,
    `${JSON.stringify(tripleBarrierLabelArtifact())}\n`,
    "utf8"
  );
  writeFileSync(
    metaLabelEvaluationPath,
    `${JSON.stringify(metaLabelEvaluationReport())}\n`,
    "utf8"
  );
  const reportResult = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      String(output["runsPath"]),
      "--output-path",
      aggregateReportPath,
      "--target-return-thresholds",
      "0.02,0.05"
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
  assert.deepEqual(aggregateReport["targetReturnThresholds"], [0.02, 0.05]);
  assert.equal(
    aggregateReport["sourceSelectionTrialsPath"],
    output["selectionTrialsPath"]
  );
  assert.equal(
    aggregateReport["sourceTripleBarrierLabelPath"],
    tripleBarrierLabelPath
  );
  assert.equal(
    aggregateReport["sourceMetaLabelEvaluationPath"],
    metaLabelEvaluationPath
  );
  assert.equal(
    (
      (aggregateReport["tripleBarrierLabel"] as Record<string, unknown>)[
        "summary"
      ] as Record<string, unknown>
    )["unavailableLabelCount"],
    1
  );
  assert.equal(
    (
      (aggregateReport["metaLabelEvaluation"] as Record<string, unknown>)[
        "summary"
      ] as Record<string, unknown>
    )["accuracyRatio"],
    0.5
  );
  const trialSummary = aggregateReport["trialSummary"] as Record<string, unknown>;
  assert.equal(trialSummary["trialCount"], 1);
  assert.equal(trialSummary["selectedCount"], 0);
  assert.equal(trialSummary["unselectedCount"], 1);
  assert.equal(summary["runCount"], 1);
  assert.equal(summary["completedCount"], 1);
  assert.equal(output["decisionProvider"], "deterministic_fixture");
  assert.equal(output["maxCodexCallsPerRun"], null);
  assert.equal(
    (manifest["decisionProvider"] as Record<string, unknown>)["mode"],
    "deterministic_fixture"
  );
});

test("historical batch replay CLI applies calendar fixture validation", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-calendar-cli-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-calendar-cli-output-")
  );
  const calendarPath = join(sourceDataDir, "market-calendar.jsonl");
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_batch_calendar", "005930"))}\n`,
    "utf8"
  );
  writeFileSync(
    calendarPath,
    `${JSON.stringify(calendarFixture({ isHoliday: true }))}\n`,
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
      "batch-calendar-cli",
      "--seed",
      "seed-calendar",
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
      "--min-window-snapshots",
      "1",
      "--calendar-fixtures-path",
      calendarPath,
      "--calendar-rule",
      "KR:KRX:Asia/Seoul"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const runRecords = readFileSync(String(output["runsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const trialRecords = readFileSync(String(output["selectionTrialsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const availability = runRecords[0]?.["dataAvailability"] as Record<
    string,
    unknown
  >;

  assert.equal(output["status"], "completed");
  assert.equal(output["completedCount"], 0);
  assert.equal(output["skippedCount"], 1);
  assert.equal(runRecords[0]?.["status"], "skipped");
  assert.equal(runRecords[0]?.["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(runRecords[0]?.["reportPath"], null);
  assert.equal(trialRecords[0]?.["status"], "skipped");
  assert.deepEqual(availability["issues"], ["CALENDAR_HOLIDAY_SAMPLE"]);
});

test("historical batch replay CLI applies FX fixture validation", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-fx-cli-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-fx-cli-output-")
  );
  const fxPath = join(sourceDataDir, "fx-fixtures.jsonl");
  const validationSplitsPath = join(outputBaseDir, "validation-splits.json");
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(
      snapshot("hist_spy_batch_fx", "SPY", {
        market: "US",
        observedAt: "2025-02-03T14:30:00.000Z",
        sourceRefs: [
          "fixture:hist_spy_batch_fx",
          "yahoo_fx:KRW=X:2025-02-02"
        ]
      })
    )}\n`,
    "utf8"
  );
  writeFileSync(
    fxPath,
    `${JSON.stringify(
      fxFixture({ staleAfter: "2025-02-03T00:00:00.000Z" })
    )}\n`,
    "utf8"
  );
  writeFileSync(
    validationSplitsPath,
    `${JSON.stringify([validationAssignment("validation")], null, 2)}\n`,
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
      "batch-fx-cli",
      "--seed",
      "seed-fx",
      "--runs",
      "1",
      "--random-window-from",
      "2025-02-01T00:00:00.000Z",
      "--random-window-to",
      "2025-02-28T23:59:59.999Z",
      "--step-seconds",
      "604800",
      "--max-snapshot-age-seconds",
      String(31 * 24 * 60 * 60),
      "--min-window-snapshots",
      "1",
      "--validation-splits-path",
      validationSplitsPath,
      "--fx-fixtures-path",
      fxPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const runRecords = readFileSync(String(output["runsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const availability = runRecords[0]?.["dataAvailability"] as Record<
    string,
    unknown
  >;

  assert.equal(output["status"], "completed");
  assert.equal(output["completedCount"], 0);
  assert.equal(output["skippedCount"], 1);
  assert.equal(runRecords[0]?.["status"], "skipped");
  assert.equal(runRecords[0]?.["skipReason"], "DATA_INSUFFICIENT");
  assert.deepEqual(availability["issues"], ["VIRTUAL_FX_STALE"]);
});

test("historical batch report CLI tolerates missing selection trial log", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-legacy",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /trial_summary: null/);
  const report = JSON.parse(readFileSync(outputPath, "utf8")) as Record<
    string,
    unknown
  >;

  assert.equal(report["sourceSelectionTrialsPath"], null);
  assert.equal(report["trialSummary"], null);
  assert.equal(report["overfittingDiagnostics"], null);
});

test("historical batch report CLI warns on expected split count without trial log", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-missing-trials-expected",
      runId: "run_0",
      runIndex: 0,
      status: "completed",
      summary: { totalReturnRatio: 0.01 },
      marketRegime: { label: "bull" },
      dataAvailability: { status: "available" },
      window: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--expected-sampled-cpcv-split-count",
      "3",
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sampled_cpcv_split_count_matches_expected: false/);
  assert.match(result.stdout, /split count mismatch/);
  const report = JSON.parse(readFileSync(outputPath, "utf8")) as Record<
    string,
    unknown
  >;
  const diagnostics = report["overfittingDiagnostics"] as Record<
    string,
    unknown
  >;

  assert.equal(report["sourceSelectionTrialsPath"], null);
  assert.equal(report["trialSummary"], null);
  assert.equal(diagnostics["expectedSampledCpcvSplitCount"], 3);
  assert.equal(diagnostics["sampledCpcvSplitCount"], 0);
  assert.equal(diagnostics["sampledCpcvSplitCountMatchesExpected"], false);
});

test("historical batch replay CLI records validation split roles in aggregate report", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-split-cli-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-split-cli-output-")
  );
  const validationSplitsPath = join(outputBaseDir, "validation-splits.json");
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(
      snapshot("hist_005930_validation", "005930")
    )}\n`,
    "utf8"
  );
  writeFileSync(
    validationSplitsPath,
    `${JSON.stringify([validationAssignment("validation")], null, 2)}\n`,
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
      "batch-split-cli",
      "--seed",
      "seed-split",
      "--runs",
      "1",
      "--random-window-from",
      "2025-01-01T00:00:00+09:00",
      "--random-window-to",
      "2025-02-28T23:59:59.999+09:00",
      "--step-seconds",
      "604800",
      "--max-snapshot-age-seconds",
      String(31 * 24 * 60 * 60),
      "--validation-splits-path",
      validationSplitsPath
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
  const validationProtocol = manifest["validationProtocol"] as Record<
    string,
    unknown
  >;

  assert.equal(output["validationSplitsPath"], validationSplitsPath);
  assert.equal(output["windowSamplingMode"], "fixed_range");
  assert.deepEqual(validationProtocol["roleCounts"], { validation: 1 });
  assert.equal(
    (manifest["windowSampling"] as Record<string, unknown>)["mode"],
    "fixed_range"
  );
  assert.equal(
    (runRecords[0]?.["validationSplit"] as Record<string, unknown>)["splitRole"],
    "validation"
  );
  assert.equal(
    (runRecords[0]?.["window"] as Record<string, unknown>)["startAt"],
    "2025-01-31T15:00:00.000Z"
  );
  assert.equal(
    (runRecords[0]?.["window"] as Record<string, unknown>)["localStartDate"],
    "2025-02-01"
  );

  const aggregateReportPath = join(
    outputBaseDir,
    "batch-split-cli",
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
  assert.match(reportResult.stdout, /validation_split_role_counts/);
  const aggregateReport = JSON.parse(
    readFileSync(aggregateReportPath, "utf8")
  ) as Record<string, unknown>;
  assert.deepEqual(
    (aggregateReport["summary"] as Record<string, unknown>)[
      "validationSplitRoleCounts"
    ],
    { validation: 1 }
  );
  assert.equal(
    (
      (aggregateReport["byValidationSplitRole"] as Record<string, unknown>)[
        "validation"
      ] as Record<string, unknown>
    )["completedCount"],
    1
  );
});

test("historical batch report CLI rejects missing selection trial path value", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-missing-path",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--selection-trials-path",
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--selection-trials-path requires a value/);
});

test("historical batch report CLI reads explicit universe coverage report", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const coveragePath = join(batchDir, "coverage", "historical-universe-coverage.json");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  mkdirSync(join(batchDir, "coverage"), { recursive: true });
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-coverage",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );
  writeFileSync(
    coveragePath,
    `${JSON.stringify(universeCoverageReport())}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--universe-coverage-path",
      coveragePath,
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## Universe Coverage/);
  assert.match(result.stdout, /universe selection bias warning/);
  const report = JSON.parse(readFileSync(outputPath, "utf8")) as Record<
    string,
    unknown
  >;
  const coverage = report["universeCoverage"] as Record<string, unknown>;
  assert.equal(report["sourceUniverseCoveragePath"], coveragePath);
  assert.equal(coverage["status"], "insufficient");
  assert.match(
    JSON.stringify(coverage["warnings"]),
    /REQUIRED_UNIVERSE_SYMBOL_MISSING/
  );
});

test("historical batch report CLI rejects missing universe coverage path value", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-missing-coverage-path",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--universe-coverage-path",
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--universe-coverage-path requires a value/);
});

test("historical batch report CLI rejects invalid sampled CPCV split count", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-invalid-cpcv-count",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--expected-sampled-cpcv-split-count",
      "-1",
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--expected-sampled-cpcv-split-count must be a non-negative integer/
  );
});

test("historical batch report CLI rejects missing sampled CPCV split count value", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-missing-cpcv-count",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--expected-sampled-cpcv-split-count",
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--expected-sampled-cpcv-split-count requires a value/
  );
});

test("historical batch report CLI rejects malformed selection trial nested fields", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "historical-batch-report-cli-"));
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const trialsPath = join(batchDir, "batch-replay-selection-trials.jsonl");
  const outputPath = join(batchDir, "batch-replay-aggregate-report.json");
  writeFileSync(
    runsPath,
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-corrupt",
      runId: "run_0",
      runIndex: 0,
      status: "skipped",
      marketRegime: { label: "insufficient_data" },
      dataAvailability: { status: "insufficient" },
      window: {}
    })}\n`,
    "utf8"
  );
  writeFileSync(
    trialsPath,
    `${JSON.stringify({
      mode: "paper_only",
      trialSchemaVersion: "selection_trial.v1",
      trialId: "batch-corrupt:trial:000000:run_0",
      batchId: "batch-corrupt",
      runId: "run_0",
      runIndex: 0,
      runSeed: "seed:0",
      status: "skipped",
      startedAt: "2026-06-12T01:00:00.000Z",
      completedAt: null,
      skippedAt: "2026-06-12T01:00:01.000Z",
      failedAt: null,
      window: {},
      marketRegime: { label: "insufficient_data" },
      decisionProvider: {},
      config: {},
      outcome: {},
      selection: {},
      researchManifest: {}
    })}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReport.js"),
      "--runs-path",
      runsPath,
      "--selection-trials-path",
      trialsPath,
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid selection trial record at line 1/);
});

test("historical batch replay CLI applies paper strategy preset defaults and overrides", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-preset-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-preset-output-")
  );
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(snapshot("hist_005930_preset_001", "005930")),
      JSON.stringify(
        snapshot("hist_005930_preset_002", "005930", {
          observedAt: "2025-02-10T09:00:00+09:00"
        })
      )
    ].join("\n") + "\n",
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
      "batch-short-term-preset",
      "--seed",
      "seed-preset",
      "--runs",
      "1",
      "--random-window-from",
      "2025-02-01T00:00:00+09:00",
      "--random-window-to",
      "2025-02-28T23:59:59.999+09:00",
      "--strategy-preset",
      "short-term",
      "--min-window-snapshots",
      "1",
      "--min-snapshots-per-symbol",
      "1",
      "--max-decision-calls",
      "3",
      "--paper-stop-loss-ratio",
      "0.04"
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
  const trialRecords = readFileSync(String(output["selectionTrialsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const metadata = JSON.parse(
    readFileSync(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const configuration = metadata["configuration"] as Record<string, unknown>;
  const clock = configuration["clock"] as Record<string, unknown>;
  const samplingPolicy = configuration["samplingPolicy"] as Record<
    string,
    unknown
  >;
  const paperExitPolicy = configuration["paperExitPolicy"] as Record<
    string,
    unknown
  >;
  const trialConfig = trialRecords[0]?.["config"] as Record<string, unknown>;

  assert.equal(output["strategyPreset"], "short_term");
  assert.equal(output["riskProfile"], "aggressive_paper");
  assert.equal(manifest["strategyPreset"], "short_term");
  assert.equal(manifest["riskProfile"], "aggressive_paper");
  assert.equal(configuration["strategyPreset"], "short_term");
  assert.equal(configuration["riskProfile"], "aggressive_paper");
  assert.equal(clock["stepSeconds"], 86_400);
  assert.equal(samplingPolicy["decisionFrequency"], "once_per_day");
  assert.equal(samplingPolicy["maxDecisionCalls"], 3);
  assert.equal(paperExitPolicy["takeProfitMode"], "full_exit");
  assert.equal(paperExitPolicy["takeProfitRatio"], 0.06);
  assert.equal(paperExitPolicy["stopLossRatio"], 0.04);
  assert.equal(trialConfig["strategyPreset"], "short_term");
  assert.deepEqual(trialConfig["replayCadence"], {
    stepSeconds: 86_400,
    everyNSteps: null,
    candidateChangedOnly: false,
    decisionFrequency: "once_per_day",
    maxDecisionCalls: 3,
    timezoneOffsetMinutes: 540
  });
});

test("historical batch replay CLI rejects missing strategy preset value", () => {
  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReplay.js"),
      "--strategy-preset",
      "--runs",
      "1"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--strategy-preset requires a value/);
});

test("historical batch replay CLI applies hedge strategy preset risk policy", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-hedge-preset-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-hedge-preset-output-")
  );
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(
        snapshot("hist_005930_hedge_preset_001", "005930", {
          observedAt: "2025-01-15T09:00:00+09:00"
        })
      ),
      JSON.stringify(
        snapshot("hist_005930_hedge_preset_002", "005930", {
          observedAt: "2025-02-15T09:00:00+09:00"
        })
      ),
      JSON.stringify(
        snapshot("hist_005930_hedge_preset_003", "005930", {
          observedAt: "2025-03-15T09:00:00+09:00"
        })
      )
    ].join("\n") + "\n",
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
      "batch-hedge-preset",
      "--seed",
      "seed-hedge-preset",
      "--runs",
      "1",
      "--random-window-from",
      "2025-01-01T00:00:00+09:00",
      "--random-window-to",
      "2025-04-30T23:59:59.999+09:00",
      "--strategy-preset",
      "hedge",
      "--min-window-snapshots",
      "1",
      "--min-snapshots-per-symbol",
      "1"
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
  const trialRecords = readFileSync(String(output["selectionTrialsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const metadata = JSON.parse(
    readFileSync(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const configuration = metadata["configuration"] as Record<string, unknown>;
  const riskPolicy = configuration["riskPolicy"] as Record<string, unknown>;
  const paperExitPolicy = configuration["paperExitPolicy"] as Record<
    string,
    unknown
  >;
  const trialConfig = trialRecords[0]?.["config"] as Record<string, unknown>;

  assert.equal(output["strategyPreset"], "hedge");
  assert.equal(output["riskProfile"], "balanced");
  assert.equal(manifest["strategyPreset"], "hedge");
  assert.equal(configuration["strategyPreset"], "hedge");
  assert.equal(riskPolicy["maxStrategyBucketExposureRatio"], undefined);
  assert.deepEqual(riskPolicy["hedgePolicy"], {
    requireHedgeBucket: true,
    maxGrossExposureRatio: 0.65
  });
  assert.equal(paperExitPolicy["takeProfitRatio"], 0.1);
  assert.equal(paperExitPolicy["stopLossRatio"], 0.06);
  assert.equal(trialConfig["strategyPreset"], "hedge");
  assert.equal(
    trialConfig["riskPolicyHash"],
    createReplayResearchHash(riskPolicy)
  );
});

test("historical batch replay CLI defaults Codex budget to effective decision budget", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-preset-codex-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-preset-codex-output-")
  );
  const fakeCodexDir = mkdtempSync(join(tmpdir(), "fake-codex-cli-"));
  const fakeCodexLogPath = join(fakeCodexDir, "calls.jsonl");
  createFakeCodexExecScript(fakeCodexDir);
  const cliPath = join(
    process.cwd(),
    "dist",
    "cli",
    "historicalBatchReplay.js"
  );
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(snapshot("hist_005930_preset_codex_001", "005930")),
      JSON.stringify(
        snapshot("hist_005930_preset_codex_002", "005930", {
          observedAt: "2025-02-10T09:00:00+09:00"
        })
      )
    ].join("\n") + "\n",
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--source-data-dir",
      sourceDataDir,
      "--output-dir",
      outputBaseDir,
      "--batch-id",
      "batch-short-term-preset-codex",
      "--seed",
      "seed-preset-codex",
      "--runs",
      "1",
      "--random-window-from",
      "2025-02-01T00:00:00+09:00",
      "--random-window-to",
      "2025-02-28T23:59:59.999+09:00",
      "--strategy-preset",
      "short-term",
      "--min-window-snapshots",
      "1",
      "--min-snapshots-per-symbol",
      "1",
      "--max-decision-calls",
      "30",
      "--use-codex-ai",
      "--skip-codex-preflight"
    ],
    {
      cwd: fakeCodexDir,
      encoding: "utf8",
      env: {
        ...process.env,
        AI_DECISION_MODE: "paper_only",
        AI_DECISION_ENABLED: "true",
        CODEX_EXEC_PATH: process.execPath,
        CODEX_EXEC_TIMEOUT_SECONDS: "5",
        FAKE_CODEX_LOG_PATH: fakeCodexLogPath
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const trialRecords = readFileSync(String(output["selectionTrialsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const trialConfig = trialRecords[0]?.["config"] as Record<string, unknown>;
  const replayCadence = trialConfig["replayCadence"] as Record<
    string,
    unknown
  >;

  assert.equal(output["decisionProvider"], "codex_cli");
  assert.equal(output["maxCodexCallsPerRun"], 30);
  assert.equal(replayCadence["maxDecisionCalls"], 30);
});

test("historical universe coverage CLI writes a JSON coverage report", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-universe-source-"));
  const outputPath = join(dataDir, "historical-universe-coverage.json");
  const universePath = join(dataDir, "universe.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(
        snapshot("hist_005930_202501", "005930", {
          strategyBucket: "long_term"
        })
      ),
      JSON.stringify(
        snapshot("hist_000660_202501", "000660", {
          strategyBucket: "swing"
        })
      )
    ].join("\n") + "\n",
    "utf8"
  );
  writeFileSync(
    universePath,
    JSON.stringify(strategyBucketCoverageUniverse()),
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalUniverseCoverage.js"),
      "--data-dir",
      dataDir,
      "--universe-path",
      universePath,
      "--range-start",
      "2025-02-01T00:00:00+09:00",
      "--range-end",
      "2025-02-28T23:59:59.999+09:00",
      "--min-monthly-coverage-ratio",
      "1",
      "--require-strategy-buckets",
      "long_term,swing",
      "--min-available-strategy-bucket-symbols",
      "long_term:1,swing:1",
      "--output-path",
      outputPath,
      "--json"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const stdoutReport = JSON.parse(result.stdout) as Record<string, unknown>;
  const storedReport = JSON.parse(readFileSync(outputPath, "utf8")) as Record<
    string,
    unknown
  >;

  assert.equal(stdoutReport["status"], "available");
  assert.equal(storedReport["universeId"], "fixture-expanded");
  assert.deepEqual(storedReport["requiredStrategyBuckets"], [
    "long_term",
    "swing"
  ]);
  assert.deepEqual(storedReport["availableStrategyBuckets"], [
    "long_term",
    "swing"
  ]);
  assert.deepEqual(storedReport["availableStrategyBucketSymbolCounts"], {
    long_term: 1,
    swing: 1
  });
  assert.deepEqual(storedReport["missingOptionalSymbols"], [
    { market: "KR", symbol: "035420" }
  ]);
});

test("historical batch replay CLI can enforce optional universe symbols", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-universe-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-universe-output-")
  );
  const universePath = join(sourceDataDir, "universe.json");
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    [
      JSON.stringify(snapshot("hist_005930_202501", "005930")),
      JSON.stringify(snapshot("hist_000660_202501", "000660"))
    ].join("\n") + "\n",
    "utf8"
  );
  writeFileSync(universePath, JSON.stringify(universe()), "utf8");

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReplay.js"),
      "--source-data-dir",
      sourceDataDir,
      "--output-dir",
      outputBaseDir,
      "--batch-id",
      "batch-universe-cli",
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
      "--universe-path",
      universePath,
      "--require-optional-universe-symbols"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const runRecords = readFileSync(String(output["runsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(output["completedCount"], 0);
  assert.equal(output["skippedCount"], 1);
  assert.equal(runRecords[0]?.["skipReason"], "DATA_INSUFFICIENT");
  assert.deepEqual(
    (runRecords[0]?.["dataAvailability"] as Record<string, unknown>)["issues"],
    ["REQUIRED_SYMBOL_MISSING"]
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

test("historical batch replay CLI uses ephemeral Codex sessions per run", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-codex-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-codex-output-")
  );
  const fakeCodexDir = mkdtempSync(join(tmpdir(), "fake-codex-cli-"));
  const fakeCodexLogPath = join(fakeCodexDir, "calls.jsonl");
  createFakeCodexExecScript(fakeCodexDir);
  const cliPath = join(
    process.cwd(),
    "dist",
    "cli",
    "historicalBatchReplay.js"
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
      cliPath,
      "--source-data-dir",
      sourceDataDir,
      "--output-dir",
      outputBaseDir,
      "--batch-id",
      "batch-codex-ephemeral",
      "--seed",
      "seed-001",
      "--runs",
      "2",
      "--random-window-from",
      "2025-02-01T00:00:00+09:00",
      "--random-window-to",
      "2025-02-28T23:59:59.999+09:00",
      "--step-seconds",
      "604800",
      "--max-snapshot-age-seconds",
      String(31 * 24 * 60 * 60),
      "--max-decision-calls",
      "1",
      "--max-codex-calls-per-run",
      "1",
      "--use-codex-ai"
    ],
    {
      cwd: fakeCodexDir,
      encoding: "utf8",
      env: {
        ...process.env,
        AI_DECISION_MODE: "paper_only",
        AI_DECISION_ENABLED: "true",
        CODEX_EXEC_PATH: process.execPath,
        CODEX_EXEC_TIMEOUT_SECONDS: "5",
        FAKE_CODEX_LOG_PATH: fakeCodexLogPath
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const calls = readFileSync(fakeCodexLogPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { args: string[] });

  assert.equal(output["completedCount"], 2);
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.args.includes("--ephemeral")), true);
});

function snapshot(
  snapshotId: string,
  symbol: string,
  options: {
    market?: HistoricalMarketSnapshot["market"];
    observedAt?: string;
    sourceRefs?: string[];
    strategyBucket?: HistoricalMarketSnapshot["strategyBucket"];
  } = {}
): HistoricalMarketSnapshot {
  const observedAt = options.observedAt ?? "2025-02-03T09:00:00+09:00";
  return {
    snapshotId,
    market: options.market ?? "KR",
    symbol,
    observedAt,
    interval: "1m",
    ...(options.strategyBucket === undefined
      ? {}
      : { strategyBucket: options.strategyBucket }),
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: options.sourceRefs ?? [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function universeCoverageReport(): Record<string, unknown> {
  return {
    mode: "paper_only",
    universeId: "cli-test-universe",
    status: "insufficient",
    rangeStart: "2025-01-01T00:00:00.000Z",
    rangeEnd: "2025-01-31T14:59:59.999Z",
    timezoneOffsetMinutes: 540,
    expectedMonths: ["2025-01"],
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 2,
    minAvailableMarketSymbolCounts: { KR: 2 },
    minAvailableAssetTypeSymbolCounts: { STOCK: 2 },
    minAvailableStrategyBucketSymbolCounts: { long_term: 1 },
    requireOptionalSymbols: false,
    requiredMarkets: ["KR"],
    requiredAssetTypes: ["STOCK"],
    requiredStrategyBuckets: ["long_term"],
    availableMarkets: ["KR"],
    availableAssetTypes: ["STOCK"],
    availableStrategyBuckets: ["long_term"],
    availableSymbolCount: 1,
    availableMarketSymbolCounts: { KR: 1 },
    availableAssetTypeSymbolCounts: { STOCK: 1 },
    availableStrategyBucketSymbolCounts: { long_term: 1 },
    missingRequiredMarkets: [],
    missingRequiredAssetTypes: [],
    missingRequiredStrategyBuckets: [],
    insufficientAvailableMarketSymbolCounts: [
      { market: "KR", minimum: 2, available: 1 }
    ],
    insufficientAvailableAssetTypeSymbolCounts: [
      { assetType: "STOCK", minimum: 2, available: 1 }
    ],
    insufficientAvailableStrategyBucketSymbolCounts: [],
    corruptLineCount: 0,
    universeSymbolCount: 2,
    requiredSymbolCount: 2,
    optionalSymbolCount: 0,
    availableRequiredSymbolCount: 1,
    availableOptionalSymbolCount: 0,
    missingRequiredSymbols: [{ market: "KR", symbol: "MISSING_REQUIRED" }],
    missingOptionalSymbols: [],
    insufficientRequiredSymbols: [],
    insufficientOptionalSymbols: [],
    symbolSummaries: [],
    issues: ["REQUIRED_UNIVERSE_SYMBOL_MISSING"],
    disclaimer:
      "Paper-only historical universe coverage. This is not investment advice, not a performance guarantee, and not a live trading signal."
  };
}

function metaLabelEvaluationReport(): Record<string, unknown> {
  return {
    schemaVersion: "meta_label_evaluation.v1",
    generatedAt: "2026-07-06T00:00:00.000Z",
    candidates: [
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_cli_positive",
        sideDecision: "long",
        outcome: "correct_side",
        sizingDirective: null
      },
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_cli_negative",
        sideDecision: "long",
        outcome: "wrong_side",
        sizingDirective: null
      },
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_cli_unavailable",
        sideDecision: "unknown",
        outcome: "not_actionable",
        sizingDirective: null
      }
    ],
    summary: {
      totalCandidateCount: 3,
      actionableCandidateCount: 2,
      correctSideCount: 1,
      wrongSideCount: 1,
      notActionableCount: 1,
      accuracyRatio: 0.5
    }
  };
}

function tripleBarrierLabelArtifact(): Record<string, unknown> {
  return buildTripleBarrierLabelArtifact({
    generatedAt: "2026-07-06T00:00:00.000Z",
    config: {
      referencePriceField: "last",
      profitTakingReturnRatio: 0.05,
      stopLossReturnRatio: 0.03,
      timeBarrierDurationDays: 5
    },
    events: [
      tripleBarrierLabelEvent("cli_label_profit", "CLP"),
      tripleBarrierLabelEvent("cli_label_stop", "CLS"),
      tripleBarrierLabelEvent("cli_label_unavailable", "CLU")
    ],
    priceSnapshots: [
      tripleBarrierSnapshot("CLP", "2026-07-06T00:00:00.000Z", 100),
      tripleBarrierSnapshot("CLP", "2026-07-07T00:00:00.000Z", 106),
      tripleBarrierSnapshot("CLS", "2026-07-06T00:00:00.000Z", 100),
      tripleBarrierSnapshot("CLS", "2026-07-07T00:00:00.000Z", 96)
    ]
  });
}

function tripleBarrierLabelEvent(sampleId: string, symbol: string) {
  return {
    sampleId,
    symbol,
    market: "KR" as const,
    observationAt: "2026-07-06T00:00:00.000Z",
    labelStart: "2026-07-06T00:00:00.000Z"
  };
}

function tripleBarrierSnapshot(
  symbol: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId: `snapshot_${symbol}_${observedAt}`,
    market: "KR",
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    volume: 1_000,
    sourceRefs: [`fixture:${symbol}:${observedAt}`],
    createdAt: observedAt
  };
}

function validationAssignment(splitRole: "train" | "validation" | "test") {
  return {
    validationProtocol: "walk_forward",
    splitId: "wf_cli",
    splitIndex: 0,
    trainStart: "2024-12-31T15:00:00.000Z",
    trainEnd: "2025-01-31T14:59:59.999Z",
    validationStart: "2025-01-31T15:00:00.000Z",
    validationEnd: "2025-02-28T14:59:59.999Z",
    testStart:
      splitRole === "test" ? "2025-02-28T15:00:00.000Z" : null,
    testEnd:
      splitRole === "test" ? "2025-03-31T14:59:59.999Z" : null,
    purgeDurationDays: 0,
    embargoDurationDays: 0,
    splitRole
  };
}

function calendarFixture(input: { isHoliday: boolean }) {
  return {
    calendarId: "calendar.krx.2025-02-03",
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate: "2025-02-03",
    marketOpen: input.isHoliday ? null : "2025-02-03T00:00:00.000Z",
    marketClose: input.isHoliday ? null : "2025-02-03T06:30:00.000Z",
    isHoliday: input.isHoliday,
    ...(input.isHoliday ? { holidayName: "KRX holiday fixture" } : {}),
    sourceRefs: ["manual_calendar_fixture:KRX:2025-02-03"],
    createdAt: "2026-07-01T00:00:00.000Z"
  };
}

function fxFixture(input: { staleAfter?: string } = {}) {
  return {
    fxId: "fx.usdkrw.2025-02-02",
    pair: "USD/KRW",
    sourceSymbol: "KRW=X",
    observedAt: "2025-02-02T00:00:00.000Z",
    rate: 1460.25,
    staleAfter: input.staleAfter ?? "2025-02-04T00:00:00.000Z",
    sourceRefs: ["yahoo_fx:KRW=X:2025-02-02"],
    createdAt: "2026-07-01T00:00:00.000Z"
  };
}

function createFakeCodexExecScript(baseDir: string): void {
  const scriptPath = join(baseDir, "exec");
  writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const logPath = process.env.FAKE_CODEX_LOG_PATH;",
      "if (logPath) { fs.appendFileSync(logPath, JSON.stringify({ args: process.argv.slice(2) }) + '\\n'); }",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const parsed = JSON.parse(input);",
      "  const packet = parsed.marketPacket;",
      "  process.stdout.write(JSON.stringify({",
      "    packetId: packet.packetId,",
      "    packetHash: parsed.packetHash,",
      "    promptVersion: parsed.promptVersion,",
      "    modelId: parsed.modelId,",
      "    schemaVersion: parsed.schemaVersion,",
      "    policyVersion: parsed.policyVersion,",
      "    summary: 'fake Codex hold decision',",
      "    decisions: []",
      "  }));",
      "});"
    ].join("\n"),
    "utf8"
  );
}

function universe() {
  return {
    mode: "paper_only_historical_universe",
    universeId: "fixture-expanded",
    snapshotDate: "2025-01-01",
    symbols: [
      { market: "KR", symbol: "005930", required: true },
      { market: "KR", symbol: "000660", required: true },
      { market: "KR", symbol: "035420", required: false }
    ],
    disclaimer: "Paper-only fixture."
  };
}

function strategyBucketCoverageUniverse() {
  return {
    mode: "paper_only_historical_universe",
    universeId: "fixture-expanded",
    snapshotDate: "2025-01-01",
    symbols: [
      {
        market: "KR",
        symbol: "005930",
        strategyBucket: "long_term",
        required: true
      },
      {
        market: "KR",
        symbol: "000660",
        strategyBucket: "swing",
        required: true
      },
      {
        market: "KR",
        symbol: "035420",
        strategyBucket: "short_term",
        required: false
      }
    ],
    disclaimer: "Paper-only fixture."
  };
}
