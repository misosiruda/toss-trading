import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG } from "../analytics/marketRegimeClassifier.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";
import {
  defaultMarketRegimeClassifierConfig,
  enumerateValidationRoleCandidates,
  validationSplitRegimeFeasibilityArtifactSchema
} from "./validationSplitRegimeFeasibility.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

test("feasibility artifact schema accepts the paper-only v1 contract", () => {
  const parsed = validationSplitRegimeFeasibilityArtifactSchema.parse(
    artifact()
  );

  assert.equal(parsed.schemaVersion, "validation_split_regime_feasibility.v1");
  assert.equal(parsed.mode, "paper_only");
  assert.deepEqual(parsed.config.marketRegimeClassifier, {
    version: "market_regime_classifier.v1",
    minSymbols: 1,
    minSnapshotsPerSymbol: 2,
    bullReturnThreshold: 0.03,
    bearReturnThreshold: -0.03,
    sidewaysAbsReturnThreshold: 0.01,
    breadthThreshold: 0.6
  });
});

test("feasibility artifact schema rejects unsafe mode and invalid provenance", () => {
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...artifact(),
      mode: "live"
    }).success,
    false
  );
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...artifact(),
      provenance: {
        ...artifact().provenance,
        marketRegimeClassifierHash: "not-a-hash"
      }
    }).success,
    false
  );
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...artifact(),
      status: "available"
    }).success,
    false
  );
});

test("feasibility artifact schema rejects duplicate calendar markets", () => {
  const base = artifact();
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...base,
      config: {
        ...base.config,
        calendarValidation: {
          rules: [
            { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" },
            { market: "KR", exchange: "KOSDAQ", timezone: "Asia/Seoul" }
          ]
        }
      }
    }).success,
    false
  );
});

test("feasibility artifact schema requires canonical calendar rule order", () => {
  const base = artifact();
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...base,
      config: {
        ...base.config,
        calendarValidation: {
          rules: [...base.config.calendarValidation.rules].reverse()
        }
      }
    }).success,
    false
  );
});

test("available artifact requires derived role-level coverage", () => {
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse(
      incompleteAvailableArtifact()
    ).success,
    false
  );
});

test("available artifact requires sufficient structural capacity per role", () => {
  const available = completeAvailableArtifact();
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse(available).success,
    true
  );
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      summary: {
        ...available.summary,
        roleCapacityCounts: { train: 0, validation: 0, test: 0 }
      },
      roles: available.roles.map((role) => ({
        ...role,
        structuralCapacityCount: 0,
        capacityStatus: "insufficient"
      }))
    }).success,
    false
  );
});

test("assignment diagnostics must match scoped candidate regimes", () => {
  const available = completeAvailableArtifact();
  const firstAssignment = available.assignments[0];

  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      assignments: [
        {
          ...firstAssignment,
          regimeCounts: {
            bull: 0,
            bear: 1,
            sideways: 0,
            mixed: 0,
            insufficient_data: 0
          }
        },
        ...available.assignments.slice(1)
      ]
    }).success,
    false
  );
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      assignments: [
        {
          ...firstAssignment,
          availableTargetRegimes: [],
          unavailableTargetRegimes: ["bull"]
        },
        ...available.assignments.slice(1)
      ]
    }).success,
    false
  );
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      assignments: [
        {
          ...firstAssignment,
          availableTargetRegimes: ["bull", "bull"]
        },
        ...available.assignments.slice(1)
      ]
    }).success,
    false
  );
});

test("summary candidate totals must match assignment candidates", () => {
  const available = completeAvailableArtifact();

  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      summary: {
        ...available.summary,
        candidateCount: 4
      }
    }).success,
    false
  );
  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      summary: {
        ...available.summary,
        uniqueCandidateCount: 2
      }
    }).success,
    false
  );
});

test("scoped candidate payload cannot use multiple hashes", () => {
  const available = completeAvailableArtifact();
  const firstAssignment = available.assignments[0]!;
  const duplicateCandidate = {
    ...firstAssignment.candidates[0]!,
    candidateHash: `sha256:${"4".repeat(64)}`
  };

  assert.equal(
    validationSplitRegimeFeasibilityArtifactSchema.safeParse({
      ...available,
      summary: {
        ...available.summary,
        candidateCount: 4,
        uniqueCandidateCount: 4,
        roleCapacityCounts: { train: 2, validation: 1, test: 1 }
      },
      assignments: [
        {
          ...firstAssignment,
          structuralCapacityCount: 2,
          candidateCount: 2,
          regimeCounts: { ...firstAssignment.regimeCounts, bull: 2 },
          candidates: [...firstAssignment.candidates, duplicateCandidate]
        },
        ...available.assignments.slice(1)
      ],
      roles: available.roles.map((role) =>
        role.splitRole === "train"
          ? {
              ...role,
              structuralCapacityCount: 2,
              uniqueCandidateCount: 2,
              regimeCounts: { ...role.regimeCounts, bull: 2 }
            }
          : role
      )
    }).success,
    false
  );
});

test("default classifier config exposes the precommitted effective values", () => {
  assert.equal(Object.isFrozen(DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG), true);
  assert.deepEqual(defaultMarketRegimeClassifierConfig(), {
    version: "market_regime_classifier.v1",
    minSymbols: 1,
    minSnapshotsPerSymbol: 2,
    bullReturnThreshold: 0.03,
    bearReturnThreshold: -0.03,
    sidewaysAbsReturnThreshold: 0.01,
    breadthThreshold: 0.6
  });
});

test("train enumeration applies embargo before listing full windows", () => {
  const result = enumerateValidationRoleCandidates({
    assignment: assignment("train", { embargoDurationDays: 5 }),
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });

  assert.equal(result.roleWindow.roleStart, "2023-01-01T00:00:00+09:00");
  assert.equal(result.roleWindow.roleEnd, "2023-04-30T23:59:59.999+09:00");
  assert.equal(
    result.roleWindow.effectiveRoleEnd,
    "2023-04-25T14:59:59.999Z"
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.selectedMonth),
    ["2023-01", "2023-02", "2023-03"]
  );
  assert.equal(result.structuralCapacityCount, 3);
  assert.deepEqual(result.warnings, []);
});

test("validation and test enumeration stay inside their own role boundaries", () => {
  const validation = enumerateValidationRoleCandidates({
    assignment: assignment("validation"),
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });
  const testRole = enumerateValidationRoleCandidates({
    assignment: assignment("test"),
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(
    validation.candidates.map((candidate) => candidate.selectedMonth),
    ["2023-05", "2023-06"]
  );
  assert.equal(validation.roleWindow.effectiveRoleEnd, null);
  assert.deepEqual(
    testRole.candidates.map((candidate) => candidate.selectedMonth),
    ["2023-07", "2023-08", "2023-09"]
  );
  assert.equal(testRole.roleWindow.effectiveRoleEnd, null);
});

test("valid but too-short roles return zero capacity with a warning", () => {
  const result = enumerateValidationRoleCandidates({
    assignment: assignment("validation", {
      validationStart: "2023-05-15T00:00:00+09:00",
      validationEnd: "2023-05-20T23:59:59.999+09:00"
    }),
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });

  assert.equal(result.structuralCapacityCount, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.warnings, [
    {
      code: "ROLE_FULL_WINDOW_CAPACITY_ZERO",
      message: "validation split role contains no full replay window",
      splitId: "split-0",
      splitRole: "validation"
    }
  ]);
});

test("role window parsing fails closed for malformed test assignments", () => {
  assert.throws(
    () =>
      validationRoleWindow({
        ...assignment("test"),
        testStart: null,
        testEnd: null
      } as ValidationSplitAssignment),
    /validation split assignment failed validation/
  );
});

test("train role fails closed when embargo removes the full role range", () => {
  assert.throws(
    () =>
      enumerateValidationRoleCandidates({
        assignment: assignment("train", {
          trainStart: "2023-04-29T00:00:00+09:00",
          embargoDurationDays: 5
        }),
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /no non-embargo replay range/
  );
});

function assignment(
  splitRole: ValidationSplitAssignment["splitRole"],
  overrides: Partial<ValidationSplitAssignment> = {}
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole,
    trainStart: "2023-01-01T00:00:00+09:00",
    trainEnd: "2023-04-30T23:59:59.999+09:00",
    validationStart: "2023-05-01T00:00:00+09:00",
    validationEnd: "2023-06-30T23:59:59.999+09:00",
    testStart: "2023-07-01T00:00:00+09:00",
    testEnd: "2023-09-30T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0,
    ...overrides
  };
}

function artifact() {
  const hash = `sha256:${"a".repeat(64)}`;
  return {
    schemaVersion: "validation_split_regime_feasibility.v1",
    mode: "paper_only",
    status: "insufficient",
    generatedAt: "2026-07-20T00:00:00.000Z",
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
      marketRegimeClassifier: defaultMarketRegimeClassifierConfig()
    },
    provenance: {
      dataSnapshotHash: hash,
      universeHash: hash,
      coverageHash: hash,
      validationSplitHash: hash,
      calendarHash: hash,
      marketRegimeClassifierHash: hash
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

function incompleteAvailableArtifact() {
  const base = artifact();
  const hash = `sha256:${"b".repeat(64)}`;
  return {
    ...base,
    status: "available",
    summary: {
      ...base.summary,
      assignmentCount: 1,
      roleCounts: { train: 1, validation: 0, test: 0 },
      candidateCount: 1,
      uniqueCandidateCount: 1,
      roleCapacityCounts: { train: 4, validation: 0, test: 0 },
      unavailableRoleRegimeCount: 0
    },
    assignments: [
      {
        splitId: "split-0",
        splitIndex: 0,
        splitRole: "train",
        roleStart: "2023-01-01T00:00:00+09:00",
        roleEnd: "2023-04-30T23:59:59.999+09:00",
        effectiveRoleEnd: "2023-04-30T23:59:59.999+09:00",
        structuralCapacityCount: 4,
        candidateCount: 1,
        regimeCounts: {
          bull: 1,
          bear: 0,
          sideways: 0,
          mixed: 0,
          insufficient_data: 0
        },
        availableTargetRegimes: ["bull"],
        unavailableTargetRegimes: ["bear", "sideways", "mixed"],
        candidates: [
          {
            startAt: "2023-01-01T00:00:00+09:00",
            endAt: "2023-01-31T23:59:59.999+09:00",
            regime: "bull",
            scopeAvailable: true,
            candidateHash: hash
          }
        ],
        maximumPairwiseOverlapRatio: 0,
        calendarRejectedCandidateCount: 3,
        scopeUnavailableCandidateCount: 0,
        warnings: []
      }
    ],
    roles: []
  };
}

function completeAvailableArtifact() {
  const base = artifact();
  const roleInputs = [
    {
      splitRole: "train" as const,
      roleStart: "2023-01-01T00:00:00+09:00",
      roleEnd: "2023-04-30T23:59:59.999+09:00",
      effectiveRoleEnd: "2023-04-30T23:59:59.999+09:00",
      candidateStart: "2023-01-01T00:00:00+09:00",
      candidateEnd: "2023-01-31T23:59:59.999+09:00",
      hashDigit: "1"
    },
    {
      splitRole: "validation" as const,
      roleStart: "2023-05-01T00:00:00+09:00",
      roleEnd: "2023-06-30T23:59:59.999+09:00",
      effectiveRoleEnd: null,
      candidateStart: "2023-05-01T00:00:00+09:00",
      candidateEnd: "2023-05-31T23:59:59.999+09:00",
      hashDigit: "2"
    },
    {
      splitRole: "test" as const,
      roleStart: "2023-07-01T00:00:00+09:00",
      roleEnd: "2023-09-30T23:59:59.999+09:00",
      effectiveRoleEnd: null,
      candidateStart: "2023-07-01T00:00:00+09:00",
      candidateEnd: "2023-07-31T23:59:59.999+09:00",
      hashDigit: "3"
    }
  ];
  const assignments = roleInputs.map((input, splitIndex) => ({
    splitId: `split-${splitIndex}`,
    splitIndex,
    splitRole: input.splitRole,
    roleStart: input.roleStart,
    roleEnd: input.roleEnd,
    effectiveRoleEnd: input.effectiveRoleEnd,
    structuralCapacityCount: 1,
    candidateCount: 1,
    regimeCounts: {
      bull: 1,
      bear: 0,
      sideways: 0,
      mixed: 0,
      insufficient_data: 0
    },
    availableTargetRegimes: ["bull"],
    unavailableTargetRegimes: [],
    candidates: [
      {
        startAt: input.candidateStart,
        endAt: input.candidateEnd,
        regime: "bull",
        scopeAvailable: true,
        candidateHash: `sha256:${input.hashDigit.repeat(64)}`
      }
    ],
    maximumPairwiseOverlapRatio: 0,
    calendarRejectedCandidateCount: 0,
    scopeUnavailableCandidateCount: 0,
    warnings: []
  }));
  return {
    ...base,
    status: "available",
    config: { ...base.config, targetRegimes: ["bull"] },
    summary: {
      ...base.summary,
      assignmentCount: 3,
      roleCounts: { train: 1, validation: 1, test: 1 },
      candidateCount: 3,
      uniqueCandidateCount: 3,
      roleCapacityCounts: { train: 1, validation: 1, test: 1 },
      unavailableRoleRegimeCount: 0
    },
    assignments,
    roles: roleInputs.map((input) => ({
      splitRole: input.splitRole,
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
    }))
  };
}
