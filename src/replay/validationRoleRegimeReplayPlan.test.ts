import assert from "node:assert/strict";
import test from "node:test";

import type { ValidationSplitRegimeFeasibilityArtifact } from "./validationSplitRegimeFeasibility.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";
import {
  buildValidationRoleRegimeReplayPlan,
  buildExhaustiveValidationRoleRegimeSelection,
  createValidationRoleRegimeFeasibilityArtifactHash,
  createValidationRoleRegimeReplayPlanHash,
  parseValidationRoleRegimeReplayPlan,
  validationRoleRegimeReplayPlanSchema,
  validationRoleRegimeReplaySelectionRowSchema
} from "./validationRoleRegimeReplayPlan.js";

const HASH_A = hash("a");
const HASH_B = hash("b");
const HASH_C = hash("c");
const HASH_D = hash("d");
const HASH_E = hash("e");
const HASH_F = hash("f");
const HASH_G = hash("3");
const HASH_X = hash("1");
const HASH_UNAVAILABLE = hash("2");

test("role-regime replay plan schema accepts the paper-only v1 structure", () => {
  const parsed = validationRoleRegimeReplayPlanSchema.parse(emptyPlan());

  assert.equal(parsed.schemaVersion, "validation_role_regime_replay_plan.v1");
  assert.equal(parsed.mode, "paper_only");
  assert.equal(parsed.status, "insufficient");
});

test("role-regime replay plan schemas reject unsafe mode and path-unsafe run keys", () => {
  assert.equal(
    validationRoleRegimeReplayPlanSchema.safeParse({
      ...emptyPlan(),
      mode: "live"
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeReplaySelectionRowSchema.safeParse({
      ...selectionRow(),
      runKey: "train:bull:unsafe"
    }).success,
    false
  );
});

test("exhaustive builder deduplicates within role and preserves source assignments", () => {
  const sourceAssignments = assignments();
  const rows = buildExhaustiveValidationRoleRegimeSelection({
    feasibilityArtifact: availableFeasibilityArtifact(),
    validationAssignments: [...sourceAssignments].reverse()
  });

  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((row) => `${row.splitRole}/${row.targetRegime}`),
    [
      "train/bull",
      "train/bull",
      "train/bull",
      "train/bear",
      "validation/bull",
      "validation/bear",
      "test/bull",
      "test/bear"
    ]
  );
  assert.deepEqual(
    rows.map((row) => row.planIndex),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
  assert.equal(rows.some((row) => row.candidateHash === HASH_X), false);
  assert.equal(
    rows.some((row) => row.candidateHash === HASH_UNAVAILABLE),
    false
  );

  const trainBull = rows[0]!;
  assert.equal(trainBull.candidateHash, HASH_A);
  assert.deepEqual(
    trainBull.sourceAssignments.map((assignment) => assignment.splitId),
    ["split-0", "split-1"]
  );
  assert.equal(trainBull.executionAssignment.splitId, "split-0");
  assert.match(trainBull.runKey, /^train_bull_[a-f0-9]{64}$/);
  assert.deepEqual(
    rows
      .filter(
        (row) => row.splitRole === "train" && row.targetRegime === "bull"
      )
      .map((row) => row.candidateOrdinalWithinRoleRegime),
    [0, 1, 2]
  );
});

test("exhaustive builder output is invariant to assignment and candidate order", () => {
  const artifact = availableFeasibilityArtifact();
  const reordered = {
    ...artifact,
    assignments: [...artifact.assignments]
      .reverse()
      .map((assignment) => ({
        ...assignment,
        candidates: [...assignment.candidates].reverse()
      }))
  };

  const first = buildExhaustiveValidationRoleRegimeSelection({
    feasibilityArtifact: artifact,
    validationAssignments: assignments()
  });
  const second = buildExhaustiveValidationRoleRegimeSelection({
    feasibilityArtifact: reordered,
    validationAssignments: [...assignments()].reverse()
  });

  assert.deepEqual(second, first);
});

test("exhaustive builder rejects non-ready and missing assignment inputs", () => {
  assert.throws(
    () =>
      buildExhaustiveValidationRoleRegimeSelection({
        feasibilityArtifact: {
          ...availableFeasibilityArtifact(),
          status: "insufficient"
        },
        validationAssignments: assignments()
      }),
    /feasibility artifact must be available/
  );
  assert.throws(
    () =>
      buildExhaustiveValidationRoleRegimeSelection({
        feasibilityArtifact: availableFeasibilityArtifact(),
        validationAssignments: assignments().filter(
          (assignment) => assignment.splitId !== "split-1"
        )
      }),
    /validation assignment missing: split-1\/train/
  );
});

test("exhaustive builder rejects duplicate source assignments", () => {
  const sourceAssignments = assignments();
  assert.throws(
    () =>
      buildExhaustiveValidationRoleRegimeSelection({
        feasibilityArtifact: availableFeasibilityArtifact(),
        validationAssignments: [
          ...sourceAssignments,
          sourceAssignments[0]!
        ]
      }),
    /duplicate validation assignment: split-0\/train/
  );
});

test("exhaustive builder rejects source boundary and embargo mismatch", () => {
  const sourceAssignments = assignments();
  sourceAssignments[0] = {
    ...sourceAssignments[0]!,
    embargoDurationDays: 1
  };

  assert.throws(
    () =>
      buildExhaustiveValidationRoleRegimeSelection({
        feasibilityArtifact: availableFeasibilityArtifact(),
        validationAssignments: sourceAssignments
      }),
    /validation assignment boundary mismatch: split-0\/train/
  );
});

test("plan builder groups cross-role evidence and derives canonical summary", () => {
  const plan = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact: availableFeasibilityArtifact(),
    validationAssignments: assignments(),
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });

  assert.equal(plan.status, "ready_for_paper_diagnostic");
  assert.equal(plan.runs.length, 8);
  assert.deepEqual(plan.summary, {
    requiredRoleRegimeCellCount: 6,
    coveredRoleRegimeCellCount: 6,
    plannedRunCount: 8,
    globalUniqueEvidenceGroupCount: 7,
    crossRoleSharedEvidenceGroupCount: 1,
    nonTargetCandidateCount: 1,
    roleRunCounts: { train: 4, validation: 2, test: 2 },
    roleRegimeRunCounts: {
      "train.bull": 3,
      "train.bear": 1,
      "validation.bull": 1,
      "validation.bear": 1,
      "test.bull": 1,
      "test.bear": 1
    }
  });
  const shared = plan.runs.filter((run) => run.candidateHash === HASH_C);
  assert.equal(shared.length, 2);
  assert.deepEqual(
    shared.map((run) => [run.splitRole, run.sharedRoles, run.sharedAcrossRoles]),
    [
      ["train", ["train", "validation"], true],
      ["validation", ["train", "validation"], true]
    ]
  );
  assert.equal(
    plan.warnings.filter(
      (warning) => warning.code === "CROSS_ROLE_EVIDENCE_SHARED"
    ).length,
    1
  );
  assert.equal(plan.warnings.length, 11);
  assert.deepEqual(parseValidationRoleRegimeReplayPlan(plan), plan);
});

test("feasibility artifact hash ignores canonicalized array input order", () => {
  const artifact = availableFeasibilityArtifact();
  const reordered = {
    ...artifact,
    roles: [...artifact.roles].reverse(),
    assignments: [...artifact.assignments]
      .reverse()
      .map((entry) => ({
        ...entry,
        availableTargetRegimes: [...entry.availableTargetRegimes].reverse(),
        candidates: [...entry.candidates].reverse(),
        warnings: [...entry.warnings].reverse()
      })),
    warnings: [...artifact.warnings].reverse()
  };

  assert.equal(
    createValidationRoleRegimeFeasibilityArtifactHash(reordered),
    createValidationRoleRegimeFeasibilityArtifactHash(artifact)
  );
  assert.notEqual(
    createValidationRoleRegimeFeasibilityArtifactHash({
      ...artifact,
      generatedAt: "2026-07-22T00:00:00.000Z"
    }),
    createValidationRoleRegimeFeasibilityArtifactHash(artifact)
  );
});

test("plan hash excludes plan generation time but binds semantic content", () => {
  const first = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact: availableFeasibilityArtifact(),
    validationAssignments: assignments(),
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });
  const second = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact: availableFeasibilityArtifact(),
    validationAssignments: assignments(),
    generatedAt: "2026-07-22T01:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });

  assert.equal(second.planHash, first.planHash);
  assert.notEqual(second.generatedAt, first.generatedAt);
  assert.notEqual(
    createValidationRoleRegimeReplayPlanHash({
      ...first,
      summary: { ...first.summary, nonTargetCandidateCount: 2 }
    }),
    first.planHash
  );
});

test("plan builder rejects unsupported calendar evidence classification", () => {
  assert.throws(
    () =>
      buildValidationRoleRegimeReplayPlan({
        feasibilityArtifact: availableFeasibilityArtifact(),
        validationAssignments: assignments(),
        generatedAt: "2026-07-22T00:00:00.000Z",
        calendarEvidenceClass: "full_exchange_calendar" as never
      }),
    /calendar evidence class must be observed_session_only/
  );
});

test("strict plan parser rejects hash and derived contract tampering", () => {
  const plan = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact: availableFeasibilityArtifact(),
    validationAssignments: assignments(),
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });
  assert.throws(
    () => parseValidationRoleRegimeReplayPlan({ ...plan, planHash: HASH_A }),
    /plan hash mismatch/
  );

  const summaryTampered = {
    ...plan,
    summary: { ...plan.summary, plannedRunCount: plan.runs.length + 1 }
  };
  assert.throws(
    () =>
      parseValidationRoleRegimeReplayPlan({
        ...summaryTampered,
        planHash: createValidationRoleRegimeReplayPlanHash(summaryTampered)
      }),
    /plan summary does not match replay runs/
  );

  const runs = plan.runs.map((run) =>
    run.candidateHash === HASH_C
      ? { ...run, sharedRoles: [run.splitRole] }
      : run
  );
  const sharingTampered = { ...plan, runs };
  assert.throws(
    () =>
      parseValidationRoleRegimeReplayPlan({
        ...sharingTampered,
        planHash: createValidationRoleRegimeReplayPlanHash(sharingTampered)
      }),
    /sharedRoles mismatch/
  );
});

test("strict plan parser rejects unconfigured and missing role-regime cells", () => {
  const plan = readyPlan();
  const unconfiguredRuns = plan.runs.map((run) =>
    run.splitRole === "test" && run.targetRegime === "bear"
      ? {
          ...run,
          targetRegime: "sideways" as const,
          runKey: `test_sideways_${run.candidateHash.replace(/^sha256:/, "")}`
        }
      : run
  );
  const unconfigured = { ...plan, runs: unconfiguredRuns };
  assert.throws(
    () =>
      parseValidationRoleRegimeReplayPlan({
        ...unconfigured,
        planHash: createValidationRoleRegimeReplayPlanHash(unconfigured)
      }),
    /run targetRegime is not configured: test\/sideways/
  );

  const missing = {
    ...plan,
    runs: plan.runs.filter(
      (run) => !(run.splitRole === "test" && run.targetRegime === "bear")
    )
  };
  assert.throws(
    () =>
      parseValidationRoleRegimeReplayPlan({
        ...missing,
        planHash: createValidationRoleRegimeReplayPlanHash(missing)
      }),
    /required plan role-regime run missing: test\/bear/
  );
});

test("strict plan parser rejects run windows outside source assignments", () => {
  const plan = readyPlan();
  const runs = plan.runs.map((run, index) =>
    index === 0 ? { ...run, startAt: "2024-12-31T00:00:00.000Z" } : run
  );
  const tampered = { ...plan, runs };

  assert.throws(
    () =>
      parseValidationRoleRegimeReplayPlan({
        ...tampered,
        planHash: createValidationRoleRegimeReplayPlanHash(tampered)
      }),
    /run window exceeds source assignment/
  );
});

function emptyPlan() {
  const value = hash("0");
  return {
    schemaVersion: "validation_role_regime_replay_plan.v1",
    mode: "paper_only",
    purpose: "role_local_regime_diagnostic",
    status: "insufficient",
    generatedAt: "2026-07-21T00:00:00.000Z",
    source: {
      feasibilitySchemaVersion: "validation_split_regime_feasibility.v1",
      feasibilityArtifactHash: value,
      feasibilityStatus: "insufficient",
      dataSnapshotHash: value,
      universeHash: value,
      coverageHash: value,
      validationSplitHash: value,
      calendarHash: value,
      marketRegimeClassifierHash: value
    },
    config: {
      selectionPolicyVersion: "exhaustive_role_regime_candidates.v1",
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull", "bear"],
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    summary: {
      requiredRoleRegimeCellCount: 6,
      coveredRoleRegimeCellCount: 0,
      plannedRunCount: 0,
      globalUniqueEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 0,
      nonTargetCandidateCount: 0,
      roleRunCounts: { train: 0, validation: 0, test: 0 },
      roleRegimeRunCounts: {}
    },
    runs: [],
    warnings: [],
    planHash: value
  };
}

function readyPlan() {
  return buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact: availableFeasibilityArtifact(),
    validationAssignments: assignments(),
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });
}

function selectionRow() {
  const assignment = assignments()[0]!;
  return {
    planIndex: 0,
    runKey: `train_bull_${"a".repeat(64)}`,
    splitRole: "train",
    targetRegime: "bull",
    candidateOrdinalWithinRoleRegime: 0,
    candidateHash: HASH_A,
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    sourceAssignments: [assignment],
    executionAssignment: assignment
  };
}

function availableFeasibilityArtifact(): ValidationSplitRegimeFeasibilityArtifact {
  const sourceAssignments = assignments();
  const artifactAssignments = [
    feasibilityAssignment(sourceAssignments[0]!, [
      candidate(HASH_A, "bull", "2025-01-01", true),
      candidate(HASH_B, "bear", "2025-02-01", true),
      candidate(HASH_X, "insufficient_data", "2025-03-01", true),
      candidate(HASH_UNAVAILABLE, "bull", "2025-03-15", false),
      candidate(HASH_G, "bull", "2025-03-20", true)
    ]),
    feasibilityAssignment(sourceAssignments[1]!, [
      candidate(HASH_A, "bull", "2025-01-01", true),
      candidate(HASH_C, "bull", "2025-04-01", true)
    ]),
    feasibilityAssignment(sourceAssignments[2]!, [
      candidate(HASH_C, "bull", "2025-04-01", true),
      candidate(HASH_D, "bear", "2025-04-15", true)
    ]),
    feasibilityAssignment(sourceAssignments[3]!, [
      candidate(HASH_E, "bull", "2025-05-01", true),
      candidate(HASH_F, "bear", "2025-05-15", true)
    ])
  ];
  const value = hash("9");

  return {
    schemaVersion: "validation_split_regime_feasibility.v1",
    mode: "paper_only",
    status: "available",
    generatedAt: "2026-07-21T00:00:00.000Z",
    config: {
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      targetRegimes: ["bull", "bear"],
      candidateStrategyBucket: "short_term",
      minimumCandidatesPerRoleRegime: 1,
      calendarValidation: {
        rules: [{ market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }]
      },
      marketRegimeClassifier: {
        version: "market_regime_classifier.v1",
        minSymbols: 1,
        minSnapshotsPerSymbol: 2,
        bullReturnThreshold: 0.03,
        bearReturnThreshold: -0.03,
        sidewaysAbsReturnThreshold: 0.01,
        breadthThreshold: 0.6
      }
    },
    provenance: {
      dataSnapshotHash: value,
      universeHash: value,
      coverageHash: value,
      validationSplitHash: value,
      calendarHash: value,
      marketRegimeClassifierHash: value
    },
    summary: {
      assignmentCount: 4,
      roleCounts: { train: 2, validation: 1, test: 1 },
      candidateCount: 11,
      uniqueCandidateCount: 8,
      roleCapacityCounts: { train: 6, validation: 2, test: 2 },
      boundaryViolationCount: 0,
      embargoViolationCount: 0,
      unavailableRoleRegimeCount: 0
    },
    roles: [
      feasibilityRole("train", 2, 6, 5, {
        bull: 3,
        bear: 1,
        sideways: 0,
        mixed: 0,
        insufficient_data: 1
      }),
      feasibilityRole("validation", 1, 2, 2, {
        bull: 1,
        bear: 1,
        sideways: 0,
        mixed: 0,
        insufficient_data: 0
      }),
      feasibilityRole("test", 1, 2, 2, {
        bull: 1,
        bear: 1,
        sideways: 0,
        mixed: 0,
        insufficient_data: 0
      })
    ],
    assignments: artifactAssignments,
    warnings: []
  };
}

function assignments(): ValidationSplitAssignment[] {
  return [
    assignment("split-0", 0, "train"),
    assignment("split-1", 1, "train"),
    assignment("split-0", 0, "validation"),
    assignment("split-0", 0, "test")
  ];
}

function assignment(
  splitId: string,
  splitIndex: number,
  splitRole: ValidationSplitAssignment["splitRole"]
): ValidationSplitAssignment {
  if (splitId === "split-1") {
    return {
      validationProtocol: "walk_forward",
      splitId,
      splitIndex,
      splitRole,
      trainStart: "2025-01-01T00:00:00.000Z",
      trainEnd: "2025-04-30T23:59:59.999Z",
      validationStart: "2025-05-01T00:00:00.000Z",
      validationEnd: "2025-05-31T23:59:59.999Z",
      testStart: "2025-06-01T00:00:00.000Z",
      testEnd: "2025-06-30T23:59:59.999Z",
      purgeDurationDays: 0,
      embargoDurationDays: 0
    };
  }
  return {
    validationProtocol: "walk_forward",
    splitId,
    splitIndex,
    splitRole,
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-03-31T23:59:59.999Z",
    validationStart: "2025-04-01T00:00:00.000Z",
    validationEnd: "2025-04-30T23:59:59.999Z",
    testStart: "2025-05-01T00:00:00.000Z",
    testEnd: "2025-05-31T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function feasibilityAssignment(
  source: ValidationSplitAssignment,
  candidates: ReturnType<typeof candidate>[]
) {
  const scoped = candidates.filter((entry) => entry.scopeAvailable);
  const regimeCounts = {
    bull: scoped.filter((entry) => entry.regime === "bull").length,
    bear: scoped.filter((entry) => entry.regime === "bear").length,
    sideways: scoped.filter((entry) => entry.regime === "sideways").length,
    mixed: scoped.filter((entry) => entry.regime === "mixed").length,
    insufficient_data: scoped.filter(
      (entry) => entry.regime === "insufficient_data"
    ).length
  };
  const roleStart =
    source.splitRole === "train"
      ? source.trainStart
      : source.splitRole === "validation"
        ? source.validationStart
        : source.testStart!;
  const roleEnd =
    source.splitRole === "train"
      ? source.trainEnd
      : source.splitRole === "validation"
        ? source.validationEnd
        : source.testEnd!;

  return {
    splitId: source.splitId,
    splitIndex: source.splitIndex,
    splitRole: source.splitRole,
    roleStart,
    roleEnd,
    effectiveRoleEnd: source.splitRole === "train" ? roleEnd : null,
    structuralCapacityCount: candidates.length,
    candidateCount: candidates.length,
    regimeCounts,
    availableTargetRegimes: (["bull", "bear"] as const).filter(
      (regime) => regimeCounts[regime] > 0
    ),
    unavailableTargetRegimes: (["bull", "bear"] as const).filter(
      (regime) => regimeCounts[regime] === 0
    ),
    candidates,
    maximumPairwiseOverlapRatio: 0,
    calendarRejectedCandidateCount: 0,
    scopeUnavailableCandidateCount: candidates.filter(
      (entry) => !entry.scopeAvailable
    ).length,
    warnings: []
  };
}

function feasibilityRole(
  splitRole: "train" | "validation" | "test",
  assignmentCount: number,
  structuralCapacityCount: number,
  uniqueCandidateCount: number,
  regimeCounts: {
    bull: number;
    bear: number;
    sideways: number;
    mixed: number;
    insufficient_data: number;
  }
) {
  return {
    splitRole,
    assignmentCount,
    structuralCapacityCount,
    uniqueCandidateCount,
    regimeCounts,
    availableTargetRegimes: ["bull", "bear"] as Array<
      "bull" | "bear" | "sideways" | "mixed"
    >,
    unavailableTargetRegimes: [],
    minimumCandidatesPerRoleRegime: 1,
    capacityStatus: "sufficient" as const,
    maximumPairwiseOverlapRatio: 0,
    warnings: []
  };
}

function candidate(
  candidateHash: string,
  regime: "bull" | "bear" | "sideways" | "mixed" | "insufficient_data",
  date: string,
  scopeAvailable: boolean
) {
  return {
    startAt: `${date}T00:00:00.000Z`,
    endAt: `${date}T23:59:59.999Z`,
    regime,
    scopeAvailable,
    candidateHash
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
