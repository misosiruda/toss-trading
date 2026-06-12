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
import {
  HistoricalReplayAuditLogRecorder,
  type HistoricalReplayRunMetadataContext
} from "../replay/historicalReplayAuditLog.js";
import { HistoricalReplayProgressRecorder } from "../replay/historicalReplayProgress.js";
import type { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import type { ReplayWindowSelection } from "../replay/replayWindowSampler.js";
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
  runId?: string;
  batchId?: string;
  batchRunIndex?: number;
  windowSelection?: ReplayWindowSelection;
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
  const tickCount = options.clock.ticks().length;
  const metadataContext = buildRunMetadataContext(options, replayStartedAt);
  const progressRecorder = new HistoricalReplayProgressRecorder({
    filePath: paths.historicalReplayProgressPath,
    startedAt: replayStartedAt,
    tickCount,
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
    tickCount,
    metadataContext
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

function buildRunMetadataContext(
  options: HistoricalReplayWorkflowOptions,
  replayStartedAt: Date
): HistoricalReplayRunMetadataContext {
  const clock = options.clock.metadata();
  const samplingPolicy = options.samplingPolicy?.metadata() ?? null;
  const windowSelection = options.windowSelection;
  const batchId = normalizeOptionalText(options.batchId);
  const runIndex = options.batchRunIndex ?? null;
  const timezoneOffsetMinutes =
    windowSelection?.timezoneOffsetMinutes ??
    samplingPolicy?.timezoneOffsetMinutes ??
    0;

  return {
    identity: {
      runId:
        normalizeOptionalText(options.runId) ??
        defaultRunId({
          batchId,
          runIndex,
          replayStartedAt,
          windowStartAt: clock.startAt
        }),
      batchId,
      runIndex
    },
    window: {
      source: windowSelection === undefined ? "explicit" : "random_window",
      startAt: clock.startAt,
      endAt: clock.endAt,
      rangeStart: windowSelection?.rangeStart ?? null,
      rangeEnd: windowSelection?.rangeEnd ?? null,
      seed: windowSelection?.seed ?? null,
      selectedMonth: windowSelection?.selectedMonth ?? null,
      localStartDate: windowSelection?.localStartDate ?? null,
      localEndDate: windowSelection?.localEndDate ?? null,
      windowMonths: windowSelection?.windowMonths ?? null,
      timezoneOffsetMinutes
    },
    configuration: {
      clock: {
        startAt: clock.startAt,
        endAt: clock.endAt,
        stepSeconds: clock.stepSeconds,
        speedMultiplier: clock.speedMultiplier
      },
      samplingPolicy,
      initialCashKrw: options.initialCashKrw ?? 1_000_000,
      packetIdPrefix: options.packetIdPrefix,
      packetExpiresInSeconds: options.packetExpiresInSeconds,
      maxCandidates: options.maxCandidates,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
      constraints: options.constraints
    }
  };
}

function defaultRunId(input: {
  batchId: string | null;
  runIndex: number | null;
  replayStartedAt: Date;
  windowStartAt: string;
}): string {
  const windowDate = input.windowStartAt.slice(0, 10).replaceAll("-", "");
  if (input.batchId !== null) {
    const runIndex =
      input.runIndex === null ? "manual" : String(input.runIndex).padStart(6, "0");
    return `${safeRunIdPart(input.batchId)}_run_${runIndex}_${windowDate}`;
  }

  const startedAt = input.replayStartedAt
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `historical_replay_${startedAt}_${windowDate}`;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function safeRunIdPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length === 0 ? "batch" : sanitized;
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
