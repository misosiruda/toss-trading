import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { assessHistoricalUniverseCoverage } from "./historicalUniverseCoverage.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

export function createEvidenceExpansionSourceVerifierTestFixture() {
  const snapshots = [
    createEvidenceExpansionSourceVerifierTestSnapshot({
      snapshotId: "snapshot-jan",
      observedAt: "2025-01-31T15:30:00+09:00"
    }),
    createEvidenceExpansionSourceVerifierTestSnapshot({
      snapshotId: "snapshot-feb",
      observedAt: "2025-02-28T15:30:00+09:00"
    })
  ];
  const universe = {
    mode: "paper_only_historical_universe" as const,
    universeId: "expansion-short-term",
    snapshotDate: "2024-12-31",
    symbols: [
      {
        market: "KR" as const,
        symbol: "123456",
        strategyBucket: "short_term" as const,
        lifecycleStatus: "active" as const,
        required: true
      }
    ],
    disclaimer: "Synthetic paper-only expansion fixture."
  };
  const coverage = assessHistoricalUniverseCoverage({
    snapshots,
    universe: {
      ...universe,
      symbols: universe.symbols.map((member) => ({
        ...member,
        lifecycleStatusSource: "explicit" as const
      }))
    },
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    requiredMarkets: ["KR"],
    requiredStrategyBuckets: ["short_term"]
  });
  return {
    snapshots,
    universe,
    coverage,
    validationSplitSource:
      createEvidenceExpansionSourceVerifierTestAssignments(),
    assignments:
      createEvidenceExpansionSourceVerifierTestAssignments()
  };
}

export function createEvidenceExpansionSourceVerifierTestSnapshot(input: {
  snapshotId: string;
  observedAt: string;
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: "123456",
    name: "Synthetic",
    strategyBucket: "short_term",
    observedAt: input.observedAt,
    interval: "1d",
    lastPriceKrw: 10_000,
    volume: 1_000,
    sourceRefs: ["fixture:synthetic"],
    createdAt: input.observedAt
  };
}

export function createEvidenceExpansionSourceVerifierTestAssignments(): ValidationSplitAssignment[] {
  const base = {
    validationProtocol: "walk_forward" as const,
    splitId: "split-0",
    splitIndex: 0,
    trainStart: "2024-01-01T00:00:00+09:00",
    trainEnd: "2024-06-30T23:59:59.999+09:00",
    validationStart: "2024-07-01T00:00:00+09:00",
    validationEnd: "2024-09-30T23:59:59.999+09:00",
    testStart: "2024-10-01T00:00:00+09:00",
    testEnd: "2024-12-31T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
  return [
    { ...base, splitRole: "train" },
    { ...base, splitRole: "validation" },
    { ...base, splitRole: "test" }
  ];
}

export function compareEvidenceExpansionSourceVerifierTestSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  return (
    Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
    left.market.localeCompare(right.market) ||
    left.symbol.localeCompare(right.symbol) ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

export function compareEvidenceExpansionSourceVerifierTestAssignments(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): number {
  return (
    left.splitIndex - right.splitIndex ||
    left.splitId.localeCompare(right.splitId) ||
    ["train", "validation", "test"].indexOf(left.splitRole) -
      ["train", "validation", "test"].indexOf(right.splitRole)
  );
}
