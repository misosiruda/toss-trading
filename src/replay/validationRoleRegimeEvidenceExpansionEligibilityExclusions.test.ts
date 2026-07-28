import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionCandidateEligibility,
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionEligibilityExclusions
} from "./validationRoleRegimeEvidenceExpansionEligibilityExclusions.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("eligibility exclusions ignore accepted rows and sort by canonical key", () => {
  const exclusions = buildEvidenceExpansionEligibilityExclusions(
    result([
      eligibility("3", "3", "train", "bull", true, null),
      eligibility(
        "2",
        "2",
        "train",
        "sideways",
        false,
        "SCOPE_UNAVAILABLE"
      ),
      eligibility(
        "1",
        "1",
        "train",
        "insufficient_data",
        true,
        "INSUFFICIENT_REGIME_DATA"
      )
    ])
  );

  assert.deepEqual(
    exclusions.map((exclusion) => exclusion.reason),
    ["INSUFFICIENT_REGIME_DATA", "SCOPE_UNAVAILABLE"]
  );
});

test("eligibility exclusions merge source variants and cross-role scope", () => {
  const exclusions = buildEvidenceExpansionEligibilityExclusions(
    result([
      eligibility(
        "1",
        "2",
        "test",
        "sideways",
        false,
        "SCOPE_UNAVAILABLE"
      ),
      eligibility(
        "1",
        "1",
        "train",
        "sideways",
        false,
        "SCOPE_UNAVAILABLE"
      )
    ])
  );

  assert.equal(exclusions.length, 1);
  assert.equal(exclusions[0]?.splitRole, null);
  assert.equal(
    exclusions[0]?.message,
    "cross-role candidate scope is unavailable"
  );
  assert.deepEqual(
    exclusions[0]?.sourceVariants.map(
      (sourceVariant) => sourceVariant.sourceVariantHash
    ),
    [hash("1"), hash("2")]
  );
});

test("eligibility exclusions use fixed role and regime ordering", () => {
  const exclusions = buildEvidenceExpansionEligibilityExclusions(
    result([
      eligibility(
        "4",
        "4",
        "test",
        "bull",
        false,
        "SCOPE_UNAVAILABLE"
      ),
      eligibility(
        "3",
        "3",
        "train",
        "mixed",
        false,
        "SCOPE_UNAVAILABLE"
      ),
      eligibility(
        "2",
        "2",
        "validation",
        "sideways",
        false,
        "SCOPE_UNAVAILABLE"
      ),
      eligibility(
        "1",
        "1",
        "train",
        "bull",
        false,
        "SCOPE_UNAVAILABLE"
      )
    ])
  );

  assert.deepEqual(
    exclusions.map(
      (exclusion) =>
        `${exclusion.splitRole}/${exclusion.targetRegime}`
    ),
    [
      "train/bull",
      "train/mixed",
      "validation/sideways",
      "test/bull"
    ]
  );
});

test("eligibility exclusions deduplicate identical source variants", () => {
  const row = eligibility(
    "1",
    "1",
    "train",
    "sideways",
    false,
    "SCOPE_UNAVAILABLE"
  );
  const exclusions = buildEvidenceExpansionEligibilityExclusions(
    result([row, structuredClone(row)])
  );

  assert.equal(exclusions.length, 1);
  assert.equal(exclusions[0]?.sourceVariants.length, 1);
});

test("eligibility exclusions reject reason and regime conflicts", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusions(
        result([
          eligibility(
            "1",
            "1",
            "train",
            "sideways",
            false,
            "SCOPE_UNAVAILABLE"
          ),
          eligibility(
            "1",
            "2",
            "train",
            "insufficient_data",
            true,
            "INSUFFICIENT_REGIME_DATA"
          )
        ])
      ),
    /conflicting reasons/
  );
  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusions(
        result([
          eligibility(
            "1",
            "1",
            "train",
            "bull",
            false,
            "SCOPE_UNAVAILABLE"
          ),
          eligibility(
            "1",
            "2",
            "test",
            "bear",
            false,
            "SCOPE_UNAVAILABLE"
          )
        ])
      ),
    /conflicting regimes/
  );
});

test("eligibility exclusions reject count drift", () => {
  const value = result([
    eligibility(
      "1",
      "1",
      "train",
      "sideways",
      false,
      "SCOPE_UNAVAILABLE"
    )
  ]);
  value.scopeUnavailableCandidateCount = 0;

  assert.throws(
    () => buildEvidenceExpansionEligibilityExclusions(value),
    /counts do not match candidate rows/
  );
});

test("eligibility exclusions reject cross-group source reuse", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusions(
        result([
          eligibility(
            "1",
            "1",
            "train",
            "sideways",
            false,
            "SCOPE_UNAVAILABLE"
          ),
          eligibility(
            "2",
            "1",
            "train",
            "sideways",
            false,
            "SCOPE_UNAVAILABLE"
          )
        ])
      ),
    /belongs to multiple evidence groups/
  );
});

test("eligibility exclusions reject duplicate source payload conflicts", () => {
  const first = eligibility(
    "1",
    "1",
    "train",
    "sideways",
    false,
    "SCOPE_UNAVAILABLE"
  );
  const second = structuredClone(first);
  second.candidate.variant.sourceVariant.feasibilityCandidateHash =
    hash("2");

  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusions(
        result([first, second])
      ),
    /source variant payload conflicts/
  );
});

test("eligibility exclusions reject conflicting interval-to-group mappings", () => {
  const reusedGroup = eligibility(
    "1",
    "1",
    "train",
    "sideways",
    false,
    "SCOPE_UNAVAILABLE"
  );
  const conflictingInterval = eligibility(
    "1",
    "2",
    "test",
    "sideways",
    false,
    "SCOPE_UNAVAILABLE"
  );
  conflictingInterval.candidate.endAt =
    "2025-02-01T00:00:00.000Z";

  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusions(
        result([reusedGroup, conflictingInterval])
      ),
    /hash has conflicting interval payload/
  );

  assert.throws(
    () => {
      const first = eligibility(
        "1",
        "1",
        "train",
        "sideways",
        false,
        "SCOPE_UNAVAILABLE"
      );
      const second = eligibility(
        "2",
        "2",
        "test",
        "sideways",
        false,
        "SCOPE_UNAVAILABLE"
      );
      second.candidate.startAt = first.candidate.startAt;
      second.candidate.endAt = first.candidate.endAt;
      return buildEvidenceExpansionEligibilityExclusions(
        result([first, second])
      );
    },
    /interval payload maps to conflicting evidence group hashes/
  );
});

function result(
  candidates: EvidenceExpansionCandidateEligibility[]
): EvidenceExpansionCandidateEligibilityResult {
  return {
    candidates,
    acceptedCandidateCount: candidates.filter(
      (candidate) => candidate.status === "accepted"
    ).length,
    scopeUnavailableCandidateCount: candidates.filter(
      (candidate) =>
        candidate.exclusionReason === "SCOPE_UNAVAILABLE"
    ).length,
    insufficientRegimeDataCandidateCount: candidates.filter(
      (candidate) =>
        candidate.exclusionReason === "INSUFFICIENT_REGIME_DATA"
    ).length
  };
}

function eligibility(
  groupCharacter: string,
  sourceCharacter: string,
  splitRole: ValidationSplitRole,
  regime: EvidenceExpansionCandidateEligibility["candidate"]["regime"],
  scopeAvailable: boolean,
  exclusionReason: EvidenceExpansionCandidateEligibility["exclusionReason"]
): EvidenceExpansionCandidateEligibility {
  const interval = candidateInterval(groupCharacter);
  return {
    assignment: {
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
    },
    candidate: {
      startAt: interval.startAt,
      endAt: interval.endAt,
      regime,
      scopeAvailable,
      variant: {
        evidenceGroupHash: hash(groupCharacter),
        sourceVariant: {
          feasibilityCandidateHash: hash(sourceCharacter),
          legacyReplayPlanEvidenceGroupHash: null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash: hash(sourceCharacter),
          observedTradingDatesHash: hash("e"),
          universeMembershipHash: hash("f")
        },
        observedTradingDates: [],
        universeMembership: scopeAvailable
          ? [{ market: "KR", symbol: "005930" }]
          : []
      }
    },
    status: exclusionReason === null ? "accepted" : "excluded",
    exclusionReason
  };
}

function candidateInterval(groupCharacter: string): {
  startAt: string;
  endAt: string;
} {
  const day = Number.parseInt(groupCharacter, 16);
  return {
    startAt: `2025-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    endAt: `2025-01-${String(day + 10).padStart(2, "0")}T23:59:59.999Z`
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
