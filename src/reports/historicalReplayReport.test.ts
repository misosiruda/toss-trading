import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  FirstPricedHistoricalDecisionProvider,
  runHistoricalReplay,
  type HistoricalPortfolioTimelineItem,
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
  assert.equal(report.costSummary.totalCostKrw, 0);
  assert.deepEqual(report.costSummary.costModelVersions, [
    "paper_cost_model.v3"
  ]);
  assert.equal(report.costSummary.filledCount, 2);
  assert.equal(report.costSummary.partialFillCount, 0);
  assert.equal(report.costSummary.notModeledLiquidityCount, 0);
  assert.equal(report.costSummary.averageParticipationRate !== null, true);
  assert.equal(report.advancedPerformance.formulaVersion, "performance_metrics.v1");
  assert.equal(report.advancedPerformance.sampleCount, 2);
  assert.equal(report.advancedPerformance.sharpeRatio, null);
  assert.equal(report.sharpeValidation.schemaVersion, "sharpe_validation.v1");
  assert.equal(report.sharpeValidation.status, "unavailable");
  assert.equal(report.sharpeValidation.sample.returnSampleCount, 2);
  assert.equal(report.sharpeValidation.metrics.sampleSharpe.status, "insufficient_sample");
  assert.equal(
    report.sharpeValidation.selectionContext.multipleTestingAdjustment,
    "none"
  );
  assert.match(
    report.sharpeValidation.warnings.map((warning) => warning.code).join("\n"),
    /INSUFFICIENT_RETURN_SAMPLES/
  );
  assert.match(
    report.advancedPerformance.warnings.join("\n"),
    /at least 3 return samples/
  );
  assert.equal(report.riskSummary.policySummary.dynamicCashReserve.rejectedCount, 0);
  assert.equal(report.riskSummary.policySummary.hedge.hedgeTradeCount, 0);
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
  assert.equal(report.reproducibility.status, "partial");
  assert.deepEqual(report.reproducibility.warnings, [
    "RESEARCH_MANIFEST_MISSING"
  ]);
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
  assert.match(rendered, /exposure_by_asset_class/);
  assert.match(rendered, /exposure_by_strategy_bucket/);
  assert.match(rendered, /unknown_metadata_exposure_ratio/);
  assert.match(rendered, /symbol_exposures/);
  assert.match(rendered, /meaningful_reject_count/);
  assert.match(rendered, /dynamic_cash_reserve_policy/);
  assert.match(rendered, /hedge_policy/);
  assert.match(rendered, /Execution Costs/);
  assert.match(rendered, /total_cost_krw/);
  assert.match(rendered, /partial_fill_count/);
  assert.match(rendered, /average_participation_rate/);
  assert.match(rendered, /cost_model_versions/);
  assert.match(rendered, /Advanced Performance Metrics/);
  assert.match(rendered, /cost_adjusted_total_return_ratio/);
  assert.match(rendered, /gross_total_return_ratio/);
  assert.match(rendered, /sharpe_annualization_status/);
  assert.match(rendered, /exposure_adjusted_return_ratio/);
  assert.match(rendered, /Sharpe Statistical Validation/);
  assert.match(rendered, /schema_version: sharpe_validation\.v1/);
  assert.match(rendered, /sample_sharpe_status: insufficient_sample/);
  assert.match(rendered, /deflated_sharpe_ratio_status: insufficient_sample/);
  assert.match(rendered, /selection_context/);
  assert.match(rendered, /dust_reject_count/);
  assert.match(rendered, /lookahead_guard_status/);
  assert.match(rendered, /Reproducibility/);
  assert.match(rendered, /status: partial/);
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

test("historical replay report summarizes execution cost components", () => {
  const result = replayResult();
  result.trades[0] = {
    ...result.trades[0]!,
    feeKrw: 10,
    taxKrw: 2,
    slippageKrw: 3,
    spreadCostKrw: 4,
    impactCostKrw: 5,
    totalCostKrw: 999,
    costModelVersion: "paper_cost_model.v3",
    fillStatus: "partial",
    liquidityStatus: "partial",
    participationRate: 0.1
  };
  result.trades[1] = {
    ...result.trades[1]!,
    totalCostKrw: 7,
    fillStatus: "filled",
    liquidityStatus: "not_modeled"
  };
  delete result.trades[1]!.participationRate;

  const report = buildHistoricalReplayReport({ result, generatedAt });

  assert.equal(report.costSummary.feeKrw, 10);
  assert.equal(report.costSummary.taxKrw, 2);
  assert.equal(report.costSummary.slippageKrw, 3);
  assert.equal(report.costSummary.spreadCostKrw, 4);
  assert.equal(report.costSummary.impactCostKrw, 5);
  assert.equal(report.costSummary.totalCostKrw, 31);
  assert.equal(report.costSummary.filledCount, 1);
  assert.equal(report.costSummary.partialFillCount, 1);
  assert.equal(report.costSummary.notModeledLiquidityCount, 1);
  assert.equal(report.costSummary.averageParticipationRate, 0.1);
  assert.equal(report.costSummary.maxParticipationRate, 0.1);
  assert.deepEqual(report.costSummary.costModelVersions, [
    "paper_cost_model.v3"
  ]);
  assert.equal(report.advancedPerformance.costDragRatio! > 0, true);
  assert.equal(
    report.advancedPerformance.grossTotalReturnRatio! >
      report.advancedPerformance.costAdjustedTotalReturnRatio!,
    true
  );
});

test("historical replay report uses initial portfolio net worth as performance baseline", () => {
  const result = replayResult();
  result.portfolioTimeline = [
    {
      simulatedAt: "2025-01-02T09:00:00.000Z",
      cashKrw: 990_000,
      positionCount: 0,
      positionMarketValueKrw: 0,
      virtualNetWorthKrw: 990_000
    }
  ];
  result.finalPortfolio = {
    ...result.finalPortfolio,
    cashKrw: 990_000,
    positions: []
  };
  result.trades = [
    {
      ...result.trades[0]!,
      feeKrw: 10_000,
      taxKrw: 0,
      slippageKrw: 0,
      spreadCostKrw: 0,
      impactCostKrw: 0,
      totalCostKrw: 999
    }
  ];

  const report = buildHistoricalReplayReport({ result, generatedAt });

  assert.equal(report.advancedPerformance.initialNetWorthKrw, 1_000_000);
  assert.equal(report.advancedPerformance.finalNetWorthKrw, 990_000);
  assert.equal(report.advancedPerformance.sampleCount, 1);
  assert.equal(report.advancedPerformance.totalReturnRatio, -0.01);
  assert.equal(report.advancedPerformance.costAdjustedTotalReturnRatio, -0.01);
  assert.equal(report.advancedPerformance.grossTotalReturnRatio, 0);
  assert.equal(report.advancedPerformance.costDragRatio, 0.01);
  assert.equal(report.advancedPerformance.maxDrawdownRatio, -0.01);
});

test("historical replay report passes autocorrelation diagnostic to Sharpe validation", () => {
  const result = replayResult();
  result.portfolioTimeline = timelineFromReturnSamples([
    0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01,
    0.01, 0.01, 0.01, 0.01, 0.01, -0.01, -0.01, -0.01, -0.01, -0.01,
    -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01
  ]);
  result.finalPortfolio = {
    ...result.finalPortfolio,
    cashKrw: result.portfolioTimeline.at(-1)!.virtualNetWorthKrw,
    positions: []
  };

  const report = buildHistoricalReplayReport({ result, generatedAt });

  assert.equal(report.sharpeValidation.status, "available");
  assert.equal(report.sharpeValidation.distribution.autocorrelation.maxLag, 5);
  assert.equal(report.sharpeValidation.distribution.autocorrelation.lagCount, 5);
  assert.match(
    report.sharpeValidation.warnings.map((warning) => warning.code).join("\n"),
    /NON_IID_RETURN_SAMPLE/
  );
});

test("historical replay report exposes dynamic reserve and hedge policy summaries", () => {
  const result = replayResult();
  result.riskDecisions.push(
    {
      riskDecisionId: "risk_dynamic_fixture",
      packetId: "packet_historical_report_dynamic",
      symbol: "005930",
      approved: false,
      rejectCodes: ["VIRTUAL_REGIME_CASH_RESERVE_BREACHED"],
      checkedRules: ["dynamic_cash_reserve"],
      createdAt: "2025-01-02T09:02:00+09:00"
    },
    {
      riskDecisionId: "risk_hedge_fixture",
      packetId: "packet_historical_report_hedge",
      symbol: "252670",
      approved: false,
      rejectCodes: ["VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED"],
      checkedRules: ["hedge_policy"],
      createdAt: "2025-01-02T09:02:00+09:00"
    }
  );
  result.trades.push({
    tradeId: "trade_historical_report_hedge",
    packetId: "packet_historical_report_hedge",
    decisionId: "decision_historical_report_hedge",
    market: "KR",
    symbol: "252670",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 30_000,
    amountKrw: 30_000,
    feeKrw: 1,
    taxKrw: 2,
    slippageKrw: 3,
    spreadCostKrw: 4,
    impactCostKrw: 5,
    totalCostKrw: 999,
    strategyBucket: "hedge",
    status: "VIRTUAL_FILLED",
    executedAt: "2025-01-02T09:02:00+09:00"
  });

  const report = buildHistoricalReplayReport({ result, generatedAt });

  assert.equal(report.riskSummary.policySummary.dynamicCashReserve.rejectedCount, 1);
  assert.deepEqual(
    report.riskSummary.policySummary.dynamicCashReserve.rejectCodes,
    {
      VIRTUAL_REGIME_CASH_RESERVE_BREACHED: 1
    }
  );
  assert.equal(report.riskSummary.policySummary.hedge.rejectedCount, 1);
  assert.deepEqual(report.riskSummary.policySummary.hedge.rejectCodes, {
    VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED: 1
  });
  assert.equal(report.riskSummary.policySummary.hedge.hedgeTradeCount, 1);
  assert.equal(report.riskSummary.policySummary.hedge.hedgeBuyAmountKrw, 30_000);
  assert.equal(report.riskSummary.policySummary.hedge.hedgeCostKrw, 15);
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

function timelineFromReturnSamples(
  returns: number[]
): HistoricalPortfolioTimelineItem[] {
  let netWorthKrw = 1_000_000;
  const timeline: HistoricalPortfolioTimelineItem[] = [
    timelineItem(0, netWorthKrw)
  ];
  returns.forEach((returnRatio, index) => {
    netWorthKrw = Math.round(netWorthKrw * (1 + returnRatio));
    timeline.push(timelineItem(index + 1, netWorthKrw));
  });
  return timeline;
}

function timelineItem(
  minuteOffset: number,
  virtualNetWorthKrw: number
): HistoricalPortfolioTimelineItem {
  return {
    simulatedAt: new Date(
      Date.parse("2025-01-02T09:00:00+09:00") + minuteOffset * 60_000
    ).toISOString(),
    cashKrw: virtualNetWorthKrw,
    positionCount: 0,
    positionMarketValueKrw: 0,
    virtualNetWorthKrw
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
