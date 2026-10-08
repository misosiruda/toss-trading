import type { HistoricalMarketSnapshot, MarketPacket, VirtualPortfolio } from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import type { CodexHistoricalReplayRunnerOptions } from "./codexHistoricalReplayRunner.js";
import { SimulatedClock } from "./simulatedClock.js";

export const sourceTime = "2025-01-03T00:00:00.000Z";
export const sourceEarlierTime = "2025-01-02T00:00:00.000Z";

export function sourceSnapshot(overrides: Partial<HistoricalMarketSnapshot> = {}): HistoricalMarketSnapshot {
  return {
    snapshotId: "source_fixture", market: "KR", symbol: "005930", observedAt: sourceTime,
    interval: "1d", lastPriceKrw: 110, volume: 100_000,
    sourceRefs: ["fixture:source"], riskTags: ["currency_exposed"], createdAt: sourceTime,
    ...overrides
  };
}

export function sourcePortfolio(overrides: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "source_portfolio", cashKrw: 1_000_000, positions: [], updatedAt: sourceTime,
    ...overrides
  };
}

export function heldSourcePortfolio(): VirtualPortfolio {
  return sourcePortfolio({
    cashKrw: 0,
    positions: [{ market: "KR", symbol: "005930", quantity: 2.5, averagePriceKrw: 100,
      marketValueKrw: 250, updatedAt: sourceEarlierTime }]
  });
}

export function sourceOptions(
  overrides: Partial<CodexHistoricalReplayRunnerOptions> = {}
): CodexHistoricalReplayRunnerOptions {
  return {
    clock: new SimulatedClock({ startAt: new Date(sourceTime), endAt: new Date(sourceTime), stepSeconds: 60 }),
    packetIdPrefix: "source_packet", packetExpiresInSeconds: 60, maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    constraints: { maxNewPositions: 3, maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"] },
    decisionProvider: { decide: async packet => sourceDecision(packet) },
    ...overrides
  };
}

export function sourceDecision(packet: MarketPacket, buySymbol?: string): CodexCliDecisionResult {
  return {
    attempted: true, command: null, failure: null,
    decision: {
      packetId: packet.packetId, summary: "Synthetic source ownership fixture.",
      decisions: buySymbol === undefined ? [] : [{
        market: "KR", symbol: buySymbol, action: "VIRTUAL_BUY", confidence: 0.6, budgetKrw: 80_000,
        thesis: "Synthetic paper-only decision.", riskFactors: ["Synthetic fixture."],
        dataRefs: ["fixture:source"], expiresAt: packet.expiresAt
      }]
    }
  };
}

export function sourceGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
