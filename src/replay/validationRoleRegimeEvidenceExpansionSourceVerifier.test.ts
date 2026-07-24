import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { assessHistoricalUniverseCoverage } from "./historicalUniverseCoverage.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { verifyValidationRoleRegimeEvidenceExpansionSource } from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

test("expansion source verifier parses and hashes canonical sources", () => {
  const fixtures = sourceFixtures();
  const result = verifyValidationRoleRegimeEvidenceExpansionSource({
    ...fixtures,
    snapshots: [...fixtures.snapshots].reverse(),
    validationSplitSource: {
      sourceVersion: "fixture",
      assignments: [...fixtures.assignments].reverse()
    }
  });

  const expectedSnapshots = [...fixtures.snapshots].sort(compareSnapshots);
  const expectedAssignments = [...fixtures.assignments].sort(
    compareAssignments
  );
  assert.deepEqual(result.snapshots, expectedSnapshots);
  assert.deepEqual(result.assignments, expectedAssignments);
  assert.deepEqual(result.validationSplitSource, {
    sourceVersion: "fixture",
    assignments: expectedAssignments
  });
  assert.deepEqual(result.hashes, {
    expansionDataSnapshotHash: createReplayResearchHash(expectedSnapshots),
    expansionUniverseHash: createReplayResearchHash(fixtures.universe),
    expansionCoverageHash: createReplayResearchHash(fixtures.coverage),
    validationSplitHash: createReplayResearchHash({
      sourceVersion: "fixture",
      assignments: expectedAssignments
    })
  });
});

test("expansion source verifier rejects duplicate snapshot ids", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        snapshots: [
          fixtures.snapshots[0]!,
          {
            ...fixtures.snapshots[1]!,
            snapshotId: fixtures.snapshots[0]!.snapshotId
          }
        ]
      }),
    /duplicate expansion historical snapshotId/
  );
});

test("expansion source verifier rejects snapshots outside universe", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        snapshots: [
          fixtures.snapshots[0]!,
          {
            ...fixtures.snapshots[1]!,
            symbol: "OUTSIDE"
          }
        ]
      }),
    /expansion snapshot is outside universe/
  );
});

test("expansion source verifier rejects mismatched coverage", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        coverage: {
          ...fixtures.coverage,
          availableSymbolCount: 0
        }
      }),
    /expansion coverage does not match snapshots and universe/
  );
});

test("expansion source verifier rejects duplicate validation assignments", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        validationSplitSource: [
          fixtures.assignments[0]!,
          fixtures.assignments[0]!
        ]
      }),
    /duplicate expansion validation assignment/
  );
});

function sourceFixtures() {
  const snapshots = [
    snapshot({
      snapshotId: "snapshot-jan",
      observedAt: "2025-01-31T15:30:00+09:00"
    }),
    snapshot({
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
  const rangeStart = new Date("2025-01-01T00:00:00+09:00");
  const rangeEnd = new Date("2025-02-28T23:59:59.999+09:00");
  const coverage = assessHistoricalUniverseCoverage({
    snapshots,
    universe: {
      ...universe,
      symbols: universe.symbols.map((member) => ({
        ...member,
        lifecycleStatusSource: "explicit" as const
      }))
    },
    rangeStart,
    rangeEnd,
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
    validationSplitSource: assignments(),
    assignments: assignments()
  };
}

function snapshot(input: {
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

function assignments(): ValidationSplitAssignment[] {
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

function compareSnapshots(
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

function compareAssignments(
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
