import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  FirstPricedHistoricalDecisionProvider,
  runHistoricalReplay,
  type HistoricalReplayDecisionContext,
  type HistoricalReplayDecisionProvider,
  type HistoricalReplayRunnerOptions
} from "./historicalReplayRunner.js";
import { ReplaySamplingPolicy } from "./replaySamplingPolicy.js";
import { SimulatedClock } from "./simulatedClock.js";

test("historical replay runner is deterministic without AI", () => {
  const first = runHistoricalReplay(runnerOptions(), {
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
      })
    ]
  });
  const second = runHistoricalReplay(runnerOptions(), {
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
      })
    ]
  });

  assert.deepEqual(first, second);
  assert.equal(first.status, "completed");
  assert.equal(first.tickCount, 2);
  assert.equal(first.packetCount, 2);
  assert.equal(first.tradeCount, 2);
  assert.equal(first.finalPortfolio.cashKrw, 830_000);
  assert.deepEqual(
    first.trades.map((trade) => trade.symbol),
    ["005930", "000660"]
  );
});

test("historical replay runner leaves portfolio unchanged on risk reject", () => {
  const result = runHistoricalReplay(runnerOptions(), {
    initialPortfolio: portfolio({ cashKrw: 50 }),
    snapshots: [
      snapshot({
        snapshotId: "hist_005930_0900",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      })
    ]
  });

  assert.equal(result.tradeCount, 0);
  assert.equal(result.rejectedCount, 2);
  assert.equal(result.finalPortfolio.cashKrw, 50);
  assert.equal(result.finalPortfolio.positions.length, 0);
});

test("historical replay runner skips packets when only future snapshots exist", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      })
    },
    {
      initialPortfolio: portfolio(),
      snapshots: [
        snapshot({
          snapshotId: "hist_future",
          symbol: "005930",
          observedAt: "2025-01-02T09:01:00+09:00",
          lastPriceKrw: 70_000
        })
      ]
    }
  );

  assert.equal(result.tickCount, 1);
  assert.equal(result.packetCount, 0);
  assert.equal(result.tradeCount, 0);
  assert.equal(result.finalPortfolio.cashKrw, 1_000_000);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_PACKET_SKIPPED"
    ),
    true
  );
  assert.equal(result.warnings.some((warning) => warning.includes("future")), true);
});

test("historical replay runner preserves portfolio on sampled-out steps", () => {
  const decisionProvider = new CountingDecisionProvider();
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:02:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider,
      samplingPolicy: new ReplaySamplingPolicy({ everyNSteps: 2 })
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

  assert.equal(decisionProvider.calls, 2);
  assert.equal(result.packetCount, 3);
  assert.equal(result.decisionProviderCallCount, 2);
  assert.equal(result.decisionSkippedCount, 1);
  assert.equal(result.tradeCount, 2);
  assert.equal(result.portfolioTimeline.length, 3);
  assert.deepEqual(
    result.samplingDecisions.map((item) => item.shouldEvaluate),
    [true, false, true]
  );
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_DECISION_SKIPPED"
    ),
    true
  );
  assert.equal(result.progressSummary.decisionsSkipped, 1);
  assert.equal(result.progressSummary.decisionsRequested, 2);
});

test("historical replay runner marks held positions to current market prices", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      decisionProvider: new HoldDecisionProvider(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      })
    },
    {
      initialPortfolio: portfolio({
        cashKrw: 500_000,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 2,
            averagePriceKrw: 70_000,
            marketValueKrw: 140_000,
            updatedAt: "2025-01-02T08:59:00+09:00"
          }
        ]
      }),
      snapshots: [
        snapshot({
          snapshotId: "hist_005930_0900",
          symbol: "005930",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 80_000
        })
      ]
    }
  );

  const finalPosition = result.finalPortfolio.positions[0];
  const timelineItem = result.portfolioTimeline.at(-1);

  assert.equal(finalPosition?.marketPriceKrw, 80_000);
  assert.equal(finalPosition?.marketValueKrw, 160_000);
  assert.equal(finalPosition?.unrealizedPnlKrw, 20_000);
  assert.equal(timelineItem?.positionMarketValueKrw, 160_000);
  assert.equal(timelineItem?.virtualNetWorthKrw, 660_000);
});

function runnerOptions(): HistoricalReplayRunnerOptions {
  return {
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:01:00+09:00"),
      stepSeconds: 60
    }),
    decisionProvider: new FirstPricedHistoricalDecisionProvider(),
    packetIdPrefix: "packet_historical",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

class CountingDecisionProvider implements HistoricalReplayDecisionProvider {
  calls = 0;
  private readonly delegate = new FirstPricedHistoricalDecisionProvider();

  decide(
    packet: Parameters<HistoricalReplayDecisionProvider["decide"]>[0],
    _context: HistoricalReplayDecisionContext
  ) {
    this.calls += 1;
    return this.delegate.decide(packet);
  }
}

class HoldDecisionProvider implements HistoricalReplayDecisionProvider {
  decide(
    packet: Parameters<HistoricalReplayDecisionProvider["decide"]>[0]
  ): VirtualDecision {
    const candidate = packet.candidates[0];
    assert.ok(candidate);
    return {
      packetId: packet.packetId,
      summary: "Hold fixture.",
      decisions: [
        {
          market: candidate.market,
          symbol: candidate.symbol,
          action: "VIRTUAL_HOLD",
          confidence: 0.5,
          budgetKrw: 0,
          thesis: "Hold existing position.",
          riskFactors: [],
          dataRefs: [candidate.sourceRefs[0] ?? `packet:${packet.packetId}`],
          expiresAt: packet.expiresAt
        }
      ]
    };
  }
}

function portfolio(overrides: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00",
    ...overrides
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
