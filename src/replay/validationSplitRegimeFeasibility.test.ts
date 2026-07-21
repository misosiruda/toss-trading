import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG } from "../analytics/marketRegimeClassifier.js";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  assessHistoricalUniverseCoverage,
  historicalUniverseManifestSchema,
  type HistoricalUniverseCoverageReport
} from "./historicalUniverseCoverage.js";
import { parseMarketCalendarFixture } from "./marketCalendar.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";
import {
  assessValidationRoleCandidateAvailability,
  buildValidationSplitRegimeFeasibilityArtifact,
  createValidationFeasibilityCalendarHash,
  createValidationFeasibilityCandidateHash,
  createValidationFeasibilityClassifierHash,
  createValidationSplitRegimeFeasibilityProvenance,
  defaultMarketRegimeClassifierConfig,
  enumerateValidationRoleCandidates,
  maximumPairwiseTradingDateOverlapRatio,
  type BuildValidationSplitRegimeFeasibilityArtifactOptions,
  type ValidationRoleCandidateEnumeration,
  validationSplitRegimeFeasibilityArtifactSchema
} from "./validationSplitRegimeFeasibility.js";
import {
  writeValidationSplitRegimeFeasibilityArtifact
} from "./validationSplitRegimeFeasibilityArtifactWriter.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

test("feasibility artifact writer creates a schema-valid JSON artifact", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "validation-feasibility-"));
  const outputPath = join(directory, "nested", "artifact.json");
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeValidationSplitRegimeFeasibilityArtifact({
    outputPath,
    artifact: artifact()
  });

  const written = await readFile(outputPath, "utf8");
  assert.equal(written.endsWith("\n"), true);
  assert.deepEqual(
    validationSplitRegimeFeasibilityArtifactSchema.parse(JSON.parse(written)),
    validationSplitRegimeFeasibilityArtifactSchema.parse(artifact())
  );
  assert.deepEqual(await readdir(join(directory, "nested")), ["artifact.json"]);
});

test("feasibility artifact writer preserves an existing output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "validation-feasibility-"));
  const outputPath = join(directory, "artifact.json");
  const existing = "existing artifact must remain unchanged\n";
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(outputPath, existing, "utf8");

  await assert.rejects(
    writeValidationSplitRegimeFeasibilityArtifact({
      outputPath,
      artifact: artifact()
    }),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST"
  );
  assert.equal(await readFile(outputPath, "utf8"), existing);
  assert.deepEqual(await readdir(directory), ["artifact.json"]);
});

test(
  "feasibility artifact writer rejects invalid input before filesystem write",
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "validation-feasibility-"));
    const outputPath = join(directory, "nested", "artifact.json");
    t.after(() => rm(directory, { recursive: true, force: true }));

    await assert.rejects(
      writeValidationSplitRegimeFeasibilityArtifact({
        outputPath,
        artifact: { ...artifact(), mode: "live" }
      })
    );
    await assert.rejects(access(outputPath));
  }
);

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

test("calendar provenance hash normalizes rule fixture and source-ref order", () => {
  const kr = openCalendarValidation();
  const usFixture = usCalendarFixture();
  const usRule = {
    market: "US" as const,
    exchange: "NYSE",
    timezone: "America/New_York" as const
  };
  const first = createValidationFeasibilityCalendarHash({
    rules: [...kr.rules, usRule],
    fixtures: [
      { ...kr.fixtures[0]!, sourceRefs: ["fixture:b", "fixture:a"] },
      usFixture
    ]
  });
  const reordered = createValidationFeasibilityCalendarHash({
    rules: [usRule, ...kr.rules],
    fixtures: [
      usFixture,
      { ...kr.fixtures[0]!, sourceRefs: ["fixture:a", "fixture:b"] }
    ]
  });
  const changed = createValidationFeasibilityCalendarHash({
    rules: [...kr.rules, usRule],
    fixtures: [
      { ...kr.fixtures[0]!, createdAt: "2026-07-21T00:00:00.000Z" },
      usFixture
    ]
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("classifier provenance hash covers effective config", () => {
  const config = defaultMarketRegimeClassifierConfig();
  const first = createValidationFeasibilityClassifierHash(config);

  assert.equal(createValidationFeasibilityClassifierHash(config), first);
  assert.notEqual(
    createValidationFeasibilityClassifierHash({
      ...config,
      bullReturnThreshold: config.bullReturnThreshold + 0.01
    }),
    first
  );
});

test("feasibility provenance hashes source contracts independently", () => {
  const calendarValidation = openCalendarValidation();
  const input = {
    dataSnapshot: { rows: [1, 2] },
    universe: { symbols: ["TEST"] },
    coverage: { status: "available" },
    validationSplit: { assignmentCount: 3 },
    calendarValidation,
    marketRegimeClassifier: defaultMarketRegimeClassifierConfig()
  };
  const first = createValidationSplitRegimeFeasibilityProvenance(input);
  const changed = createValidationSplitRegimeFeasibilityProvenance({
    ...input,
    coverage: { status: "insufficient" }
  });

  assert.match(first.dataSnapshotHash, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(first.coverageHash, changed.coverageHash);
  assert.equal(first.dataSnapshotHash, changed.dataSnapshotHash);
  assert.equal(first.calendarHash, changed.calendarHash);
});

test("candidate hash covers window scope and source provenance", () => {
  const provenance = createValidationSplitRegimeFeasibilityProvenance({
    dataSnapshot: { rows: [1, 2] },
    universe: { symbols: ["TEST"] },
    coverage: { status: "available" },
    validationSplit: { assignmentCount: 3 },
    calendarValidation: openCalendarValidation(),
    marketRegimeClassifier: defaultMarketRegimeClassifierConfig()
  });
  const input = {
    startAt: "2025-02-03T00:00:00.000Z",
    endAt: "2025-02-03T23:59:59.999Z",
    timezoneOffsetMinutes: 540,
    windowMonths: 1,
    calendarHash: provenance.calendarHash,
    marketRegimeClassifierHash: provenance.marketRegimeClassifierHash,
    candidateStrategyBucket: "short_term" as const,
    scopeAvailable: true,
    dataSnapshotHash: provenance.dataSnapshotHash,
    universeHash: provenance.universeHash,
    coverageHash: provenance.coverageHash
  };
  const first = createValidationFeasibilityCandidateHash(input);

  assert.equal(createValidationFeasibilityCandidateHash(input), first);
  assert.notEqual(
    createValidationFeasibilityCandidateHash({
      ...input,
      scopeAvailable: false
    }),
    first
  );
  assert.throws(
    () =>
      createValidationFeasibilityCandidateHash({
        ...input,
        startAt: input.endAt,
        endAt: input.startAt
      }),
    /candidate hash startAt/
  );
});

test("feasibility builder creates deterministic available role aggregates", () => {
  const options = feasibilityBuilderOptions();
  const first = buildValidationSplitRegimeFeasibilityArtifact(options);
  const reordered = buildValidationSplitRegimeFeasibilityArtifact({
    ...options,
    assignments: [...options.assignments].reverse(),
    snapshots: [...options.snapshots].reverse(),
    validationSplit: {
      assignments: [...options.assignments].reverse()
    },
    calendarValidation: {
      ...options.calendarValidation,
      fixtures: [...options.calendarValidation.fixtures].reverse()
    }
  });

  assert.deepEqual(first, reordered);
  assert.equal(first.status, "available");
  assert.deepEqual(first.summary.roleCounts, {
    train: 1,
    validation: 1,
    test: 1
  });
  assert.deepEqual(first.summary.roleCapacityCounts, {
    train: 1,
    validation: 1,
    test: 1
  });
  assert.equal(first.summary.candidateCount, 3);
  assert.equal(first.summary.uniqueCandidateCount, 3);
  assert.equal(first.summary.unavailableRoleRegimeCount, 0);
  assert.deepEqual(
    first.roles.map((role) => ({
      splitRole: role.splitRole,
      regimeCounts: role.regimeCounts,
      capacityStatus: role.capacityStatus
    })),
    ["train", "validation", "test"].map((splitRole) => ({
      splitRole,
      regimeCounts: {
        bull: 1,
        bear: 0,
        sideways: 0,
        mixed: 0,
        insufficient_data: 0
      },
      capacityStatus: "sufficient"
    }))
  );
  assert.equal(
    first.assignments.every(
      (item) => item.candidates[0]?.scopeAvailable === true
    ),
    true
  );
});

test("feasibility builder rejects stale coverage before bucket fallback", () => {
  const options = feasibilityBuilderOptions();
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        snapshots: options.snapshots.map((snapshot) => ({
          ...snapshot,
          strategyBucket: "long_term"
        }))
      }),
    /coverage report does not match assessed snapshots and universe/
  );
});

test("feasibility builder hashes the snapshots actually assessed", () => {
  const options = feasibilityBuilderOptions();
  const first = buildValidationSplitRegimeFeasibilityArtifact(options);
  const changed = buildValidationSplitRegimeFeasibilityArtifact({
    ...options,
    snapshots: options.snapshots.map((snapshot, index) =>
      index === 1
        ? { ...snapshot, lastPriceKrw: snapshot.lastPriceKrw + 1 }
        : snapshot
    )
  });

  assert.notEqual(
    first.provenance.dataSnapshotHash,
    changed.provenance.dataSnapshotHash
  );
  assert.notEqual(
    first.assignments[0]?.candidates[0]?.candidateHash,
    changed.assignments[0]?.candidates[0]?.candidateHash
  );
});

test("feasibility builder deduplicates overlapping role capacity", () => {
  const options = feasibilityBuilderOptions();
  const assignments = [
    ...options.assignments,
    ...options.assignments.map((assignment) => ({
      ...assignment,
      splitId: "split-1",
      splitIndex: 1
    }))
  ];
  const artifact = buildValidationSplitRegimeFeasibilityArtifact({
    ...options,
    assignments,
    validationSplit: { assignments }
  });
  const train = artifact.roles.find((role) => role.splitRole === "train");

  assert.equal(artifact.status, "available");
  assert.equal(train?.assignmentCount, 2);
  assert.equal(train?.structuralCapacityCount, 1);
  assert.equal(train?.uniqueCandidateCount, 1);
  assert.equal(artifact.summary.candidateCount, 6);
  assert.equal(artifact.summary.uniqueCandidateCount, 3);
});

test("feasibility builder rejects malformed contracts", () => {
  const options = feasibilityBuilderOptions();
  const coverage = options.coverage as HistoricalUniverseCoverageReport;
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        targetRegimes: ["bull", "bull"]
      }),
    /targetRegimes must not contain duplicates/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        assignments: [
          {
            ...options.assignments[0]!,
            testStart: null,
            testEnd: null,
            splitRole: "test"
          }
        ]
      }),
    /test splitRole requires testStart and testEnd/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        coverage: {
          status: "insufficient",
          corruptLineCount: 0,
          availableStrategyBuckets: ["short_term"]
        }
      }),
    /validation feasibility coverage gate/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        coverage: {
          status: "available",
          corruptLineCount: 1,
          availableStrategyBuckets: ["short_term"]
        }
      }),
    /validation feasibility coverage gate/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        assignments: [
          ...options.assignments,
          { ...options.assignments[0]! }
        ]
      }),
    /duplicate validation assignment/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        assignments: options.assignments.map((assignment) =>
          assignment.splitRole === "validation"
            ? { ...assignment, purgeDurationDays: 1 }
            : assignment
        )
      }),
    /inconsistent split definition/
  );
  const incompleteSplitAssignments = options.assignments.map(
    (assignment, splitIndex) => ({
      ...assignment,
      splitId: `split-${splitIndex}`,
      splitIndex
    })
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        assignments: incompleteSplitAssignments,
        validationSplit: { assignments: incompleteSplitAssignments }
      }),
    /validation split is missing required roles: 0:split-0 \(validation,test\)/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        validationSplit: {
          assignments: options.assignments.map((assignment) =>
            assignment.splitRole === "test"
              ? { ...assignment, testEnd: "2025-04-30T23:59:59.999+09:00" }
              : assignment
          )
        }
      }),
    /validation split source assignments must match assessed assignments/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        snapshots: [...options.snapshots, { ...options.snapshots[0]! }]
      }),
    /duplicate historical snapshotId/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        snapshots: options.snapshots.map((snapshot, index) =>
          index === 0 ? { ...snapshot, symbol: "OUTSIDE" } : snapshot
        )
      }),
    /historical snapshot is outside declared universe: KR:OUTSIDE/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        coverage: { ...coverage, universeId: "stale-universe" }
      }),
    /coverage universeId does not match assessed universe/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        coverage: {
          ...coverage,
          rangeEnd: "2025-02-28T14:59:59.999Z"
        }
      }),
    /historical snapshot is outside coverage range/
  );
  assert.throws(
    () =>
      buildValidationSplitRegimeFeasibilityArtifact({
        ...options,
        snapshots: options.snapshots.slice(0, -1)
      }),
    /coverage report does not match assessed snapshots and universe/
  );
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

test("candidate availability keeps calendar-valid short-term scope", () => {
  const result = assessValidationRoleCandidateAvailability({
    enumeration: candidateEnumeration(),
    snapshots: candidateSnapshots("short_term"),
    calendarValidation: openCalendarValidation(),
    candidateStrategyBucket: "short_term",
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(result.candidates, [
    {
      startAt: "2025-02-03T00:00:00.000Z",
      endAt: "2025-02-03T23:59:59.999Z",
      regime: "bull",
      scopeAvailable: true
    }
  ]);
  assert.equal(result.calendarRejectedCandidateCount, 0);
  assert.equal(result.scopeUnavailableCandidateCount, 0);
  assert.equal(result.maximumPairwiseOverlapRatio, 0);
  assert.deepEqual(result.warnings, []);
});

test("candidate availability does not fallback across strategy buckets", () => {
  const result = assessValidationRoleCandidateAvailability({
    enumeration: candidateEnumeration(),
    snapshots: candidateSnapshots("long_term"),
    calendarValidation: openCalendarValidation(),
    candidateStrategyBucket: "short_term",
    timezoneOffsetMinutes: 540
  });

  assert.equal(result.candidates[0]?.scopeAvailable, false);
  assert.equal(result.scopeUnavailableCandidateCount, 1);
  assert.deepEqual(result.warnings, [
    {
      code: "ROLE_CANDIDATE_SCOPE_UNAVAILABLE",
      message: "validation role candidate has no scoped new-buy snapshot",
      splitId: "split-0",
      splitRole: "test"
    }
  ]);
});

test("candidate availability excludes calendar-invalid windows", () => {
  const calendarValidation = openCalendarValidation();
  calendarValidation.fixtures = [
    parseMarketCalendarFixture({
      ...calendarValidation.fixtures[0],
      marketOpen: null,
      marketClose: null,
      isHoliday: true,
      holidayName: "fixture holiday"
    })
  ];
  const result = assessValidationRoleCandidateAvailability({
    enumeration: candidateEnumeration(),
    snapshots: candidateSnapshots("short_term"),
    calendarValidation,
    candidateStrategyBucket: "short_term",
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(result.candidates, []);
  assert.equal(result.calendarRejectedCandidateCount, 1);
  assert.equal(result.scopeUnavailableCandidateCount, 0);
  assert.deepEqual(result.warnings, [
    {
      code: "ROLE_CANDIDATE_CALENDAR_REJECTED",
      message: "validation role candidate failed calendar validation",
      splitId: "split-0",
      splitRole: "test"
    }
  ]);
});

test("candidate availability rejects non-short-term runtime input", () => {
  assert.throws(
    () =>
      assessValidationRoleCandidateAvailability({
        enumeration: candidateEnumeration(),
        snapshots: candidateSnapshots("short_term"),
        calendarValidation: openCalendarValidation(),
        candidateStrategyBucket: "long_term" as "short_term",
        timezoneOffsetMinutes: 540
      }),
    /candidateStrategyBucket must be short_term/
  );
});

test("candidate overlap uses local trading-date intersection over union", () => {
  const candidates = [
    replayCandidate("2025-02-02T00:00:00.000Z", "2025-02-03T23:59:59.999Z"),
    replayCandidate("2025-02-03T00:00:00.000Z", "2025-02-04T23:59:59.999Z")
  ];
  const snapshots = [
    candidateSnapshot("snapshot-overlap-1", "2025-02-02T01:00:00.000Z", 100),
    candidateSnapshot("snapshot-overlap-2", "2025-02-03T01:00:00.000Z", 101),
    candidateSnapshot("snapshot-overlap-3", "2025-02-04T01:00:00.000Z", 102)
  ];

  assert.equal(
    maximumPairwiseTradingDateOverlapRatio({
      candidates,
      snapshots,
      timezoneOffsetMinutes: 540
    }),
    0.333333
  );
  assert.equal(
    maximumPairwiseTradingDateOverlapRatio({
      candidates: [candidates[0]!],
      snapshots,
      timezoneOffsetMinutes: 540
    }),
    0
  );
});

test("candidate overlap validates timezone offset at runtime", () => {
  assert.throws(
    () =>
      maximumPairwiseTradingDateOverlapRatio({
        candidates: [],
        snapshots: [],
        timezoneOffsetMinutes: 0.5
      }),
    /timezoneOffsetMinutes must be an integer/
  );
});

function replayCandidate(
  startAt: string,
  endAt: string
): ValidationRoleCandidateEnumeration["candidates"][number] {
  return {
    selectedMonth: startAt.slice(0, 7),
    localStartDate: startAt.slice(0, 10),
    localEndDate: endAt.slice(0, 10),
    startMs: Date.parse(startAt),
    endMs: Date.parse(endAt)
  };
}

function candidateEnumeration(): ValidationRoleCandidateEnumeration {
  return {
    roleWindow: {
      splitId: "split-0",
      splitIndex: 0,
      splitRole: "test",
      roleStart: "2025-02-03T00:00:00.000Z",
      roleEnd: "2025-02-03T23:59:59.999Z",
      effectiveRoleEnd: null
    },
    structuralCapacityCount: 1,
    candidates: [
      {
        selectedMonth: "2025-02",
        localStartDate: "2025-02-03",
        localEndDate: "2025-02-03",
        startMs: Date.parse("2025-02-03T00:00:00.000Z"),
        endMs: Date.parse("2025-02-03T23:59:59.999Z")
      }
    ],
    warnings: []
  };
}

function candidateSnapshots(
  strategyBucket: HistoricalMarketSnapshot["strategyBucket"]
): HistoricalMarketSnapshot[] {
  return [
    candidateSnapshot("snapshot-1", "2025-02-03T01:00:00.000Z", 100),
    candidateSnapshot(
      "snapshot-2",
      "2025-02-03T05:00:00.000Z",
      105,
      strategyBucket
    )
  ];
}

function candidateSnapshot(
  snapshotId: string,
  observedAt: string,
  lastPriceKrw: number,
  strategyBucket?: HistoricalMarketSnapshot["strategyBucket"]
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol: "TEST",
    observedAt,
    interval: "1m",
    lastPriceKrw,
    volume: 1_000,
    ...(strategyBucket === undefined ? {} : { strategyBucket }),
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function openCalendarValidation() {
  return {
    rules: [
      {
        market: "KR" as const,
        exchange: "KRX",
        timezone: "Asia/Seoul" as const
      }
    ],
    fixtures: [
      parseMarketCalendarFixture({
        calendarId: "calendar.krx.2025-02-03",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-02-03",
        marketOpen: "2025-02-03T00:00:00.000Z",
        marketClose: "2025-02-03T06:30:00.000Z",
        isHoliday: false,
        sourceRefs: ["fixture:calendar.krx.2025-02-03"],
        createdAt: "2026-07-20T00:00:00.000Z"
      })
    ]
  };
}

function usCalendarFixture() {
  return parseMarketCalendarFixture({
    calendarId: "calendar.nyse.2025-02-03",
    exchange: "NYSE",
    market: "US",
    timezone: "America/New_York",
    sessionDate: "2025-02-03",
    marketOpen: "2025-02-03T14:30:00.000Z",
    marketClose: "2025-02-03T21:00:00.000Z",
    isHoliday: false,
    sourceRefs: ["fixture:calendar.nyse.2025-02-03"],
    createdAt: "2026-07-20T00:00:00.000Z"
  });
}

function feasibilityBuilderOptions(): BuildValidationSplitRegimeFeasibilityArtifactOptions {
  const baseAssignment = {
    validationProtocol: "walk_forward" as const,
    splitId: "split-0",
    splitIndex: 0,
    trainStart: "2025-01-01T00:00:00+09:00",
    trainEnd: "2025-01-31T23:59:59.999+09:00",
    validationStart: "2025-02-01T00:00:00+09:00",
    validationEnd: "2025-02-28T23:59:59.999+09:00",
    testStart: "2025-03-01T00:00:00+09:00",
    testEnd: "2025-03-31T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
  const sessionDates = [
    "2025-01-02",
    "2025-01-31",
    "2025-02-03",
    "2025-02-28",
    "2025-03-04",
    "2025-03-31"
  ];
  const snapshots = sessionDates.map((sessionDate, index) => {
    const observedAt = `${sessionDate}T0${index % 2 === 0 ? "1" : "5"}:00:00.000Z`;
    return candidateSnapshot(
      `builder-snapshot-${index}`,
      observedAt,
      index % 2 === 0 ? 100 : 105,
      "short_term"
    );
  });
  const fixtures = sessionDates.map((sessionDate) =>
    parseMarketCalendarFixture({
      calendarId: `calendar.krx.${sessionDate}`,
      exchange: "KRX",
      market: "KR",
      timezone: "Asia/Seoul",
      sessionDate,
      marketOpen: `${sessionDate}T00:00:00.000Z`,
      marketClose: `${sessionDate}T06:30:00.000Z`,
      isHoliday: false,
      sourceRefs: [`fixture:calendar.krx.${sessionDate}`],
      createdAt: "2026-07-20T00:00:00.000Z"
    })
  );
  const assignments = (["train", "validation", "test"] as const).map(
    (splitRole) => ({ ...baseAssignment, splitRole })
  );
  const universeSource = {
    mode: "paper_only_historical_universe",
    universeId: "builder-universe",
    snapshotDate: "2025-01-01",
    symbols: [
      {
        market: "KR",
        symbol: "TEST",
        strategyBucket: "short_term",
        required: true
      }
    ],
    disclaimer: "Paper-only feasibility test universe."
  } as const;
  const universe = historicalUniverseManifestSchema.parse(universeSource);
  const coverage = assessHistoricalUniverseCoverage({
    snapshots,
    universe,
    rangeStart: new Date("2024-12-31T15:00:00.000Z"),
    rangeEnd: new Date("2025-03-31T14:59:59.999Z"),
    corruptLineCount: 0,
    timezoneOffsetMinutes: 540,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableStrategyBucketSymbolCounts: { short_term: 1 },
    requiredMarkets: ["KR"],
    requiredStrategyBuckets: ["short_term"]
  });

  return {
    generatedAt: "2026-07-20T00:00:00.000Z",
    assignments,
    snapshots,
    universe: universeSource,
    coverage,
    validationSplit: { assignments },
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "KRX",
          timezone: "Asia/Seoul"
        }
      ],
      fixtures
    },
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    targetRegimes: ["bull"],
    candidateStrategyBucket: "short_term",
    minimumCandidatesPerRoleRegime: 1
  };
}

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
