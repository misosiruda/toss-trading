import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG } from "../analytics/marketRegimeClassifier.js";
import type { ValidationSplitRegimeFeasibilityArtifact } from "./validationSplitRegimeFeasibility.js";
import {
  createValidationFeasibilityCandidateHash,
  createValidationFeasibilityClassifierHash
} from "./validationSplitRegimeFeasibility.js";
import {
  buildValidationRoleRegimeReplayPlan,
  createValidationRoleRegimeFeasibilityArtifactHash,
  createValidationRoleRegimeReplayPlanHash,
  type ValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";
import {
  buildValidationRoleRegimeStatisticalReadinessArtifact,
  type ValidationRoleRegimeStatisticalReadinessArtifact
} from "./validationRoleRegimeStatisticalReadiness.js";
import {
  createValidationRoleRegimeStatisticalReadinessArtifactHash,
  verifyValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";

test("baseline verifier accepts a consistent paper-only artifact chain", () => {
  const fixtures = baselineFixtures();
  const verified =
    verifyValidationRoleRegimeEvidenceExpansionBaseline(fixtures);

  assert.equal(verified.feasibility.status, "insufficient");
  assert.equal(verified.plan.status, "insufficient");
  assert.equal(verified.readiness.status, "inconclusive");
  assert.equal(
    verified.hashes.baselineFeasibilityArtifactHash,
    createValidationRoleRegimeFeasibilityArtifactHash(fixtures.feasibilityArtifact)
  );
  assert.equal(
    verified.hashes.baselinePlanHash,
    fixtures.planArtifact.planHash
  );
  assert.equal(
    verified.hashes.baselineReadinessArtifactHash,
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
});

test("baseline verifier rejects unknown result fields in strict sources", () => {
  const fixtures = baselineFixtures();

  assert.throws(() =>
    verifyValidationRoleRegimeEvidenceExpansionBaseline({
      ...fixtures,
      readinessArtifact: {
        ...fixtures.readinessArtifact,
        sharpe: 1.5
      }
    })
  );
});

test("baseline verifier rejects invalid artifact statuses", () => {
  const fixtures = baselineFixtures();
  const invalidPlan = withPlanHash({
    ...fixtures.planArtifact,
    status: "invalid"
  });
  const invalidReadiness =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: fixtures.readinessArtifact.generatedAt,
      planHash: fixtures.planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: 1,
        globalUniqueEvidenceGroupCount: 1,
        crossRoleSharedEvidenceGroupCount: 0
      },
      evidenceRows: []
    });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        feasibilityArtifact: {
          ...fixtures.feasibilityArtifact,
          status: "invalid"
        }
      }),
    /baseline feasibility status must not be invalid/
  );
  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: invalidPlan
      }),
    /baseline plan status must not be invalid/
  );
  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        readinessArtifact: invalidReadiness
      }),
    /baseline readiness status must not be invalid/
  );
});

test("baseline verifier rejects a plan linked to another feasibility artifact", () => {
  const fixtures = baselineFixtures();
  const changedPlan = withPlanHash({
    ...fixtures.planArtifact,
    source: {
      ...fixtures.planArtifact.source,
      feasibilityArtifactHash: hash("b")
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: changedPlan
      }),
    /baseline plan does not match feasibility identity/
  );
});

test("baseline verifier rejects feasibility provenance and config drift", () => {
  const fixtures = baselineFixtures();
  const provenanceDrift = withPlanHash({
    ...fixtures.planArtifact,
    source: {
      ...fixtures.planArtifact.source,
      coverageHash: hash("c")
    }
  });
  const configDrift = withPlanHash({
    ...fixtures.planArtifact,
    config: {
      ...fixtures.planArtifact.config,
      windowMonths: 2
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: provenanceDrift
      }),
    /baseline plan provenance mismatch: coverageHash/
  );
  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: configDrift
      }),
    /baseline plan config does not match feasibility config/
  );
});

test("baseline verifier normalizes feasibility target regime order", () => {
  const feasibilityArtifact = feasibilityFixture();
  feasibilityArtifact.config.targetRegimes = ["bear", "bull"];
  const planArtifact = planFixture(feasibilityArtifact);
  planArtifact.config.targetRegimes = ["bull", "bear"];
  planArtifact.planHash = createValidationRoleRegimeReplayPlanHash(planArtifact);

  assert.doesNotThrow(() =>
    verifyValidationRoleRegimeEvidenceExpansionBaseline({
      feasibilityArtifact,
      planArtifact,
      readinessArtifact: readinessForPlan(planArtifact)
    })
  );
});

test("baseline verifier rejects readiness linked to another plan", () => {
  const fixtures = baselineFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        readinessArtifact: {
          ...fixtures.readinessArtifact,
          source: { planHash: hash("d") }
        }
      }),
    /baseline readiness does not match plan identity/
  );
});

test("baseline verifier rejects readiness counts derived from another plan", () => {
  const fixtures = baselineFixtures();
  const readinessArtifact =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: fixtures.readinessArtifact.generatedAt,
      planHash: fixtures.planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: 1,
        globalUniqueEvidenceGroupCount: 1,
        crossRoleSharedEvidenceGroupCount: 0
      },
      evidenceRows: [
        {
          splitRole: "train",
          targetRegime: "bull",
          evidenceGroupHash: hash("e")
        }
      ]
    });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        readinessArtifact
      }),
    /baseline readiness expected counts do not match plan/
  );
});

test("baseline verifier rejects role-regime evidence redistributed from plan runs", () => {
  const fixtures = readyBaselineFixtures();
  assert.doesNotThrow(() =>
    verifyValidationRoleRegimeEvidenceExpansionBaseline(fixtures)
  );

  const redistributedReadiness =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: fixtures.readinessArtifact.generatedAt,
      planHash: fixtures.planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: fixtures.planArtifact.summary.plannedRunCount,
        globalUniqueEvidenceGroupCount:
          fixtures.planArtifact.summary.globalUniqueEvidenceGroupCount,
        crossRoleSharedEvidenceGroupCount:
          fixtures.planArtifact.summary.crossRoleSharedEvidenceGroupCount
      },
      evidenceRows: fixtures.planArtifact.runs.map((run) => ({
        splitRole: "train",
        targetRegime: run.targetRegime,
        evidenceGroupHash: run.evidenceGroupHash
      }))
    });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        readinessArtifact: redistributedReadiness
      }),
    /baseline readiness evidence does not match plan runs/
  );
});

test("baseline verifier rejects recomposed chains with corrupted candidate hashes", () => {
  const feasibilityArtifact = readyFeasibilityFixture();
  feasibilityArtifact.assignments[0]!.candidates[0]!.candidateHash = hash("f");
  const fixtures = readyBaselineFixtures(feasibilityArtifact);

  assert.throws(
    () => verifyValidationRoleRegimeEvidenceExpansionBaseline(fixtures),
    /baseline feasibility candidate hash mismatch/
  );
});

test("baseline verifier rejects classifier config provenance mismatch", () => {
  const feasibilityArtifact = feasibilityFixture();
  feasibilityArtifact.config.marketRegimeClassifier.bullReturnThreshold = 0.04;
  const fixtures = baselineFixtures(feasibilityArtifact);

  assert.throws(
    () => verifyValidationRoleRegimeEvidenceExpansionBaseline(fixtures),
    /baseline feasibility classifier hash mismatch/
  );
});

test("baseline verifier rejects non-ready plans for available feasibility", () => {
  const feasibilityArtifact = readyFeasibilityFixture();
  const planArtifact = planFixture(feasibilityArtifact);

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        feasibilityArtifact,
        planArtifact,
        readinessArtifact: readinessForPlan(planArtifact)
      }),
    /baseline plan status does not match feasibility status/
  );
});

test("baseline verifier rejects plans that omit eligible candidates", () => {
  const feasibilityArtifact = readyFeasibilityWithExtraTrainCandidate();
  const reducedFeasibility = readyFeasibilityFixture();
  const reducedPlan = readyBaselineFixtures(reducedFeasibility).planArtifact;
  const relinkedPlan = withPlanHash({
    ...reducedPlan,
    source: {
      ...reducedPlan.source,
      feasibilityArtifactHash:
        createValidationRoleRegimeFeasibilityArtifactHash(
          feasibilityArtifact
        ),
      feasibilityStatus: feasibilityArtifact.status,
      ...feasibilityArtifact.provenance
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        feasibilityArtifact,
        planArtifact: relinkedPlan,
        readinessArtifact: readinessForPlan(relinkedPlan)
      }),
    /baseline plan runs do not exhaust feasibility candidates/
  );
});

test("baseline verifier rejects plan runs absent from linked feasibility", () => {
  const feasibilityArtifact = readyFeasibilityFixture();
  const alternateFeasibility = structuredClone(feasibilityArtifact);
  const alternateCandidate =
    alternateFeasibility.assignments[0]!.candidates[0]!;
  alternateCandidate.startAt = "2023-02-01T00:00:00+09:00";
  alternateCandidate.endAt = "2023-02-28T23:59:59.999+09:00";
  alternateCandidate.candidateHash = candidateHash(
    alternateFeasibility,
    alternateCandidate
  );
  const alternatePlan = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact: alternateFeasibility,
    validationAssignments: readyAssignments(),
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });
  const relinkedPlan = withPlanHash({
    ...alternatePlan,
    source: {
      ...alternatePlan.source,
      feasibilityArtifactHash:
        createValidationRoleRegimeFeasibilityArtifactHash(
          feasibilityArtifact
        ),
      feasibilityStatus: feasibilityArtifact.status,
      ...feasibilityArtifact.provenance
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        feasibilityArtifact,
        planArtifact: relinkedPlan,
        readinessArtifact: readinessForPlan(relinkedPlan)
      }),
    /baseline plan run does not match feasibility candidates/
  );
});

test("baseline verifier rejects fabricated non-ready plan summary counts", () => {
  const fixtures = baselineFixtures();
  const planArtifact = withPlanHash({
    ...fixtures.planArtifact,
    summary: {
      ...fixtures.planArtifact.summary,
      coveredRoleRegimeCellCount: 1,
      roleRunCounts: { train: 1, validation: 0, test: 0 }
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact,
        readinessArtifact: readinessForPlan(planArtifact)
      }),
    /baseline non-ready plan summary mismatch/
  );
});

test("readiness hash ignores generation time but preserves semantic changes", () => {
  const fixtures = baselineFixtures();
  const changedTime = {
    ...fixtures.readinessArtifact,
    generatedAt: "2026-07-23T01:00:00.000Z"
  };
  const changedSource = {
    ...fixtures.readinessArtifact,
    source: {
      planHash: hash("f")
    }
  };
  const reorderedBlockers = {
    ...fixtures.readinessArtifact,
    blockers: [...fixtures.readinessArtifact.blockers].reverse()
  };

  assert.equal(
    createValidationRoleRegimeStatisticalReadinessArtifactHash(changedTime),
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
  assert.notEqual(
    createValidationRoleRegimeStatisticalReadinessArtifactHash(changedSource),
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
  assert.equal(
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      reorderedBlockers
    ),
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
});

function baselineFixtures(
  feasibilityArtifact = feasibilityFixture()
): {
  feasibilityArtifact: ValidationSplitRegimeFeasibilityArtifact;
  planArtifact: ValidationRoleRegimeReplayPlan;
  readinessArtifact: ValidationRoleRegimeStatisticalReadinessArtifact;
} {
  const planArtifact = planFixture(feasibilityArtifact);
  const readinessArtifact =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: "2026-07-23T00:00:00.000Z",
      planHash: planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: 0,
        globalUniqueEvidenceGroupCount: 0,
        crossRoleSharedEvidenceGroupCount: 0
      },
      evidenceRows: []
    });
  return { feasibilityArtifact, planArtifact, readinessArtifact };
}

function readyBaselineFixtures(
  feasibilityArtifact = readyFeasibilityFixture()
): {
  feasibilityArtifact: ValidationSplitRegimeFeasibilityArtifact;
  planArtifact: ValidationRoleRegimeReplayPlan;
  readinessArtifact: ValidationRoleRegimeStatisticalReadinessArtifact;
} {
  const planArtifact = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact,
    validationAssignments: readyAssignments(),
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });
  const readinessArtifact = readinessForPlan(planArtifact);
  return { feasibilityArtifact, planArtifact, readinessArtifact };
}

function feasibilityFixture(): ValidationSplitRegimeFeasibilityArtifact {
  const sourceHash = hash("a");
  const marketRegimeClassifier = {
    version: "market_regime_classifier.v1" as const,
    ...DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG
  };
  return {
    schemaVersion: "validation_split_regime_feasibility.v1",
    mode: "paper_only",
    status: "insufficient",
    generatedAt: "2026-07-21T00:00:00.000Z",
    config: {
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      targetRegimes: ["bull", "bear", "sideways", "mixed"],
      candidateStrategyBucket: "short_term",
      minimumCandidatesPerRoleRegime: 1,
      calendarValidation: {
        rules: [
          { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" },
          {
            market: "US",
            exchange: "NYSE",
            timezone: "America/New_York"
          }
        ]
      },
      marketRegimeClassifier
    },
    provenance: {
      dataSnapshotHash: sourceHash,
      universeHash: sourceHash,
      coverageHash: sourceHash,
      validationSplitHash: sourceHash,
      calendarHash: sourceHash,
      marketRegimeClassifierHash:
        createValidationFeasibilityClassifierHash(marketRegimeClassifier)
    },
    summary: {
      assignmentCount: 0,
      roleCounts: { train: 0, validation: 0, test: 0 },
      candidateCount: 0,
      uniqueCandidateCount: 0,
      roleCapacityCounts: { train: 0, validation: 0, test: 0 },
      boundaryViolationCount: 0,
      embargoViolationCount: 0,
      unavailableRoleRegimeCount: 0
    },
    roles: [],
    assignments: [],
    warnings: []
  };
}

function readyFeasibilityFixture(): ValidationSplitRegimeFeasibilityArtifact {
  const base = feasibilityFixture();
  const assignments = readyAssignments().map((assignment, index) => {
    const roleStart =
      assignment.splitRole === "train"
        ? assignment.trainStart
        : assignment.splitRole === "validation"
          ? assignment.validationStart
          : assignment.testStart!;
    const roleEnd =
      assignment.splitRole === "train"
        ? assignment.trainEnd
        : assignment.splitRole === "validation"
          ? assignment.validationEnd
          : assignment.testEnd!;
    return {
      splitId: assignment.splitId,
      splitIndex: assignment.splitIndex,
      splitRole: assignment.splitRole,
      roleStart,
      roleEnd,
      effectiveRoleEnd: assignment.splitRole === "train" ? roleEnd : null,
      structuralCapacityCount: 1,
      candidateCount: 1,
      regimeCounts: {
        bull: 1,
        bear: 0,
        sideways: 0,
        mixed: 0,
        insufficient_data: 0
      },
      availableTargetRegimes: ["bull"] as Array<"bull">,
      unavailableTargetRegimes: [],
      candidates: [
        {
          startAt: roleStart,
          endAt:
            assignment.splitRole === "train"
              ? "2023-01-31T23:59:59.999+09:00"
              : assignment.splitRole === "validation"
                ? "2023-05-31T23:59:59.999+09:00"
                : "2023-07-31T23:59:59.999+09:00",
          regime: "bull" as const,
          scopeAvailable: true,
          candidateHash: hash(String(index + 1))
        }
      ],
      maximumPairwiseOverlapRatio: 0,
      calendarRejectedCandidateCount: 0,
      scopeUnavailableCandidateCount: 0,
      warnings: []
    };
  });

  const artifact: ValidationSplitRegimeFeasibilityArtifact = {
    ...base,
    status: "available",
    config: {
      ...base.config,
      targetRegimes: ["bull"]
    },
    summary: {
      ...base.summary,
      assignmentCount: 3,
      roleCounts: { train: 1, validation: 1, test: 1 },
      candidateCount: 3,
      uniqueCandidateCount: 3,
      roleCapacityCounts: { train: 1, validation: 1, test: 1 }
    },
    roles: (["train", "validation", "test"] as const).map((splitRole) => ({
      splitRole,
      assignmentCount: 1,
      structuralCapacityCount: 1,
      uniqueCandidateCount: 1,
      regimeCounts: {
        bull: 1,
        bear: 0,
        sideways: 0,
        mixed: 0,
        insufficient_data: 0
      },
      availableTargetRegimes: ["bull"],
      unavailableTargetRegimes: [],
      minimumCandidatesPerRoleRegime: 1,
      capacityStatus: "sufficient",
      maximumPairwiseOverlapRatio: 0,
      warnings: []
    })),
    assignments
  };
  for (const assignment of artifact.assignments) {
    for (const candidate of assignment.candidates) {
      candidate.candidateHash = candidateHash(artifact, candidate);
    }
  }
  return artifact;
}

function readyFeasibilityWithExtraTrainCandidate(): ValidationSplitRegimeFeasibilityArtifact {
  const artifact = readyFeasibilityFixture();
  const trainAssignment = artifact.assignments.find(
    (assignment) => assignment.splitRole === "train"
  )!;
  const candidate: ValidationSplitRegimeFeasibilityArtifact["assignments"][number]["candidates"][number] = {
    startAt: "2023-02-01T00:00:00+09:00",
    endAt: "2023-02-28T23:59:59.999+09:00",
    regime: "bull" as const,
    scopeAvailable: true,
    candidateHash: hash("f")
  };
  candidate.candidateHash = candidateHash(artifact, candidate);
  trainAssignment.candidates.push(candidate);
  trainAssignment.structuralCapacityCount = 2;
  trainAssignment.candidateCount = 2;
  trainAssignment.regimeCounts.bull = 2;
  artifact.summary.candidateCount = 4;
  artifact.summary.uniqueCandidateCount = 4;
  artifact.summary.roleCapacityCounts.train = 2;
  const trainRole = artifact.roles.find(
    (role) => role.splitRole === "train"
  )!;
  trainRole.structuralCapacityCount = 2;
  trainRole.uniqueCandidateCount = 2;
  trainRole.regimeCounts.bull = 2;
  return artifact;
}

function readyAssignments(): ValidationSplitAssignment[] {
  const base = {
    validationProtocol: "walk_forward" as const,
    splitId: "split-0",
    splitIndex: 0,
    trainStart: "2023-01-01T00:00:00+09:00",
    trainEnd: "2023-04-30T23:59:59.999+09:00",
    validationStart: "2023-05-01T00:00:00+09:00",
    validationEnd: "2023-06-30T23:59:59.999+09:00",
    testStart: "2023-07-01T00:00:00+09:00",
    testEnd: "2023-09-30T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
  return [
    { ...base, splitRole: "train" },
    { ...base, splitRole: "validation" },
    { ...base, splitRole: "test" }
  ];
}

function readinessForPlan(
  plan: ValidationRoleRegimeReplayPlan
): ValidationRoleRegimeStatisticalReadinessArtifact {
  return buildValidationRoleRegimeStatisticalReadinessArtifact({
    generatedAt: "2026-07-23T00:00:00.000Z",
    planHash: plan.planHash,
    expectedCounts: {
      plannedRunCount: plan.summary.plannedRunCount,
      globalUniqueEvidenceGroupCount:
        plan.summary.globalUniqueEvidenceGroupCount,
      crossRoleSharedEvidenceGroupCount:
        plan.summary.crossRoleSharedEvidenceGroupCount
    },
    evidenceRows: plan.runs.map((run) => ({
      splitRole: run.splitRole,
      targetRegime: run.targetRegime,
      evidenceGroupHash: run.evidenceGroupHash
    }))
  });
}

function candidateHash(
  feasibility: ValidationSplitRegimeFeasibilityArtifact,
  candidate: ValidationSplitRegimeFeasibilityArtifact["assignments"][number]["candidates"][number]
): string {
  return createValidationFeasibilityCandidateHash({
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    timezoneOffsetMinutes: feasibility.config.timezoneOffsetMinutes,
    windowMonths: feasibility.config.windowMonths,
    calendarHash: feasibility.provenance.calendarHash,
    marketRegimeClassifierHash:
      feasibility.provenance.marketRegimeClassifierHash,
    candidateStrategyBucket: feasibility.config.candidateStrategyBucket,
    scopeAvailable: candidate.scopeAvailable,
    dataSnapshotHash: feasibility.provenance.dataSnapshotHash,
    universeHash: feasibility.provenance.universeHash,
    coverageHash: feasibility.provenance.coverageHash
  });
}

function planFixture(
  feasibility: ValidationSplitRegimeFeasibilityArtifact
): ValidationRoleRegimeReplayPlan {
  const roleRegimeRunCounts = Object.fromEntries(
    (["train", "validation", "test"] as const).flatMap((splitRole) =>
      feasibility.config.targetRegimes.map((targetRegime) => [
        `${splitRole}.${targetRegime}`,
        0
      ])
    )
  );
  const planWithoutHash: Omit<ValidationRoleRegimeReplayPlan, "planHash"> = {
    schemaVersion: "validation_role_regime_replay_plan.v1",
    mode: "paper_only",
    purpose: "role_local_regime_diagnostic",
    status: "insufficient",
    generatedAt: "2026-07-22T00:00:00.000Z",
    source: {
      feasibilitySchemaVersion: feasibility.schemaVersion,
      feasibilityArtifactHash:
        createValidationRoleRegimeFeasibilityArtifactHash(feasibility),
      feasibilityStatus: feasibility.status,
      ...feasibility.provenance
    },
    config: {
      selectionPolicyVersion:
        "exhaustive_role_regime_candidates.v1",
      candidateStrategyBucket: "short_term",
      targetRegimes: [...feasibility.config.targetRegimes],
      windowMonths: feasibility.config.windowMonths,
      timezoneOffsetMinutes: feasibility.config.timezoneOffsetMinutes,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    summary: {
      requiredRoleRegimeCellCount:
        3 * feasibility.config.targetRegimes.length,
      coveredRoleRegimeCellCount: 0,
      plannedRunCount: 0,
      globalUniqueEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 0,
      nonTargetCandidateCount: 0,
      roleRunCounts: { train: 0, validation: 0, test: 0 },
      roleRegimeRunCounts
    },
    runs: [],
    warnings: []
  };
  return {
    ...planWithoutHash,
    planHash: createValidationRoleRegimeReplayPlanHash(planWithoutHash)
  };
}

function withPlanHash(
  plan: ValidationRoleRegimeReplayPlan
): ValidationRoleRegimeReplayPlan {
  return {
    ...plan,
    planHash: createValidationRoleRegimeReplayPlanHash(plan)
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
