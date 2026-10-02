import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { VirtualDecision, VirtualPortfolio, VirtualRiskDecision, VirtualTrade } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { bindVirtualDecisionHash } from "../paper/decisionHash.js";
import { markPortfolioToMarket, pricePointsFromMarketPacket } from "../portfolio/markToMarket.js";
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
export async function writeExperimentEvidence(
  owner: Awaited<ReturnType<typeof createPaperExperimentAttempt>>, options: { nonempty?: boolean } = {}
) {
  const input = owner.input.normalizedInput;
  const generatedAt = new Date(input.evaluation.generatedAt);
  const configuration = JSON.parse(JSON.stringify(input.configuration)) as typeof input.configuration;
  const paths = createStoragePaths(owner.paths.replayDir);
  const start = configuration.clock.startAt;
  const window = { source: "explicit" as const, startAt: start, endAt: configuration.clock.endAt,
    rangeStart: null, rangeEnd: null, seed: null, selectedMonth: null, localStartDate: null, localEndDate: null,
    windowMonths: null, timezoneOffsetMinutes: 0 };
  const manifest = createReplayResearchManifest({ runId: owner.runId, createdAt: generatedAt,
    config: configuration, dataSnapshot: input.source.snapshots, universe: input.universe,
    coverage: owner.input.preflight, prompt: input.provider, schema: { fixture: 1 },
    riskPolicy: configuration.riskPolicy, costModel: input.costModel, executionModelVersion: PAPER_EXECUTION_MODEL_VERSION });
  const initialPortfolio: VirtualPortfolio = { portfolioId: "fixture-portfolio", cashKrw: configuration.initialCashKrw, positions: [], updatedAt: start };
  let portfolio = structuredClone(initialPortfolio);
  const decisions: VirtualDecision[] = []; const risks: VirtualRiskDecision[] = []; const trades: VirtualTrade[] = [];
  const tickCount = owner.input.preflight.tickCount;
  const metadataContext = { identity: { runId: owner.runId, batchId: null, runIndex: null }, window,
    configuration: JSON.parse(JSON.stringify(configuration)) };
  const audit = new HistoricalReplayAuditLogRecorder({ paths: {
    runMetadataPath: paths.historicalReplayRunMetadataPath, packetLogPath: paths.historicalReplayPacketLogPath,
    decisionLogPath: paths.historicalReplayDecisionLogPath, riskDecisionLogPath: paths.historicalReplayRiskDecisionLogPath,
    tradeLogPath: paths.historicalReplayTradeLogPath, portfolioTimelinePath: paths.historicalReplayPortfolioTimelinePath,
    researchManifestPath: paths.historicalReplayResearchManifestPath
  }, startedAt: generatedAt, tickCount, metadataContext, researchManifest: manifest });
  const progress = new HistoricalReplayProgressRecorder({ filePath: paths.historicalReplayProgressPath,
    startedAt: generatedAt, tickCount, initialPortfolio: portfolio });
  await writeFile(paths.historicalReplayResearchManifestPath, JSON.stringify(manifest));
  await audit.start(); await progress.start();
  const packets = [];
  const timeline = [];
  const ticks = new SimulatedClock({ startAt: new Date(start), endAt: new Date(configuration.clock.endAt),
    stepSeconds: configuration.clock.stepSeconds }).ticks();
  for (const tick of ticks) {
    const packet = new MarketPacketBuilder({ packetId: `fixture-${tick.stepIndex}`, generatedAt: new Date(tick.epochMs),
      expiresInSeconds: configuration.packetExpiresInSeconds, maxCandidates: configuration.maxCandidates,
      constraints: JSON.parse(JSON.stringify(configuration.constraints)) }).build({ portfolio, candidates: options.nonempty ? [{ market: "KR", symbol: "FIXTURE_A", lastPriceKrw: 10000,
        ranking: 1, sourceRefs: ["fixture:paper-experiment.v1"] }] : [] }).packet;
    packets.push(packet);
    if (options.nonempty) {
      const action = tick.stepIndex < 2 ? "VIRTUAL_BUY" as const : "VIRTUAL_HOLD" as const;
      decisions.push(bindVirtualDecisionHash({ packetId: packet.packetId, packetHash: createMarketPacketHash(packet),
        summary: "Stored synthetic decision", decisions: [{ market: "KR", symbol: "FIXTURE_A", action,
          confidence: 0.5, budgetKrw: action === "VIRTUAL_BUY" ? 10000 : 0,
          ...(action === "VIRTUAL_HOLD" ? { holdReasonCode: "INSUFFICIENT_EVIDENCE" as const } : {}),
          thesis: "Synthetic stored evidence", riskFactors: ["synthetic"], dataRefs: ["fixture:paper-experiment.v1"],
          expiresAt: packet.expiresAt }] }));
      if (tick.stepIndex < 2) risks.push({ riskDecisionId: `risk-${tick.stepIndex}`, packetId: packet.packetId,
        symbol: "FIXTURE_A", approved: tick.stepIndex === 0,
        rejectCodes: tick.stepIndex === 0 ? [] : ["VIRTUAL_REGIME_CASH_RESERVE_BREACHED"],
        checkedRules: ["fixture-rule"], createdAt: tick.simulatedAt });
      if (tick.stepIndex === 0) {
        trades.push({ tradeId: "trade-0", packetId: packet.packetId, decisionId: "risk-0", market: "KR", symbol: "FIXTURE_A",
          action: "VIRTUAL_BUY", quantity: 1, priceKrw: 10000, amountKrw: 10000, feeKrw: 0, taxKrw: 0,
          slippageKrw: 0, totalCostKrw: 0, fillStatus: "filled", status: "VIRTUAL_FILLED", executedAt: tick.simulatedAt });
        portfolio = { ...portfolio, cashKrw: configuration.initialCashKrw - 10000,
          positions: [{ market: "KR", symbol: "FIXTURE_A", quantity: 1, averagePriceKrw: 10000, updatedAt: tick.simulatedAt }] };
      }
      portfolio = markPortfolioToMarket({ portfolio, prices: pricePointsFromMarketPacket(packet), asOf: new Date(tick.epochMs) });
    }
    const rejectedCount = risks.filter((row) => !row.approved).length;
    const update = { simulatedAt: new Date(tick.epochMs), tick, tickCount, packetCount: packets.length,
      decisionProviderCallCount: decisions.length, decisionSkippedCount: 0, decisionRecordCount: decisions.length,
      tradeCount: trades.length, riskDecisionCount: risks.length, riskApprovedCount: risks.length - rejectedCount, rejectedCount,
      currentPortfolio: portfolio, packets, decisions, riskDecisions: risks, trades };
    await audit.record(update); await progress.record(update);
    timeline.push({ simulatedAt: tick.simulatedAt, cashKrw: portfolio.cashKrw, positionCount: portfolio.positions.length,
      positionMarketValueKrw: options.nonempty ? 10000 : 0, virtualNetWorthKrw: portfolio.cashKrw + (options.nonempty ? 10000 : 0) });
  }
  const result: HistoricalReplayResult = {
    status: "completed", mode: "paper_only", tickCount, packetCount: packets.length, decisionProviderCallCount: decisions.length,
    decisionSkippedCount: 0, decisionRecordCount: decisions.length, decisionItemCount: decisions.length, tradeCount: trades.length,
    rejectedCount: risks.filter((row) => !row.approved).length, packets, decisions, riskDecisions: risks, trades, auditEvents: [], warnings: [],
    samplingPolicy: JSON.parse(JSON.stringify(configuration.samplingPolicy)),
    allocationPolicy: JSON.parse(JSON.stringify(configuration.allocationPolicy)), paperExitPolicy: null,
    samplingDecisions: [], progressSummary: { totalTicks: tickCount, packetsCreated: packets.length,
      decisionsRequested: decisions.length, decisionsSkipped: 0, tradesCreated: trades.length, maxCandidatesPerStep: options.nonempty ? 1 : 0 },
    initialPortfolio, finalPortfolio: portfolio, portfolioTimeline: timeline
  };
  const report = buildHistoricalReplayReport({ result, generatedAt,
    researchManifest: manifest, researchManifestPath: paths.historicalReplayResearchManifestPath });
  await writeFile(paths.historicalReplayReportPath, JSON.stringify(report));
  await progress.complete({ completedAt: generatedAt, finalReportPath: paths.historicalReplayReportPath });
  await audit.complete(generatedAt);
  return paths;
}
