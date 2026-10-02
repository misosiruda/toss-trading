import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MarketPacketBuilder } from "../market/packetBuilder.js";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildHistoricalReplayReport } from "../reports/historicalReplayReport.js";
import { HistoricalReplayAuditLogRecorder } from "../replay/historicalReplayAuditLog.js";
import { HistoricalReplayProgressRecorder } from "../replay/historicalReplayProgress.js";
import type { HistoricalReplayResult } from "../replay/historicalReplayRunner.js";
import { createReplayResearchHash, createReplayResearchManifest } from "../replay/replayRunManifest.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { createStoragePaths } from "./repositories.js";
import type { createPaperExperimentAttempt } from "./paperExperimentStore.js";

export const EXPERIMENT_TEST_RUNTIME = {
  implementationRevision: "1".repeat(40), dependencyLockHash: createReplayResearchHash({ fixture: "lock" }), nodeVersion: "v24.19.0"
};
export const EXPERIMENT_TEST_TIME = new Date("2026-10-02T00:00:00.000Z");
export async function experimentFixtureJson() {
  return readFile(join(process.cwd(), "src/replay/fixtures/paper-experiment.v1.json"), "utf8");
}

/** Stored synthetic evidence only: no workflow, runner, provider, Risk engine or order execution. */
export async function writeExperimentEvidence(owner: Awaited<ReturnType<typeof createPaperExperimentAttempt>>) {
  const input = owner.input.normalizedInput;
  const configuration = JSON.parse(JSON.stringify(input.configuration)) as typeof input.configuration;
  const paths = createStoragePaths(owner.paths.replayDir);
  const start = configuration.clock.startAt;
  const window = { source: "explicit" as const, startAt: start, endAt: configuration.clock.endAt,
    rangeStart: null, rangeEnd: null, seed: null, selectedMonth: null, localStartDate: null, localEndDate: null,
    windowMonths: null, timezoneOffsetMinutes: 0 };
  const manifest = createReplayResearchManifest({ runId: owner.runId, createdAt: EXPERIMENT_TEST_TIME,
    config: configuration, dataSnapshot: input.source.snapshots, universe: input.universe,
    coverage: owner.input.preflight, prompt: input.provider, schema: { fixture: 1 },
    riskPolicy: configuration.riskPolicy, costModel: input.costModel, executionModelVersion: PAPER_EXECUTION_MODEL_VERSION });
  const portfolio = { portfolioId: "fixture-portfolio", cashKrw: configuration.initialCashKrw, positions: [], updatedAt: start };
  const tickCount = owner.input.preflight.tickCount;
  const metadataContext = { identity: { runId: owner.runId, batchId: null, runIndex: null }, window,
    configuration: JSON.parse(JSON.stringify(configuration)) };
  const audit = new HistoricalReplayAuditLogRecorder({ paths: {
    runMetadataPath: paths.historicalReplayRunMetadataPath, packetLogPath: paths.historicalReplayPacketLogPath,
    decisionLogPath: paths.historicalReplayDecisionLogPath, riskDecisionLogPath: paths.historicalReplayRiskDecisionLogPath,
    tradeLogPath: paths.historicalReplayTradeLogPath, portfolioTimelinePath: paths.historicalReplayPortfolioTimelinePath,
    researchManifestPath: paths.historicalReplayResearchManifestPath
  }, startedAt: EXPERIMENT_TEST_TIME, tickCount, metadataContext, researchManifest: manifest });
  const progress = new HistoricalReplayProgressRecorder({ filePath: paths.historicalReplayProgressPath,
    startedAt: EXPERIMENT_TEST_TIME, tickCount, initialPortfolio: portfolio });
  await writeFile(paths.historicalReplayResearchManifestPath, JSON.stringify(manifest));
  await audit.start(); await progress.start();
  const packets = [];
  const timeline = [];
  const ticks = new SimulatedClock({ startAt: new Date(start), endAt: new Date(configuration.clock.endAt),
    stepSeconds: configuration.clock.stepSeconds }).ticks();
  for (const tick of ticks) {
    const packet = new MarketPacketBuilder({ packetId: `fixture-${tick.stepIndex}`, generatedAt: new Date(tick.epochMs),
      expiresInSeconds: configuration.packetExpiresInSeconds, maxCandidates: configuration.maxCandidates,
      constraints: JSON.parse(JSON.stringify(configuration.constraints)) }).build({ portfolio, candidates: [] }).packet;
    packets.push(packet);
    const update = { simulatedAt: new Date(tick.epochMs), tick, tickCount, packetCount: packets.length,
      decisionProviderCallCount: 0, decisionSkippedCount: packets.length, decisionRecordCount: 0,
      tradeCount: 0, riskDecisionCount: 0, riskApprovedCount: 0, rejectedCount: 0,
      currentPortfolio: portfolio, packets, decisions: [], riskDecisions: [], trades: [] };
    await audit.record(update); await progress.record(update);
    timeline.push({ simulatedAt: tick.simulatedAt, cashKrw: portfolio.cashKrw, positionCount: 0,
      positionMarketValueKrw: 0, virtualNetWorthKrw: portfolio.cashKrw });
  }
  const result: HistoricalReplayResult = {
    status: "completed", mode: "paper_only", tickCount, packetCount: packets.length, decisionProviderCallCount: 0,
    decisionSkippedCount: packets.length, decisionRecordCount: 0, decisionItemCount: 0, tradeCount: 0,
    rejectedCount: 0, packets, decisions: [], riskDecisions: [], trades: [], auditEvents: [], warnings: [],
    samplingPolicy: JSON.parse(JSON.stringify(configuration.samplingPolicy)),
    allocationPolicy: JSON.parse(JSON.stringify(configuration.allocationPolicy)), paperExitPolicy: null,
    samplingDecisions: [], progressSummary: { totalTicks: tickCount, packetsCreated: packets.length,
      decisionsRequested: 0, decisionsSkipped: packets.length, tradesCreated: 0, maxCandidatesPerStep: 0 },
    initialPortfolio: portfolio, finalPortfolio: portfolio, portfolioTimeline: timeline
  };
  const report = buildHistoricalReplayReport({ result, generatedAt: EXPERIMENT_TEST_TIME,
    researchManifest: manifest, researchManifestPath: paths.historicalReplayResearchManifestPath });
  await writeFile(paths.historicalReplayReportPath, JSON.stringify(report));
  await progress.complete({ completedAt: EXPERIMENT_TEST_TIME, finalReportPath: paths.historicalReplayReportPath });
  await audit.complete(EXPERIMENT_TEST_TIME);
  return paths;
}
