import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";

import { virtualTradeSchema, type MarketPacket } from "../domain/schemas.js";
import { historicalReplayRunMetadataSchema } from "../replay/historicalReplayAuditLog.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import type { HistoricalReplayReport } from "../reports/historicalReplayReport.js";
import { readPaperSimulationRequest } from "../storage/paperSimulationRequestStore.js";
import { readPaperSimulationInput } from "../storage/paperSimulationInputStore.js";
import { readPaperSimulationObservation } from "../storage/paperSimulationObservationStore.js";
import { createBatchReplayArtifactPaths } from "../storage/artifactPaths.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import type { BatchReplayManifest, BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";
import { createPaperSimulationRun } from "./paperSimulationRuns.js";
import { validatePaperSimulationCandidate } from "./paperSimulationConfig.js";
import { simulationConfig } from "./paperSimulationTestFixtures.js";

test("default runner persists the validated effective contract on synthetic fixed and random replays", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-runner-contract-"));
  await mkdir("data", { recursive: true });
  const source = await mkdtemp(join("data", "ux02a-fixture-"));
  const sourcePaths = createStoragePaths(source);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(sourcePaths.historicalMarketSnapshotsPath);
  for (const market of ["KR", "US"] as const) {
    await snapshotStore.append({
      snapshotId: `hist_ux02a_${market}`, market, symbol: market === "KR" ? "005930" : "AAPL",
      observedAt: "2024-01-01T00:00:00+09:00", interval: "1d",
      lastPriceKrw: 70_000, volume: 100_000,
      sourceRefs: [`fixture:ux02a_${market}`], createdAt: "2024-01-01T00:00:00+09:00"
    });
  }
  try {
    for (const [caseName, mode, executionCosts] of [
      ["fixed-default", "fixed_range", undefined],
      ["random-default", "random_month", undefined],
      ["fixed-explicit-costs", "fixed_range", { feeBps: 12.5, taxBps: 25, slippageBps: 5.5 }]
    ] as const) {
      const config = simulationConfig();
      if (executionCosts !== undefined) config.executionCosts = executionCosts;
      config.sourceDataDir = relative(process.cwd(), source) || source;
      config.universe.market = mode === "fixed_range" ? "kr" : "mixed_global";
      config.riskProfile = "balanced";
      config.paperExitPolicy = "take_profit_stop_loss";
      config.window.mode = mode;
      config.window.endAt = mode === "fixed_range" ? "2024-01-02" : "2024-01-31";
      config.samplingPolicy.maxDecisionCalls = 2;
      const validated = validatePaperSimulationCandidate(config, {});
      const accepted = await createPaperSimulationRun(config, {
        storageBaseDir: join(root, caseName, "paper"), env: {},
        now: () => new Date("2026-10-02T00:00:00.000Z")
      });
      assert.deepEqual(accepted.effectiveConfig, validated.effectiveConfig);
      assert.equal(accepted.status, "accepted");
      const canonical = await readPaperSimulationRequest(join(root, caseName, "paper"), accepted.batchId);
      assert.equal(canonical.status, "available");
      assert.deepEqual(canonical.status === "available" && canonical.requestedConfig, config);
      const admission = await readPaperSimulationInput(join(root, caseName, "paper"), accepted.batchId);
      assert.equal(admission.status, "available");
      assert.deepEqual(admission.status === "available" && admission.snapshot,
        { requestedConfig: validated.requestedConfig, effectiveConfig: validated.effectiveConfig, notices: validated.notices });
      assert.equal(admission.comparability, "unavailable");
      const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
      const manifest = await waitForManifest(paths.manifestPath);
      assert.equal(manifest.status, "completed");
      assert.equal(manifest.completedCount, 1);
      assert.equal(manifest.batchId, accepted.simulationRunId);
      const observation = await readPaperSimulationObservation(join(root, caseName, "paper"), accepted.simulationRunId);
      assert.equal(observation.status, "available");
      assert.equal(observation.status === "available" && observation.outcome, "unknown");
      assert.equal(manifest.sourceDataDir, config.sourceDataDir);
      assert.equal(manifest.runCount, validated.effectiveConfig.runCount);
      assert.equal(manifest.initialCashKrw, validated.effectiveConfig.capital.initialCashKrw);
      assert.deepEqual(manifest.allocationPolicy, validated.effectiveConfig.allocationPolicy);
      assert.deepEqual(manifest.paperExitPolicy, validated.effectiveConfig.paperExitPolicy);
      const records = (await readFile(paths.runsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as BatchReplayRunRecord);
      const run = records[0]!;
      assert.equal(run.batchId, accepted.batchId);
      assert.equal(run.status, "completed");
      assert.equal(run.window.startAt, validated.effectiveConfig.window.rangeStartAt);
      assert.equal(run.window.endAt, validated.effectiveConfig.window.rangeEndAt);
      const runPaths = createStoragePaths(run.storageBaseDir);
      const metadata = historicalReplayRunMetadataSchema.parse(JSON.parse(await readFile(runPaths.historicalReplayRunMetadataPath, "utf8")));
      const effective = validated.effectiveConfig;
      assert.equal(metadata.identity.runId, run.runId);
      assert.equal(metadata.identity.batchId, accepted.batchId);
      const initial = JSON.parse(await readFile(join(run.storageBaseDir, "historical-replay-initial-portfolio.json"), "utf8"));
      assert.deepEqual(initial.identity, metadata.identity);
      assert.equal(initial.initialPortfolio.status, "recorded");
      assert.equal(initial.initialPortfolio.snapshot.cashKrw, effective.capital.initialCashKrw);
      assert.deepEqual(initial.initialPortfolio.snapshot.positions, []);
      assert.equal(initial.completeInput, false);
      assert.equal(initial.comparability, "unavailable");
      assert.equal(metadata.configuration.clock.stepSeconds, effective.samplingPolicy.stepSeconds);
      assert.equal(metadata.configuration.samplingPolicy?.decisionFrequency, effective.samplingPolicy.decisionFrequency);
      assert.equal(metadata.configuration.samplingPolicy?.maxDecisionCalls, effective.samplingPolicy.maxDecisionCalls);
      assert.equal(metadata.configuration.samplingPolicy?.timezoneOffsetMinutes, effective.window.timezoneOffsetMinutes);
      assert.deepEqual(metadata.configuration.executionPolicy, effective.costModel.executionPolicy);
      assert.deepEqual(metadata.configuration.constraints, effective.constraints);
      assert.deepEqual(metadata.configuration.riskPolicy, effective.riskPolicy);
      assert.equal(metadata.configuration.riskProfile, effective.riskProfile);
      const research = JSON.parse(await readFile(runPaths.historicalReplayResearchManifestPath, "utf8")) as Record<string, unknown>;
      assert.equal(research["costModelHash"], createReplayResearchHash(effective.costModel));
      const report = JSON.parse(await readFile(runPaths.historicalReplayReportPath, "utf8")) as HistoricalReplayReport;
      assert.ok(report.benchmarks.cashOnly);
      assert.ok(report.benchmarks.equalWeightBuyAndHold);
      assert.ok(report.benchmarks.initialPortfolioBuyAndHold);
      if (executionCosts === undefined) {
        assert.equal(report.costSummary.totalCostKrw, 0);
      } else {
        const trades = (await readFile(runPaths.historicalReplayTradeLogPath, "utf8")).trim().split("\n")
          .map(line => virtualTradeSchema.parse(JSON.parse(line)));
        assert.ok(report.costSummary.feeKrw > 0);
        assert.ok(report.costSummary.slippageKrw > 0);
        assert.equal(report.costSummary.totalCostKrw, trades.reduce((total, trade) => total + (trade.totalCostKrw ?? 0), 0));
        assert.equal(report.costSummary.spreadCostKrw, 0);
        assert.equal(report.costSummary.impactCostKrw, 0);
      }
      const packets = (await readFile(runPaths.historicalReplayPacketLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as MarketPacket);
      assert.deepEqual([...new Set(packets.flatMap((packet) => packet.candidates.map((candidate) => candidate.market)))].sort(), ["KR", "US"]);
    }
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("default runner keeps skipped partial research evidence separate from accepted observation", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-skipped-contract-"));
  await mkdir("data", { recursive: true });
  const source = await mkdtemp(join("data", "ux02b-empty-fixture-"));
  const storageBaseDir = join(root, "paper");
  try {
    const config = simulationConfig();
    config.sourceDataDir = relative(process.cwd(), source);
    config.window.mode = "fixed_range";
    config.window.endAt = "2024-01-02";
    const accepted = await createPaperSimulationRun(config, {
      storageBaseDir, env: {}, now: () => new Date("2026-10-02T00:00:00.000Z")
    });
    const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
    const manifest = await waitForManifest(paths.manifestPath);
    assert.equal(manifest.status, "completed");
    assert.equal(manifest.completedCount, 0);
    assert.equal(manifest.skippedCount, 1);
    assert.equal(manifest.failedCount, 0);
    const records = (await readFile(paths.runsPath, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as BatchReplayRunRecord);
    assert.equal(records[0]?.status, "skipped");
    assert.equal(records[0]?.researchManifest.status, "partial");
    assert.equal(records[0]?.skipReason, "DATA_INSUFFICIENT");
    const observation = await readPaperSimulationObservation(storageBaseDir, accepted.simulationRunId);
    assert.equal(observation.status === "available" && observation.outcome, "unknown");
    assert.equal(observation.status === "available" && observation.runnerFailure, null);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForManifest(path: string): Promise<BatchReplayManifest> {
  const deadline = performance.now() + 10000;
  let last: BatchReplayManifest | undefined;
  while (performance.now() < deadline) {
    try {
      last = JSON.parse(await readFile(path, "utf8")) as BatchReplayManifest;
      if (last.status !== "running") return last;
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await setTimeout(10);
  }
  throw new Error(`fixture runner did not finish: ${JSON.stringify(last)}`);
}
