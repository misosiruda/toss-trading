import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import {
  FirstPricedHistoricalDecisionProvider,
  runHistoricalReplay
} from "./historicalReplayRunner.js";
import {
  runCodexHistoricalReplay,
  type CodexHistoricalReplayDecisionProviderLike
} from "./codexHistoricalReplayRunner.js";
import { SimulatedClock } from "./simulatedClock.js";

test("historical replay runner applies market regime allocation budget", () => {
  const result = runHistoricalReplay(
    {
      clock: oneTickClock(),
      decisionProvider: new FirstPricedHistoricalDecisionProvider(),
      packetIdPrefix: "packet_regime_allocation",
      packetExpiresInSeconds: 60,
      maxCandidates: 10,
      maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
      constraints: {
        maxNewPositions: 5,
        maxBudgetPerSymbolKrw: 200_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      allocationPolicy: allocationPolicy(),
      marketRegimeAllocationPolicy: {
        lookbackDays: 20,
        minSymbols: 1,
        minSnapshotsPerSymbol: 2
      }
    },
    {
      initialPortfolio: portfolio({
        cashKrw: 800_000,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 2_000,
            averagePriceKrw: 100,
            marketValueKrw: 200_000,
            updatedAt: "2025-01-20T09:00:00+09:00"
          }
        ]
      }),
      snapshots: regimeSnapshots()
    }
  );

  const allocation = result.packets[0]?.portfolioAllocation;

  assert.equal(allocation?.policyName, "fixture_market_allocation_market_regime");
  assert.ok(
    (allocation?.marketTargetExposureRatios?.US ?? 0) >
      (allocation?.marketTargetExposureRatios?.KR ?? 0)
  );
  assert.deepEqual(
    result.decisions[0]?.decisions.map((decision) => decision.market),
    ["US"]
  );
  assert.equal(result.tradeCount, 1);
});

test("codex historical replay runner applies market regime allocation budget to packet", async () => {
  const packets: MarketPacket[] = [];
  const provider = new FakeCodexReplayProvider((packet) => {
    packets.push(packet);
    return {
      attempted: true,
      decision: {
        packetId: packet.packetId,
        summary: "No-op fixture.",
        decisions: []
      },
      failure: null,
      command: null
    };
  });

  const result = await runCodexHistoricalReplay(
    {
      clock: oneTickClock(),
      decisionProvider: provider,
      packetIdPrefix: "packet_regime_allocation_codex",
      packetExpiresInSeconds: 60,
      maxCandidates: 10,
      maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 100_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      },
      allocationPolicy: allocationPolicy(),
      marketRegimeAllocationPolicy: {
        lookbackDays: 20,
        minSymbols: 1,
        minSnapshotsPerSymbol: 2
      }
    },
    {
      initialPortfolio: portfolio(),
      snapshots: regimeSnapshots()
    }
  );

  const allocation = packets[0]?.portfolioAllocation;

  assert.equal(result.packetCount, 1);
  assert.equal(provider.calls, 1);
  assert.equal(allocation?.policyName, "fixture_market_allocation_market_regime");
  assert.ok(
    (allocation?.marketTargetExposureRatios?.US ?? 0) >
      (allocation?.marketTargetExposureRatios?.KR ?? 0)
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

function oneTickClock(): SimulatedClock {
  return new SimulatedClock({
    startAt: new Date("2025-01-20T09:00:00+09:00"),
    endAt: new Date("2025-01-20T09:00:00+09:00"),
    stepSeconds: 60
  });
}

function allocationPolicy() {
  return {
    policyName: "fixture_market_allocation",
    targetExposureRatio: 0.85,
    minCashReserveRatio: 0.05,
    maxBudgetPerDecisionRatio: 0.2,
    maxSymbolExposureRatio: 0.3
  };
}

function portfolio(overrides: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-20T09:00:00+09:00",
    ...overrides
  };
}

function regimeSnapshots(): HistoricalMarketSnapshot[] {
  return [
    snapshot("hist_005930_0102", "KR", "005930", "2025-01-02T09:00:00+09:00", 100),
    snapshot("hist_005930_0120", "KR", "005930", "2025-01-20T09:00:00+09:00", 90),
    snapshot("hist_aapl_0102", "US", "AAPL", "2025-01-02T09:00:00+09:00", 100),
    snapshot("hist_aapl_0120", "US", "AAPL", "2025-01-20T09:00:00+09:00", 112)
  ];
}

function snapshot(
  snapshotId: string,
  market: HistoricalMarketSnapshot["market"],
  symbol: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market,
    symbol,
    observedAt,
    interval: "1m",
    lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: "2026-06-15T09:00:00+09:00"
  };
}
