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
import { MarketPacketBuilder } from "../market/packetBuilder.js";
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
  assert.equal(
    first.decisions[0]?.decisions[0]?.confidenceBreakdown?.modelConfidence,
    0.55
  );
  assert.deepEqual(
    first.trades.map((trade) => trade.symbol),
    ["005930", "000660"]
  );
});

test("first priced provider skips buy-ineligible candidates without allocation", () => {
  const packetBuilder = new MarketPacketBuilder({
    packetId: "packet_buy_eligibility",
    generatedAt: new Date("2025-01-02T09:00:00+09:00"),
    expiresInSeconds: 60,
    maxCandidates: 2,
    constraints: {
      maxNewPositions: 2,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });
  const provider = new FirstPricedHistoricalDecisionProvider();
  const mixedPacket = packetBuilder.build({
    portfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: 70_000,
        ranking: 1,
        additionalBuyBlockedReasonCodes: ["TEST_BUY_BLOCKED"],
        sourceRefs: ["fixture:blocked"]
      },
      {
        market: "KR",
        symbol: "000660",
        lastPriceKrw: 100_000,
        ranking: 2,
        sourceRefs: ["fixture:eligible"]
      }
    ]
  }).packet;
  const blockedOnlyPacket = new MarketPacketBuilder({
    packetId: "packet_buy_blocked",
    generatedAt: new Date("2025-01-02T09:00:00+09:00"),
    expiresInSeconds: 60,
    maxCandidates: 1,
    constraints: {
      maxNewPositions: 1,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  }).build({
    portfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        lastPriceKrw: 70_000,
        additionalBuyBlockedReasonCodes: ["TEST_BUY_BLOCKED"],
        sourceRefs: ["fixture:blocked"]
      }
    ]
  }).packet;

  const mixedDecision = provider.decide(mixedPacket);
  const blockedOnlyDecision = provider.decide(blockedOnlyPacket);

  assert.deepEqual(
    mixedDecision.decisions.map((decision) => [decision.symbol, decision.action]),
    [["000660", "VIRTUAL_BUY"]]
  );
  assert.deepEqual(
    blockedOnlyDecision.decisions.map((decision) => [
      decision.symbol,
      decision.action
    ]),
    [["005930", "VIRTUAL_HOLD"]]
  );
});

test("first priced fixture uses allocation budget when present", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 200_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      allocationPolicy: {
        policyName: "fixture_allocation",
        targetExposureRatio: 0.85,
        minCashReserveRatio: 0.05,
        maxBudgetPerDecisionRatio: 0.2,
        maxSymbolExposureRatio: 0.3
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
        })
      ]
    }
  );

  assert.equal(result.decisionRecordCount, 1);
  assert.equal(result.decisions[0]?.decisions[0]?.budgetKrw, 200_000);
  assert.equal(result.trades[0]?.netAmountKrw, 200_000);
  assert.equal(result.finalPortfolio.cashKrw, 800_000);
  assert.equal(result.allocationPolicy?.targetExposureRatio, 0.85);
});

test("first priced fixture applies allocation budget as an aggregate decision cap", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      constraints: {
        maxNewPositions: 5,
        maxBudgetPerSymbolKrw: 200_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      allocationPolicy: {
        policyName: "fixture_allocation",
        targetExposureRatio: 0.85,
        minCashReserveRatio: 0.05,
        maxBudgetPerDecisionRatio: 0.2,
        maxSymbolExposureRatio: 0.3
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
          snapshotId: "hist_000660_0900",
          symbol: "000660",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 120_000
        }),
        snapshot({
          snapshotId: "hist_035420_0900",
          symbol: "035420",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 180_000
        })
      ]
    }
  );

  assert.deepEqual(
    result.decisions[0]?.decisions
      .map((decision) => decision.symbol)
      .sort(),
    ["000660"]
  );
  assert.deepEqual(
    result.decisions[0]?.decisions.map((decision) => decision.budgetKrw),
    [200_000]
  );
  assert.equal(result.tradeCount, 1);
  assert.equal(result.finalPortfolio.cashKrw, 800_000);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_DECISION_ALLOCATION_CAPPED"
    ),
    false
  );
});

test("first priced fixture respects market allocation budget", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      constraints: {
        maxNewPositions: 5,
        maxBudgetPerSymbolKrw: 200_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      allocationPolicy: {
        policyName: "fixture_market_allocation",
        targetExposureRatio: 0.85,
        minCashReserveRatio: 0.05,
        maxBudgetPerDecisionRatio: 0.2,
        maxSymbolExposureRatio: 0.3,
        marketTargetExposureRatios: {
          KR: 0.1,
          US: 0.4
        }
      }
    },
    {
      initialPortfolio: portfolio({
        cashKrw: 800_000,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 20,
            averagePriceKrw: 10_000,
            marketValueKrw: 200_000,
            updatedAt: "2025-01-02T09:00:00+09:00"
          }
        ]
      }),
      snapshots: [
        snapshot({
          snapshotId: "hist_000660_0900",
          symbol: "000660",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 70_000,
          market: "KR"
        }),
        snapshot({
          snapshotId: "hist_aapl_0900",
          symbol: "AAPL",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 120_000,
          market: "US"
        })
      ]
    }
  );

  assert.deepEqual(
    result.decisions[0]?.decisions.map((decision) => decision.market),
    ["US"]
  );
  assert.equal(result.decisions[0]?.decisions[0]?.budgetKrw, 200_000);
  assert.equal(result.trades[0]?.market, "US");
  assert.equal(result.tradeCount, 1);
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

test("historical replay runner applies dynamic cash reserve policy per tick", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 800_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      riskPolicy: {
        maxBudgetPerDecisionKrw: 800_000,
        maxSymbolExposureKrw: 800_000,
        maxPositionWeightRatio: 1,
        minCashReserveRatio: 0.05,
        dynamicCashReservePolicy: {
          lookbackDays: 3,
          minSymbols: 1,
          minSnapshotsPerSymbol: 2
        }
      }
    },
    {
      initialPortfolio: portfolio(),
      snapshots: [
        snapshot({
          snapshotId: "hist_005930_0101",
          symbol: "005930",
          observedAt: "2025-01-01T09:00:00+09:00",
          lastPriceKrw: 900_000
        }),
        snapshot({
          snapshotId: "hist_005930_0102",
          symbol: "005930",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 800_000
        })
      ]
    }
  );

  assert.equal(result.tradeCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.finalPortfolio.cashKrw, 1_000_000);
  assert.deepEqual(result.riskDecisions[0]?.rejectCodes, [
    "VIRTUAL_REGIME_CASH_RESERVE_BREACHED"
  ]);
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

test("historical replay runner executes paper exit policy on sampled-out provider steps", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      decisionProvider: new HoldDecisionProvider(),
      samplingPolicy: new ReplaySamplingPolicy({ everyNSteps: 2 }),
      paperExitPolicy: { takeProfitRatio: 0.15 }
    },
    {
      initialPortfolio: portfolio({
        cashKrw: 0,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 10,
            averagePriceKrw: 100,
            marketValueKrw: 1_000,
            updatedAt: "2025-01-02T08:59:00+09:00"
          }
        ]
      }),
      snapshots: [
        snapshot({
          snapshotId: "hist_005930_0900",
          symbol: "005930",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 100
        }),
        snapshot({
          snapshotId: "hist_005930_0901",
          symbol: "005930",
          observedAt: "2025-01-02T09:01:00+09:00",
          lastPriceKrw: 120
        })
      ]
    }
  );

  assert.deepEqual(
    result.samplingDecisions.map((item) => item.shouldEvaluate),
    [true, false]
  );
  assert.deepEqual(result.paperExitPolicy, {
    takeProfitRatio: 0.15,
    takeProfitMode: "full_exit"
  });
  assert.equal(result.decisionProviderCallCount, 1);
  assert.equal(result.decisionSkippedCount, 1);
  assert.equal(result.decisionRecordCount, 2);
  assert.equal(result.tradeCount, 1);
  assert.equal(result.trades[0]?.action, "VIRTUAL_SELL");
  assert.equal(result.finalPortfolio.cashKrw, 1_200);
  assert.equal(result.finalPortfolio.positions.length, 0);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "PAPER_EXIT_POLICY_RECORDED"
    ),
    true
  );
});

test("historical replay runner suppresses same-symbol provider items after filled exits", () => {
  const result = runHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      paperExitPolicy: { takeProfitRatio: 0.15 }
    },
    {
      initialPortfolio: portfolio({
        cashKrw: 0,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 10,
            averagePriceKrw: 100,
            marketValueKrw: 1_000,
            updatedAt: "2025-01-02T08:59:00+09:00"
          }
        ]
      }),
      snapshots: [
        snapshot({
          snapshotId: "hist_005930_0900",
          symbol: "005930",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 120
        })
      ]
    }
  );

  assert.equal(result.decisionProviderCallCount, 1);
  assert.equal(result.decisionRecordCount, 1);
  assert.equal(result.tradeCount, 1);
  assert.equal(result.trades[0]?.action, "VIRTUAL_SELL");
  assert.equal(result.finalPortfolio.cashKrw, 1_200);
  assert.equal(result.finalPortfolio.positions.length, 0);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_DECISION_ITEM_SUPPRESSED"
    ),
    true
  );
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
    const dataRef = candidate.sourceRefs[0] ?? `packet:${packet.packetId}`;
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
          dataRefs: [dataRef],
          claimSupport: [
            {
              claim: "Hold existing position.",
              dataRefs: [dataRef]
            }
          ],
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
  market?: HistoricalMarketSnapshot["market"];
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: input.market ?? "KR",
    symbol: input.symbol,
    observedAt: input.observedAt,
    interval: "1m",
    lastPriceKrw: input.lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-12T09:00:00+09:00"
  };
}
