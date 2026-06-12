import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { VirtualPortfolio } from "../domain/schemas.js";
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
  runHistoricalReplay,
  type HistoricalReplayResult
} from "../replay/historicalReplayRunner.js";
import {
  runCodexHistoricalReplay,
  type CodexHistoricalReplayDecisionProviderLike
} from "../replay/codexHistoricalReplayRunner.js";
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
  const replayResult =
    options.decisionProvider === undefined
      ? runHistoricalReplay(
          {
            ...commonOptions,
            decisionProvider: new FirstPricedHistoricalDecisionProvider()
          },
          replayInput
        )
      : await runCodexHistoricalReplay(
          {
            ...commonOptions,
            decisionProvider: options.decisionProvider
          },
          replayInput
        );
  const report = buildHistoricalReplayReport({
    result: replayResult,
    generatedAt: options.generatedAt ?? new Date()
  });

  await mkdir(dirname(paths.historicalReplayReportPath), { recursive: true });
  await writeFile(
    paths.historicalReplayReportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  return {
    status: "completed",
    mode: "paper_only",
    reportPath: paths.historicalReplayReportPath,
    report,
    replayResult
  };
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
