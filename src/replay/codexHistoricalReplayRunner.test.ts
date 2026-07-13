import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import { ReplaySamplingPolicy } from "./replaySamplingPolicy.js";
import { SimulatedClock } from "./simulatedClock.js";
import {
  runCodexHistoricalReplay,
  type CodexHistoricalReplayRunnerOptions,
  type CodexHistoricalReplayDecisionProviderLike
} from "./codexHistoricalReplayRunner.js";
import type { HistoricalReplayProgressUpdate } from "./historicalReplayProgress.js";

test("codex historical replay runner executes async paper decisions", async () => {
  const provider = new FakeCodexReplayProvider((packet) => ({
    attempted: true,
    decision: decision(packet.packetId, packet.candidates[0]?.symbol ?? "005930"),
    failure: null,
    command: null
  }));
  const progressUpdates: HistoricalReplayProgressUpdate[] = [];

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      decisionProvider: provider,
      samplingPolicy: new ReplaySamplingPolicy({ everyNSteps: 2 }),
      onProgress: (update) => {
        progressUpdates.push(update);
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

  assert.equal(provider.calls, 2);
  assert.equal(result.packetCount, 3);
  assert.equal(result.decisionProviderCallCount, 2);
  assert.equal(result.decisionSkippedCount, 1);
  assert.equal(result.decisionRecordCount, 2);
  assert.equal(result.tradeCount, 2);
  assert.equal(
    result.decisions[0]?.decisions[0]?.confidenceBreakdown?.modelConfidence,
    0.6
  );
  assert.deepEqual(
    result.samplingDecisions.map((item) => item.shouldEvaluate),
    [true, false, true]
  );
  assert.equal(
    progressUpdates.some((update) => update.event?.eventType === "VIRTUAL_BUY"),
    true
  );
  const latestProgress = progressUpdates.at(-1);
  assert.equal(latestProgress?.packets.length, 3);
  assert.equal(latestProgress?.decisions.length, 2);
  assert.equal(
    latestProgress?.decisions[0]?.decisions[0]?.confidenceBreakdown
      ?.modelConfidence,
    0.6
  );
  assert.equal(latestProgress?.riskDecisions.length, 2);
  assert.equal(latestProgress?.trades.length, 2);
  assert.equal(latestProgress?.currentPortfolio.positions.length, 2);
  assert.equal(
    latestProgress?.performance !== undefined &&
      latestProgress.performance.tickElapsedMs >=
        latestProgress.performance.packetBuildMs,
    true
  );
});

test("codex historical replay runner passes candidate bucket scope to packets", async () => {
  const packets: MarketPacket[] = [];
  const provider = new FakeCodexReplayProvider((packet) => {
    packets.push(packet);
    return {
      attempted: true,
      decision: decision(packet.packetId, packet.candidates[0]?.symbol ?? "222222"),
      failure: null,
      command: null
    };
  });

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider,
      candidateStrategyBucket: "short_term"
    },
    {
      initialPortfolio: portfolio(),
      snapshots: [
        snapshot({
          snapshotId: "hist_long_term_0900",
          symbol: "111111",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 70_000,
          strategyBucket: "long_term"
        }),
        snapshot({
          snapshotId: "hist_short_term_0900",
          symbol: "222222",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 80_000,
          strategyBucket: "short_term"
        })
      ]
    }
  );

  assert.equal(provider.calls, 1);
  assert.equal(result.packetCount, 1);
  assert.deepEqual(
    packets[0]?.candidates.map((candidate) => [
      candidate.symbol,
      candidate.strategyBucket
    ]),
    [["222222", "short_term"]]
  );
  assert.equal(result.trades[0]?.symbol, "222222");
});

test("codex historical replay runner applies optional pacing once per tick", async () => {
  const delayCalls: number[] = [];
  const provider = new FakeCodexReplayProvider((packet) => ({
    attempted: true,
    decision: decision(packet.packetId, packet.candidates[0]?.symbol ?? "005930"),
    failure: null,
    command: null
  }));

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      decisionProvider: provider,
      tickDelayMs: 12,
      tickDelay: async (ms) => {
        delayCalls.push(ms);
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

  assert.equal(result.tickCount, 3);
  assert.deepEqual(delayCalls, [12, 12, 12]);
});

test("codex historical replay runner emits progress after each decision item", async () => {
  const provider = new FakeCodexReplayProvider((packet) => ({
    attempted: true,
    decision: {
      packetId: packet.packetId,
      summary: "Multiple decision item fixture.",
      decisions: [
        decision(packet.packetId, "005930").decisions[0]!,
        decision(packet.packetId, "000660").decisions[0]!
      ]
    },
    failure: null,
    command: null
  }));
  const progressUpdates: HistoricalReplayProgressUpdate[] = [];

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider,
      onProgress: (update) => {
        progressUpdates.push(update);
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
          lastPriceKrw: 100_000
        })
      ]
    }
  );

  const buyUpdates = progressUpdates.filter(
    (update) => update.event?.eventType === "VIRTUAL_BUY"
  );

  assert.equal(result.tradeCount, 2);
  assert.equal(buyUpdates.length, 2);
  assert.equal(buyUpdates[0]?.tradeCount, 1);
  assert.equal(buyUpdates[0]?.trades.length, 1);
  assert.equal(buyUpdates[0]?.event?.symbol, "005930");
  assert.equal(buyUpdates[1]?.tradeCount, 2);
  assert.equal(buyUpdates[1]?.trades.length, 2);
  assert.equal(buyUpdates[1]?.event?.symbol, "000660");
});

test("codex historical replay runner preserves unobserved market budget on first ramp packet", async () => {
  const provider = new FakeCodexReplayProvider((packet) => ({
    attempted: true,
    decision: {
      packetId: packet.packetId,
      summary: "KR-only first packet fixture.",
      decisions: ["005930", "000660", "035420"].map((symbol) => ({
        market: "KR" as const,
        symbol,
        action: "VIRTUAL_BUY" as const,
        confidence: 0.7,
        budgetKrw: 20_000_000,
        thesis: "Fixture requests aggressive first-packet BUY.",
        riskFactors: ["Paper-only replay risk."],
        dataRefs: [`historical_snapshot:${symbol}`],
        claimSupport: [
          {
            claim: "Fixture requests aggressive first-packet BUY.",
            dataRefs: [`historical_snapshot:${symbol}`]
          }
        ],
        expiresAt: "2025-01-02T00:05:00.000Z"
      }))
    },
    failure: null,
    command: null
  }));

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      constraints: {
        maxNewPositions: 5,
        maxBudgetPerSymbolKrw: 20_000_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      allocationPolicy: {
        policyName: "aggressive_paper_allocation",
        targetExposureRatio: 0.85,
        minCashReserveRatio: 0.05,
        maxBudgetPerDecisionRatio: 0.2,
        maxSymbolExposureRatio: 0.25,
        deploymentRampDays: 10,
        maxInitialDeploymentRatio: 0.25,
        maxInitialOpenPositions: 2,
        maxNewPositionsPerDay: 2,
        maxConcurrentPositions: 5,
        positionSlotRampDays: 10,
        marketTargetExposureRatios: {
          KR: 0.425,
          US: 0.425
        }
      },
      decisionProvider: provider
    },
    {
      initialPortfolio: portfolio({ cashKrw: 100_000_000 }),
      snapshots: [
        snapshot({
          snapshotId: "hist_005930_0900",
          symbol: "005930",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 10_000
        }),
        snapshot({
          snapshotId: "hist_000660_0900",
          symbol: "000660",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 10_000
        }),
        snapshot({
          snapshotId: "hist_035420_0900",
          symbol: "035420",
          observedAt: "2025-01-02T09:00:00+09:00",
          lastPriceKrw: 10_000
        })
      ]
    }
  );

  const allocation = result.packets[0]?.portfolioAllocation;
  assert.equal(allocation?.rampDayIndex, 1);
  assert.equal(allocation?.scheduledExposureCeilingRatio, 0.25);
  assert.equal(
    allocation?.marketAllocations?.KR?.maxAdditionalBuyBudgetKrw,
    12_500_000
  );
  assert.equal(
    allocation?.marketAllocations?.US?.maxAdditionalBuyBudgetKrw,
    12_500_000
  );
  assert.deepEqual(
    result.decisions[0]?.decisions.map((item) => item.action),
    ["VIRTUAL_BUY", "VIRTUAL_HOLD", "VIRTUAL_HOLD"]
  );
  assert.deepEqual(
    result.decisions[0]?.decisions.map((item) => item.budgetKrw),
    [12_500_000, 0, 0]
  );
  assert.equal(result.tradeCount, 1);
  assert.equal(result.trades[0]?.amountKrw, 12_500_000);
  assert.equal(result.finalPortfolio.cashKrw, 87_500_000);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_DECISION_ALLOCATION_CAPPED"
    ),
    true
  );
});

test("codex historical replay runner skips paper orders on provider failure", async () => {
  const provider = new FakeCodexReplayProvider(() => ({
    attempted: true,
    decision: null,
    failure: {
      code: "AI_DECISION_FAILED",
      reason: "fixture failure"
    },
    command: null
  }));

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider
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

  assert.equal(provider.calls, 1);
  assert.equal(result.decisionRecordCount, 0);
  assert.equal(result.tradeCount, 0);
  assert.equal(result.finalPortfolio.cashKrw, 1_000_000);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_AI_DECISION_FAILED"
    ),
    true
  );
});

test("codex historical replay runner records stderr details on provider failure", async () => {
  const provider = new FakeCodexReplayProvider(() => ({
    attempted: true,
    decision: null,
    failure: {
      code: "AI_DECISION_FAILED",
      reason: "exit_code_1",
      stderr: [
        "OpenAI Codex v0.130.0-alpha.5",
        "user prompt omitted",
        "ERROR: stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)"
      ].join("\n")
    },
    command: null
  }));

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider
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

  const failure = result.auditEvents.find(
    (event) => event.eventType === "HISTORICAL_AI_DECISION_FAILED"
  );
  assert.match(failure?.summary ?? "", /exit_code_1/);
  assert.match(failure?.summary ?? "", /api\.openai\.com/);
  assert.doesNotMatch(failure?.summary ?? "", /user prompt omitted/);
});

test("codex historical replay runner executes paper exit policy before provider failure", async () => {
  const provider = new FakeCodexReplayProvider(() => ({
    attempted: true,
    decision: null,
    failure: {
      code: "AI_DECISION_FAILED",
      reason: "fixture failure"
    },
    command: null
  }));
  const progressUpdates: HistoricalReplayProgressUpdate[] = [];

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider,
      paperExitPolicy: { takeProfitRatio: 0.15 },
      onProgress: (update) => {
        progressUpdates.push(update);
      }
    },
    {
      initialPortfolio: {
        portfolioId: "virtual_default",
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
        ],
        updatedAt: "2025-01-02T09:00:00+09:00"
      },
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

  assert.equal(provider.calls, 1);
  assert.deepEqual(result.paperExitPolicy, {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15
  });
  assert.equal(result.decisionRecordCount, 1);
  assert.equal(result.tradeCount, 1);
  assert.equal(result.trades[0]?.action, "VIRTUAL_SELL");
  assert.equal(result.finalPortfolio.cashKrw, 1_200);
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "HISTORICAL_AI_DECISION_FAILED"
    ),
    true
  );
  assert.equal(
    result.auditEvents.some(
      (event) => event.eventType === "PAPER_EXIT_POLICY_RECORDED"
    ),
    true
  );
  assert.equal(
    progressUpdates.some((update) => update.event?.eventType === "VIRTUAL_SELL"),
    true
  );
});

test("codex historical replay runner supports partial take-profit then trailing stop", async () => {
  const provider = new FakeCodexReplayProvider(() => ({
    attempted: true,
    decision: null,
    failure: {
      code: "AI_DECISION_FAILED",
      reason: "fixture failure"
    },
    command: null
  }));

  const result = await runCodexHistoricalReplay(
    {
      ...runnerOptions(),
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:03:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider,
      paperExitPolicy: {
        takeProfitRatio: 0.15,
        takeProfitMode: "partial_then_trail",
        takeProfitSellRatio: 0.5,
        trailingStopFromPeakRatio: 0.08
      }
    },
    {
      initialPortfolio: {
        portfolioId: "virtual_default",
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
        ],
        updatedAt: "2025-01-02T09:00:00+09:00"
      },
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
        }),
        snapshot({
          snapshotId: "hist_005930_0902",
          symbol: "005930",
          observedAt: "2025-01-02T09:02:00+09:00",
          lastPriceKrw: 140
        }),
        snapshot({
          snapshotId: "hist_005930_0903",
          symbol: "005930",
          observedAt: "2025-01-02T09:03:00+09:00",
          lastPriceKrw: 128
        })
      ]
    }
  );

  assert.equal(result.tradeCount, 2);
  assert.equal(result.trades[0]?.quantity, 5);
  assert.equal(result.trades[1]?.quantity, 5);
  assert.equal(result.finalPortfolio.positions.length, 0);
  assert.equal(result.finalPortfolio.cashKrw, 1_240);
  assert.equal(
    result.decisions
      .flatMap((decision) => decision.decisions)
      .filter((item) => item.thesis.includes("partial take-profit")).length,
    1
  );
  assert.equal(
    result.decisions
      .flatMap((decision) => decision.decisions)
      .some((item) => item.thesis.includes("trailing stop")),
    true
  );
});

test("codex historical replay runner emits risk rejection progress events", async () => {
  const baseOptions = runnerOptions();
  const provider = new FakeCodexReplayProvider((packet) => ({
    attempted: true,
    decision: decision(packet.packetId, packet.candidates[0]?.symbol ?? "005930", {
      budgetKrw: 2_000_000
    }),
    failure: null,
    command: null
  }));
  const progressUpdates: HistoricalReplayProgressUpdate[] = [];

  const result = await runCodexHistoricalReplay(
    {
      ...baseOptions,
      constraints: {
        ...baseOptions.constraints,
        maxBudgetPerSymbolKrw: 2_000_000
      },
      clock: new SimulatedClock({
        startAt: new Date("2025-01-02T09:00:00+09:00"),
        endAt: new Date("2025-01-02T09:00:00+09:00"),
        stepSeconds: 60
      }),
      decisionProvider: provider,
      onProgress: (update) => {
        progressUpdates.push(update);
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

  const rejectedUpdate = progressUpdates.find(
    (update) => update.event?.eventType === "RISK_REJECTED"
  );

  assert.equal(result.rejectedCount, 1);
  assert.equal(result.tradeCount, 0);
  assert.equal(rejectedUpdate?.event?.symbol, "005930");
  assert.equal(
    rejectedUpdate?.event?.rejectCodes.includes("VIRTUAL_CASH_EXCEEDED"),
    true
  );
});

class FakeCodexReplayProvider implements CodexHistoricalReplayDecisionProviderLike {
  calls = 0;

  constructor(
    private readonly factory: (packet: MarketPacket) => CodexCliDecisionResult
  ) {}

  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    this.calls += 1;
    return this.factory(packet);
  }
}

function runnerOptions(): Omit<
  CodexHistoricalReplayRunnerOptions,
  "decisionProvider" | "samplingPolicy"
> {
  return {
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:02:00+09:00"),
      stepSeconds: 60
    }),
    packetIdPrefix: "packet_historical_codex",
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

function portfolio(overrides: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00",
    ...overrides
  };
}

function decision(
  packetId: string,
  symbol: string,
  overrides: Partial<VirtualDecision["decisions"][number]> = {}
): VirtualDecision {
  return {
    packetId,
    summary: "Async Codex replay fixture.",
    decisions: [
      {
        market: "KR",
        symbol,
        action: "VIRTUAL_BUY",
        confidence: 0.6,
        budgetKrw: symbol === "005930" ? 70_000 : 100_000,
        thesis: "Fixture decision uses only the current historical packet.",
        riskFactors: ["Historical replay is paper-only."],
        dataRefs: [`historical_snapshot:${symbol}`],
        claimSupport: [
          {
            claim: "Fixture decision uses only the current historical packet.",
            dataRefs: [`historical_snapshot:${symbol}`]
          }
        ],
        expiresAt: "2025-01-02T00:05:00.000Z",
        ...overrides
      }
    ]
  };
}

function snapshot(input: {
  snapshotId: string;
  symbol: string;
  observedAt: string;
  lastPriceKrw: number;
  strategyBucket?: HistoricalMarketSnapshot["strategyBucket"];
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: input.symbol,
    observedAt: input.observedAt,
    interval: "1m",
    lastPriceKrw: input.lastPriceKrw,
    ...(input.strategyBucket === undefined
      ? {}
      : { strategyBucket: input.strategyBucket }),
    volume: 100_000,
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-12T09:00:00+09:00"
  };
}
