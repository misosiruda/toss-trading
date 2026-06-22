import type {
  HistoricalMarketSnapshot,
  MarketPacket
} from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import { createPaperExecutionPolicy } from "../paper/executionModel.js";
import {
  buildHistoricalReplayReport,
  type HistoricalReplayReport
} from "../reports/historicalReplayReport.js";
import {
  createReplayResearchManifest,
  type ReplayResearchManifestReference,
  replayResearchManifestReference
} from "../replay/replayRunManifest.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore,
  FileVirtualPortfolioStore
} from "../storage/repositories.js";
import {
  FirstPricedHistoricalDecisionProvider,
  type HistoricalReplayDecisionContext,
  type HistoricalReplayResult
} from "../replay/historicalReplayRunner.js";
import {
  runCodexHistoricalReplay,
  type CodexHistoricalReplayDecisionProviderLike
} from "../replay/codexHistoricalReplayRunner.js";
import { HistoricalReplayAuditLogRecorder } from "../replay/historicalReplayAuditLog.js";
import { HistoricalReplayProgressRecorder } from "../replay/historicalReplayProgress.js";
import {
  createHistoricalReplayWorkflowPlan,
  type HistoricalReplayWorkflowPlan,
  type HistoricalReplayWorkflowOptions
} from "./historicalReplayWorkflowPlan.js";
import {
  writeHistoricalReplayReportArtifact,
  writeReplayResearchManifestArtifact
} from "./historicalReplayWorkflowArtifacts.js";

export type { HistoricalReplayWorkflowOptions } from "./historicalReplayWorkflowPlan.js";

export interface HistoricalReplayWorkflowResult {
  status: "completed";
  mode: "paper_only";
  reportPath: string;
  researchManifestPath: string;
  researchManifest: ReplayResearchManifestReference;
  report: HistoricalReplayReport;
  replayResult: HistoricalReplayResult;
}

export async function runHistoricalReplayWorkflow(
  options: HistoricalReplayWorkflowOptions
): Promise<HistoricalReplayWorkflowResult> {
  const paths = createStoragePaths(options.storageBaseDir);
  const historicalMarketSnapshotsPath =
    options.historicalMarketSnapshotsPath ?? paths.historicalMarketSnapshotsPath;
  const [portfolio, snapshots] = await Promise.all([
    new FileVirtualPortfolioStore(paths.virtualPortfolioPath).read(),
    new FileHistoricalMarketSnapshotStore(historicalMarketSnapshotsPath).readAll()
  ]);
  const replayStartedAt = options.generatedAt ?? new Date();
  const decisionProvider =
    options.decisionProvider ?? new FirstPricedCodexHistoricalDecisionProvider();
  const plan = createHistoricalReplayWorkflowPlan({
    options,
    storedPortfolio: portfolio,
    snapshots: snapshots.records,
    replayStartedAt,
    decisionProvider
  });
  const researchManifest = createWorkflowResearchManifest({
    plan,
    snapshots: snapshots.records,
    corruptLineCount: snapshots.corruptLineCount,
    decisionProviderMetadata: options.decisionProviderMetadata,
    createdAt: replayStartedAt
  });
  const researchManifestRef = replayResearchManifestReference({
    manifest: researchManifest,
    manifestPath: paths.historicalReplayResearchManifestPath
  });
  const progressRecorder = new HistoricalReplayProgressRecorder({
    filePath: paths.historicalReplayProgressPath,
    startedAt: replayStartedAt,
    tickCount: plan.tickCount,
    initialPortfolio: plan.initialPortfolio
  });
  const auditLogRecorder = new HistoricalReplayAuditLogRecorder({
    paths: {
      runMetadataPath: paths.historicalReplayRunMetadataPath,
      packetLogPath: paths.historicalReplayPacketLogPath,
      decisionLogPath: paths.historicalReplayDecisionLogPath,
      riskDecisionLogPath: paths.historicalReplayRiskDecisionLogPath,
      tradeLogPath: paths.historicalReplayTradeLogPath,
      portfolioTimelinePath: paths.historicalReplayPortfolioTimelinePath,
      researchManifestPath: paths.historicalReplayResearchManifestPath
    },
    startedAt: replayStartedAt,
    tickCount: plan.tickCount,
    metadataContext: plan.metadataContext,
    researchManifest
  });

  await writeReplayResearchManifestArtifact({
    manifestPath: paths.historicalReplayResearchManifestPath,
    manifest: researchManifest
  });
  await Promise.all([progressRecorder.start(), auditLogRecorder.start()]);

  try {
    const replayResult = await runCodexHistoricalReplay(
      {
        ...plan.runnerOptions,
        onProgress: async (update) => {
          await progressRecorder.record(update);
          await auditLogRecorder.record(update);
        }
      },
      plan.replayInput
    );
    const reportGeneratedAt = options.generatedAt ?? new Date();
    const report = buildHistoricalReplayReport({
      result: replayResult,
      generatedAt: reportGeneratedAt,
      researchManifest,
      researchManifestPath: paths.historicalReplayResearchManifestPath
    });

    await writeHistoricalReplayReportArtifact({
      reportPath: paths.historicalReplayReportPath,
      report
    });
    await progressRecorder.complete({
      completedAt: reportGeneratedAt,
      finalReportPath: paths.historicalReplayReportPath
    });
    await auditLogRecorder.complete(reportGeneratedAt);

    return {
      status: "completed",
      mode: "paper_only",
      reportPath: paths.historicalReplayReportPath,
      researchManifestPath: paths.historicalReplayResearchManifestPath,
      researchManifest: researchManifestRef,
      report,
      replayResult
    };
  } catch (error) {
    await progressRecorder.fail(error);
    await auditLogRecorder.fail(error);
    throw error;
  }
}

function createWorkflowResearchManifest(input: {
  plan: HistoricalReplayWorkflowPlan;
  snapshots: HistoricalMarketSnapshot[];
  corruptLineCount: number;
  decisionProviderMetadata: unknown;
  createdAt: Date;
}) {
  const metadata = input.plan.metadataContext;
  return createReplayResearchManifest({
    runId: metadata.identity.runId,
    batchId: metadata.identity.batchId,
    createdAt: input.createdAt,
    config: {
      window: metadata.window,
      configuration: metadata.configuration
    },
    dataSnapshot: {
      source: "historical_market_snapshots",
      corruptLineCount: input.corruptLineCount,
      snapshots: input.snapshots
        .map((snapshot) => ({
          snapshotId: snapshot.snapshotId,
          market: snapshot.market,
          symbol: snapshot.symbol,
          observedAt: snapshot.observedAt,
          interval: snapshot.interval,
          lastPriceKrw: snapshot.lastPriceKrw ?? null,
          volume: snapshot.volume ?? null
        }))
        .sort(compareSnapshotManifestEntry)
    },
    universe: summarizeReplayUniverse(input.snapshots),
    coverage: {
      tickCount: input.plan.tickCount,
      window: metadata.window,
      snapshotCount: input.snapshots.length,
      corruptLineCount: input.corruptLineCount
    },
    prompt: input.decisionProviderMetadata ?? {
      mode: "deterministic_fixture",
      promptPolicy: null,
      promptVersion: null
    },
    schema: {
      replayResearchManifestVersion: "replay_research_manifest.v1",
      historicalReplayRunMetadata: "historical_replay_run_metadata.v1",
      historicalReplayReport: "historical_replay_report.v1"
    },
    riskPolicy: {
      riskProfile: metadata.configuration.riskProfile,
      riskPolicy: metadata.configuration.riskPolicy,
      allocationPolicy: metadata.configuration.allocationPolicy,
      marketRegimeAllocationPolicy:
        metadata.configuration.marketRegimeAllocationPolicy,
      paperExitPolicy: metadata.configuration.paperExitPolicy
    },
    costModel: {
      executionPolicy: createPaperExecutionPolicy(undefined)
    },
    executionModelVersion: "execution_simulator.v0"
  });
}

function summarizeReplayUniverse(
  snapshots: Array<{ market: string; symbol: string }>
): Array<{ market: string; symbol: string }> {
  const seen = new Set<string>();
  const universe: Array<{ market: string; symbol: string }> = [];
  for (const snapshot of snapshots) {
    const key = `${snapshot.market}:${snapshot.symbol}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    universe.push({
      market: snapshot.market,
      symbol: snapshot.symbol
    });
  }

  return universe.sort((left, right) =>
    compareText(
      `${left.market}:${left.symbol}`,
      `${right.market}:${right.symbol}`
    )
  );
}

function compareSnapshotManifestEntry(
  left: {
    market: string;
    symbol: string;
    observedAt: string;
    snapshotId: string;
  },
  right: {
    market: string;
    symbol: string;
    observedAt: string;
    snapshotId: string;
  }
): number {
  return (
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol) ||
    compareText(left.observedAt, right.observedAt) ||
    compareText(left.snapshotId, right.snapshotId)
  );
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

class FirstPricedCodexHistoricalDecisionProvider
  implements CodexHistoricalReplayDecisionProviderLike
{
  private readonly provider = new FirstPricedHistoricalDecisionProvider();

  async decide(
    packet: MarketPacket,
    context: HistoricalReplayDecisionContext
  ): Promise<CodexCliDecisionResult> {
    void context;
    return {
      attempted: true,
      decision: this.provider.decide(packet),
      failure: null,
      command: null
    };
  }
}
