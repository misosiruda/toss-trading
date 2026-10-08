import type { MarketPacket } from "../domain/schemas.js";
import type { ReplaySettingsSnapshot } from "../domain/replaySettingsSnapshot.js";
import type { CodexHistoricalReplayRunnerOptions } from "./codexHistoricalReplayRunner.js";
import { sourceDecision, sourceEarlierTime, sourceOptions, sourcePortfolio, sourceSnapshot, sourceTime } from "./codexReplaySourceTestFixtures.js";
import { SimulatedClock } from "./simulatedClock.js";

export function settingsDecision(packet: MarketPacket, budgetKrw = 10_000) {
  const result = sourceDecision(packet, "000660");
  result.decision!.decisions[0]!.budgetKrw = budgetKrw;
  return result;
}

export function settingsScenario() {
  const supplied = {
    packetIdPrefix: "settings_packet", packetExpiresInSeconds: 120, maxCandidates: 2,
    maxSnapshotAgeSeconds: 90, candidateStrategyBucket: "short_term", tickDelayMs: 7,
    constraints: { maxNewPositions: 2, maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"] },
    executionPolicy: { slippageBps: 100, feeBps: 100, taxBps: 200, halfSpreadBps: 50,
      fillRatio: 0.5, allowFractionalShares: false, maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1, rejectStaleLiquidity: false, marketImpactBpsPerParticipationRate: 1_000 },
    riskPolicy: { maxBudgetPerDecisionKrw: 100_000, maxSymbolExposureKrw: 100_000,
      maxPositionWeightRatio: 1, minCashReserveRatio: 0,
      maxStrategyBucketExposureKrw: { short_term: 100_000 }, maxBucketTurnoverKrw: { short_term: 100_000 },
      cooldownEntries: [{ market: "KR", symbol: "000660", action: "VIRTUAL_BUY", activeUntil: sourceEarlierTime }] },
    paperExitPolicy: { takeProfitRatio: 0.15 }
  } satisfies ReplaySettingsSnapshot;
  const delays: number[] = [];
  const options = sourceOptions({ ...structuredClone(supplied),
    clock: new SimulatedClock({ startAt: new Date(sourceTime),
      endAt: new Date(Date.parse(sourceTime) + 60_000), stepSeconds: 60 }),
    onSettings: () => {}, onSourceSnapshots: () => {},
    decisionProvider: { decide: async packet => settingsDecision(packet) },
    tickDelay: async ms => { delays.push(ms); }
  });
  const input = {
    initialPortfolio: sourcePortfolio({ cashKrw: 98_800, positions: [{ market: "KR", symbol: "005930",
      quantity: 10, averagePriceKrw: 100, marketValueKrw: 1_000, updatedAt: sourceEarlierTime }] }),
    snapshots: [
      sourceSnapshot({ lastPriceKrw: 120, strategyBucket: "short_term" }),
      sourceSnapshot({ snapshotId: "buy", symbol: "000660", lastPriceKrw: 100, strategyBucket: "short_term" }),
      sourceSnapshot({ snapshotId: "wrong_scope", symbol: "035420", strategyBucket: "swing" }),
      sourceSnapshot({ snapshotId: "stale", symbol: "035720", strategyBucket: "short_term",
        observedAt: new Date(Date.parse(sourceTime) - 120_000).toISOString() })
    ]
  };
  return { supplied, options, input, delays };
}

export function mutateSettings(settings: Pick<CodexHistoricalReplayRunnerOptions,
  "packetIdPrefix" | "packetExpiresInSeconds" | "maxCandidates" | "maxSnapshotAgeSeconds" |
  "candidateStrategyBucket" | "tickDelayMs" | "constraints" | "executionPolicy" | "riskPolicy" | "paperExitPolicy">): void {
  settings.packetIdPrefix = "mutated_packet";
  settings.packetExpiresInSeconds = 1;
  settings.maxCandidates = 1;
  settings.maxSnapshotAgeSeconds = 1;
  settings.candidateStrategyBucket = "swing";
  settings.tickDelayMs = 31;
  settings.constraints.maxNewPositions = 0;
  settings.constraints.maxBudgetPerSymbolKrw = 1;
  settings.constraints.allowedActions.splice(0, 3, "VIRTUAL_HOLD");
  settings.executionPolicy!.slippageBps = 0;
  settings.executionPolicy!.feeBps = 0;
  settings.executionPolicy!.taxBps = 0;
  settings.executionPolicy!.halfSpreadBps = 0;
  settings.executionPolicy!.fillRatio = 1;
  settings.executionPolicy!.allowFractionalShares = true;
  settings.executionPolicy!.maxVolumeParticipationRate = 0.000001;
  settings.executionPolicy!.minLiquidityFillRatio = 1;
  settings.executionPolicy!.rejectStaleLiquidity = true;
  settings.executionPolicy!.marketImpactBpsPerParticipationRate = 0;
  settings.riskPolicy!.maxBudgetPerDecisionKrw = 1;
  settings.riskPolicy!.maxStrategyBucketExposureKrw!.short_term = 1;
  settings.riskPolicy!.maxBucketTurnoverKrw!.short_term = 1;
  settings.riskPolicy!.cooldownEntries![0]!.activeUntil = "2030-01-01T00:00:00.000Z";
  settings.paperExitPolicy!.takeProfitRatio = 9;
}
