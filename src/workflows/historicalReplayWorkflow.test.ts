import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetRiskTag,
  AssetType,
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore,
  FileVirtualPortfolioStore
} from "../storage/repositories.js";
import {
  parseHistoricalUniverseManifest,
  type HistoricalUniverseManifest
} from "../replay/historicalUniverseCoverage.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { createPaperCostModel } from "../paper/costModel.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";

test("historical replay workflow writes a stored paper report", async () => {
  const storageBaseDir = await mkdtemp(join(tmpdir(), "toss-replay-workflow-"));
  const paths = createStoragePaths(storageBaseDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot({
      snapshotId: "hist_005930_0900",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000
    })
  );
  await snapshotStore.append(
    snapshot({
      snapshotId: "hist_000660_0901",
      symbol: "000660",
      observedAt: "2025-01-02T09:01:00+09:00",
      lastPriceKrw: 120_000
    })
  );

  const result = await runHistoricalReplayWorkflow({
    storageBaseDir,
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:01:00+09:00"),
      stepSeconds: 60
    }),
    samplingPolicy: new ReplaySamplingPolicy({ everyNSteps: 2 }),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    packetIdPrefix: "packet_historical_workflow",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    runId: "batch_replay_202501_run_000001",
    batchId: "batch_replay_202501",
    batchRunIndex: 1,
    windowSelection: {
      seed: "batch-seed-001",
      rangeStart: "2025-01-01T00:00:00.000Z",
      rangeEnd: "2025-01-31T23:59:59.999Z",
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      candidateCount: 1,
      selectedCandidateIndex: 0,
      selectedMonth: "2025-01",
      localStartDate: "2025-01-02",
      localEndDate: "2025-01-02",
      startAt: "2025-01-02T00:00:00.000Z",
      endAt: "2025-01-02T00:01:00.000Z"
    },
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });
  const stored = JSON.parse(
    await readFile(paths.historicalReplayReportPath, "utf8")
  ) as Record<string, unknown>;
  const progress = JSON.parse(
    await readFile(paths.historicalReplayProgressPath, "utf8")
  ) as Record<string, unknown>;
  const progressEvents = progress["recentEvents"] as Array<
    Record<string, unknown>
  >;
  const progressPortfolio = progress["currentPortfolio"] as Record<string, unknown>;
  const progressPositions = progressPortfolio["positions"] as Array<
    Record<string, unknown>
  >;
  const progressPackets = progress["recentPackets"] as Array<Record<string, unknown>>;
  const progressDecisions = progress["recentDecisions"] as Array<
    Record<string, unknown>
  >;
  const progressRiskDecisions = progress["recentRiskDecisions"] as Array<
    Record<string, unknown>
  >;
  const progressTrades = progress["recentTrades"] as Array<Record<string, unknown>>;
  const progressTimeline = progress["portfolioTimeline"] as Array<
    Record<string, unknown>
  >;
  const runMetadata = JSON.parse(
    await readFile(paths.historicalReplayRunMetadataPath, "utf8")
  ) as Record<string, unknown>;
  const researchManifest = JSON.parse(
    await readFile(paths.historicalReplayResearchManifestPath, "utf8")
  ) as Record<string, unknown>;
  const packetLog = await readJsonl(paths.historicalReplayPacketLogPath);
  const decisionLog = await readJsonl(paths.historicalReplayDecisionLogPath);
  const riskDecisionLog = await readJsonl(
    paths.historicalReplayRiskDecisionLogPath
  );
  const tradeLog = await readJsonl(paths.historicalReplayTradeLogPath);
  const portfolioTimelineLog = await readJsonl(
    paths.historicalReplayPortfolioTimelinePath
  );

  assert.equal(result.status, "completed");
  assert.equal(result.mode, "paper_only");
  assert.equal(result.reportPath, paths.historicalReplayReportPath);
  assert.equal(
    result.researchManifestPath,
    paths.historicalReplayResearchManifestPath
  );
  assert.equal(result.researchManifest.status, "available");
  assert.equal(result.replayResult.packetCount, 2);
  assert.equal(result.replayResult.decisionProviderCallCount, 1);
  assert.equal(result.replayResult.decisionSkippedCount, 1);
  assert.equal(stored["title"], "Historical Replay Paper Report");
  assert.match(String(stored["disclaimer"]), /cannot place live orders/);
  assert.equal(
    (stored["costSummary"] as Record<string, unknown>)["totalCostKrw"],
    0
  );
  assert.equal(
    (stored["reproducibility"] as Record<string, unknown>)["status"],
    "available"
  );
  assert.equal(progress["status"], "completed");
  assert.equal(progress["tickCount"], 2);
  assert.equal(progress["decisionProviderCallCount"], 1);
  assert.equal(progress["decisionSkippedCount"], 1);
  assert.equal(progress["riskDecisionCount"], 1);
  assert.equal(progress["riskApprovedCount"], 1);
  assert.equal(progress["finalReportPath"], paths.historicalReplayReportPath);
  assert.equal(progressPositions[0]?.["symbol"], "005930");
  assert.equal(progressTimeline.length, 2);
  assert.equal(progressTimeline.at(-1)?.["virtualNetWorthKrw"], 1_000_000);
  assert.equal(progressPackets.length, 2);
  assert.equal(progressDecisions[0]?.["packetId"], "packet_historical_workflow_0");
  assert.match(String(progressDecisions[0]?.["decisionHash"]), /^sha256:[a-f0-9]{64}$/);
  assert.equal(progressRiskDecisions[0]?.["approved"], true);
  assert.equal(progressTrades[0]?.["symbol"], "005930");
  assert.equal(progressEvents[0]?.["eventType"], "VIRTUAL_BUY");
  assert.equal(runMetadata["status"], "completed");
  assert.equal(runMetadata["mode"], "paper_only");
  assert.match(String(runMetadata["disclaimer"]), /cannot place live orders/);
  const runRiskPolicySummary = runMetadata["riskPolicySummary"] as Record<
    string,
    unknown
  >;
  const runDynamicCashReserveSummary = runRiskPolicySummary[
    "dynamicCashReserve"
  ] as Record<string, unknown>;
  const runHedgeSummary = runRiskPolicySummary["hedge"] as Record<
    string,
    unknown
  >;
  assert.equal(runDynamicCashReserveSummary["rejectedCount"], 0);
  assert.equal(runHedgeSummary["rejectedCount"], 0);
  assert.equal(runHedgeSummary["hedgeTradeCount"], 0);
  const runIdentity = runMetadata["identity"] as Record<string, unknown>;
  const runWindow = runMetadata["window"] as Record<string, unknown>;
  const runConfiguration = runMetadata["configuration"] as Record<
    string,
    unknown
  >;
  const runClock = runConfiguration["clock"] as Record<string, unknown>;
  const runLogPaths = runMetadata["logPaths"] as Record<string, unknown>;
  const runResearchManifest = runMetadata["researchManifest"] as Record<
    string,
    unknown
  >;
  const runSamplingPolicy = runConfiguration["samplingPolicy"] as Record<
    string,
    unknown
  >;
  assert.equal(runIdentity["runId"], "batch_replay_202501_run_000001");
  assert.equal(runIdentity["batchId"], "batch_replay_202501");
  assert.equal(runIdentity["runIndex"], 1);
  assert.equal(runWindow["source"], "random_window");
  assert.equal(runWindow["selectedMonth"], "2025-01");
  assert.equal(runWindow["seed"], "batch-seed-001");
  assert.equal(runWindow["timezoneOffsetMinutes"], 540);
  assert.equal(runClock["stepSeconds"], 60);
  assert.equal(runSamplingPolicy["everyNSteps"], 2);
  assert.equal(runConfiguration["initialCashKrw"], 1_000_000);
  assert.equal(runConfiguration["riskProfile"], null);
  assert.equal(runConfiguration["riskPolicy"], null);
  assert.equal(runConfiguration["paperExitPolicy"], null);
  assert.equal(
    runLogPaths["researchManifestPath"],
    paths.historicalReplayResearchManifestPath
  );
  assert.equal(runResearchManifest["manifestVersion"], "replay_research_manifest.v1");
  assert.equal(
    runResearchManifest["configHash"],
    researchManifest["configHash"]
  );
  assert.match(String(researchManifest["dataSnapshotHash"]), /^sha256:[a-f0-9]{64}$/);
  assert.match(String(researchManifest["universeHash"]), /^sha256:[a-f0-9]{64}$/);
  assert.equal(researchManifest["universeSnapshotDate"], null);
  assert.match(String(researchManifest["coverageHash"]), /^sha256:[a-f0-9]{64}$/);
  assert.match(String(researchManifest["costModelHash"]), /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    researchManifest["executionModelVersion"],
    "execution_simulator.v4"
  );
  assert.equal(
    (stored["reproducibility"] as Record<string, unknown>)[
      "executionModelVersion"
    ],
    "execution_simulator.v4"
  );
  assert.equal(packetLog.length, result.replayResult.packetCount);
  assert.equal(decisionLog.length, result.replayResult.decisionRecordCount);
  assert.equal(riskDecisionLog.length, result.replayResult.riskDecisions.length);
  assert.equal(tradeLog.length, result.replayResult.tradeCount);
  assert.ok(portfolioTimelineLog.length >= result.replayResult.tickCount);
  assert.equal(packetLog[0]?.["packetId"], "packet_historical_workflow_0");
  assert.equal(decisionLog[0]?.["packetId"], "packet_historical_workflow_0");
  assert.match(String(decisionLog[0]?.["decisionHash"]), /^sha256:[a-f0-9]{64}$/);
  assert.equal(riskDecisionLog[0]?.["approved"], true);
  assert.equal(tradeLog[0]?.["symbol"], "005930");
  assert.equal(
    (portfolioTimelineLog.at(-1)?.["portfolio"] as Record<string, unknown>)?.[
      "virtualNetWorthKrw"
    ],
    1_000_000
  );
});

test("historical replay workflow applies universe lifecycle risk gate", async () => {
  const storageBaseDir = await mkdtemp(
    join(tmpdir(), "toss-replay-lifecycle-")
  );
  const paths = createStoragePaths(storageBaseDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot({
      snapshotId: "hist_005930_lifecycle",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000
    })
  );

  const result = await runHistoricalReplayWorkflow({
    storageBaseDir,
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:00:00+09:00"),
      stepSeconds: 60
    }),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    packetIdPrefix: "packet_historical_lifecycle",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    universeManifest: universeManifest({ lifecycleStatus: "delisted" }),
    decisionProvider: {
      async decide(packet) {
        const candidate = packet.candidates[0];
        assert.ok(candidate);
        const dataRef =
          candidate.dataRefs?.[0] ??
          candidate.sourceRefs[0] ??
          `candidate.${candidate.market}.${candidate.symbol}`;
        return {
          attempted: true,
          decision: {
            packetId: packet.packetId,
            summary: "Lifecycle risk gate fixture.",
            decisions: [
              {
                market: candidate.market,
                symbol: candidate.symbol,
                action: "VIRTUAL_BUY",
                confidence: 0.6,
                budgetKrw: 70_000,
                thesis: "Exercise the deterministic lifecycle risk gate.",
                riskFactors: ["Candidate lifecycle is not eligible."],
                dataRefs: [dataRef],
                claimSupport: [
                  {
                    claim: "Exercise the deterministic lifecycle risk gate.",
                    dataRefs: [dataRef]
                  }
                ],
                expiresAt: packet.expiresAt
              }
            ]
          },
          failure: null,
          command: null
        };
      }
    },
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });

  const candidate = result.replayResult.packets[0]?.candidates[0];
  assert.equal(candidate?.lifecycleStatus, "delisted");
  assert.equal(candidate?.buyEligible, false);
  assert.equal(
    candidate?.blockedReasonCodes?.includes("LIFECYCLE_DELISTED"),
    true
  );
  assert.equal(result.replayResult.tradeCount, 0);
  assert.equal(result.replayResult.rejectedCount, 1);
  assert.equal(
    result.replayResult.riskDecisions[0]?.rejectCodes.includes(
      "VIRTUAL_LIFECYCLE_NOT_ELIGIBLE"
    ),
    true
  );
  assert.equal(
    result.replayResult.warnings.some((warning) =>
      warning.includes("status=delisted")
    ),
    true
  );
});

test("historical replay workflow applies market impact execution policy", async () => {
  const storageBaseDir = await mkdtemp(join(tmpdir(), "toss-replay-impact-"));
  const paths = createStoragePaths(storageBaseDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot({
      snapshotId: "hist_005930_impact",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000,
      volume: 10
    })
  );

  const result = await runHistoricalReplayWorkflow({
    storageBaseDir,
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:00:00+09:00"),
      stepSeconds: 60
    }),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    packetIdPrefix: "packet_historical_impact",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    executionPolicy: {
      marketImpactBpsPerParticipationRate: 500
    },
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    riskPolicy: {
      minCashReserveRatio: 0
    }
  });

  const metadata = JSON.parse(
    await readFile(paths.historicalReplayRunMetadataPath, "utf8")
  ) as Record<string, unknown>;
  const researchManifest = JSON.parse(
    await readFile(paths.historicalReplayResearchManifestPath, "utf8")
  ) as Record<string, unknown>;
  const configuration = metadata["configuration"] as Record<string, unknown>;
  const executionPolicy = configuration["executionPolicy"] as Record<
    string,
    unknown
  >;

  assert.equal(result.replayResult.trades[0]?.impactCostKrw, 350);
  assert.equal(result.replayResult.trades[0]?.totalCostKrw, 350);
  assert.equal(result.replayResult.trades[0]?.participationRate, 0.1);
  assert.equal(result.report.costSummary.impactCostKrw, 350);
  assert.equal(result.report.costSummary.totalCostKrw, 350);
  assert.equal(executionPolicy["marketImpactBpsPerParticipationRate"], 500);
  assert.equal(
    researchManifest["costModelHash"],
    createReplayResearchHash(
      createPaperCostModel({ marketImpactBpsPerParticipationRate: 500 })
    )
  );
});

test("historical replay research manifest hashes initial portfolio and replay snapshot fields", async () => {
  const baseline = await runWorkflowAndReadResearchManifest({});
  const withStoredPortfolio = await runWorkflowAndReadResearchManifest({
    storedPortfolio: portfolioWithPosition()
  });
  const withDifferentStoredPortfolioStrategyBucket =
    await runWorkflowAndReadResearchManifest({
      storedPortfolio: portfolioWithPosition({ strategyBucket: "swing" })
    });
  const withStrategyBucketSnapshot = await runWorkflowAndReadResearchManifest({
    snapshotInput: {
      snapshotId: "hist_005930_0900",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000,
      strategyBucket: "swing"
    }
  });
  const withUniverseManifest = await runWorkflowAndReadResearchManifest({
    universeManifest: universeManifest()
  });
  const withStrategyBucketUniverseManifest =
    await runWorkflowAndReadResearchManifest({
      universeManifest: universeManifest({ strategyBucket: "long_term" })
    });
  const withChangedUniverseManifest = await runWorkflowAndReadResearchManifest({
    universeManifest: universeManifest({
      snapshotDate: "2025-04-30",
      lifecycleStatus: "delisted"
    })
  });
  const withDifferentSnapshotInputs = await runWorkflowAndReadResearchManifest({
    snapshotInput: {
      snapshotId: "hist_005930_0900",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000,
      name: "KODEX 200",
      assetType: "ETF",
      riskTags: ["currency_exposed"],
      sector: "Broad Market",
      openPriceKrw: 69_500,
      closePriceKrw: 70_500,
      sourceRefs: ["fixture:changed_source_ref"]
    }
  });

  assert.notEqual(
    baseline["configHash"],
    withStoredPortfolio["configHash"],
    "initial portfolio must affect configHash"
  );
  assert.notEqual(
    withStoredPortfolio["configHash"],
    withDifferentStoredPortfolioStrategyBucket["configHash"],
    "initial portfolio strategyBucket must affect configHash"
  );
  assert.notEqual(
    baseline["dataSnapshotHash"],
    withDifferentSnapshotInputs["dataSnapshotHash"],
    "replay-relevant snapshot fields must affect dataSnapshotHash"
  );
  assert.notEqual(
    baseline["dataSnapshotHash"],
    withStrategyBucketSnapshot["dataSnapshotHash"],
    "snapshot strategyBucket must affect dataSnapshotHash"
  );
  assert.equal(
    baseline["universeHash"],
    createReplayResearchHash([{ market: "KR", symbol: "005930" }]),
    "legacy no-universe path must keep hashing the observed symbol summary array"
  );
  assert.equal(withUniverseManifest["universeSnapshotDate"], "2025-03-31");
  assert.notEqual(
    baseline["universeHash"],
    withUniverseManifest["universeHash"],
    "explicit universe manifest must replace snapshot-derived universe hash source"
  );
  assert.notEqual(
    withUniverseManifest["universeHash"],
    withStrategyBucketUniverseManifest["universeHash"],
    "universe strategyBucket metadata must affect universeHash"
  );
  assert.notEqual(
    withUniverseManifest["universeHash"],
    withChangedUniverseManifest["universeHash"],
    "universe snapshot date and lifecycle metadata must affect universeHash"
  );
});

function snapshot(input: {
  snapshotId: string;
  symbol: string;
  observedAt: string;
  lastPriceKrw: number;
  name?: string;
  assetType?: AssetType;
  riskTags?: AssetRiskTag[];
  strategyBucket?: HistoricalMarketSnapshot["strategyBucket"];
  sector?: string;
  openPriceKrw?: number;
  closePriceKrw?: number;
  volume?: number;
  sourceRefs?: string[];
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: input.symbol,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.assetType === undefined ? {} : { assetType: input.assetType }),
    ...(input.riskTags === undefined ? {} : { riskTags: input.riskTags }),
    ...(input.strategyBucket === undefined
      ? {}
      : { strategyBucket: input.strategyBucket }),
    ...(input.sector === undefined ? {} : { sector: input.sector }),
    observedAt: input.observedAt,
    interval: "1m",
    ...(input.openPriceKrw === undefined
      ? {}
      : { openPriceKrw: input.openPriceKrw }),
    ...(input.closePriceKrw === undefined
      ? {}
      : { closePriceKrw: input.closePriceKrw }),
    lastPriceKrw: input.lastPriceKrw,
    volume: input.volume ?? 100_000,
    sourceRefs: input.sourceRefs ?? [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-12T09:00:00+09:00"
  };
}

async function runWorkflowAndReadResearchManifest(input: {
  storedPortfolio?: VirtualPortfolio;
  snapshotInput?: Parameters<typeof snapshot>[0];
  universeManifest?: HistoricalUniverseManifest;
}): Promise<Record<string, unknown>> {
  const storageBaseDir = await mkdtemp(join(tmpdir(), "toss-replay-manifest-"));
  const paths = createStoragePaths(storageBaseDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot(
      input.snapshotInput ?? {
        snapshotId: "hist_005930_0900",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      }
    )
  );

  if (input.storedPortfolio !== undefined) {
    await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(
      input.storedPortfolio
    );
  }

  await runHistoricalReplayWorkflow({
    storageBaseDir,
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:00:00+09:00"),
      stepSeconds: 60
    }),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    packetIdPrefix: "packet_historical_manifest_hash",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    ...(input.universeManifest === undefined
      ? {}
      : { universeManifest: input.universeManifest })
  });

  return JSON.parse(
    await readFile(paths.historicalReplayResearchManifestPath, "utf8")
  ) as Record<string, unknown>;
}

function universeManifest(
  overrides: {
    snapshotDate?: string;
    lifecycleStatus?: "active" | "suspended" | "delisted" | "unknown";
    strategyBucket?: HistoricalMarketSnapshot["strategyBucket"];
  } = {}
): HistoricalUniverseManifest {
  return parseHistoricalUniverseManifest({
    mode: "paper_only_historical_universe",
    universeId: "fixture-replay-universe",
    snapshotDate: overrides.snapshotDate ?? "2025-03-31",
    symbols: [
      {
        market: "KR",
        symbol: "005930",
        lifecycleStatus: overrides.lifecycleStatus ?? "active",
        ...(overrides.strategyBucket === undefined
          ? {}
          : { strategyBucket: overrides.strategyBucket }),
        required: true
      }
    ],
    disclaimer: "Paper-only fixture."
  });
}

function portfolioWithPosition(
  input: {
    strategyBucket?: VirtualPortfolio["positions"][number]["strategyBucket"];
  } = {}
): VirtualPortfolio {
  return {
    portfolioId: "portfolio_fixture_existing_position",
    cashKrw: 850_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        assetType: "STOCK",
        quantity: 1,
        averagePriceKrw: 70_000,
        marketPriceKrw: 70_000,
        marketValueKrw: 70_000,
        priceUpdatedAt: "2025-01-02T09:00:00+09:00",
        priceSourceRefs: ["fixture:initial_position"],
        ...(input.strategyBucket === undefined
          ? {}
          : { strategyBucket: input.strategyBucket }),
        updatedAt: "2025-01-02T09:00:00+09:00"
      }
    ],
    updatedAt: "2025-01-02T09:00:00+09:00"
  };
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
