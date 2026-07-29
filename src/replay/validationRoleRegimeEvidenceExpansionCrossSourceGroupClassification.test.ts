import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  classifyEvidenceExpansionCrossSourceGroups
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";

test("cross-source groups classify overlap and incremental evidence", () => {
  const overlap = group("a", "bull", 0);
  const incremental = group("b", "bear", 32);

  const result = classify({
    baseline: consolidation([overlap]),
    expansion: consolidation([incremental, { ...overlap }])
  });

  assert.equal(result.baselineUniqueEvidenceGroupCount, 1);
  assert.equal(result.expansionUniqueEvidenceGroupCount, 2);
  assert.equal(result.baselineOverlapEvidenceGroupCount, 1);
  assert.equal(result.incrementalUniqueEvidenceGroupCount, 1);
  assert.deepEqual(result.overlapEvidenceGroupHashes, [hash("a")]);
  assert.deepEqual(
    result.incrementalEvidenceGroups.map(
      (value) => value.evidenceGroupHash
    ),
    [hash("b")]
  );
});

test("cross-source groups allow an empty expansion", () => {
  const result = classify({
    baseline: consolidation([group("a", "bull", 0)]),
    expansion: consolidation([])
  });

  assert.equal(result.expansionUniqueEvidenceGroupCount, 0);
  assert.equal(result.baselineOverlapEvidenceGroupCount, 0);
  assert.equal(result.incrementalUniqueEvidenceGroupCount, 0);
});

test("cross-source groups classify all expansion evidence as incremental when baseline is empty", () => {
  const incremental = group("a", "bull", 0);

  const result = classify({
    baseline: consolidation([]),
    expansion: consolidation([incremental])
  });

  assert.equal(result.baselineUniqueEvidenceGroupCount, 0);
  assert.equal(result.baselineOverlapEvidenceGroupCount, 0);
  assert.equal(result.incrementalUniqueEvidenceGroupCount, 1);
  assert.deepEqual(result.incrementalEvidenceGroups, [incremental]);
});

test("cross-source groups reject consolidation count drift", () => {
  const baseline = consolidation([group("a", "bull", 0)]);
  baseline.uniqueEvidenceGroupCount = 2;

  assert.throws(
    () =>
      classify({
        baseline,
        expansion: consolidation([])
      }),
    /baseline evidence groups do not match unique count/
  );
});

test("cross-source groups reject duplicate hashes", () => {
  const duplicate = group("a", "bull", 0);

  assert.throws(
    () =>
      classify({
        baseline: {
          evidenceGroups: [duplicate, { ...duplicate }],
          acceptedCandidateCount: 2,
          uniqueEvidenceGroupCount: 2
        },
        expansion: consolidation([])
      }),
    /duplicate evidenceGroupHash/
  );
});

test("cross-source groups reject same hash with interval drift", () => {
  assert.throws(
    () =>
      classify({
        baseline: consolidation([group("a", "bull", 0)]),
        expansion: consolidation([group("a", "bull", 1)])
      }),
    /conflicting interval payload/
  );
});

test("cross-source groups reject same hash with regime drift", () => {
  assert.throws(
    () =>
      classify({
        baseline: consolidation([group("a", "bull", 0)]),
        expansion: consolidation([group("a", "bear", 0)])
      }),
    /conflicting regime labels/
  );
});

test("cross-source groups reject same interval with different hashes", () => {
  assert.throws(
    () =>
      classify({
        baseline: consolidation([group("a", "bull", 0)]),
        expansion: consolidation([group("b", "bull", 0)])
      }),
    /interval payload maps to conflicting evidence group hashes/
  );
});

test("cross-source groups reject window policy drift", () => {
  assert.throws(
    () =>
      classify({
        baseline: consolidation([group("a", "bull", 0)]),
        expansion: consolidation([]),
        expansionWindowPolicy: {
          candidateStrategyBucket: "short_term",
          windowMonths: 2,
          timezoneOffsetMinutes: 540
        }
      }),
    /require matching window policies/
  );
});

interface WindowPolicy {
  candidateStrategyBucket: "short_term";
  windowMonths: number;
  timezoneOffsetMinutes: number;
}

function classify(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy?: WindowPolicy;
  expansionWindowPolicy?: WindowPolicy;
}) {
  const defaultPolicy: WindowPolicy = {
    candidateStrategyBucket: "short_term",
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  };
  return classifyEvidenceExpansionCrossSourceGroups({
    baseline: input.baseline,
    expansion: input.expansion,
    baselineWindowPolicy:
      input.baselineWindowPolicy ?? defaultPolicy,
    expansionWindowPolicy:
      input.expansionWindowPolicy ?? defaultPolicy
  });
}

function consolidation(
  evidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[]
): EvidenceExpansionEvidenceGroupConsolidationResult {
  return {
    evidenceGroups,
    acceptedCandidateCount: evidenceGroups.length,
    uniqueEvidenceGroupCount: evidenceGroups.length
  };
}

function group(
  character: string,
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"],
  intervalOffsetDays: number
): EvidenceExpansionAcceptedEvidenceGroup {
  const startMs =
    Date.parse("2025-01-01T00:00:00.000Z") +
    intervalOffsetDays * 24 * 60 * 60 * 1_000;
  return {
    evidenceGroupHash: hash(character),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(
      startMs + 31 * 24 * 60 * 60 * 1_000 - 1
    ).toISOString(),
    targetRegime,
    splitRoles: ["train"],
    sourceVariants: [
      {
        evidenceGroupHash: hash(character),
        sourceVariant: {
          feasibilityCandidateHash: hash("c"),
          legacyReplayPlanEvidenceGroupHash: null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash: hash("d"),
          observedTradingDatesHash: hash("e"),
          universeMembershipHash: hash("f")
        },
        observedTradingDates: [
          { market: "KR", sessionDate: "2025-01-02" }
        ],
        universeMembership: [
          { market: "KR", symbol: "005930" }
        ]
      }
    ]
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
