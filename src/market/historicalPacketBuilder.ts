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
  snapshots: HistoricalMarketSnapshot[];
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

export class HistoricalMarketPacketBuilder {
  constructor(private readonly options: HistoricalMarketPacketBuilderOptions) {
    validateOptions(options);
  }

  build(
    input: HistoricalMarketPacketBuildInput
  ): HistoricalMarketPacketBuildResult {
    const warnings: string[] = [];
    const selectedSnapshots = new Map<string, HistoricalMarketSnapshot>();
    let excludedFutureCount = 0;
    let excludedStaleCount = 0;
    const simulatedAtMs = this.options.simulatedAt.getTime();

    for (const snapshot of input.snapshots) {
      const observedAtMs = Date.parse(snapshot.observedAt);
      if (observedAtMs > simulatedAtMs) {
        excludedFutureCount += 1;
        warnings.push(
          `${snapshot.market}:${snapshot.symbol} ${snapshot.snapshotId} excluded: future snapshot`
        );
        continue;
      }

      if (
        observedAtMs <
        simulatedAtMs - this.options.maxSnapshotAgeSeconds * 1000
      ) {
        excludedStaleCount += 1;
        warnings.push(
          `${snapshot.market}:${snapshot.symbol} ${snapshot.snapshotId} excluded: stale historical snapshot`
        );
        continue;
      }

      const key = `${snapshot.market}:${snapshot.symbol}`;
      const existing = selectedSnapshots.get(key);
      if (existing === undefined || compareSnapshotFreshness(snapshot, existing) > 0) {
        selectedSnapshots.set(key, snapshot);
      }
    }

    const candidates = Array.from(selectedSnapshots.values())
      .sort(compareCandidateSnapshots)
      .slice(0, this.options.maxCandidates)
      .map((snapshot, index) => toCandidateDraft(snapshot, index + 1, this.options));

    if (candidates.length === 0) {
      return {
        status: "failed",
        reason: "NO_HISTORICAL_CANDIDATES",
        warnings:
          warnings.length > 0
            ? warnings
            : ["historical packet failed: no snapshots available"],
        sourceSnapshotCount: input.snapshots.length,
        candidateSnapshotCount: 0,
        excludedFutureCount,
        excludedStaleCount
      };
    }

    const result = new MarketPacketBuilder({
      packetId: this.options.packetId,
      generatedAt: this.options.simulatedAt,
      expiresInSeconds: this.options.expiresInSeconds,
      maxCandidates: this.options.maxCandidates,
      constraints: this.options.constraints
    }).build({
      portfolio: input.portfolio,
      candidates
    });

    return {
      status: "ok",
      packet: result.packet,
      warnings: [...warnings, ...result.warnings],
      sourceSnapshotCount: input.snapshots.length,
      candidateSnapshotCount: candidates.length,
      excludedFutureCount,
      excludedStaleCount
    };
  }
}

function toCandidateDraft(
  snapshot: HistoricalMarketSnapshot,
  ranking: number,
  options: HistoricalMarketPacketBuilderOptions
): MarketCandidateDraft {
  return {
    market: snapshot.market,
    symbol: snapshot.symbol,
    lastPriceKrw: snapshot.lastPriceKrw,
    ranking,
    reasonCodes: [`HISTORICAL_${snapshot.interval}`, "HISTORICAL_REPLAY"],
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

function compareSnapshotFreshness(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  const observedDiff = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (observedDiff !== 0) {
    return observedDiff;
  }
  return left.snapshotId.localeCompare(right.snapshotId);
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
