import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketPacket,
  VirtualPortfolio,
  VirtualTrade
} from "../domain/schemas.js";
import type { HistoricalReplayResult } from "../replay/historicalReplayRunner.js";
import { buildHistoricalReplayBenchmarks } from "./historicalReplayBenchmark.js";

test("historical replay benchmarks include strategy comparison deltas", () => {
  const benchmarks = buildHistoricalReplayBenchmarks(
    replayResult({
      portfolioTimelineValues: [1_000, 1_100],
      packets: [
        packet("packet_0", [{ symbol: "AAA", lastPriceKrw: 100 }]),
        packet("packet_1", [{ symbol: "AAA", lastPriceKrw: 120 }])
      ],
      trades: [trade({ amountKrw: 500, feeKrw: 10 })]
    })
  );

  assert.equal(benchmarks.strategy.totalReturnRatio, 0.1);
  assert.equal(benchmarks.cashOnly.totalReturnRatio, 0);
  assert.equal(benchmarks.equalWeightBuyAndHold?.totalReturnRatio, 0.2);

  assert.equal(
    benchmarks.comparisons.strategyVsCashOnly.benchmarkAvailable,
    true
  );
  assert.equal(
    benchmarks.comparisons.strategyVsCashOnly.finalNetWorthDeltaKrw,
    100
  );
  assert.equal(
    benchmarks.comparisons.strategyVsCashOnly.totalReturnDeltaRatio,
    0.1
  );
  assert.equal(benchmarks.comparisons.strategyVsCashOnly.feeDragDeltaKrw, 10);

  assert.equal(
    benchmarks.comparisons.strategyVsEqualWeightBuyAndHold.finalNetWorthDeltaKrw,
    -100
  );
  assert.equal(
    benchmarks.comparisons.strategyVsEqualWeightBuyAndHold.totalReturnDeltaRatio,
    -0.1
  );
});

test("equal-weight benchmark enters only after the first priced replay packet", () => {
  const benchmarks = buildHistoricalReplayBenchmarks(
    replayResult({
      portfolioTimelineValues: [1_000, 1_000, 1_000],
      packets: [
        packet("packet_0", [{ symbol: "AAA" }]),
        packet("packet_1", [{ symbol: "AAA", lastPriceKrw: 100 }]),
        packet("packet_2", [{ symbol: "AAA", lastPriceKrw: 110 }])
      ]
    })
  );

  assert.equal(benchmarks.equalWeightBuyAndHold?.initialNetWorthKrw, 1_000);
  assert.equal(benchmarks.equalWeightBuyAndHold?.finalNetWorthKrw, 1_100);
  assert.equal(benchmarks.equalWeightBuyAndHold?.totalReturnRatio, 0.1);
});

test("equal-weight comparison is unavailable without priced candidates", () => {
  const benchmarks = buildHistoricalReplayBenchmarks(
    replayResult({
      portfolioTimelineValues: [1_000, 1_010],
      packets: [packet("packet_0", [{ symbol: "AAA" }])]
    })
  );

  assert.equal(benchmarks.equalWeightBuyAndHold, null);
  assert.equal(
    benchmarks.comparisons.strategyVsEqualWeightBuyAndHold.benchmarkAvailable,
    false
  );
  assert.equal(
    benchmarks.comparisons.strategyVsEqualWeightBuyAndHold.totalReturnDeltaRatio,
    null
  );
});

function replayResult(input: {
  portfolioTimelineValues: number[];
  packets: MarketPacket[];
  trades?: VirtualTrade[];
}): HistoricalReplayResult {
  const initialNetWorthKrw = input.portfolioTimelineValues[0] ?? 0;
  const finalNetWorthKrw =
    input.portfolioTimelineValues.at(-1) ?? initialNetWorthKrw;

  return {
    status: "completed",
    mode: "paper_only",
    tickCount: input.portfolioTimelineValues.length,
    packetCount: input.packets.length,
    decisionProviderCallCount: 0,
    decisionSkippedCount: 0,
    decisionRecordCount: 0,
    decisionItemCount: 0,
    tradeCount: input.trades?.length ?? 0,
    rejectedCount: 0,
    packets: input.packets,
    decisions: [],
    riskDecisions: [],
    trades: input.trades ?? [],
    auditEvents: [],
    warnings: [],
    samplingPolicy: null,
    allocationPolicy: null,
    paperExitPolicy: null,
    samplingDecisions: [],
    progressSummary: {
      totalTicks: input.portfolioTimelineValues.length,
      packetsCreated: input.packets.length,
      decisionsRequested: 0,
      decisionsSkipped: 0,
      tradesCreated: input.trades?.length ?? 0,
      maxCandidatesPerStep: 10
    },
    initialPortfolio: portfolio(initialNetWorthKrw),
    finalPortfolio: portfolio(finalNetWorthKrw),
    portfolioTimeline: input.portfolioTimelineValues.map((value, index) => ({
      simulatedAt: new Date(Date.UTC(2025, 0, 1, 0, index, 0)).toISOString(),
      cashKrw: value,
      positionCount: 0,
      positionMarketValueKrw: 0,
      virtualNetWorthKrw: value
    }))
  };
}

function packet(
  packetId: string,
  candidates: Array<{ symbol: string; lastPriceKrw?: number }>
): MarketPacket {
  return {
    packetId,
    mode: "paper_only",
    generatedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-01-01T00:05:00.000Z",
    virtualPortfolio: portfolio(1_000),
    candidates: candidates.map((candidate, index) => ({
      market: "KR",
      symbol: candidate.symbol,
      name: `Fixture ${candidate.symbol}`,
      ranking: index + 1,
      reasonCodes: ["FIXTURE"],
      sourceRefs: [`fixture:${packetId}:${candidate.symbol}`],
      collectedAt: "2025-01-01T00:00:00.000Z",
      staleAfter: "2025-01-01T00:05:00.000Z",
      ...(candidate.lastPriceKrw === undefined
        ? {}
        : { lastPriceKrw: candidate.lastPriceKrw })
    })),
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function portfolio(cashKrw: number): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw,
    positions: [],
    updatedAt: "2025-01-01T00:00:00.000Z"
  };
}

function trade(input: { amountKrw: number; feeKrw: number }): VirtualTrade {
  return {
    tradeId: "trade_fixture",
    packetId: "packet_0",
    decisionId: "decision_fixture",
    market: "KR",
    symbol: "AAA",
    action: "VIRTUAL_BUY",
    quantity: 5,
    priceKrw: 100,
    amountKrw: input.amountKrw,
    grossAmountKrw: input.amountKrw,
    feeKrw: input.feeKrw,
    taxKrw: 0,
    slippageKrw: 0,
    status: "VIRTUAL_FILLED",
    executedAt: "2025-01-01T00:00:00.000Z"
  };
}
