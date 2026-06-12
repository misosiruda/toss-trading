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
  assert.equal(report.portfolio.finalCashKrw, 830_000);
  assert.equal(report.portfolio.finalPositionCount, 2);
  assert.equal(report.portfolioTimeline.length, 3);
  assert.equal(report.decisionOutcome.byAction["VIRTUAL_BUY"], 2);
  assert.equal(report.samplingSummary.skipReasons["STEP_INTERVAL_SKIPPED"], 1);
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
  assert.match(rendered, /lookahead_guard_status/);
  assert.match(rendered, /Virtual Portfolio Timeline/);
  assert.match(rendered, /Paper-only historical replay simulation/);
  assert.match(rendered, /not financial advice/);
  assert.match(rendered, /not a performance guarantee/);
  assert.match(rendered, /cannot place live orders/);
  assert.equal(rendered.includes("1234-5678-901234"), false);
  assert.equal(rendered.includes("ord_abcdef123456"), false);
  assert.equal(rendered.includes("can place live orders"), false);
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
