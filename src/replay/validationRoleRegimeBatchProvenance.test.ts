import assert from "node:assert/strict";
import test from "node:test";

import type { ValidationSplitAssignment } from "./validationProtocol.js";
import {
  createValidationRoleRegimeReplayPlanHash,
  type ValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import {
  buildValidationRoleRegimeBatchProvenance,
  validationRoleRegimeBatchManifestProvenanceSchema,
  validationRoleRegimeBatchRunProvenanceSchema
} from "./validationRoleRegimeBatchProvenance.js";

const SHARED_HASH = hash("a");
const TEST_HASH = hash("b");

test("batch provenance preserves manifest aggregates and exact plan run identity", () => {
  const plan = readyPlan();
  const provenance = buildValidationRoleRegimeBatchProvenance(plan);

  assert.deepEqual(provenance.manifest, {
    samplingMode: "validation_role_regime_plan",
    planHash: plan.planHash,
    plannedRunCount: 3,
    globalUniqueEvidenceGroupCount: 2,
    crossRoleSharedEvidenceGroupCount: 1,
    crossRoleSharedEvidenceWarnings: [
      {
        code: "CROSS_ROLE_EVIDENCE_SHARED",
        message: "candidate evidence is shared across validation roles",
        splitRole: null,
        targetRegime: "bull",
        candidateHash: SHARED_HASH
      }
    ]
  });
  assert.deepEqual(
    provenance.runs.map((run) => ({
      planIndex: run.planIndex,
      splitRole: run.splitRole,
      candidateHash: run.candidateHash,
      evidenceGroupHash: run.evidenceGroupHash,
      executionSplitId: run.executionAssignment.splitId,
      sourceSplitIds: run.sourceAssignments.map(
        (assignment) => assignment.splitId
      )
    })),
    [
      {
        planIndex: 0,
        splitRole: "train",
        candidateHash: SHARED_HASH,
        evidenceGroupHash: SHARED_HASH,
        executionSplitId: "train-source",
        sourceSplitIds: ["train-source"]
      },
      {
        planIndex: 1,
        splitRole: "validation",
        candidateHash: SHARED_HASH,
        evidenceGroupHash: SHARED_HASH,
        executionSplitId: "validation-source",
        sourceSplitIds: ["validation-source"]
      },
      {
        planIndex: 2,
        splitRole: "test",
        candidateHash: TEST_HASH,
        evidenceGroupHash: TEST_HASH,
        executionSplitId: "test-source",
        sourceSplitIds: ["test-source"]
      }
    ]
  );
});

test("batch provenance rejects non-ready and hash-tampered plans", () => {
  const nonReady = readyPlan();
  const nonReadyWithoutHash = {
    ...nonReady,
    status: "insufficient" as const,
    summary: {
      ...nonReady.summary,
      plannedRunCount: 0,
      globalUniqueEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 0,
      coveredRoleRegimeCellCount: 0,
      roleRunCounts: { train: 0, validation: 0, test: 0 },
      roleRegimeRunCounts: {}
    },
    runs: [],
    warnings: []
  };
  const nonReadyPlan = {
    ...nonReadyWithoutHash,
    planHash: createValidationRoleRegimeReplayPlanHash(nonReadyWithoutHash)
  };

  assert.throws(
    () => buildValidationRoleRegimeBatchProvenance(nonReadyPlan),
    /requires a ready plan/
  );
  assert.throws(
    () =>
      buildValidationRoleRegimeBatchProvenance({
        ...readyPlan(),
        planHash: hash("f")
      }),
    /plan hash mismatch/
  );
});

test("batch provenance schemas reject unsafe and inconsistent payloads", () => {
  const provenance = buildValidationRoleRegimeBatchProvenance(readyPlan());

  assert.equal(
    validationRoleRegimeBatchManifestProvenanceSchema.safeParse({
      ...provenance.manifest,
      samplingMode: "random"
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchManifestProvenanceSchema.safeParse({
      ...provenance.manifest,
      crossRoleSharedEvidenceWarnings: []
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...provenance.runs[0],
      evidenceGroupHash: TEST_HASH
    }).success,
    false
  );
});

test("run provenance schema rejects unrelated or non-canonical assignments", () => {
  const run = buildValidationRoleRegimeBatchProvenance(readyPlan()).runs[0]!;
  const laterTrainAssignment = assignment({
    splitId: "later-train-source",
    splitIndex: 3,
    splitRole: "train",
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: "2025-03-01T00:00:00.000Z",
    testEnd: "2025-03-31T23:59:59.999Z"
  });
  const orderedAssignments = [run.executionAssignment, laterTrainAssignment];

  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sourceAssignments: orderedAssignments,
      executionAssignment: laterTrainAssignment
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sourceAssignments: [...orderedAssignments].reverse()
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sourceAssignments: [readyPlan().runs[1]!.executionAssignment]
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      startAt: "2024-12-31T00:00:00.000Z"
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sourceAssignments: [run.executionAssignment, run.executionAssignment]
    }).success,
    false
  );
});

test("run provenance schema rejects inconsistent shared-role metadata", () => {
  const run = buildValidationRoleRegimeBatchProvenance(readyPlan()).runs[0]!;

  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sharedRoles: ["validation"],
      sharedAcrossRoles: false
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sharedRoles: ["train", "train"],
      sharedAcrossRoles: true
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sharedRoles: ["validation", "train"]
    }).success,
    false
  );
  assert.equal(
    validationRoleRegimeBatchRunProvenanceSchema.safeParse({
      ...run,
      sharedAcrossRoles: false
    }).success,
    false
  );
});

function readyPlan(): ValidationRoleRegimeReplayPlan {
  const trainAssignment = assignment({
    splitId: "train-source",
    splitIndex: 0,
    splitRole: "train",
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: "2025-03-01T00:00:00.000Z",
    testEnd: "2025-03-31T23:59:59.999Z"
  });
  const validationAssignment = assignment({
    splitId: "validation-source",
    splitIndex: 1,
    splitRole: "validation",
    trainStart: "2024-12-01T00:00:00.000Z",
    trainEnd: "2024-12-31T23:59:59.999Z",
    validationStart: "2025-01-01T00:00:00.000Z",
    validationEnd: "2025-01-31T23:59:59.999Z",
    testStart: "2025-02-01T00:00:00.000Z",
    testEnd: "2025-02-28T23:59:59.999Z"
  });
  const testAssignment = assignment({
    splitId: "test-source",
    splitIndex: 2,
    splitRole: "test",
    trainStart: "2025-03-01T00:00:00.000Z",
    trainEnd: "2025-03-31T23:59:59.999Z",
    validationStart: "2025-04-01T00:00:00.000Z",
    validationEnd: "2025-04-30T23:59:59.999Z",
    testStart: "2025-05-01T00:00:00.000Z",
    testEnd: "2025-05-31T23:59:59.999Z"
  });
  const runs = [
    planRun(0, "train", SHARED_HASH, trainAssignment, "2025-01-10"),
    planRun(
      1,
      "validation",
      SHARED_HASH,
      validationAssignment,
      "2025-01-10"
    ),
    planRun(2, "test", TEST_HASH, testAssignment, "2025-05-10")
  ];
  const value = hash("9");
  const withoutHash: Omit<ValidationRoleRegimeReplayPlan, "planHash"> = {
    schemaVersion: "validation_role_regime_replay_plan.v1",
    mode: "paper_only",
    purpose: "role_local_regime_diagnostic",
    status: "ready_for_paper_diagnostic",
    generatedAt: "2026-07-22T00:00:00.000Z",
    source: {
      feasibilitySchemaVersion: "validation_split_regime_feasibility.v1",
      feasibilityArtifactHash: value,
      feasibilityStatus: "available",
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
      targetRegimes: ["bull"],
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    summary: {
      requiredRoleRegimeCellCount: 3,
      coveredRoleRegimeCellCount: 3,
      plannedRunCount: 3,
      globalUniqueEvidenceGroupCount: 2,
      crossRoleSharedEvidenceGroupCount: 1,
      nonTargetCandidateCount: 0,
      roleRunCounts: { train: 1, validation: 1, test: 1 },
      roleRegimeRunCounts: {
        "train.bull": 1,
        "validation.bull": 1,
        "test.bull": 1
      }
    },
    runs,
    warnings: [
      warning("CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY", null, null, null),
      warning(
        "CROSS_ROLE_EVIDENCE_SHARED",
        null,
        "bull",
        SHARED_HASH
      ),
      warning("ROLE_REGIME_SINGLE_CANDIDATE", "train", "bull", SHARED_HASH),
      warning(
        "ROLE_REGIME_SINGLE_CANDIDATE",
        "validation",
        "bull",
        SHARED_HASH
      ),
      warning("ROLE_REGIME_SINGLE_CANDIDATE", "test", "bull", TEST_HASH),
      warning("ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM", "train", null, null),
      warning(
        "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
        "validation",
        null,
        null
      ),
      warning("ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM", "test", null, null)
    ]
  };

  return {
    ...withoutHash,
    planHash: createValidationRoleRegimeReplayPlanHash(withoutHash)
  };
}

function planRun(
  planIndex: number,
  splitRole: "train" | "validation" | "test",
  candidateHash: `sha256:${string}`,
  sourceAssignment: ValidationSplitAssignment,
  date: string
) {
  const sharedAcrossRoles = candidateHash === SHARED_HASH;
  const sharedRoles: Array<"train" | "validation" | "test"> =
    sharedAcrossRoles ? ["train", "validation"] : ["test"];
  return {
    planIndex,
    runKey: `${splitRole}_bull_${candidateHash.replace("sha256:", "")}`,
    splitRole,
    targetRegime: "bull" as const,
    candidateOrdinalWithinRoleRegime: 0,
    candidateHash,
    evidenceGroupHash: candidateHash,
    startAt: `${date}T00:00:00.000Z`,
    endAt: `${date}T23:59:59.999Z`,
    sourceAssignments: [sourceAssignment],
    executionAssignment: sourceAssignment,
    sharedAcrossRoles,
    sharedRoles
  };
}

function assignment(
  input: Pick<
    ValidationSplitAssignment,
    | "splitId"
    | "splitIndex"
    | "splitRole"
    | "trainStart"
    | "trainEnd"
    | "validationStart"
    | "validationEnd"
    | "testStart"
    | "testEnd"
  >
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    ...input,
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function warning(
  code:
    | "CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY"
    | "CROSS_ROLE_EVIDENCE_SHARED"
    | "ROLE_REGIME_SINGLE_CANDIDATE"
    | "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
  splitRole: "train" | "validation" | "test" | null,
  targetRegime: "bull" | null,
  candidateHash: `sha256:${string}` | null
) {
  const messages = {
    CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY:
      "calendar evidence is limited to observed sessions",
    CROSS_ROLE_EVIDENCE_SHARED:
      "candidate evidence is shared across validation roles",
    ROLE_REGIME_SINGLE_CANDIDATE: "role-regime cell has only one candidate",
    ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM:
      "role-local sample count is below the statistical minimum"
  } as const;
  return { code, message: messages[code], splitRole, targetRegime, candidateHash };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
