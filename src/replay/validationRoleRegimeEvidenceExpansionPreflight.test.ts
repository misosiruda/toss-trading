import assert from "node:assert/strict";
import test from "node:test";

import {
  type EvidenceExpansionPreflightBlocker,
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact,
  validationRoleRegimeEvidenceExpansionPreflightArtifactSchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

test("strict preflight schema accepts a synthetic ready fixture", () => {
  const artifact = readyArtifact();

  const parsed =
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    );

  assert.equal(parsed.status, "ready_for_expansion_replay");
  assert.equal(parsed.mode, "paper_only");
  assert.equal(parsed.blockers.length, 0);
});

test("strict preflight schema rejects unknown fields and non-paper mode", () => {
  const artifact = readyArtifact() as ValidationRoleRegimeEvidenceExpansionPreflightArtifact & {
    resultMetrics?: { sharpe: number };
  };
  artifact.resultMetrics = { sharpe: 9 };

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      mode: "live"
    })
  );
});

test("preflight status fails closed for an invalid blocker", () => {
  const invalidBlocker = blocker("SOURCE_PROVENANCE_INVALID");
  const artifact = {
    ...readyArtifact(),
    status: "invalid",
    blockers: [invalidBlocker]
  };

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "invalid"
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "inconclusive"
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "ready_for_expansion_replay"
    })
  );
});

test("preflight status requires inconclusive for non-integrity blockers", () => {
  const artifact = {
    ...readyArtifact(),
    status: "inconclusive",
    blockers: [blocker("DEPENDENCY_INPUT_INCOMPLETE")]
  };

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "ready_for_expansion_replay"
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "invalid"
    })
  );
});

test("missing official calendar evidence requires its blocker", () => {
  const artifact = readyArtifact();
  artifact.source.officialCalendarArtifactHash = null;

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  artifact.status = "inconclusive";
  artifact.blockers = [blocker("OFFICIAL_CALENDAR_EVIDENCE_MISSING")];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );
});

test("undefined role-regime target requires null targets and blocker", () => {
  const artifact = readyArtifact();
  artifact.config.roleRegimeSampleMinimum = null;
  for (const role of ["train", "validation", "test"] as const) {
    for (const regime of ["bull", "bear", "sideways", "mixed"] as const) {
      artifact.targetMatrix.byRole[role].byRegime[regime] = null;
    }
  }

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  artifact.status = "inconclusive";
  artifact.blockers = [blocker("ROLE_REGIME_TARGET_UNDEFINED")];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );
});

test("combined capacity below target requires scoped blockers", () => {
  const artifact = readyArtifact();
  artifact.capacity.combined.byRole.validation = {
    roleLocalUniqueEvidenceGroupCount: 29,
    roleExclusiveEvidenceGroupCount: 28,
    byRegime: {
      bull: 1,
      bear: 8,
      sideways: 10,
      mixed: 10
    }
  };
  artifact.capacity.combined.globalUniqueEvidenceGroupCount = 90;
  artifact.capacity.combined.crossRoleSharedEvidenceGroupCount = 2;
  artifact.status = "inconclusive";
  artifact.blockers = [
    blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "validation"),
    blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "validation"),
    blocker(
      "ROLE_REGIME_CAPACITY_BELOW_TARGET",
      "validation",
      "bull"
    )
  ];

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );

  artifact.blockers = artifact.blockers.slice(1);
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
});

test("capacity views reject global and role count conflicts", () => {
  const artifact = readyArtifact();
  artifact.capacity.baseline.globalUniqueEvidenceGroupCount = 90;

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  const roleConflict = readyArtifact();
  roleConflict.capacity.expansion.byRole.train.byRegime.bull = 7;
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      roleConflict
    )
  );
});

test("strict preflight schema rejects duplicate and incorrectly scoped blockers", () => {
  const dependencyBlocker = blocker("DEPENDENCY_INPUT_INCOMPLETE");
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "inconclusive",
      blockers: [dependencyBlocker, dependencyBlocker]
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "inconclusive",
      blockers: [
        blocker(
          "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
          "train",
          "bull"
        )
      ]
    })
  );
});

test("dependency contract rejects overwritten or inconsistent date diagnostics", () => {
  const artifact = readyArtifact();
  artifact.dependencyInputs.candidateIntervals[0]!.sourceVariants[0] = {
    ...artifact.dependencyInputs.candidateIntervals[0]!.sourceVariants[0]!,
    observedTradingDatesHash: hash("b")
  };
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  artifact.status = "invalid";
  artifact.blockers = [blocker("TRADING_DATE_SET_CONFLICT")];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "invalid"
  );

  const invalidPairwise = readyArtifact();
  invalidPairwise.dependencyInputs.pairwise[0] = {
    ...invalidPairwise.dependencyInputs.pairwise[0]!,
    tradingDateOverlapCount: 2,
    tradingDateUnionCount: 4,
    tradingDateOverlapRatio: 0.75,
    adjacencyTradingDayGap: 1
  };
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      invalidPairwise
    )
  );
});

test("strict preflight schema rejects stale derived blockers", () => {
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "inconclusive",
      blockers: [blocker("OFFICIAL_CALENDAR_EVIDENCE_MISSING")]
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "invalid",
      blockers: [blocker("TRADING_DATE_SET_CONFLICT")]
    })
  );
});

function readyArtifact(): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  const sourceVariant = {
    feasibilityCandidateHash: hash("1"),
    legacyReplayPlanEvidenceGroupHash: hash("2"),
    sourceVariantHashVersion:
      "evidence_expansion_source_variant.v1" as const,
    sourceVariantHash: hash("3"),
    observedTradingDatesHash: hash("4"),
    universeMembershipHash: hash("5")
  };
  const capacityRole = {
    roleLocalUniqueEvidenceGroupCount: 32,
    roleExclusiveEvidenceGroupCount: 30,
    byRegime: {
      bull: 8,
      bear: 8,
      sideways: 8,
      mixed: 8
    }
  };
  const capacityView = {
    globalUniqueEvidenceGroupCount: 93,
    crossRoleSharedEvidenceGroupCount: 3,
    byRole: {
      train: capacityRole,
      validation: capacityRole,
      test: capacityRole
    }
  };
  const roleTarget = {
    roleLocalUniqueMinimum: 30 as const,
    roleExclusiveMinimum: 30 as const,
    byRegime: {
      bull: 2,
      bear: 2,
      sideways: 2,
      mixed: 2
    }
  };

  return {
    schemaVersion:
      "validation_role_regime_evidence_expansion_preflight.v1",
    mode: "paper_only",
    purpose: "evidence_expansion_preflight",
    status: "ready_for_expansion_replay",
    generatedAt: "2026-07-23T00:00:00.000Z",
    source: {
      baselineFeasibilityArtifactHash: hash("a"),
      baselinePlanHash: hash("b"),
      baselineReadinessArtifactHash: hash("c"),
      expansionDataSnapshotHash: hash("d"),
      expansionUniverseHash: hash("e"),
      expansionCoverageHash: hash("f"),
      validationSplitHash: hash("6"),
      calendarHash: hash("7"),
      officialCalendarArtifactHash: hash("8"),
      marketRegimeClassifierHash: hash("9")
    },
    config: {
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull", "bear", "sideways", "mixed"],
      windowMonths: 12,
      timezoneOffsetMinutes: 540,
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 2,
      inputPolicyVersion: "result_blind_capacity_scan.v1",
      dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
    },
    targetMatrix: {
      byRole: {
        train: roleTarget,
        validation: roleTarget,
        test: roleTarget
      }
    },
    capacity: {
      baseline: structuredClone(capacityView),
      expansion: structuredClone(capacityView),
      combined: structuredClone(capacityView),
      incremental: structuredClone(capacityView)
    },
    dependencyInputs: {
      candidateIntervals: [
        {
          evidenceGroupHash: hash("0"),
          sourceVariants: [sourceVariant],
          splitRoles: ["train"],
          targetRegime: "bull",
          startAt: "2020-01-01T00:00:00.000Z",
          endAt: "2021-01-01T00:00:00.000Z",
          canonicalTradingDatesHash: hash("4"),
          combinedUniverseMembershipHash: hash("5")
        },
        {
          evidenceGroupHash: hash("a"),
          sourceVariants: [
            {
              ...sourceVariant,
              feasibilityCandidateHash: hash("6"),
              sourceVariantHash: hash("7")
            }
          ],
          splitRoles: ["validation"],
          targetRegime: "bear",
          startAt: "2021-01-02T00:00:00.000Z",
          endAt: "2022-01-01T00:00:00.000Z",
          canonicalTradingDatesHash: hash("4"),
          combinedUniverseMembershipHash: hash("5")
        }
      ],
      pairwise: [
        {
          leftEvidenceGroupHash: hash("0"),
          rightEvidenceGroupHash: hash("a"),
          tradingDateOverlapCount: 0,
          tradingDateUnionCount: 504,
          tradingDateOverlapRatio: 0,
          adjacencyTradingDayGap: 1,
          sharedUniverse: true,
          sameRegime: false,
          crossRole: true
        }
      ]
    },
    exclusions: [],
    blockers: [],
    preflightHash: hash("f")
  };
}

function blocker(
  code: EvidenceExpansionPreflightBlocker["code"],
  splitRole: EvidenceExpansionPreflightBlocker["splitRole"] = null,
  targetRegime: EvidenceExpansionPreflightBlocker["targetRegime"] = null
): EvidenceExpansionPreflightBlocker {
  return {
    code,
    message: `${code} fixture`,
    splitRole,
    targetRegime
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
