import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceExpansionPreflightIdentity } from "./validationRoleRegimeEvidenceExpansionPreflightIdentity.js";

test("preflight identity projects verified source, config, and targets", () => {
  const identity = buildEvidenceExpansionPreflightIdentity(input());

  assert.deepEqual(identity.source, {
    baselineFeasibilityArtifactHash: hash("1"),
    baselinePlanHash: hash("2"),
    baselineReadinessArtifactHash: hash("3"),
    expansionDataSnapshotHash: hash("4"),
    expansionUniverseHash: hash("5"),
    expansionCoverageHash: hash("6"),
    validationSplitHash: hash("7"),
    calendarHash: hash("8"),
    officialCalendarArtifactHash: hash("9"),
    marketRegimeClassifierHash: hash("a")
  });
  assert.deepEqual(identity.config, {
    candidateStrategyBucket: "short_term",
    targetRegimes: ["bull", "bear", "sideways", "mixed"],
    windowMonths: 12,
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
  value.calendarClassifier.officialCalendarArtifactHash = null;

  const identity = buildEvidenceExpansionPreflightIdentity(value);

  assert.equal(identity.source.officialCalendarArtifactHash, null);
});

test("preflight identity rejects mismatched verified links", () => {
  const mismatches: Array<{
    field: string;
    mutate: (value: ReturnType<typeof input>) => void;
  }> = [
    {
      field: "validation split",
      mutate: (value) => {
        value.expansion.hashes.validationSplitHash = hash("b");
      }
    },
    {
      field: "calendar",
      mutate: (value) => {
        value.calendarClassifier.calendarHash = hash("b");
      }
    },
    {
      field: "classifier",
      mutate: (value) => {
        value.calendarClassifier.marketRegimeClassifierHash = hash("b");
      }
    },
    {
      field: "timezone",
      mutate: (value) => {
        value.expansion.coverageTimezoneOffsetMinutes = 0;
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
  assert.throws(
    () =>
      buildEvidenceExpansionPreflightIdentity({
        ...input(),
        resultMetrics: { sharpeRatio: 1 }
      }),
    { name: "ZodError" }
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
  return {
    baseline: {
      hashes: {
        baselineFeasibilityArtifactHash: hash("1"),
        baselinePlanHash: hash("2"),
        baselineReadinessArtifactHash: hash("3")
      },
      provenance: {
        validationSplitHash: hash("7"),
        calendarHash: hash("8"),
        marketRegimeClassifierHash: hash("a")
      },
      config: {
        candidateStrategyBucket: "short_term" as const,
        windowMonths: 12,
        timezoneOffsetMinutes: 540
      }
    },
    expansion: {
      hashes: {
        expansionDataSnapshotHash: hash("4"),
        expansionUniverseHash: hash("5"),
        expansionCoverageHash: hash("6"),
        validationSplitHash: hash("7")
      },
      coverageTimezoneOffsetMinutes: 540
    },
    calendarClassifier: {
      calendarHash: hash("8"),
      officialCalendarArtifactHash: hash("9") as `sha256:${string}` | null,
      marketRegimeClassifierHash: hash("a")
    },
    roleRegimeSampleMinimum: 8
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
