import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";
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
import type { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import type { SimulatedClock } from "../replay/simulatedClock.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";

export interface HistoricalReplayWorkflowOptions {
  storageBaseDir: string;
  clock: SimulatedClock;
  decisionProvider?: CodexHistoricalReplayDecisionProviderLike;
  samplingPolicy?: ReplaySamplingPolicy;
  generatedAt?: Date;
  initialCashKrw?: number;
  packetIdPrefix: string;
  packetExpiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
}

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
  const [portfolio, snapshots] = await Promise.all([
    new FileVirtualPortfolioStore(paths.virtualPortfolioPath).read(),
    new FileHistoricalMarketSnapshotStore(
      paths.historicalMarketSnapshotsPath
    ).readAll()
  ]);
  const initialPortfolio =
    portfolio ?? createInitialPortfolio(options.initialCashKrw ?? 1_000_000, options);
  const samplingOption =
    options.samplingPolicy === undefined
      ? {}
      : { samplingPolicy: options.samplingPolicy };
  const commonOptions = {
    clock: options.clock,
    ...samplingOption,
    packetIdPrefix: options.packetIdPrefix,
    packetExpiresInSeconds: options.packetExpiresInSeconds,
    maxCandidates: options.maxCandidates,
    maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
    constraints: options.constraints
  };
  const replayInput = {
    initialPortfolio,
    snapshots: snapshots.records
  };
  const replayStartedAt = options.generatedAt ?? new Date();
  const progressRecorder = new HistoricalReplayProgressRecorder({
    filePath: paths.historicalReplayProgressPath,
    startedAt: replayStartedAt,
    tickCount: options.clock.ticks().length,
    initialPortfolio
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
    tickCount: options.clock.ticks().length
  });

  await Promise.all([progressRecorder.start(), auditLogRecorder.start()]);

  try {
    const decisionProvider =
      options.decisionProvider ??
      new FirstPricedCodexHistoricalDecisionProvider();
    const replayResult = await runCodexHistoricalReplay(
      {
        ...commonOptions,
        decisionProvider,
        onProgress: async (update) => {
          await progressRecorder.record(update);
          await auditLogRecorder.record(update);
        }
      },
      replayInput
    );
    const reportGeneratedAt = options.generatedAt ?? new Date();
    const report = buildHistoricalReplayReport({
      result: replayResult,
      generatedAt: reportGeneratedAt
    });

    await mkdir(dirname(paths.historicalReplayReportPath), { recursive: true });
    await writeFile(
      paths.historicalReplayReportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
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

function createInitialPortfolio(
  cashKrw: number,
  options: Pick<HistoricalReplayWorkflowOptions, "clock">
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw,
    positions: [],
    updatedAt: options.clock.metadata().startAt
  };
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
