import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionCombinedUniverseMembership
} from "./validationRoleRegimeEvidenceExpansionCombinedUniverseMembership.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
  type EvidenceExpansionUniverseMember
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

test("combined universe membership builds a canonical source union", () => {
  const group = evidenceGroup([
    variant("1", [
      { market: "KR", symbol: "005930" },
      { market: "US", symbol: "AAPL" }
    ]),
    variant("2", [
      { market: "KR", symbol: "005930" },
      { market: "KR", symbol: "035420" }
    ])
  ]);

  const result =
    buildEvidenceExpansionCombinedUniverseMembership(group);

  assert.deepEqual(result.members, [
    { market: "KR", symbol: "005930" },
    { market: "KR", symbol: "035420" },
    { market: "US", symbol: "AAPL" }
  ]);
  assert.equal(
    result.combinedUniverseMembershipHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: result.members
    })
  );
});

test("combined universe membership rejects group identity drift", () => {
  const group = evidenceGroup([
    variant("1", [{ market: "KR", symbol: "005930" }])
  ]);
  group.sourceVariants[0]!.evidenceGroupHash = hash("2");

  assert.throws(
    () => buildEvidenceExpansionCombinedUniverseMembership(group),
    /does not match evidence group/
  );
});

test("combined universe membership rejects invalid source evidence", () => {
  const staleHash = evidenceGroup([
    variant("1", [{ market: "KR", symbol: "005930" }])
  ]);
  staleHash.sourceVariants[0]!.sourceVariant.universeMembershipHash =
    hash("f");
  assert.throws(
    () => buildEvidenceExpansionCombinedUniverseMembership(staleHash),
    /membership hash mismatch/
  );

  const nonCanonical = evidenceGroup([
    variant("1", [
      { market: "US", symbol: "AAPL" },
      { market: "KR", symbol: "005930" }
    ])
  ]);
  assert.throws(
    () => buildEvidenceExpansionCombinedUniverseMembership(nonCanonical),
    /canonical order/
  );

  const empty = evidenceGroup([]);
  assert.throws(
    () => buildEvidenceExpansionCombinedUniverseMembership(empty),
    /requires source variants/
  );
});

function evidenceGroup(
  sourceVariants: EvidenceExpansionSourceCandidateVariant[]
): EvidenceExpansionAcceptedEvidenceGroup {
  return {
    evidenceGroupHash: hash("a"),
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    targetRegime: "bull",
    splitRoles: ["train"],
    sourceVariants
  };
}

function variant(
  sourceCharacter: string,
  universeMembership: EvidenceExpansionUniverseMember[]
): EvidenceExpansionSourceCandidateVariant {
  return {
    evidenceGroupHash: hash("a"),
    sourceVariant: {
      feasibilityCandidateHash: hash(sourceCharacter),
      legacyReplayPlanEvidenceGroupHash: null,
      sourceVariantHashVersion:
        "evidence_expansion_source_variant.v1",
      sourceVariantHash: hash(sourceCharacter),
      observedTradingDatesHash: hash("b"),
      universeMembershipHash: createReplayResearchHash({
        version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
        members: universeMembership
      })
    },
    observedTradingDates: [
      { market: "KR", sessionDate: "2025-01-02" }
    ],
    universeMembership
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
