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
      "--paper-take-profit-ratio",
      "0.15",
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
      "aggressive_paper",
      "--paper-take-profit-ratio",
      "0.15",
      "--paper-stop-loss-ratio",
      "0.08",
      "--paper-rebalance-max-position-weight-ratio",
      "0.55",
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

  assert.equal(output["status"], "completed");
  assert.equal(output["completedCount"], 1);
  assert.equal(output["riskProfile"], "aggressive_paper");
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
  const runConfiguration = runMetadata["configuration"] as Record<
    string,
    unknown
  >;
  const runConstraints = runConfiguration["constraints"] as Record<
    string,
    unknown
  >;
  assert.equal(runConfiguration["riskProfile"], "aggressive_paper");
  assert.deepEqual(runConfiguration["paperExitPolicy"], {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08,
    rebalanceMaxPositionWeightRatio: 0.55
  });
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
  assert.equal(summary["runCount"], 1);
  assert.equal(summary["completedCount"], 1);
  assert.equal(output["decisionProvider"], "deterministic_fixture");
  assert.equal(output["maxCodexCallsPerRun"], null);
  assert.equal(
    (manifest["decisionProvider"] as Record<string, unknown>)["mode"],
    "deterministic_fixture"
  );
});

test("historical universe coverage CLI writes a JSON coverage report", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-universe-source-"));
  const outputPath = join(dataDir, "historical-universe-coverage.json");
  const universePath = join(dataDir, "universe.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
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
    symbols: [
      { market: "KR", symbol: "005930", required: true },
      { market: "KR", symbol: "000660", required: true },
      { market: "KR", symbol: "035420", required: false }
    ],
    disclaimer: "Paper-only fixture."
  };
}
