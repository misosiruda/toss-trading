import type {
  HistoricalMarketSnapshot,
  InstrumentLifecycleStatus,
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  MarketPacketBuilder,
  type MarketPacketConstraints,
  type MarketCandidateDraft
} from "./packetBuilder.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import type {
  HistoricalUniverseManifest,
  HistoricalUniverseMember
} from "../replay/historicalUniverseCoverage.js";

export interface HistoricalMarketPacketBuilderOptions {
  packetId: string;
  simulatedAt: Date;
  expiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
  allocationPolicy?: PaperAllocationPolicy;
  universeManifest?: HistoricalUniverseManifest;
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
  averageVolume?: number | undefined;
}

interface HistoricalCandidateLifecycleMetadata {
  status?: InstrumentLifecycleStatus | undefined;
  reasonCodes: string[];
  warnings: string[];
}

interface ScreenedHistoricalCandidate {
  snapshot: HistoricalMarketSnapshot;
  features: HistoricalCandidateFeatures;
  reasonCodes: string[];
}

interface HistoricalCandidateScreenInput {
  snapshot: HistoricalMarketSnapshot;
  features: HistoricalCandidateFeatures;
}

interface IndexedHistoricalMarketSnapshot {
  snapshot: HistoricalMarketSnapshot;
  observedAtMs: number;
}

const maxDetailedExclusionWarnings = 20;
const maxMarketCandidateShare = 0.65;
const maxAssetTypeCandidateShare = 0.75;

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
    const protectedSymbolKeys = portfolioPositionKeys(portfolio);
    const freshSnapshotKeys = new Set(selectedSnapshots.map(snapshotSymbolKey));
    const universeLifecycleBySymbol = lifecycleBySymbolFromUniverse(
      options.universeManifest
    );
    for (const symbolKey of protectedSymbolKeys) {
      if (!freshSnapshotKeys.has(symbolKey)) {
        warnings.push(
          `held position ${symbolKey} excluded: no fresh historical snapshot`
        );
      }
    }
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

    const screenedCandidates = screenHistoricalCandidates({
      candidates: selectedSnapshots.map((snapshot) => ({
        snapshot,
        features: deriveCandidateFeatures(
          snapshot,
          featureHistoryBySnapshotId.get(snapshot.snapshotId) ?? [snapshot]
        )
      })),
      maxCandidates: options.maxCandidates,
      protectedSymbolKeys
    });

    const candidates = screenedCandidates.map((candidate, index) => {
      const lifecycle = lifecycleMetadataForSnapshot({
        snapshot: candidate.snapshot,
        universeLifecycleBySymbol
      });
      warnings.push(...lifecycle.warnings);
      return toCandidateDraft(
        candidate.snapshot,
        index + 1,
        options,
        {
          ...candidate.features,
          reasonCodes: [
            ...candidate.features.reasonCodes,
            ...candidate.reasonCodes
          ]
        },
        lifecycle
      );
    });

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
      constraints: options.constraints,
      ...(options.allocationPolicy === undefined
        ? {}
        : { allocationPolicy: options.allocationPolicy })
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
  features: HistoricalCandidateFeatures,
  lifecycle: HistoricalCandidateLifecycleMetadata = {
    reasonCodes: [],
    warnings: []
  }
): MarketCandidateDraft {
  return {
    market: snapshot.market,
    symbol: snapshot.symbol,
    ...(snapshot.name === undefined ? {} : { name: snapshot.name }),
    ...(snapshot.assetType === undefined ? {} : { assetType: snapshot.assetType }),
    ...(snapshot.assetClass === undefined
      ? {}
      : { assetClass: snapshot.assetClass }),
    ...(snapshot.region === undefined ? {} : { region: snapshot.region }),
    ...(snapshot.riskTags === undefined ? {} : { riskTags: snapshot.riskTags }),
    ...(snapshot.strategyBucket === undefined
      ? {}
      : { strategyBucket: snapshot.strategyBucket }),
    ...(snapshot.sector === undefined ? {} : { sector: snapshot.sector }),
    ...(lifecycle.status === undefined
      ? {}
      : { lifecycleStatus: lifecycle.status }),
    lastPriceKrw: snapshot.lastPriceKrw,
    ...(snapshot.volume === undefined ? {} : { volume: snapshot.volume }),
    ...(features.averageVolume === undefined
      ? {}
      : { averageVolume: features.averageVolume }),
    ranking,
    score: features.score,
    reasonCodes: [
      `HISTORICAL_${snapshot.interval}`,
      "HISTORICAL_REPLAY",
      ...features.reasonCodes,
      ...lifecycle.reasonCodes
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

function lifecycleBySymbolFromUniverse(
  universe: HistoricalUniverseManifest | undefined
): Map<string, HistoricalUniverseMember> | undefined {
  if (universe === undefined) {
    return undefined;
  }

  return new Map(
    universe.symbols.map((member) => [`${member.market}:${member.symbol}`, member])
  );
}

function lifecycleMetadataForSnapshot(input: {
  snapshot: HistoricalMarketSnapshot;
  universeLifecycleBySymbol:
    | Map<string, HistoricalUniverseMember>
    | undefined;
}): HistoricalCandidateLifecycleMetadata {
  if (input.universeLifecycleBySymbol === undefined) {
    return {
      reasonCodes: [],
      warnings: []
    };
  }

  const key = snapshotSymbolKey(input.snapshot);
  const member = input.universeLifecycleBySymbol.get(key);
  const status = member?.lifecycleStatus ?? "unknown";
  const reasonCode = `HISTORICAL_LIFECYCLE_${status.toUpperCase()}`;
  const warnings =
    status === "active"
      ? []
      : [
          member === undefined
            ? `historical universe lifecycle ${key} missing; candidate trading blocked as unknown`
            : `historical universe lifecycle ${key} status=${status}; candidate trading blocked`
        ];

  return {
    status,
    reasonCodes: [reasonCode],
    warnings
  };
}

function screenHistoricalCandidates(input: {
  candidates: HistoricalCandidateScreenInput[];
  maxCandidates: number;
  protectedSymbolKeys?: ReadonlySet<string>;
}): ScreenedHistoricalCandidate[] {
  if (input.maxCandidates <= 0 || input.candidates.length === 0) {
    return [];
  }

  const sorted = [...input.candidates].sort(compareScreenInputs);
  const protectedSymbolKeys = input.protectedSymbolKeys ?? new Set<string>();
  const marketLimit = Math.max(
    1,
    Math.ceil(input.maxCandidates * maxMarketCandidateShare)
  );
  const assetTypeLimit = Math.max(
    1,
    Math.ceil(input.maxCandidates * maxAssetTypeCandidateShare)
  );
  const selected: ScreenedHistoricalCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedById = new Map<string, ScreenedHistoricalCandidate>();
  const marketCounts = new Map<string, number>();
  const assetTypeCounts = new Map<string, number>();
  const selectCandidate = (
    candidate: HistoricalCandidateScreenInput,
    reasonCodes: string[]
  ): boolean => {
    const existing = selectedById.get(candidate.snapshot.snapshotId);
    if (existing !== undefined) {
      existing.reasonCodes = uniqueReasonCodes([
        ...existing.reasonCodes,
        ...reasonCodes
      ]);
      return false;
    }

    const screened: ScreenedHistoricalCandidate = {
      ...candidate,
      reasonCodes
    };
    selected.push(screened);
    selectedIds.add(candidate.snapshot.snapshotId);
    selectedById.set(candidate.snapshot.snapshotId, screened);
    return true;
  };

  for (const candidate of sorted) {
    if (selected.length >= input.maxCandidates) {
      break;
    }
    if (
      (marketCounts.get(candidate.snapshot.market) ?? 0) >= marketLimit ||
      (assetTypeCounts.get(assetTypeKey(candidate.snapshot)) ?? 0) >=
        assetTypeLimit
    ) {
      continue;
    }
    if (selectCandidate(candidate, ["HISTORICAL_SCREENER_DIVERSIFIED"])) {
      incrementCount(marketCounts, candidate.snapshot.market);
      incrementCount(assetTypeCounts, assetTypeKey(candidate.snapshot));
    }
  }

  for (const candidate of sorted) {
    if (selected.length >= input.maxCandidates) {
      break;
    }
    if (selectedIds.has(candidate.snapshot.snapshotId)) {
      continue;
    }
    selectCandidate(candidate, ["HISTORICAL_SCREENER_SCORE_FILL"]);
  }

  for (const candidate of sorted) {
    if (!protectedSymbolKeys.has(snapshotSymbolKey(candidate.snapshot))) {
      continue;
    }
    selectCandidate(candidate, ["HISTORICAL_HELD_POSITION"]);
  }

  return selected;
}

function compareScreenInputs(
  left: HistoricalCandidateScreenInput,
  right: HistoricalCandidateScreenInput
): number {
  const scoreDiff = right.features.score - left.features.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return compareCandidateSnapshots(left.snapshot, right.snapshot);
}

function assetTypeKey(snapshot: HistoricalMarketSnapshot): string {
  return snapshot.assetType ?? "UNKNOWN";
}

function snapshotSymbolKey(snapshot: Pick<HistoricalMarketSnapshot, "market" | "symbol">): string {
  return `${snapshot.market}:${snapshot.symbol}`;
}

function portfolioPositionKeys(portfolio: VirtualPortfolio): Set<string> {
  return new Set(
    portfolio.positions
      .filter((position) => position.quantity > 0)
      .map((position) => `${position.market}:${position.symbol}`)
  );
}

function uniqueReasonCodes(reasonCodes: string[]): string[] {
  return Array.from(new Set(reasonCodes)).sort();
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
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

  const averageVolume = averageHistoricalVolume(previousWindow);
  const volumeRatio =
    current.volume !== undefined && averageVolume !== undefined
      ? current.volume / averageVolume
      : undefined;
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
    reasonCodes: Array.from(new Set(reasonCodes)).sort(),
    ...(averageVolume === undefined ? {} : { averageVolume })
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

function averageHistoricalVolume(
  previousWindow: HistoricalMarketSnapshot[]
): number | undefined {
  if (previousWindow.length === 0) {
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

  return averageVolume;
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
