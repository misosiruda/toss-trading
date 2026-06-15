import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualDecision
} from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { runHistoricalBatchReplay } from "./historicalBatchReplayWorkflow.js";

test("historical batch replay runner writes manifest and per-run records", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-smoke",
    seed: "seed-001",
    runCount: 2,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;
  const firstMetadata = JSON.parse(
    await readFile(
      join(
        String(firstRecord["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const firstIdentity = firstMetadata["identity"] as Record<string, unknown>;
  const firstWindow = firstMetadata["window"] as Record<string, unknown>;

  assert.equal(result.status, "completed");
  assert.equal(result.runCount, 2);
  assert.equal(result.completedCount, 2);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(manifest["status"], "completed");
  assert.equal(manifest["completedCount"], 2);
  assert.equal(manifest["riskProfile"], null);
  assert.equal(manifest["paperExitPolicy"], null);
  assert.equal(
    (manifest["windowSampling"] as Record<string, unknown>)["mode"],
    "random"
  );
  assert.equal(runRecords.length, 2);
  assert.equal(firstRecord["status"], "completed");
  assert.equal(
    (firstRecord["windowSampling"] as Record<string, unknown>)["mode"],
    "random"
  );
  assert.equal(
    (firstRecord["window"] as Record<string, unknown>)["selectedMonth"],
    "2025-02"
  );
  assert.equal(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["status"],
    "available"
  );
  assert.equal(
    (firstRecord["marketRegime"] as Record<string, unknown>)["label"],
    "bull"
  );
  assert.ok(firstRecord["summary"]);
  assert.equal(firstIdentity["batchId"], "batch-smoke");
  assert.equal(firstIdentity["runIndex"], 0);
  assert.equal(firstWindow["source"], "random_window");
  assert.equal(firstWindow["selectedMonth"], "2025-02");
});

test("historical batch replay runner skips insufficient windows", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-skip",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1
  });
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(firstRecord["status"], "skipped");
  assert.equal(firstRecord["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(firstRecord["reportPath"], null);
  assert.equal(
    (firstRecord["marketRegime"] as Record<string, unknown>)["label"],
    "insufficient_data"
  );
  assert.deepEqual(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["issues"],
    ["WINDOW_SNAPSHOT_MISSING", "WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM"]
  );
});

test("historical batch replay runner balances windows by market regime", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  for (const item of [
    snapshot("hist_005930_202501_001", "005930", "2025-01-03T09:00:00+09:00", 100),
    snapshot("hist_005930_202501_002", "005930", "2025-01-28T09:00:00+09:00", 106),
    snapshot("hist_005930_202502_001", "005930", "2025-02-03T09:00:00+09:00", 100),
    snapshot("hist_005930_202502_002", "005930", "2025-02-28T09:00:00+09:00", 94),
    snapshot("hist_005930_202503_001", "005930", "2025-03-03T09:00:00+09:00", 10_000),
    snapshot("hist_005930_202503_002", "005930", "2025-03-28T09:00:00+09:00", 10_050)
  ]) {
    await snapshotStore.append(item);
  }

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-balanced-regime",
    seed: "seed-001",
    runCount: 3,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    windowSamplingMode: "balanced_regime",
    targetRegimes: ["bull", "bear", "sideways"]
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const manifestWindowSampling = manifest["windowSampling"] as Record<
    string,
    unknown
  >;

  assert.equal(result.completedCount, 3);
  assert.equal(manifestWindowSampling["mode"], "balanced_regime");
  assert.deepEqual(manifestWindowSampling["activeTargetRegimes"], [
    "bull",
    "bear",
    "sideways"
  ]);
  assert.deepEqual(
    runRecords.map(
      (record) =>
        (record["windowSampling"] as Record<string, unknown>)["targetRegime"]
    ),
    ["bull", "bear", "sideways"]
  );
  assert.deepEqual(
    runRecords.map(
      (record) => (record["marketRegime"] as Record<string, unknown>)["label"]
    ),
    ["bull", "bear", "sideways"]
  );
});

test("historical batch replay runner can inject Codex-style provider per run", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );
  const factoryContexts: Array<Record<string, unknown>> = [];

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-codex",
    seed: "seed-001",
    runCount: 2,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxDecisionCalls: 1,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    decisionProviderFactory: (context) => {
      factoryContexts.push({
        batchId: context.batchId,
        runId: context.runId,
        runIndex: context.runIndex,
        runSeed: context.runSeed,
        selectedMonth: context.window.selectedMonth
      });
      return new FakeCodexBatchProvider();
    },
    decisionProviderMetadata: {
      mode: "codex_cli",
      maxCallsPerRun: 1,
      sandbox: "read-only",
      allowWebSearch: false,
      promptPolicy: "aggressive_paper",
      promptVersion: "paper-v11-historical-replay-aggressive-paper-v1"
    }
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const manifestProvider = manifest["decisionProvider"] as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);

  assert.equal(result.completedCount, 2);
  assert.equal(factoryContexts.length, 2);
  assert.deepEqual(
    factoryContexts.map((context) => context["runIndex"]),
    [0, 1]
  );
  assert.equal(manifestProvider["mode"], "codex_cli");
  assert.equal(manifestProvider["maxCallsPerRun"], 1);
  assert.equal(manifestProvider["promptPolicy"], "aggressive_paper");
  assert.equal(
    manifestProvider["promptVersion"],
    "paper-v11-historical-replay-aggressive-paper-v1"
  );
  assert.equal(
    (runRecords[0]?.["summary"] as Record<string, unknown>)["decisionProviderCallCount"],
    1
  );
});

test("historical batch replay runner records AI provider failures without failing completed replay", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-codex-provider-failure",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxDecisionCalls: 1,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    decisionProviderFactory: () => new FailingCodexBatchProvider()
  });
  const runRecords = await readJsonl(result.runsPath);
  const firstSummary = runRecords[0]?.["summary"] as Record<string, unknown>;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(runRecords[0]?.["status"], "completed");
  assert.equal(runRecords[0]?.["error"], null);
  assert.equal(firstSummary["decisionProviderCallCount"], 1);
  assert.equal(firstSummary["aiDecisionFailureCount"], 1);
  assert.equal(firstSummary["tradeCount"], 0);
  assert.match(String(runRecords[0]?.["reportPath"]), /historical-replay-report\.json$/);
});

test("historical batch replay runner records selected risk profile", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-aggressive-profile",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    riskProfile: "aggressive_paper",
    constraints: {
      maxNewPositions: 5,
      maxBudgetPerSymbolKrw: 400_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    riskPolicy: {
      maxBudgetPerDecisionKrw: 400_000,
      maxSymbolExposureKrw: 600_000,
      targetExposureRatio: 0.85,
      maxPositionWeightRatio: 0.65,
      minCashReserveRatio: 0.05,
      minCashReserveKrw: 0
    },
    allocationPolicy: {
      policyName: "aggressive_paper_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3
    },
    paperExitPolicy: {
      takeProfitRatio: 0.15,
      stopLossRatio: 0.08,
      rebalanceMaxPositionWeightRatio: 0.55
    }
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const metadata = JSON.parse(
    await readFile(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const configuration = metadata["configuration"] as Record<string, unknown>;
  const constraints = configuration["constraints"] as Record<string, unknown>;
  const riskPolicy = configuration["riskPolicy"] as Record<string, unknown>;
  const manifestAllocationPolicy = manifest["allocationPolicy"] as Record<
    string,
    unknown
  >;
  const allocationPolicy = configuration["allocationPolicy"] as Record<
    string,
    unknown
  >;
  const paperExitPolicy = configuration["paperExitPolicy"] as Record<
    string,
    unknown
  >;

  assert.equal(manifest["riskProfile"], "aggressive_paper");
  assert.deepEqual(manifest["paperExitPolicy"], {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08,
    rebalanceMaxPositionWeightRatio: 0.55
  });
  assert.equal(configuration["riskProfile"], "aggressive_paper");
  assert.equal(manifestAllocationPolicy["targetExposureRatio"], 0.85);
  assert.equal(allocationPolicy["policyName"], "aggressive_paper_allocation");
  assert.equal(allocationPolicy["targetExposureRatio"], 0.85);
  assert.equal(allocationPolicy["maxBudgetPerDecisionRatio"], 0.2);
  assert.equal(paperExitPolicy["takeProfitMode"], "full_exit");
  assert.equal(paperExitPolicy["takeProfitRatio"], 0.15);
  assert.equal(paperExitPolicy["stopLossRatio"], 0.08);
  assert.equal(paperExitPolicy["rebalanceMaxPositionWeightRatio"], 0.55);
  assert.equal(constraints["maxNewPositions"], 5);
  assert.equal(constraints["maxBudgetPerSymbolKrw"], 400_000);
  assert.equal(riskPolicy["maxBudgetPerDecisionKrw"], 400_000);
  assert.equal(riskPolicy["maxSymbolExposureKrw"], 600_000);
  assert.equal(riskPolicy["targetExposureRatio"], 0.85);
  assert.equal(riskPolicy["maxPositionWeightRatio"], 0.65);
  assert.equal(riskPolicy["minCashReserveRatio"], 0.05);
});

class FakeCodexBatchProvider {
  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    return {
      attempted: true,
      decision: decision(packet),
      failure: null,
      command: null
    };
  }
}

class FailingCodexBatchProvider {
  async decide(_packet: MarketPacket): Promise<CodexCliDecisionResult> {
    return {
      attempted: true,
      decision: null,
      failure: {
        code: "AI_DECISION_FAILED",
        reason: "fixture provider failure"
      },
      command: null
    };
  }
}

function decision(packet: MarketPacket): VirtualDecision {
  const candidate = packet.candidates[0];
  const symbol = candidate?.symbol ?? "005930";
  const dataRef = candidate?.sourceRefs[0] ?? `historical_snapshot:${symbol}`;

  return {
    packetId: packet.packetId,
    summary: "Injected Codex-style batch replay fixture.",
    decisions: [
      {
        market: "KR",
        symbol,
        action: "VIRTUAL_BUY",
        confidence: 0.6,
        budgetKrw: 70_000,
        thesis: "Fixture uses only the simulated historical packet.",
        riskFactors: ["Historical replay remains paper-only."],
        dataRefs: [dataRef],
        claimSupport: [
          {
            claim: "Fixture uses only the simulated historical packet.",
            dataRefs: [dataRef]
          }
        ],
        expiresAt: packet.expiresAt
      }
    ]
  };
}

function snapshot(
  snapshotId: string,
  symbol: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
