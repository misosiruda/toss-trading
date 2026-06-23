import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import type { CodexHistoricalReplayDecisionProviderLike } from "../replay/codexHistoricalReplayRunner.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { createHistoricalReplayWorkflowPlan } from "./historicalReplayWorkflowPlan.js";

const decisionProvider: CodexHistoricalReplayDecisionProviderLike = {
  async decide() {
    throw new Error("decision provider is not called by workflow plan tests");
  }
};

test("historical replay workflow plan builds runner input and run metadata", () => {
  const clock = new SimulatedClock({
    startAt: new Date("2025-02-03T09:00:00+09:00"),
    endAt: new Date("2025-02-03T09:01:00+09:00"),
    stepSeconds: 60,
    speedMultiplier: 2
  });
  const samplingPolicy = new ReplaySamplingPolicy({
    everyNSteps: 2,
    timezoneOffsetMinutes: 540
  });
  const paperExitPolicy = {
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08
  };
  const plan = createHistoricalReplayWorkflowPlan({
    options: {
      storageBaseDir: "data/paper",
      clock,
      samplingPolicy,
      initialCashKrw: 2_000_000,
      packetIdPrefix: "packet_plan",
      packetExpiresInSeconds: 120,
      maxCandidates: 5,
      maxSnapshotAgeSeconds: 600,
      constraints: {
        maxNewPositions: 2,
        maxBudgetPerSymbolKrw: 200_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      riskProfile: "aggressive_paper",
      riskPolicy: {
        maxBudgetPerDecisionKrw: 200_000,
        targetExposureRatio: 0.8,
        maxStrategyBucketExposureRatio: { long_term: 0.6 },
        maxBucketTurnoverKrw: { intraday: 50_000 },
        maxSectorExposureRatio: 0.45,
        maxCountryExposureRatio: 0.7,
        maxCurrencyExposureRatio: 0.4,
        maxUnknownMetadataExposureRatio: 0.1,
        dynamicCashReservePolicy: {
          lookbackDays: 20,
          minSymbols: 1,
          minSnapshotsPerSymbol: 2,
          highVolatilityCashReserveRatio: 0.3
        },
        hedgePolicy: {
          maxGrossExposureKrw: 1_500_000,
          maxGrossExposureRatio: 0.9,
          requireHedgeBucket: true
        }
      },
      paperExitPolicy,
      runId: "   ",
      batchId: "batch smoke/2025",
      batchRunIndex: 2,
      windowSelection: {
        seed: "seed-001",
        rangeStart: "2025-02-01T00:00:00.000Z",
        rangeEnd: "2025-02-28T23:59:59.999Z",
        windowMonths: 1,
        timezoneOffsetMinutes: 540,
        candidateCount: 1,
        selectedCandidateIndex: 0,
        selectedMonth: "2025-02",
        localStartDate: "2025-02-03",
        localEndDate: "2025-02-03",
        startAt: "2025-02-03T00:00:00.000Z",
        endAt: "2025-02-03T00:01:00.000Z"
      }
    },
    storedPortfolio: null,
    snapshots: [snapshot()],
    replayStartedAt: new Date("2026-06-12T10:00:00+09:00"),
    decisionProvider
  });

  assert.equal(plan.tickCount, 2);
  assert.equal(plan.initialPortfolio.cashKrw, 2_000_000);
  assert.equal(plan.initialPortfolio.updatedAt, "2025-02-03T00:00:00.000Z");
  assert.equal(plan.replayInput.initialPortfolio, plan.initialPortfolio);
  assert.equal(plan.replayInput.snapshots.length, 1);
  assert.equal(plan.runnerOptions.decisionProvider, decisionProvider);
  assert.equal(plan.runnerOptions.samplingPolicy, samplingPolicy);
  assert.deepEqual(plan.runnerOptions.paperExitPolicy, paperExitPolicy);
  assert.equal(
    plan.metadataContext.identity.runId,
    "batch_smoke_2025_run_000002_20250203"
  );
  assert.equal(plan.metadataContext.identity.batchId, "batch smoke/2025");
  assert.equal(plan.metadataContext.identity.runIndex, 2);
  assert.equal(plan.metadataContext.window.source, "random_window");
  assert.equal(plan.metadataContext.window.timezoneOffsetMinutes, 540);
  assert.equal(
    plan.metadataContext.configuration.riskPolicy?.maxBudgetPerDecisionKrw,
    200_000
  );
  assert.equal(
    plan.metadataContext.configuration.riskPolicy?.targetExposureRatio,
    0.8
  );
  assert.deepEqual(
    plan.metadataContext.configuration.riskPolicy
      ?.maxStrategyBucketExposureRatio,
    { long_term: 0.6 }
  );
  assert.deepEqual(
    plan.metadataContext.configuration.riskPolicy?.maxBucketTurnoverKrw,
    { intraday: 50_000 }
  );
  assert.equal(
    plan.metadataContext.configuration.riskPolicy?.maxSectorExposureRatio,
    0.45
  );
  assert.equal(
    plan.metadataContext.configuration.riskPolicy?.maxCountryExposureRatio,
    0.7
  );
  assert.equal(
    plan.metadataContext.configuration.riskPolicy?.maxCurrencyExposureRatio,
    0.4
  );
  assert.equal(
    plan.metadataContext.configuration.riskPolicy
      ?.maxUnknownMetadataExposureRatio,
    0.1
  );
  assert.deepEqual(
    plan.metadataContext.configuration.riskPolicy?.dynamicCashReservePolicy,
    {
      lookbackDays: 20,
      minSymbols: 1,
      minSnapshotsPerSymbol: 2,
      highVolatilityCashReserveRatio: 0.3
    }
  );
  assert.deepEqual(
    plan.metadataContext.configuration.riskPolicy?.hedgePolicy,
    {
      maxGrossExposureKrw: 1_500_000,
      maxGrossExposureRatio: 0.9,
      requireHedgeBucket: true
    }
  );
  assert.deepEqual(plan.metadataContext.configuration.paperExitPolicy, {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08
  });
});

function snapshot(): HistoricalMarketSnapshot {
  return {
    snapshotId: "hist_005930_001",
    market: "KR",
    symbol: "005930",
    observedAt: "2025-02-03T09:00:00+09:00",
    interval: "1m",
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: ["fixture:hist_005930_001"],
    createdAt: "2025-02-03T09:00:00+09:00"
  };
}
