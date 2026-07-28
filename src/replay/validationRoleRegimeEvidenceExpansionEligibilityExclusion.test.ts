import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionCandidateEligibility
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionEligibilityExclusion
} from "./validationRoleRegimeEvidenceExpansionEligibilityExclusion.js";

test("eligibility exclusion projects a scoped universe rejection", () => {
  const exclusion = buildEvidenceExpansionEligibilityExclusion(
    eligibility("sideways", false, "SCOPE_UNAVAILABLE")
  );

  assert.deepEqual(exclusion, {
    sourceVariants: [sourceReference("1")],
    evidenceGroupHash: hash("1"),
    splitRole: "train",
    targetRegime: "sideways",
    reason: "SCOPE_UNAVAILABLE",
    message: "train candidate scope is unavailable"
  });
});

test("scope exclusion remains primary for insufficient regime data", () => {
  const exclusion = buildEvidenceExpansionEligibilityExclusion(
    eligibility(
      "insufficient_data",
      false,
      "SCOPE_UNAVAILABLE"
    )
  );

  assert.equal(exclusion.reason, "SCOPE_UNAVAILABLE");
  assert.equal(exclusion.targetRegime, null);
});

test("eligibility exclusion projects insufficient regime data", () => {
  const exclusion = buildEvidenceExpansionEligibilityExclusion(
    eligibility(
      "insufficient_data",
      true,
      "INSUFFICIENT_REGIME_DATA"
    )
  );

  assert.equal(exclusion.reason, "INSUFFICIENT_REGIME_DATA");
  assert.equal(exclusion.targetRegime, null);
  assert.equal(
    exclusion.message,
    "train candidate regime data is insufficient"
  );
});

test("eligibility exclusion rejects accepted candidates", () => {
  const value = eligibility(
    "bull",
    true,
    "INSUFFICIENT_REGIME_DATA"
  );
  value.status = "accepted";
  value.exclusionReason = null;

  assert.throws(
    () => buildEvidenceExpansionEligibilityExclusion(value),
    /requires an excluded candidate/
  );
});

test("eligibility exclusion rejects reason and evidence mismatch", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusion(
        eligibility("bull", true, "SCOPE_UNAVAILABLE")
      ),
    /requires unavailable candidate scope/
  );
  assert.throws(
    () =>
      buildEvidenceExpansionEligibilityExclusion(
        eligibility(
          "sideways",
          true,
          "INSUFFICIENT_REGIME_DATA"
        )
      ),
    /requires scoped insufficient data/
  );
});

test("eligibility exclusion rejects malformed source references", () => {
  const value = eligibility(
    "sideways",
    false,
    "SCOPE_UNAVAILABLE"
  );
  value.candidate.variant.sourceVariant.sourceVariantHash =
    "invalid" as Sha256Hash;

  assert.throws(
    () => buildEvidenceExpansionEligibilityExclusion(value),
    { name: "ZodError" }
  );
});

function eligibility(
  regime: EvidenceExpansionCandidateEligibility["candidate"]["regime"],
  scopeAvailable: boolean,
  exclusionReason: NonNullable<
    EvidenceExpansionCandidateEligibility["exclusionReason"]
  >
): EvidenceExpansionCandidateEligibility {
  return {
    assignment: {
      validationProtocol: "walk_forward",
      splitId: "split-0",
      splitIndex: 0,
      splitRole: "train",
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
        evidenceGroupHash: hash("1"),
        sourceVariant: sourceReference("1"),
        observedTradingDates: [],
        universeMembership: scopeAvailable
          ? [{ market: "KR", symbol: "005930" }]
          : []
      }
    },
    status: "excluded",
    exclusionReason
  };
}

function sourceReference(character: string) {
  return {
    feasibilityCandidateHash: hash(character),
    legacyReplayPlanEvidenceGroupHash: null,
    sourceVariantHashVersion:
      "evidence_expansion_source_variant.v1" as const,
    sourceVariantHash: hash(character),
    observedTradingDatesHash: hash("2"),
    universeMembershipHash: hash("3")
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
