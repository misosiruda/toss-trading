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

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00"
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
