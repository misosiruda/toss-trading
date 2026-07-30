import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { assessHistoricalUniverseCoverage } from "./historicalUniverseCoverage.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { verifyValidationRoleRegimeEvidenceExpansionSource } from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  compareEvidenceExpansionSourceVerifierTestAssignments as compareAssignments,
  compareEvidenceExpansionSourceVerifierTestSnapshots as compareSnapshots,
  createEvidenceExpansionSourceVerifierTestAssignments as assignments,
  createEvidenceExpansionSourceVerifierTestFixture as sourceFixtures,
  createEvidenceExpansionSourceVerifierTestSnapshot as snapshot
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

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
  assert.deepEqual(result.baselineProvenanceHashes, {
    dataSnapshotHash: createReplayResearchHash(expectedSnapshots),
    universeHash: createReplayResearchHash(fixtures.universe),
    coverageHash: createReplayResearchHash(fixtures.coverage),
    validationSplitHash: createReplayResearchHash({
      sourceVersion: "fixture",
      assignments: expectedAssignments
    })
  });
  assert.deepEqual(result.hashes, {
    expansionDataSnapshotHash: createReplayResearchHash(expectedSnapshots),
    expansionUniverseHash: createReplayResearchHash(result.universe),
    expansionCoverageHash: createReplayResearchHash(fixtures.coverage),
    validationSplitHash: createReplayResearchHash({
      sourceVersion: "fixture",
      assignments: expectedAssignments
    })
  });
});

test("expansion source verifier hashes the returned normalized universe", () => {
  const fixtures = sourceFixtures();
  const universe = {
    ...fixtures.universe,
    symbols: fixtures.universe.symbols.map((member) => ({
      market: member.market,
      symbol: member.symbol,
      strategyBucket: member.strategyBucket
    }))
  };

  const result = verifyValidationRoleRegimeEvidenceExpansionSource({
    ...fixtures,
    universe
  });

  assert.deepEqual(result.universe.symbols[0], {
    market: "KR",
    symbol: "123456",
    strategyBucket: "short_term",
    required: true,
    lifecycleStatus: "unknown",
    lifecycleStatusSource: "defaulted"
  });
  assert.equal(
    result.hashes.expansionUniverseHash,
    createReplayResearchHash(result.universe)
  );
  assert.notEqual(
    result.hashes.expansionUniverseHash,
    createReplayResearchHash(universe)
  );
  assert.equal(
    result.baselineProvenanceHashes.universeHash,
    createReplayResearchHash(universe)
  );
});
test("expansion source verifier canonicalizes universe symbol order", () => {
  const fixtures = sourceFixtures();
  const secondMember = {
    ...fixtures.universe.symbols[0]!,
    symbol: "654321"
  };
  const snapshots = fixtures.snapshots.flatMap((item) => [
    item,
    {
      ...item,
      snapshotId: `${item.snapshotId}-second`,
      symbol: secondMember.symbol
    }
  ]);
  const reversedUniverse = {
    ...fixtures.universe,
    symbols: [secondMember, fixtures.universe.symbols[0]!]
  };
  const coverage = assessHistoricalUniverseCoverage({
    snapshots,
    universe: {
      ...reversedUniverse,
      symbols: reversedUniverse.symbols.map((member) => ({
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
  const reversedResult = verifyValidationRoleRegimeEvidenceExpansionSource({
    ...fixtures,
    snapshots,
    universe: reversedUniverse,
    coverage
  });
  const orderedResult = verifyValidationRoleRegimeEvidenceExpansionSource({
    ...fixtures,
    snapshots,
    universe: {
      ...reversedUniverse,
      symbols: [...reversedUniverse.symbols].reverse()
    },
    coverage
  });

  assert.deepEqual(
    reversedResult.universe.symbols.map((member) => member.symbol),
    ["123456", "654321"]
  );
  assert.deepEqual(reversedResult.universe, orderedResult.universe);
  assert.deepEqual(reversedResult.hashes, orderedResult.hashes);
});

test("expansion source verifier canonicalizes nested provenance arrays", () => {
  const fixtures = sourceFixtures();
  const reversedRiskTags: NonNullable<
    HistoricalMarketSnapshot["riskTags"]
  > = ["leveraged", "currency_exposed"];
  const orderedRiskTags = [...reversedRiskTags].reverse();
  const snapshots = fixtures.snapshots.map((item) => ({
    ...item,
    riskTags: [...reversedRiskTags],
    sourceRefs: ["fixture:z", "fixture:a"]
  }));
  const universe = {
    ...fixtures.universe,
    symbols: fixtures.universe.symbols.map((member) => ({
      ...member,
      riskTags: [...reversedRiskTags],
      tags: ["tag-z", "tag-a"]
    }))
  };
  const coverage = assessHistoricalUniverseCoverage({
    snapshots,
    universe: {
      ...universe,
      symbols: universe.symbols.map((member) => ({
        ...member,
        riskTags: [...orderedRiskTags],
        tags: ["tag-a", "tag-z"],
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
  const reversedResult = verifyValidationRoleRegimeEvidenceExpansionSource({
    ...fixtures,
    snapshots,
    universe,
    coverage
  });
  const orderedResult = verifyValidationRoleRegimeEvidenceExpansionSource({
    ...fixtures,
    snapshots: snapshots.map((item) => ({
      ...item,
      riskTags: [...item.riskTags].reverse(),
      sourceRefs: [...item.sourceRefs].reverse()
    })),
    universe: {
      ...universe,
      symbols: universe.symbols.map((member) => ({
        ...member,
        riskTags: [...member.riskTags].reverse(),
        tags: [...member.tags].reverse()
      }))
    },
    coverage
  });

  assert.deepEqual(reversedResult.snapshots, orderedResult.snapshots);
  assert.deepEqual(reversedResult.universe, orderedResult.universe);
  assert.deepEqual(reversedResult.hashes, orderedResult.hashes);
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

test("expansion source verifier rejects empty required market scope", () => {
  const fixtures = sourceFixtures();
  const coverage = assessHistoricalUniverseCoverage({
    snapshots: fixtures.snapshots,
    universe: {
      ...fixtures.universe,
      symbols: fixtures.universe.symbols.map((member) => ({
        ...member,
        lifecycleStatusSource: "explicit" as const
      }))
    },
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    requiredStrategyBuckets: ["short_term"]
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        coverage
      }),
    /requiredMarkets must not be empty/
  );
});

test("expansion source verifier requires every evaluated market", () => {
  const fixtures = sourceFixtures();
  const usMember = {
    ...fixtures.universe.symbols[0]!,
    market: "US" as const,
    symbol: "SPY",
    required: false
  };
  const universe = {
    ...fixtures.universe,
    symbols: [...fixtures.universe.symbols, usMember]
  };
  const coverage = assessHistoricalUniverseCoverage({
    snapshots: fixtures.snapshots,
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

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        universe,
        coverage
      }),
    /requiredMarkets is missing evaluated market: US/
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
    /duplicate validation assignment/
  );
});

test("expansion source verifier rejects empty validation split sources", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        validationSplitSource: []
      }),
    /validation split source must include at least one complete split/
  );
});

test("expansion source verifier rejects validation splits missing roles", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        validationSplitSource: [fixtures.assignments[0]!]
      }),
    /validation split is missing required roles/
  );
});

test("expansion source verifier rejects inconsistent split definitions", () => {
  const fixtures = sourceFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionSource({
        ...fixtures,
        validationSplitSource: fixtures.assignments.map((assignment) =>
          assignment.splitRole === "validation"
            ? {
                ...assignment,
                validationEnd: "2024-09-29T23:59:59.999+09:00"
              }
            : assignment
        )
      }),
    /validation role assignments use inconsistent split definition/
  );
});
