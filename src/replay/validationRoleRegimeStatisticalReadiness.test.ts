import assert from "node:assert/strict";
import test from "node:test";

import {
  buildValidationRoleRegimeStatisticalReadinessArtifact,
  validationRoleRegimeStatisticalReadinessArtifactSchema,
  type ValidationRoleRegimeStatisticalReadinessArtifact
} from "./validationRoleRegimeStatisticalReadiness.js";

test("readiness builder calculates global shared and role-exclusive evidence", () => {
  const artifact = buildValidationRoleRegimeStatisticalReadinessArtifact({
    generatedAt: new Date("2026-07-23T00:00:00.000Z"),
    planHash: hash("a"),
    expectedCounts: {
      plannedRunCount: 4,
      globalUniqueEvidenceGroupCount: 3,
      crossRoleSharedEvidenceGroupCount: 1
    },
    evidenceRows: [
      { splitRole: "train", targetRegime: "bull", evidenceGroupHash: hash("b") },
      {
        splitRole: "validation",
        targetRegime: "bull",
        evidenceGroupHash: hash("b")
      },
      {
        splitRole: "train",
        targetRegime: "sideways",
        evidenceGroupHash: hash("c")
      },
      { splitRole: "test", targetRegime: "bear", evidenceGroupHash: hash("d") }
    ]
  });

  assert.equal(artifact.status, "inconclusive");
  assert.equal(artifact.provenance.status, "verified");
  assert.deepEqual(artifact.evidence.global, {
    plannedRunCount: 4,
    globalUniqueEvidenceGroupCount: 3,
    crossRoleSharedEvidenceGroupCount: 1
  });
  assert.deepEqual(artifact.evidence.byRole.train, {
    plannedRunCount: 2,
    roleLocalUniqueEvidenceGroupCount: 2,
    roleExclusiveEvidenceGroupCount: 1,
    crossRoleSharedEvidenceGroupCount: 1
  });
  assert.deepEqual(artifact.evidence.byRole.validation, {
    plannedRunCount: 1,
    roleLocalUniqueEvidenceGroupCount: 1,
    roleExclusiveEvidenceGroupCount: 0,
    crossRoleSharedEvidenceGroupCount: 1
  });
  assert.equal(
    artifact.evidence.byRoleRegime.train.sideways.uniqueEvidenceGroupCount,
    1
  );
  assert.equal(
    artifact.blockers.some(
      (blocker) => blocker.code === "CROSS_ROLE_EVIDENCE_SHARED"
    ),
    true
  );
});

test("readiness builder marks expected and observed count conflicts invalid", () => {
  const artifact = buildValidationRoleRegimeStatisticalReadinessArtifact({
    generatedAt: "2026-07-23T00:00:00.000Z",
    planHash: hash("a"),
    expectedCounts: {
      plannedRunCount: 2,
      globalUniqueEvidenceGroupCount: 1,
      crossRoleSharedEvidenceGroupCount: 0
    },
    evidenceRows: [
      { splitRole: "train", targetRegime: "bull", evidenceGroupHash: hash("b") }
    ]
  });

  assert.equal(artifact.status, "invalid");
  assert.equal(artifact.provenance.status, "conflict");
  assert.equal(
    artifact.blockers.some(
      (blocker) => blocker.code === "PROVENANCE_COUNT_CONFLICT"
    ),
    true
  );
});

test("readiness builder rejects one role evidence group assigned to multiple regimes", () => {
  assert.throws(
    () =>
      buildValidationRoleRegimeStatisticalReadinessArtifact({
        generatedAt: "2026-07-23T00:00:00.000Z",
        planHash: hash("a"),
        expectedCounts: {
          plannedRunCount: 2,
          globalUniqueEvidenceGroupCount: 1,
          crossRoleSharedEvidenceGroupCount: 0
        },
        evidenceRows: [
          {
            splitRole: "train",
            targetRegime: "bull",
            evidenceGroupHash: hash("b")
          },
          {
            splitRole: "train",
            targetRegime: "bear",
            evidenceGroupHash: hash("b")
          }
        ]
      }),
    /role-regime unique evidence counts must match the role total/
  );
});

test("readiness artifact schema accepts a consistent paper-only contract", () => {
  const parsed =
    validationRoleRegimeStatisticalReadinessArtifactSchema.parse(
      readyArtifact()
    );

  assert.equal(
    parsed.schemaVersion,
    "validation_role_regime_statistical_readiness.v1"
  );
  assert.equal(parsed.mode, "paper_only");
  assert.equal(parsed.status, "ready_for_statistical_validation");
  assert.equal(parsed.config.roleSampleMinimum, 30);
  assert.equal(parsed.evidence.global.globalUniqueEvidenceGroupCount, 90);
});

test("readiness artifact schema rejects unsafe mode and unknown fields", () => {
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...readyArtifact(),
      mode: "live"
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...readyArtifact(),
      extra: true
    }).success,
    false
  );
});

test("readiness artifact schema rejects inconsistent global role and cell counts", () => {
  const artifact = readyArtifact();
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...artifact,
      evidence: {
        ...artifact.evidence,
        global: {
          ...artifact.evidence.global,
          plannedRunCount: 89
        }
      },
      provenance: {
        ...artifact.provenance,
        expectedCounts: {
          ...artifact.provenance.expectedCounts,
          plannedRunCount: 89
        },
        observedCounts: {
          ...artifact.provenance.observedCounts,
          plannedRunCount: 89
        }
      }
    }).success,
    false
  );

  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...artifact,
      evidence: {
        ...artifact.evidence,
        byRoleRegime: {
          ...artifact.evidence.byRoleRegime,
          train: {
            ...artifact.evidence.byRoleRegime.train,
            bull: {
              plannedRunCount: 7,
              uniqueEvidenceGroupCount: 7
            }
          }
        }
      }
    }).success,
    false
  );
});

test("readiness artifact schema requires blockers to match readiness gaps", () => {
  const undefinedMinimum = readyArtifact();
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...undefinedMinimum,
      status: "inconclusive",
      config: {
        ...undefinedMinimum.config,
        roleRegimeSampleMinimum: null
      }
    }).success,
    false
  );

  const withRequiredBlocker = {
    ...undefinedMinimum,
    status: "inconclusive" as const,
    config: {
      ...undefinedMinimum.config,
      roleRegimeSampleMinimum: null
    },
    blockers: [
      {
        code: "ROLE_REGIME_STATISTICAL_MINIMUM_UNDEFINED" as const,
        message: "role-regime statistical minimum is not defined",
        splitRole: null,
        targetRegime: null
      }
    ]
  };
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse(
      withRequiredBlocker
    ).success,
    true
  );
});

test("readiness artifact schema preserves shared and role-exclusive evidence counts", () => {
  const parsed =
    validationRoleRegimeStatisticalReadinessArtifactSchema.parse(
      sharedEvidenceArtifact()
    );

  assert.equal(parsed.status, "inconclusive");
  assert.equal(parsed.evidence.global.plannedRunCount, 92);
  assert.equal(parsed.evidence.global.globalUniqueEvidenceGroupCount, 91);
  assert.equal(parsed.evidence.global.crossRoleSharedEvidenceGroupCount, 1);
  assert.equal(
    parsed.evidence.byRole.train.roleLocalUniqueEvidenceGroupCount,
    31
  );
  assert.equal(
    parsed.evidence.byRole.train.roleExclusiveEvidenceGroupCount,
    30
  );
  assert.equal(
    parsed.evidence.byRole.validation.crossRoleSharedEvidenceGroupCount,
    1
  );
  assert.deepEqual(
    parsed.blockers.map((blocker) => blocker.code),
    ["CROSS_ROLE_EVIDENCE_SHARED"]
  );
});

test("readiness artifact schema fails closed for provenance count conflicts", () => {
  const artifact = readyArtifact();
  const conflict = {
    ...artifact,
    status: "invalid" as const,
    provenance: {
      ...artifact.provenance,
      status: "conflict" as const,
      expectedCounts: {
        ...artifact.provenance.expectedCounts,
        plannedRunCount: 91
      }
    },
    blockers: [
      {
        code: "PROVENANCE_COUNT_CONFLICT" as const,
        message: "expected and observed provenance counts conflict",
        splitRole: null,
        targetRegime: null
      }
    ]
  };

  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse(conflict)
      .success,
    true
  );
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...conflict,
      status: "ready_for_statistical_validation"
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...conflict,
      blockers: []
    }).success,
    false
  );
});

test("readiness artifact schema enforces single-candidate cell blockers", () => {
  const artifact = readyArtifact();
  const singleCandidate = {
    ...artifact,
    status: "inconclusive" as const,
    evidence: {
      ...artifact.evidence,
      byRoleRegime: {
        ...artifact.evidence.byRoleRegime,
        test: {
          bull: { plannedRunCount: 14, uniqueEvidenceGroupCount: 14 },
          bear: { plannedRunCount: 1, uniqueEvidenceGroupCount: 1 },
          sideways: { plannedRunCount: 7, uniqueEvidenceGroupCount: 7 },
          mixed: { plannedRunCount: 8, uniqueEvidenceGroupCount: 8 }
        }
      }
    },
    blockers: [
      {
        code: "ROLE_REGIME_SINGLE_CANDIDATE" as const,
        message: "role-regime cell has one candidate",
        splitRole: "test" as const,
        targetRegime: "bear" as const
      },
      {
        code: "ROLE_REGIME_SAMPLE_BELOW_STATISTICAL_MINIMUM" as const,
        message: "role-regime sample count is below the minimum",
        splitRole: "test" as const,
        targetRegime: "bear" as const
      }
    ]
  };

  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse(
      singleCandidate
    ).success,
    true
  );
  assert.equal(
    validationRoleRegimeStatisticalReadinessArtifactSchema.safeParse({
      ...singleCandidate,
      blockers: singleCandidate.blockers.slice(0, 1)
    }).success,
    false
  );
});

function readyArtifact(): ValidationRoleRegimeStatisticalReadinessArtifact {
  const globalCounts = {
    plannedRunCount: 90,
    globalUniqueEvidenceGroupCount: 90,
    crossRoleSharedEvidenceGroupCount: 0
  };
  const roleCounts = {
    plannedRunCount: 30,
    roleLocalUniqueEvidenceGroupCount: 30,
    roleExclusiveEvidenceGroupCount: 30,
    crossRoleSharedEvidenceGroupCount: 0
  };
  const roleRegimeCounts = {
    bull: { plannedRunCount: 8, uniqueEvidenceGroupCount: 8 },
    bear: { plannedRunCount: 7, uniqueEvidenceGroupCount: 7 },
    sideways: { plannedRunCount: 7, uniqueEvidenceGroupCount: 7 },
    mixed: { plannedRunCount: 8, uniqueEvidenceGroupCount: 8 }
  };

  return {
    schemaVersion: "validation_role_regime_statistical_readiness.v1",
    mode: "paper_only",
    purpose: "statistical_readiness_diagnostic",
    status: "ready_for_statistical_validation",
    generatedAt: "2026-07-23T00:00:00.000Z",
    source: {
      planHash: `sha256:${"a".repeat(64)}`
    },
    config: {
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 2
    },
    provenance: {
      status: "verified",
      expectedCounts: globalCounts,
      observedCounts: globalCounts
    },
    evidence: {
      global: globalCounts,
      byRole: {
        train: roleCounts,
        validation: roleCounts,
        test: roleCounts
      },
      byRoleRegime: {
        train: roleRegimeCounts,
        validation: roleRegimeCounts,
        test: roleRegimeCounts
      }
    },
    blockers: []
  };
}

function sharedEvidenceArtifact(): ValidationRoleRegimeStatisticalReadinessArtifact {
  const artifact = readyArtifact();
  const globalCounts = {
    plannedRunCount: 92,
    globalUniqueEvidenceGroupCount: 91,
    crossRoleSharedEvidenceGroupCount: 1
  };
  const sharedRoleCounts = {
    plannedRunCount: 31,
    roleLocalUniqueEvidenceGroupCount: 31,
    roleExclusiveEvidenceGroupCount: 30,
    crossRoleSharedEvidenceGroupCount: 1
  };
  const sharedRoleRegimeCounts = {
    bull: { plannedRunCount: 9, uniqueEvidenceGroupCount: 9 },
    bear: { plannedRunCount: 7, uniqueEvidenceGroupCount: 7 },
    sideways: { plannedRunCount: 7, uniqueEvidenceGroupCount: 7 },
    mixed: { plannedRunCount: 8, uniqueEvidenceGroupCount: 8 }
  };

  return {
    ...artifact,
    status: "inconclusive",
    provenance: {
      status: "verified",
      expectedCounts: globalCounts,
      observedCounts: globalCounts
    },
    evidence: {
      global: globalCounts,
      byRole: {
        train: sharedRoleCounts,
        validation: sharedRoleCounts,
        test: artifact.evidence.byRole.test
      },
      byRoleRegime: {
        train: sharedRoleRegimeCounts,
        validation: sharedRoleRegimeCounts,
        test: artifact.evidence.byRoleRegime.test
      }
    },
    blockers: [
      {
        code: "CROSS_ROLE_EVIDENCE_SHARED",
        message: "candidate evidence is shared across validation roles",
        splitRole: null,
        targetRegime: null
      }
    ]
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
