import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionCandidateEligibility,
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  consolidateEvidenceExpansionEvidenceGroups
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("evidence group consolidation deduplicates roles and source variants", () => {
  const sharedHash = hash("1");
  const sharedVariantHash = hash("2");
  const result = consolidateEvidenceExpansionEvidenceGroups(
    eligibility([
      accepted("validation", "bull", sharedHash, sharedVariantHash),
      accepted("train", "bull", sharedHash, sharedVariantHash),
      accepted("train", "bull", sharedHash, hash("3"))
    ])
  );

  assert.equal(result.acceptedCandidateCount, 3);
  assert.equal(result.uniqueEvidenceGroupCount, 1);
  assert.deepEqual(result.evidenceGroups[0]?.splitRoles, [
    "train",
    "validation"
  ]);
  assert.deepEqual(
    result.evidenceGroups[0]?.sourceVariants.map(
      (variant) => variant.sourceVariant.sourceVariantHash
    ),
    [sharedVariantHash, hash("3")].sort()
  );
});

test("evidence group consolidation uses canonical group order", () => {
  const result = consolidateEvidenceExpansionEvidenceGroups(
    eligibility([
      accepted("test", "sideways", hash("2"), hash("4"), 32),
      accepted("train", "bull", hash("1"), hash("3"))
    ])
  );

  assert.deepEqual(
    result.evidenceGroups.map((group) => group.splitRoles),
    [["train"], ["test"]]
  );
});

test("evidence group consolidation rejects regime conflicts", () => {
  const sharedHash = hash("1");

  assert.throws(
    () =>
      consolidateEvidenceExpansionEvidenceGroups(
        eligibility([
          accepted("train", "bull", sharedHash, hash("2")),
          accepted("validation", "bear", sharedHash, hash("3"))
        ])
      ),
    /conflicting regime labels/
  );
});

test("evidence group consolidation rejects interval reverse-map conflicts", () => {
  assert.throws(
    () =>
      consolidateEvidenceExpansionEvidenceGroups(
        eligibility([
          accepted("train", "bull", hash("1"), hash("3")),
          accepted("validation", "bull", hash("2"), hash("4"))
        ])
      ),
    /interval payload maps to conflicting hashes/
  );
});

test("evidence group consolidation rejects source variant reuse", () => {
  const sharedVariantHash = hash("3");

  assert.throws(
    () =>
      consolidateEvidenceExpansionEvidenceGroups(
        eligibility([
          accepted("train", "bull", hash("1"), sharedVariantHash),
          accepted(
            "validation",
            "bear",
            hash("2"),
            sharedVariantHash,
            32
          )
        ])
      ),
    /reused across evidence groups/
  );
});

test("evidence group consolidation rejects canonical set conflicts", () => {
  const sharedGroupHash = hash("1");
  const sharedVariantHash = hash("2");
  const first = accepted(
    "train",
    "bull",
    sharedGroupHash,
    sharedVariantHash
  );
  const second = accepted(
    "validation",
    "bull",
    sharedGroupHash,
    sharedVariantHash
  );
  second.candidate.variant.observedTradingDates = [
    { market: "KR", sessionDate: "2025-01-03" }
  ];

  assert.throws(
    () =>
      consolidateEvidenceExpansionEvidenceGroups(
        eligibility([first, second])
      ),
    /conflicting canonical payload/
  );
});

test("evidence group consolidation rejects accepted count mismatch", () => {
  const value = eligibility([
    accepted("train", "bull", hash("1"), hash("2"))
  ]);
  value.acceptedCandidateCount = 2;

  assert.throws(
    () => consolidateEvidenceExpansionEvidenceGroups(value),
    /do not match eligibility count/
  );
});

function eligibility(
  candidates: EvidenceExpansionCandidateEligibility[]
): EvidenceExpansionCandidateEligibilityResult {
  return {
    candidates,
    acceptedCandidateCount: candidates.length,
    scopeUnavailableCandidateCount: 0,
    insufficientRegimeDataCandidateCount: 0
  };
}

function accepted(
  splitRole: ValidationSplitRole,
  regime: "bull" | "bear" | "sideways" | "mixed",
  evidenceGroupHash: Sha256Hash,
  sourceVariantHash: Sha256Hash,
  intervalOffsetDays = 0
): EvidenceExpansionCandidateEligibility {
  const startMs =
    Date.parse("2025-01-01T00:00:00.000Z") +
    intervalOffsetDays * 24 * 60 * 60 * 1_000;
  const startAt = new Date(startMs).toISOString();
  const endAt = new Date(
    startMs + 31 * 24 * 60 * 60 * 1_000 - 1
  ).toISOString();
  return {
    assignment: {
      validationProtocol: "walk_forward",
      splitId: `split-${splitRole}`,
      splitIndex: 0,
      splitRole,
      trainStart: startAt,
      trainEnd: endAt,
      validationStart: "2025-02-01T00:00:00.000Z",
      validationEnd: "2025-02-28T23:59:59.999Z",
      testStart: "2025-03-01T00:00:00.000Z",
      testEnd: "2025-03-31T23:59:59.999Z",
      purgeDurationDays: 0,
      embargoDurationDays: 0
    },
    candidate: {
      startAt,
      endAt,
      regime,
      scopeAvailable: true,
      variant: {
        evidenceGroupHash,
        sourceVariant: {
          feasibilityCandidateHash: sourceVariantHash,
          legacyReplayPlanEvidenceGroupHash: null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash,
          observedTradingDatesHash: sourceVariantHash,
          universeMembershipHash: sourceVariantHash
        },
        observedTradingDates: [
          { market: "KR", sessionDate: "2025-01-02" }
        ],
        universeMembership: [
          { market: "KR", symbol: "005930" }
        ]
      }
    },
    status: "accepted",
    exclusionReason: null
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
