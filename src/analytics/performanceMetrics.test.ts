import assert from "node:assert/strict";
import test from "node:test";

import {
  PERFORMANCE_METRIC_FORMULA_VERSION,
  summarizeReplayPerformanceMetrics,
  summarizeReturnDistributionMetrics
} from "./performanceMetrics.js";

test("return distribution metrics are deterministic and expose sample warnings", () => {
  const returns = [
    -0.1,
    -0.05,
    -0.02,
    -0.01,
    0,
    0.01,
    0.02,
    0.03,
    0.04,
    0.05,
    0.06,
    0.07,
    0.08,
    0.09,
    0.1,
    0.11,
    0.12,
    0.13,
    0.14,
    0.15
  ];

  const metrics = summarizeReturnDistributionMetrics(returns);

  assert.deepEqual(metrics, summarizeReturnDistributionMetrics(returns));
  assert.equal(metrics.formulaVersion, PERFORMANCE_METRIC_FORMULA_VERSION);
  assert.equal(metrics.sampleCount, 20);
  assert.equal(metrics.hitRatio, 0.75);
  assert.equal(metrics.profitFactor, 6.666667);
  assert.equal(metrics.averageWinRatio, 0.08);
  assert.equal(metrics.averageLossRatio, -0.045);
  assert.equal(metrics.tailLossRatio, -0.1);
  assert.notEqual(metrics.sharpeRatio, null);
  assert.match(metrics.warnings.join("\n"), /not annualized/);
});

test("return distribution metrics leave short samples nullable without NaN", () => {
  const metrics = summarizeReturnDistributionMetrics([]);
  const serialized = JSON.stringify(metrics);

  assert.equal(metrics.sampleCount, 0);
  assert.equal(metrics.hitRatio, null);
  assert.equal(metrics.profitFactor, null);
  assert.equal(metrics.tailLossRatio, null);
  assert.equal(metrics.sharpeRatio, null);
  assert.equal(serialized.includes("NaN"), false);
  assert.match(metrics.warnings.join("\n"), /at least one return sample/);
  assert.match(metrics.warnings.join("\n"), /at least 3 return samples/);
  assert.match(metrics.warnings.join("\n"), /at least 20 return samples/);
});

test("replay performance metrics separate gross and cost-adjusted returns", () => {
  const metrics = summarizeReplayPerformanceMetrics({
    timeline: [
      {
        simulatedAt: "2025-01-01T00:00:00.000Z",
        virtualNetWorthKrw: 1_000
      },
      {
        simulatedAt: "2025-01-16T00:00:00.000Z",
        virtualNetWorthKrw: 900
      },
      {
        simulatedAt: "2025-02-15T00:00:00.000Z",
        virtualNetWorthKrw: 1_100
      }
    ],
    trades: [
      {
        tradeId: "trade_metric_cost",
        packetId: "packet_metric_cost",
        decisionId: "decision_metric_cost",
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        quantity: 1,
        priceKrw: 100,
        amountKrw: 100,
        feeKrw: 3,
        taxKrw: 2,
        slippageKrw: 1,
        spreadCostKrw: 4,
        impactCostKrw: 0,
        totalCostKrw: 999,
        status: "VIRTUAL_FILLED",
        executedAt: "2025-01-01T00:00:00.000Z"
      }
    ],
    averageExposureRatio: 0.5
  });

  assert.equal(metrics.initialNetWorthKrw, 1_000);
  assert.equal(metrics.finalNetWorthKrw, 1_100);
  assert.equal(metrics.totalReturnRatio, 0.1);
  assert.equal(metrics.costAdjustedTotalReturnRatio, 0.1);
  assert.equal(metrics.grossTotalReturnRatio, 0.11);
  assert.equal(metrics.costDragRatio, 0.01);
  assert.equal(metrics.maxDrawdownRatio, -0.1);
  assert.notEqual(metrics.cagrRatio, null);
  assert.notEqual(metrics.calmarRatio, null);
  assert.equal(metrics.exposureAdjustedReturnRatio, 0.2);
  assert.match(metrics.warnings.join("\n"), /at least 3 return samples/);
});

test("replay performance metrics use explicit pre-trade baseline", () => {
  const metrics = summarizeReplayPerformanceMetrics({
    initialNetWorthKrw: 1_000,
    timeline: [
      {
        simulatedAt: "2025-01-01T00:00:00.000Z",
        virtualNetWorthKrw: 990
      }
    ],
    trades: [
      {
        tradeId: "trade_metric_first_tick_cost",
        packetId: "packet_metric_first_tick_cost",
        decisionId: "decision_metric_first_tick_cost",
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        quantity: 1,
        priceKrw: 100,
        amountKrw: 100,
        feeKrw: 10,
        taxKrw: 0,
        slippageKrw: 0,
        spreadCostKrw: 0,
        impactCostKrw: 0,
        totalCostKrw: 999,
        status: "VIRTUAL_FILLED",
        executedAt: "2025-01-01T00:00:00.000Z"
      }
    ],
    averageExposureRatio: 0.5
  });

  assert.equal(metrics.initialNetWorthKrw, 1_000);
  assert.equal(metrics.finalNetWorthKrw, 990);
  assert.equal(metrics.sampleCount, 1);
  assert.equal(metrics.totalReturnRatio, -0.01);
  assert.equal(metrics.costAdjustedTotalReturnRatio, -0.01);
  assert.equal(metrics.grossTotalReturnRatio, 0);
  assert.equal(metrics.costDragRatio, 0.01);
  assert.equal(metrics.maxDrawdownRatio, -0.01);
  assert.equal(metrics.exposureAdjustedReturnRatio, -0.02);
});
