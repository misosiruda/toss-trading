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
      startAt: "2025-01-01T00:00:00.000Z",
      endAt: "2025-01-31T23:59:59.999Z",
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

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
