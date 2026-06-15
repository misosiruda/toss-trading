import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  FirstPricedHistoricalDecisionProvider,
  runHistoricalReplay,
  type HistoricalReplayResult
} from "../replay/historicalReplayRunner.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import {
  buildPortfolioConstructionMetrics,
  buildHistoricalReplayReport,
  renderHistoricalReplayReport
} from "./historicalReplayReport.js";

const generatedAt = new Date("2026-06-12T10:00:00+09:00");

test("historical replay report summarizes replay result safely", () => {
  const report = buildHistoricalReplayReport({
    result: replayResult(),
    generatedAt
  });

  assert.equal(report.mode, "paper_only");
  assert.equal(report.simulatedRange.tickCount, 3);
  assert.equal(report.replaySummary.packetCount, 3);
  assert.equal(report.replaySummary.decisionProviderCallCount, 2);
  assert.equal(report.replaySummary.decisionSkippedCount, 1);
  assert.equal(report.tradeSummary.tradeCount, 2);
  assert.equal(report.paperExitPolicy, null);
  assert.equal(report.portfolio.finalCashKrw, 830_000);
  assert.equal(report.portfolio.finalPositionCount, 2);
  assert.equal(report.portfolioTimeline.length, 3);
  assert.notEqual(report.portfolioConstruction.avgExposureRatio, null);
  assert.notEqual(report.portfolioConstruction.avgCashRatio, null);
  assert.notEqual(report.portfolioConstruction.timeInMarketRatio, null);
  assert.equal(report.decisionOutcome.byAction["VIRTUAL_BUY"], 2);
  assert.equal(report.samplingSummary.skipReasons["STEP_INTERVAL_SKIPPED"], 1);
  assert.equal(report.benchmarks.strategy.initialNetWorthKrw > 0, true);
  assert.equal(report.benchmarks.cashOnly.totalReturnRatio, 0);
  assert.notEqual(report.benchmarks.equalWeightBuyAndHold, null);
  assert.equal(
    report.benchmarks.comparisons.strategyVsCashOnly.benchmarkAvailable,
    true
  );
  assert.match(report.benchmarks.notes.join(" "), /replay packets/);
  assert.equal(report.sourceWarningSummary.futureSnapshotWarningCount > 0, true);
  assert.equal(
    report.sourceWarningSummary.lookaheadGuardStatus,
    "future_snapshots_excluded"
  );
  assert.match(report.disclaimer, /not financial advice/);
  assert.match(report.disclaimer, /not a performance guarantee/);
});

test("rendered historical replay report masks sensitive values and avoids advice wording", () => {
  const result = replayResult();
  result.warnings.push(
    "fixture warning for account 1234-5678-901234 and order ord_abcdef123456"
  );

  const rendered = renderHistoricalReplayReport(
    buildHistoricalReplayReport({ result, generatedAt })
  );

  assert.match(rendered, /Historical Replay Paper Report/);
  assert.match(rendered, /paper_exit_policy/);
  assert.match(rendered, /avg_exposure_ratio/);
  assert.match(rendered, /time_in_market_ratio/);
  assert.match(rendered, /meaningful_reject_count/);
  assert.match(rendered, /dust_reject_count/);
  assert.match(rendered, /lookahead_guard_status/);
  assert.match(rendered, /Benchmarks/);
  assert.match(rendered, /equal_weight_buy_and_hold/);
  assert.match(rendered, /benchmark_comparisons/);
  assert.match(rendered, /Virtual Portfolio Timeline/);
  assert.match(rendered, /Paper-only historical replay simulation/);
  assert.match(rendered, /not financial advice/);
  assert.match(rendered, /not a performance guarantee/);
  assert.match(rendered, /cannot place live orders/);
  assert.equal(rendered.includes("1234-5678-901234"), false);
  assert.equal(rendered.includes("ord_abcdef123456"), false);
  assert.equal(rendered.includes("can place live orders"), false);
});

test("portfolio construction metrics handle zero equity without NaN", () => {
  const metrics = buildPortfolioConstructionMetrics([
    {
      simulatedAt: "2025-01-02T09:00:00.000Z",
      cashKrw: 500,
      positionCount: 1,
      positionMarketValueKrw: 500,
      virtualNetWorthKrw: 1_000
    },
    {
      simulatedAt: "2025-01-02T09:01:00.000Z",
      cashKrw: 0,
      positionCount: 0,
      positionMarketValueKrw: 0,
      virtualNetWorthKrw: 0
    }
  ]);

  assert.equal(metrics.avgExposureRatio, 0.25);
  assert.equal(metrics.avgCashRatio, 0.25);
  assert.equal(metrics.maxExposureRatio, 0.5);
  assert.equal(metrics.minExposureRatio, 0);
  assert.equal(metrics.timeInMarketRatio, 0.5);
  assert.equal(metrics.finalCashRatio, 0);
  assert.equal(metrics.finalPositionRatio, 0);
});

test("historical replay report separates dust no-op from meaningful rejects", () => {
  const result = replayResult();
  result.auditEvents.push({
    eventId: "audit_dust_noop_001",
    eventType: "NO_OP_EXIT_DUST_CLOSED",
    actor: "system",
    summary: "fixture dust close",
    maskedRefs: [],
    createdAt: "2025-01-02T09:02:00+09:00"
  });

  const report = buildHistoricalReplayReport({ result, generatedAt });

  assert.equal(report.riskSummary.meaningfulRejectCount, result.rejectedCount);
  assert.equal(report.riskSummary.dustRejectCount, 1);
});

function replayResult(): HistoricalReplayResult {
  return runHistoricalReplay(
    {
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:02:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: new FirstPricedHistoricalDecisionProvider(),
      samplingPolicy: new ReplaySamplingPolicy({ everyNSteps: 2 }),
      packetIdPrefix: "packet_historical_report",
      packetExpiresInSeconds: 60,
      maxCandidates: 10,
      maxSnapshotAgeSeconds: 300,
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 100_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    },
    {
      initialPortfolio: portfolio(),
      snapshots: [
        snapshot({
          snapshotId: "hist_005930_0900",
          symbol: "005930",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 70_000
        }),
        snapshot({
          snapshotId: "hist_000660_0901",
          symbol: "000660",
          observedAt: "2025-01-02T09:01:00+09:00",
          lastPriceKrw: 120_000
        }),
        snapshot({
          snapshotId: "hist_035420_0902",
          symbol: "035420",
          observedAt: "2025-01-02T09:02:00+09:00",
          lastPriceKrw: 180_000
        })
      ]
    }
  );
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00"
  };
}

function snapshot(input: {
  snapshotId: string;
  symbol: string;
  observedAt: string;
  lastPriceKrw: number;
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: input.symbol,
    observedAt: input.observedAt,
    interval: "1m",
    lastPriceKrw: input.lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-12T09:00:00+09:00"
  };
}
