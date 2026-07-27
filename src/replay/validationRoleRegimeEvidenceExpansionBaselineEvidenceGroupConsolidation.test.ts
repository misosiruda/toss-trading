import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionBaselineRunVariantAggregation,
  EvidenceExpansionBaselineRunVariantEntry
} from "./validationRoleRegimeEvidenceExpansionBaselineRunVariantAggregation.js";
import {
  consolidateEvidenceExpansionBaselineEvidenceGroups
} from "./validationRoleRegimeEvidenceExpansionBaselineEvidenceGroupConsolidation.js";
import type {
  ValidationRoleRegimeReplayPlanRun
} from "./validationRoleRegimeReplayPlan.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";

test("baseline evidence groups deduplicate shared role runs", () => {
  const evidenceGroupHash = hash("1");
  const candidateHash = hash("2");
  const sourceVariantHash = hash("3");
  const aggregation = value([
    entry("train", 0, candidateHash, evidenceGroupHash, sourceVariantHash),
    entry(
      "validation",
      1,
      candidateHash,
      evidenceGroupHash,
      sourceVariantHash
    )
  ]);

  const result =
    consolidateEvidenceExpansionBaselineEvidenceGroups(aggregation);

  assert.equal(result.acceptedCandidateCount, 2);
  assert.equal(result.uniqueEvidenceGroupCount, 1);
  assert.deepEqual(result.evidenceGroups[0]?.splitRoles, [
    "train",
    "validation"
  ]);
  assert.equal(result.evidenceGroups[0]?.sourceVariants.length, 1);
});

test("baseline evidence groups reject planned count mismatch", () => {
  const aggregation = value([
    entry("train", 0, hash("1"), hash("2"), hash("3"))
  ]);
  aggregation.plannedRunCount = 2;

  assert.throws(
    () =>
      consolidateEvidenceExpansionBaselineEvidenceGroups(aggregation),
    /do not match planned run count/
  );
});

test("baseline evidence groups reject non-contiguous plan order", () => {
  const aggregation = value([
    entry("train", 1, hash("1"), hash("2"), hash("3"))
  ]);

  assert.throws(
    () =>
      consolidateEvidenceExpansionBaselineEvidenceGroups(aggregation),
    /require contiguous planIndex order/
  );
});

test("baseline evidence groups reject execution role drift", () => {
  const aggregation = value([
    entry("train", 0, hash("1"), hash("2"), hash("3"))
  ]);
  aggregation.runVariants[0]!.run.executionAssignment = assignment(
    "validation"
  );

  assert.throws(
    () =>
      consolidateEvidenceExpansionBaselineEvidenceGroups(aggregation),
    /execution assignment role mismatch/
  );
});

test("baseline evidence groups reject run variant identity drift", () => {
  const aggregation = value([
    entry("train", 0, hash("1"), hash("2"), hash("3"))
  ]);
  aggregation.runVariants[0]!.variant.sourceVariant
    .feasibilityCandidateHash = hash("f");

  assert.throws(
    () =>
      consolidateEvidenceExpansionBaselineEvidenceGroups(aggregation),
    /variant does not match run identity/
  );
});

test("baseline evidence groups reject legacy run identity drift", () => {
  const aggregation = value([
    entry("train", 0, hash("1"), hash("2"), hash("3"))
  ]);
  aggregation.runVariants[0]!.run.evidenceGroupHash = hash("f");
  aggregation.runVariants[0]!.variant.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = hash("f");

  assert.throws(
    () =>
      consolidateEvidenceExpansionBaselineEvidenceGroups(aggregation),
    /variant does not match run identity/
  );
});

test("baseline evidence groups reject regime conflicts", () => {
  const evidenceGroupHash = hash("1");
  const first = entry(
    "train",
    0,
    hash("2"),
    evidenceGroupHash,
    hash("3")
  );
  const second = entry(
    "validation",
    1,
    hash("4"),
    evidenceGroupHash,
    hash("5")
  );
  second.run.targetRegime = "bear";

  assert.throws(
    () =>
      consolidateEvidenceExpansionBaselineEvidenceGroups(
        value([first, second])
      ),
    /conflicting regime labels/
  );
});

function value(
  runVariants: EvidenceExpansionBaselineRunVariantEntry[]
): EvidenceExpansionBaselineRunVariantAggregation {
  return {
    runVariants,
    plannedRunCount: runVariants.length
  };
}

function entry(
  splitRole: ValidationSplitRole,
  planIndex: number,
  candidateHash: Sha256Hash,
  evidenceGroupHash: Sha256Hash,
  sourceVariantHash: Sha256Hash
): EvidenceExpansionBaselineRunVariantEntry {
  const runValue = run(splitRole, planIndex, candidateHash);
  return {
    run: runValue,
    variant: {
      evidenceGroupHash,
      sourceVariant: {
        feasibilityCandidateHash: candidateHash,
        legacyReplayPlanEvidenceGroupHash: candidateHash,
        sourceVariantHashVersion:
          "evidence_expansion_source_variant.v1",
        sourceVariantHash,
        observedTradingDatesHash: hash("6"),
        universeMembershipHash: hash("7")
      },
      observedTradingDates: [
        { market: "KR", sessionDate: "2025-01-02" }
      ],
      universeMembership: [
        { market: "KR", symbol: "005930" }
      ]
    }
  };
}

function run(
  splitRole: ValidationSplitRole,
  planIndex: number,
  candidateHash: Sha256Hash
): ValidationRoleRegimeReplayPlanRun {
  const executionAssignment = assignment(splitRole);
  return {
    planIndex,
    runKey: `baseline-${splitRole}-${planIndex}`,
    splitRole,
    targetRegime: "bull",
    candidateOrdinalWithinRoleRegime: 0,
    candidateHash,
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    sourceAssignments: [executionAssignment],
    executionAssignment,
    evidenceGroupHash: candidateHash,
    sharedAcrossRoles: false,
    sharedRoles: [splitRole]
  };
}

function assignment(
  splitRole: ValidationSplitRole
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: `split-${splitRole}`,
    splitIndex: 0,
    splitRole,
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: "2025-03-01T00:00:00.000Z",
    testEnd: "2025-03-31T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
