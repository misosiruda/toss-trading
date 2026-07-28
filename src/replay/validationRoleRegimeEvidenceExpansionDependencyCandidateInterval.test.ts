import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  EvidenceExpansionCanonicalTradingDates
} from "./validationRoleRegimeEvidenceExpansionCanonicalTradingDates.js";
import {
  buildEvidenceExpansionDependencyCandidateInterval
} from "./validationRoleRegimeEvidenceExpansionDependencyCandidateInterval.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
  type EvidenceExpansionObservedTradingDate
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
  type EvidenceExpansionUniverseMember
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

test("dependency candidate interval joins canonical group evidence", () => {
  const dates = canonicalTradingDates();
  const group = evidenceGroup([
    variant("2", dates.sessions, [
      { market: "US", symbol: "AAPL" }
    ]),
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);

  const result =
    buildEvidenceExpansionDependencyCandidateInterval({
      group,
      canonicalTradingDates: dates
    });

  assert.deepEqual(
    result.sourceVariants.map(
      (variantReference) => variantReference.sourceVariantHash
    ),
    [hash("1"), hash("2")]
  );
  assert.deepEqual(result.splitRoles, ["train", "validation"]);
  assert.equal(
    result.canonicalTradingDatesHash,
    dates.canonicalTradingDatesHash
  );
  assert.equal(
    result.combinedUniverseMembershipHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: [
        { market: "KR", symbol: "005930" },
        { market: "US", symbol: "AAPL" }
      ]
    })
  );
});

test("dependency candidate interval rejects trading-date conflicts", () => {
  const dates = canonicalTradingDates();
  const staleReference = evidenceGroup([
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);
  staleReference.sourceVariants[0]!.sourceVariant
    .observedTradingDatesHash = hash("f");
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group: staleReference,
        canonicalTradingDates: dates
      }),
    /trading-date set conflict/
  );

  const differentSet = evidenceGroup([
    variant(
      "1",
      [{ market: "KR", sessionDate: "2025-01-03" }],
      [{ market: "KR", symbol: "005930" }]
    )
  ]);
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group: differentSet,
        canonicalTradingDates: dates
      }),
    /trading-date set conflict/
  );
});

test("dependency candidate interval rejects invalid canonical dates", () => {
  const dates = canonicalTradingDates();
  const group = evidenceGroup([
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);
  const staleHash = {
    ...dates,
    canonicalTradingDatesHash: hash("f")
  };
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        canonicalTradingDates: staleHash
      }),
    /canonical trading-date hash mismatch/
  );

  const nonCanonical = canonicalTradingDates([
    { market: "US", sessionDate: "2025-01-03" },
    { market: "KR", sessionDate: "2025-01-02" }
  ]);
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        canonicalTradingDates: nonCanonical
      }),
    /canonical order/
  );
});

test("dependency candidate interval preserves upstream membership gates", () => {
  const dates = canonicalTradingDates();
  const group = evidenceGroup([
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);
  group.sourceVariants[0]!.sourceVariant.universeMembershipHash =
    hash("f");

  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        canonicalTradingDates: dates
      }),
    /membership hash mismatch/
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
    splitRoles: ["train", "validation"],
    sourceVariants
  };
}

function canonicalTradingDates(
  sessions: EvidenceExpansionObservedTradingDate[] = [
    { market: "KR", sessionDate: "2025-01-02" },
    { market: "US", sessionDate: "2025-01-03" }
  ]
): EvidenceExpansionCanonicalTradingDates {
  return {
    sessions,
    canonicalTradingDatesHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions
    })
  };
}

function variant(
  sourceCharacter: string,
  observedTradingDates: EvidenceExpansionObservedTradingDate[],
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
      observedTradingDatesHash: createReplayResearchHash({
        version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
        sessions: observedTradingDates
      }),
      universeMembershipHash: createReplayResearchHash({
        version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
        members: universeMembership
      })
    },
    observedTradingDates,
    universeMembership
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
