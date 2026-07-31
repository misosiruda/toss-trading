import assert from "node:assert/strict";
import test from "node:test";

import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionPreflightIdentity,
  type EvidenceExpansionPreflightIdentityInput
} from "./validationRoleRegimeEvidenceExpansionPreflightIdentity.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";

test("preflight identity projects verified source, config, and targets", () => {
  const identity = buildEvidenceExpansionPreflightIdentity(input());

  assert.deepEqual(identity.source, {
    baselineFeasibilityArtifactHash: hash("1"),
    baselinePlanHash: hash("2"),
    baselineReadinessArtifactHash: hash("3"),
    expansionDataSnapshotHash: hash("4"),
    expansionUniverseHash: hash("5"),
    expansionCoverageHash: hash("6"),
    baselineValidationSplitHash: hash("7"),
    expansionValidationSplitHash: hash("7"),
    calendarHash: hash("8"),
    officialCalendarArtifactHash: hash("9"),
    marketRegimeClassifierHash: hash("a")
  });
  assert.deepEqual(identity.config, {
    candidateStrategyBucket: "short_term",
    targetRegimes: ["bull", "bear", "sideways", "mixed"],
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: 8,
    inputPolicyVersion: "result_blind_capacity_scan.v1",
    dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
  });
  assert.equal(identity.targetMatrix.byRole.train.byRegime.bull, 8);
  assert.equal(identity.targetMatrix.byRole.validation.byRegime.mixed, 8);
  assert.equal(identity.targetMatrix.byRole.test.roleExclusiveMinimum, 30);
});

test("preflight identity preserves an unavailable official calendar", () => {
  const value = input();
  value.calendarClassifier.hashes.officialCalendarArtifactHash = null;

  const identity = buildEvidenceExpansionPreflightIdentity(value);

  assert.equal(identity.source.officialCalendarArtifactHash, null);
});

test("preflight identity preserves separately verified split hashes", () => {
  const value = input();
  value.expansion.hashes.validationSplitHash = hash("b");

  const identity = buildEvidenceExpansionPreflightIdentity(value);

  assert.equal(
    identity.source.baselineValidationSplitHash,
    hash("7")
  );
  assert.equal(
    identity.source.expansionValidationSplitHash,
    hash("b")
  );
});

test("preflight identity rejects mismatched verified links", () => {
  const mismatches: Array<{
    field: string;
    mutate: (value: ReturnType<typeof input>) => void;
  }> = [
    {
      field: "calendar",
      mutate: (value) => {
        value.calendarClassifier.hashes.calendarHash = hash("b");
      }
    },
    {
      field: "classifier",
      mutate: (value) => {
        value.calendarClassifier.hashes.marketRegimeClassifierHash =
          hash("b");
      }
    },
    {
      field: "timezone",
      mutate: (value) => {
        value.expansion.coverage.timezoneOffsetMinutes = 0;
      }
    }
  ];

  for (const mismatch of mismatches) {
    const value = input();
    mismatch.mutate(value);
    assert.throws(
      () => buildEvidenceExpansionPreflightIdentity(value),
      new RegExp(mismatch.field)
    );
  }
});

test("preflight identity rejects result fields and invalid targets", () => {
  const resultInput = {
    ...input(),
    resultMetrics: { sharpeRatio: 1 }
  } as unknown as EvidenceExpansionPreflightIdentityInput;
  assert.throws(
    () => buildEvidenceExpansionPreflightIdentity(resultInput),
    /unknown fields/
  );
  assert.throws(
    () =>
      buildEvidenceExpansionPreflightIdentity({
        ...input(),
        roleRegimeSampleMinimum: 0
      }),
    { name: "ZodError" }
  );
});

function input() {
  const baseline = {
      hashes: {
        baselineFeasibilityArtifactHash: hash("1"),
        baselinePlanHash: hash("2"),
        baselineReadinessArtifactHash: hash("3")
      },
      feasibility: {
        provenance: {
          validationSplitHash: hash("7"),
          calendarHash: hash("8"),
          marketRegimeClassifierHash: hash("a")
        },
        config: {
          candidateStrategyBucket: "short_term" as const,
          windowMonths: 1,
          timezoneOffsetMinutes: 540
        }
      }
    } as VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  const expansion = {
      hashes: {
        expansionDataSnapshotHash: hash("4"),
        expansionUniverseHash: hash("5"),
        expansionCoverageHash: hash("6"),
        validationSplitHash: hash("7")
      },
      coverage: {
        timezoneOffsetMinutes: 540
      }
    } as VerifiedValidationRoleRegimeEvidenceExpansionSource;
  const calendarClassifier = {
      hashes: {
        calendarHash: hash("8"),
        officialCalendarArtifactHash:
          hash("9") as `sha256:${string}` | null,
        marketRegimeClassifierHash: hash("a")
      }
    } as VerifiedEvidenceExpansionCalendarClassifier;
  return {
    baseline,
    expansion,
    calendarClassifier,
    roleRegimeSampleMinimum: 8
  } satisfies EvidenceExpansionPreflightIdentityInput;
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
