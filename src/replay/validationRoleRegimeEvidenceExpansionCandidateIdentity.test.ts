import assert from "node:assert/strict";
import test from "node:test";

import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  createEvidenceExpansionCandidateIdentity
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";

test("candidate identity creates the documented evidence-group and source-variant hashes", () => {
  const input = identityInput();
  const identity = createEvidenceExpansionCandidateIdentity(input);

  const expectedEvidenceGroupHash = createReplayResearchHash({
    startAt: input.startAt,
    endAt: input.endAt,
    candidateStrategyBucket: input.candidateStrategyBucket,
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes
  });
  assert.equal(identity.evidenceGroupHash, expectedEvidenceGroupHash);
  assert.equal(
    identity.sourceVariant.sourceVariantHash,
    createReplayResearchHash({
      evidenceGroupHash: expectedEvidenceGroupHash,
      feasibilityCandidateHash:
        identity.sourceVariant.feasibilityCandidateHash,
      scopeAvailable: input.scopeAvailable,
      calendarHash: input.calendarHash,
      marketRegimeClassifierHash: input.marketRegimeClassifierHash,
      dataSnapshotHash: input.dataSnapshotHash,
      universeHash: input.universeHash,
      coverageHash: input.coverageHash,
      validationSplitHash: input.validationSplitHash,
      observedTradingDatesHash: input.observedTradingDatesHash,
      universeMembershipHash: input.universeMembershipHash
    })
  );
  assert.equal(
    identity.sourceVariant.sourceVariantHashVersion,
    "evidence_expansion_source_variant.v1"
  );
});

test("candidate identity keeps evidence-group identity independent from source provenance", () => {
  const baseline = createEvidenceExpansionCandidateIdentity(identityInput());
  const changed = createEvidenceExpansionCandidateIdentity({
    ...identityInput(),
    dataSnapshotHash: hash("a"),
    universeHash: hash("b"),
    coverageHash: hash("c"),
    validationSplitHash: hash("d"),
    observedTradingDatesHash: hash("e"),
    universeMembershipHash: hash("f")
  });

  assert.equal(changed.evidenceGroupHash, baseline.evidenceGroupHash);
  assert.notEqual(
    changed.sourceVariant.feasibilityCandidateHash,
    baseline.sourceVariant.feasibilityCandidateHash
  );
  assert.notEqual(
    changed.sourceVariant.sourceVariantHash,
    baseline.sourceVariant.sourceVariantHash
  );
});

test("candidate identity includes validation and observed source hashes only in the variant", () => {
  const baseline = createEvidenceExpansionCandidateIdentity(identityInput());
  const changed = createEvidenceExpansionCandidateIdentity({
    ...identityInput(),
    validationSplitHash: hash("a"),
    observedTradingDatesHash: hash("b"),
    universeMembershipHash: hash("c")
  });

  assert.equal(changed.evidenceGroupHash, baseline.evidenceGroupHash);
  assert.equal(
    changed.sourceVariant.feasibilityCandidateHash,
    baseline.sourceVariant.feasibilityCandidateHash
  );
  assert.notEqual(
    changed.sourceVariant.sourceVariantHash,
    baseline.sourceVariant.sourceVariantHash
  );
});

test("candidate identity changes both identities when the interval changes", () => {
  const baseline = createEvidenceExpansionCandidateIdentity(identityInput());
  const changed = createEvidenceExpansionCandidateIdentity({
    ...identityInput(),
    endAt: "2024-03-01T00:00:00.000Z"
  });

  assert.notEqual(changed.evidenceGroupHash, baseline.evidenceGroupHash);
  assert.notEqual(
    changed.sourceVariant.sourceVariantHash,
    baseline.sourceVariant.sourceVariantHash
  );
});

test("candidate identity preserves a verified legacy replay-plan evidence hash", () => {
  const expansion = createEvidenceExpansionCandidateIdentity(identityInput());
  const baseline = createEvidenceExpansionCandidateIdentity({
    ...identityInput(),
    legacyReplayPlanEvidenceGroupHash:
      expansion.sourceVariant.feasibilityCandidateHash
  });

  assert.equal(
    baseline.sourceVariant.legacyReplayPlanEvidenceGroupHash,
    baseline.sourceVariant.feasibilityCandidateHash
  );
  assert.equal(
    baseline.sourceVariant.sourceVariantHash,
    expansion.sourceVariant.sourceVariantHash
  );
});

test("candidate identity rejects a conflicting legacy replay-plan evidence hash", () => {
  assert.throws(
    () =>
      createEvidenceExpansionCandidateIdentity({
        ...identityInput(),
        legacyReplayPlanEvidenceGroupHash: hash("f")
      }),
    /legacy replay-plan evidence group hash does not match/
  );
});

test("candidate identity rejects invalid intervals and unknown fields", () => {
  assert.throws(
    () =>
      createEvidenceExpansionCandidateIdentity({
        ...identityInput(),
        endAt: "2024-01-01T00:00:00.000Z"
      }),
    /startAt must be before endAt/
  );
  assert.throws(
    () =>
      createEvidenceExpansionCandidateIdentity({
        ...identityInput(),
        targetRegime: "bull"
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      createEvidenceExpansionCandidateIdentity({
        ...identityInput(),
        totalReturnRatio: 1
      }),
    /Unrecognized key/
  );
});

function identityInput() {
  return {
    startAt: "2024-01-01T00:00:00.000Z",
    endAt: "2024-02-01T00:00:00.000Z",
    candidateStrategyBucket: "short_term" as const,
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    scopeAvailable: true,
    calendarHash: hash("1"),
    marketRegimeClassifierHash: hash("2"),
    dataSnapshotHash: hash("3"),
    universeHash: hash("4"),
    coverageHash: hash("5"),
    validationSplitHash: hash("6"),
    observedTradingDatesHash: hash("7"),
    universeMembershipHash: hash("8"),
    legacyReplayPlanEvidenceGroupHash: null
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
