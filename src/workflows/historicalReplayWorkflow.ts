import type { MarketPacket } from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import {
  buildHistoricalReplayReport,
  type HistoricalReplayReport
} from "../reports/historicalReplayReport.js";
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
  type HistoricalReplayWorkflowOptions
} from "./historicalReplayWorkflowPlan.js";
import { writeHistoricalReplayReportArtifact } from "./historicalReplayWorkflowArtifacts.js";

export type { HistoricalReplayWorkflowOptions } from "./historicalReplayWorkflowPlan.js";

export interface HistoricalReplayWorkflowResult {
  status: "completed";
  mode: "paper_only";
  reportPath: string;
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
      portfolioTimelinePath: paths.historicalReplayPortfolioTimelinePath
    },
    startedAt: replayStartedAt,
    tickCount: plan.tickCount,
    metadataContext: plan.metadataContext
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
      generatedAt: reportGeneratedAt
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
      report,
      replayResult
    };
  } catch (error) {
    await progressRecorder.fail(error);
    await auditLogRecorder.fail(error);
    throw error;
  }
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
