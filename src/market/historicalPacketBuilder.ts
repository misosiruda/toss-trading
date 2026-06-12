import type {
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  MarketPacketBuilder,
  type MarketPacketConstraints,
  type MarketCandidateDraft
} from "./packetBuilder.js";

export interface HistoricalMarketPacketBuilderOptions {
  packetId: string;
  simulatedAt: Date;
  expiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
}

export interface HistoricalMarketPacketBuildInput {
  portfolio: VirtualPortfolio;
  snapshots?: HistoricalMarketSnapshot[];
  snapshotIndex?: HistoricalMarketSnapshotIndex;
}

export type HistoricalMarketPacketBuildResult =
  | {
      status: "ok";
      packet: MarketPacket;
      warnings: string[];
      sourceSnapshotCount: number;
      candidateSnapshotCount: number;
      excludedFutureCount: number;
      excludedStaleCount: number;
    }
  | {
      status: "failed";
      reason: "NO_HISTORICAL_CANDIDATES";
      warnings: string[];
      sourceSnapshotCount: number;
      candidateSnapshotCount: 0;
      excludedFutureCount: number;
      excludedStaleCount: number;
    };

interface HistoricalCandidateFeatures {
  score: number;
  reasonCodes: string[];
}

interface IndexedHistoricalMarketSnapshot {
  snapshot: HistoricalMarketSnapshot;
  observedAtMs: number;
}

const maxDetailedExclusionWarnings = 20;

export class HistoricalMarketSnapshotIndex {
  private readonly snapshotsByTime: IndexedHistoricalMarketSnapshot[];
  private readonly snapshotsBySymbol = new Map<
    string,
    IndexedHistoricalMarketSnapshot[]
  >();

  constructor(snapshots: HistoricalMarketSnapshot[]) {
    this.snapshotsByTime = snapshots
      .map((snapshot) => ({
        snapshot,
        observedAtMs: Date.parse(snapshot.observedAt)
      }))
      .sort(compareIndexedSnapshotFreshness);

    for (const item of this.snapshotsByTime) {
      const key = `${item.snapshot.market}:${item.snapshot.symbol}`;
      const current = this.snapshotsBySymbol.get(key) ?? [];
      current.push(item);
      this.snapshotsBySymbol.set(key, current);
    }
  }

  get sourceSnapshotCount(): number {
    return this.snapshotsByTime.length;
  }

  latestFreshSnapshots(input: {
    simulatedAt: Date;
    maxSnapshotAgeSeconds: number;
  }): HistoricalMarketSnapshot[] {
    const simulatedAtMs = input.simulatedAt.getTime();
    const staleBeforeMs = simulatedAtMs - input.maxSnapshotAgeSeconds * 1000;
    const selectedSnapshots: IndexedHistoricalMarketSnapshot[] = [];

    for (const history of this.snapshotsBySymbol.values()) {
      const currentIndex = upperBoundObservedAt(history, simulatedAtMs) - 1;
      if (currentIndex < 0) {
        continue;
      }

      const current = history[currentIndex];
      if (current === undefined || current.observedAtMs < staleBeforeMs) {
        continue;
      }

      selectedSnapshots.push(current);
    }

    return selectedSnapshots.map((item) => item.snapshot).sort(compareCandidateSnapshots);
  }

  build(
    options: HistoricalMarketPacketBuilderOptions,
    portfolio: VirtualPortfolio
  ): HistoricalMarketPacketBuildResult {
    const simulatedAtMs = options.simulatedAt.getTime();
    const staleBeforeMs = simulatedAtMs - options.maxSnapshotAgeSeconds * 1000;
    const firstFutureIndex = upperBoundObservedAt(
      this.snapshotsByTime,
      simulatedAtMs
    );
    const firstFreshIndex = lowerBoundObservedAt(
      this.snapshotsByTime,
      staleBeforeMs
    );
    const excludedFutureCount = this.snapshotsByTime.length - firstFutureIndex;
    const excludedStaleCount = firstFreshIndex;
    const warnings = exclusionWarnings(
      this.snapshotsByTime,
      firstFreshIndex,
      firstFutureIndex,
      excludedStaleCount,
      excludedFutureCount
    );

    const selectedSnapshots = this.latestFreshSnapshots({
      simulatedAt: options.simulatedAt,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds
    });
    const featureHistoryBySnapshotId = new Map<
      string,
      HistoricalMarketSnapshot[]
    >();

    for (const history of this.snapshotsBySymbol.values()) {
      const currentIndex = upperBoundObservedAt(history, simulatedAtMs) - 1;
      if (currentIndex < 0) {
        continue;
      }

      const current = history[currentIndex];
      if (current === undefined || current.observedAtMs < staleBeforeMs) {
        continue;
      }

      featureHistoryBySnapshotId.set(
        current.snapshot.snapshotId,
        history
          .slice(Math.max(0, currentIndex - 5), currentIndex + 1)
          .map((item) => item.snapshot)
      );
    }

    const candidates = selectedSnapshots
      .slice(0, options.maxCandidates)
      .map((snapshot, index) =>
        toCandidateDraft(
          snapshot,
          index + 1,
          options,
          deriveCandidateFeatures(
            snapshot,
            featureHistoryBySnapshotId.get(snapshot.snapshotId) ?? [snapshot]
          )
        )
      );

    if (candidates.length === 0) {
      return {
        status: "failed",
        reason: "NO_HISTORICAL_CANDIDATES",
        warnings:
          warnings.length > 0
            ? warnings
            : ["historical packet failed: no snapshots available"],
        sourceSnapshotCount: this.sourceSnapshotCount,
        candidateSnapshotCount: 0,
        excludedFutureCount,
        excludedStaleCount
      };
    }

    const result = new MarketPacketBuilder({
      packetId: options.packetId,
      generatedAt: options.simulatedAt,
      expiresInSeconds: options.expiresInSeconds,
      maxCandidates: options.maxCandidates,
      constraints: options.constraints
    }).build({
      portfolio,
      candidates
    });

    return {
      status: "ok",
      packet: result.packet,
      warnings: [...warnings, ...result.warnings],
      sourceSnapshotCount: this.sourceSnapshotCount,
      candidateSnapshotCount: candidates.length,
      excludedFutureCount,
      excludedStaleCount
    };
  }
}

export class HistoricalMarketPacketBuilder {
  constructor(private readonly options: HistoricalMarketPacketBuilderOptions) {
    validateOptions(options);
  }

  build(
    input: HistoricalMarketPacketBuildInput
  ): HistoricalMarketPacketBuildResult {
    const snapshotIndex =
      input.snapshotIndex ??
      new HistoricalMarketSnapshotIndex(input.snapshots ?? []);
    return snapshotIndex.build(this.options, input.portfolio);
  }
}

function toCandidateDraft(
  snapshot: HistoricalMarketSnapshot,
  ranking: number,
  options: HistoricalMarketPacketBuilderOptions,
  features: HistoricalCandidateFeatures
): MarketCandidateDraft {
  return {
    market: snapshot.market,
    symbol: snapshot.symbol,
    lastPriceKrw: snapshot.lastPriceKrw,
    ranking,
    score: features.score,
    reasonCodes: [
      `HISTORICAL_${snapshot.interval}`,
      "HISTORICAL_REPLAY",
      ...features.reasonCodes
    ],
    sourceRefs: [
      `historical_snapshot:${snapshot.snapshotId}`,
      ...snapshot.sourceRefs
    ],
    collectedAt: snapshot.observedAt,
    staleAfter: new Date(
      Date.parse(snapshot.observedAt) + options.maxSnapshotAgeSeconds * 1000
    ).toISOString()
  };
}

function deriveCandidateFeatures(
  current: HistoricalMarketSnapshot,
  history: HistoricalMarketSnapshot[]
): HistoricalCandidateFeatures {
  const currentObservedAtMs = Date.parse(current.observedAt);
  const pastSnapshots = history.filter(
    (snapshot) => Date.parse(snapshot.observedAt) <= currentObservedAtMs
  );
  const currentIndex = pastSnapshots.findIndex(
    (snapshot) => snapshot.snapshotId === current.snapshotId
  );
  const previous = currentIndex > 0 ? pastSnapshots[currentIndex - 1] : undefined;
  const recentWindowStart = Math.max(0, pastSnapshots.length - 6);
  const recentWindow = pastSnapshots.slice(recentWindowStart);
  const baseline = recentWindow[0];
  const previousWindow = recentWindow.slice(0, -1);

  const reasonCodes: string[] = [];
  let score = 50;

  const oneStepChangePct =
    previous !== undefined
      ? percentageChange(current.lastPriceKrw, previous.lastPriceKrw)
      : undefined;
  if (oneStepChangePct !== undefined) {
    score += oneStepChangePct * 500;
    reasonCodes.push(momentumReasonCode(oneStepChangePct));
  }

  const windowChangePct =
    baseline !== undefined && baseline.snapshotId !== current.snapshotId
      ? percentageChange(current.lastPriceKrw, baseline.lastPriceKrw)
      : undefined;
  if (windowChangePct !== undefined) {
    score += windowChangePct * 250;
    reasonCodes.push(trendReasonCode(windowChangePct));
  }

  const volumeRatio = volumeRatioAgainstAverage(current, previousWindow);
  if (volumeRatio !== undefined) {
    if (volumeRatio >= 1.2) {
      score += 5;
      reasonCodes.push("HISTORICAL_VOLUME_ABOVE_AVG");
    } else if (volumeRatio <= 0.8) {
      score -= 5;
      reasonCodes.push("HISTORICAL_VOLUME_BELOW_AVG");
    } else {
      reasonCodes.push("HISTORICAL_VOLUME_NEAR_AVG");
    }
  }

  const candleReason = candleReasonCode(current);
  if (candleReason !== undefined) {
    reasonCodes.push(candleReason);
  }

  return {
    score: clampScore(score),
    reasonCodes: Array.from(new Set(reasonCodes)).sort()
  };
}

function percentageChange(current: number, baseline: number): number | undefined {
  if (baseline <= 0) {
    return undefined;
  }
  return (current - baseline) / baseline;
}

function momentumReasonCode(changePct: number): string {
  if (changePct > 0.001) {
    return "HISTORICAL_MOMENTUM_UP";
  }
  if (changePct < -0.001) {
    return "HISTORICAL_MOMENTUM_DOWN";
  }
  return "HISTORICAL_MOMENTUM_FLAT";
}

function trendReasonCode(changePct: number): string {
  if (changePct > 0.003) {
    return "HISTORICAL_TREND_UP";
  }
  if (changePct < -0.003) {
    return "HISTORICAL_TREND_DOWN";
  }
  return "HISTORICAL_TREND_FLAT";
}

function volumeRatioAgainstAverage(
  current: HistoricalMarketSnapshot,
  previousWindow: HistoricalMarketSnapshot[]
): number | undefined {
  if (current.volume === undefined || previousWindow.length === 0) {
    return undefined;
  }

  const previousVolumes = previousWindow
    .map((snapshot) => snapshot.volume)
    .filter((volume): volume is number => volume !== undefined);
  if (previousVolumes.length === 0) {
    return undefined;
  }

  const averageVolume =
    previousVolumes.reduce((total, volume) => total + volume, 0) /
    previousVolumes.length;
  if (averageVolume <= 0) {
    return undefined;
  }

  return current.volume / averageVolume;
}

function candleReasonCode(snapshot: HistoricalMarketSnapshot): string | undefined {
  if (snapshot.openPriceKrw === undefined || snapshot.closePriceKrw === undefined) {
    return undefined;
  }
  if (snapshot.closePriceKrw > snapshot.openPriceKrw) {
    return "HISTORICAL_CANDLE_UP";
  }
  if (snapshot.closePriceKrw < snapshot.openPriceKrw) {
    return "HISTORICAL_CANDLE_DOWN";
  }
  return "HISTORICAL_CANDLE_FLAT";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function compareIndexedSnapshotFreshness(
  left: IndexedHistoricalMarketSnapshot,
  right: IndexedHistoricalMarketSnapshot
): number {
  const observedDiff = left.observedAtMs - right.observedAtMs;
  if (observedDiff !== 0) {
    return observedDiff;
  }
  const marketDiff = left.snapshot.market.localeCompare(right.snapshot.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  const symbolDiff = left.snapshot.symbol.localeCompare(right.snapshot.symbol);
  if (symbolDiff !== 0) {
    return symbolDiff;
  }
  return left.snapshot.snapshotId.localeCompare(right.snapshot.snapshotId);
}

function compareCandidateSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  const observedDiff = Date.parse(right.observedAt) - Date.parse(left.observedAt);
  if (observedDiff !== 0) {
    return observedDiff;
  }
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  const symbolDiff = left.symbol.localeCompare(right.symbol);
  if (symbolDiff !== 0) {
    return symbolDiff;
  }
  return left.snapshotId.localeCompare(right.snapshotId);
}

function lowerBoundObservedAt(
  snapshots: IndexedHistoricalMarketSnapshot[],
  observedAtMs: number
): number {
  let low = 0;
  let high = snapshots.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = snapshots[middle];
    if (item !== undefined && item.observedAtMs < observedAtMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBoundObservedAt(
  snapshots: IndexedHistoricalMarketSnapshot[],
  observedAtMs: number
): number {
  let low = 0;
  let high = snapshots.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = snapshots[middle];
    if (item !== undefined && item.observedAtMs <= observedAtMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function exclusionWarnings(
  snapshotsByTime: IndexedHistoricalMarketSnapshot[],
  firstFreshIndex: number,
  firstFutureIndex: number,
  excludedStaleCount: number,
  excludedFutureCount: number
): string[] {
  const warnings: string[] = [];
  const staleDetailCount = Math.min(
    excludedStaleCount,
    maxDetailedExclusionWarnings
  );
  const staleStartIndex = Math.max(0, firstFreshIndex - staleDetailCount);
  for (const item of snapshotsByTime.slice(staleStartIndex, firstFreshIndex)) {
    warnings.push(exclusionWarning(item.snapshot, "stale historical snapshot"));
  }
  if (excludedStaleCount > staleDetailCount) {
    warnings.push(
      `${excludedStaleCount - staleDetailCount} additional historical snapshots excluded: stale historical snapshot`
    );
  }

  const futureDetailCount = Math.min(
    excludedFutureCount,
    Math.max(0, maxDetailedExclusionWarnings - warnings.length)
  );
  for (const item of snapshotsByTime.slice(
    firstFutureIndex,
    firstFutureIndex + futureDetailCount
  )) {
    warnings.push(exclusionWarning(item.snapshot, "future snapshot"));
  }
  if (excludedFutureCount > futureDetailCount) {
    warnings.push(
      `${excludedFutureCount - futureDetailCount} additional historical snapshots excluded: future snapshot`
    );
  }

  return warnings;
}

function exclusionWarning(
  snapshot: HistoricalMarketSnapshot,
  reason: "future snapshot" | "stale historical snapshot"
): string {
  return `${snapshot.market}:${snapshot.symbol} ${snapshot.snapshotId} excluded: ${reason}`;
}

function validateOptions(options: HistoricalMarketPacketBuilderOptions): void {
  if (!Number.isFinite(options.simulatedAt.getTime())) {
    throw new Error("simulatedAt must be a valid date");
  }
  if (!Number.isInteger(options.expiresInSeconds) || options.expiresInSeconds <= 0) {
    throw new Error("expiresInSeconds must be a positive integer");
  }
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates <= 0) {
    throw new Error("maxCandidates must be a positive integer");
  }
  if (
    !Number.isInteger(options.maxSnapshotAgeSeconds) ||
    options.maxSnapshotAgeSeconds <= 0
  ) {
    throw new Error("maxSnapshotAgeSeconds must be a positive integer");
  }
}
