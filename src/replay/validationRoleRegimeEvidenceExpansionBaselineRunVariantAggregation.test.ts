import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  Sha256Hash
} from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions
} from "./historicalDataAvailability.js";
import {
  createValidationFeasibilityCandidateHash,
  createValidationFeasibilityClassifierHash,
  defaultMarketRegimeClassifierConfig
} from "./validationSplitRegimeFeasibility.js";
import {
  aggregateEvidenceExpansionBaselineRunVariants
} from "./validationRoleRegimeEvidenceExpansionBaselineRunVariantAggregation.js";
import type {
  ValidationRoleRegimeReplayPlan,
  ValidationRoleRegimeReplayPlanRun
} from "./validationRoleRegimeReplayPlan.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";

test("baseline run aggregation preserves deterministic plan order", () => {
  const value = input();

  const result = aggregateEvidenceExpansionBaselineRunVariants(value);

  assert.equal(result.plannedRunCount, 2);
  assert.deepEqual(
    result.runVariants.map((entry) => entry.run.runKey),
    ["baseline-train-bull-0", "baseline-validation-bull-0"]
  );
  assert.ok(
    result.runVariants.every(
      (entry) =>
        entry.variant.sourceVariant.legacyReplayPlanEvidenceGroupHash ===
        entry.run.evidenceGroupHash
    )
  );
});

test("baseline run aggregation rejects a non-ready or empty plan", () => {
  const nonReady = input();
  nonReady.plan.status = "insufficient";
  assert.throws(
    () => aggregateEvidenceExpansionBaselineRunVariants(nonReady),
    /requires a ready baseline plan/
  );

  const empty = input();
  empty.plan.runs = [];
  assert.throws(
    () => aggregateEvidenceExpansionBaselineRunVariants(empty),
    /requires planned runs/
  );
});

test("baseline run aggregation rejects non-contiguous plan order", () => {
  const value = input();
  value.plan.runs = [...value.plan.runs].reverse();

  assert.throws(
    () => aggregateEvidenceExpansionBaselineRunVariants(value),
    /requires contiguous planIndex order/
  );
});

test("baseline run aggregation rejects duplicate run keys", () => {
  const value = input();
  value.plan.runs[1] = {
    ...value.plan.runs[1]!,
    runKey: value.plan.runs[0]!.runKey
  };

  assert.throws(
    () => aggregateEvidenceExpansionBaselineRunVariants(value),
    /contains duplicate runKey/
  );
});

test("baseline run aggregation rejects any run with regime drift", () => {
  const value = input();
  value.plan.runs[1] = {
    ...value.plan.runs[1]!,
    targetRegime: "bear"
  };

  assert.throws(
    () => aggregateEvidenceExpansionBaselineRunVariants(value),
    /regime does not match the verified classifier/
  );
});

function input() {
  const provenance = {
    dataSnapshotHash: hash("3"),
    universeHash: hash("4"),
    coverageHash: hash("5"),
    validationSplitHash: hash("6")
  };
  const calendarHash = hash("1");
  const marketRegimeClassifier =
    defaultMarketRegimeClassifierConfig();
  const classifierHash = createValidationFeasibilityClassifierHash(
    marketRegimeClassifier
  );
  const startAt = "2025-01-02T00:00:00.000Z";
  const endAt = "2025-01-03T00:00:00.000Z";
  const candidateHash = createValidationFeasibilityCandidateHash({
    startAt,
    endAt,
    timezoneOffsetMinutes: 540,
    windowMonths: 1,
    calendarHash,
    marketRegimeClassifierHash: classifierHash,
    candidateStrategyBucket: "short_term",
    scopeAvailable: true,
    dataSnapshotHash: provenance.dataSnapshotHash,
    universeHash: provenance.universeHash,
    coverageHash: provenance.coverageHash
  });
  const runs = [
    run({
      planIndex: 0,
      runKey: "baseline-train-bull-0",
      splitRole: "train",
      candidateHash,
      startAt,
      endAt
    }),
    run({
      planIndex: 1,
      runKey: "baseline-validation-bull-0",
      splitRole: "validation",
      candidateHash,
      startAt,
      endAt
    })
  ];
  const plan: Pick<
    ValidationRoleRegimeReplayPlan,
    "status" | "source" | "config" | "runs"
  > = {
    status: "ready_for_paper_diagnostic",
    source: {
      feasibilitySchemaVersion:
        "validation_split_regime_feasibility.v1",
      feasibilityArtifactHash: hash("0"),
      feasibilityStatus: "available",
      ...provenance,
      calendarHash,
      marketRegimeClassifierHash: classifierHash
    },
    config: {
      selectionPolicyVersion:
        "exhaustive_role_regime_candidates.v1",
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull"],
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    runs
  };

  return {
    plan,
    source: {
      snapshots: [
        snapshot("baseline-start", startAt, 10_000),
        snapshot("baseline-end", endAt, 10_500)
      ],
      hashes: {
        expansionDataSnapshotHash: hash("a"),
        expansionUniverseHash: hash("b"),
        expansionCoverageHash: hash("c"),
        validationSplitHash: hash("d")
      },
      baselineProvenanceHashes: { ...provenance }
    },
    calendarClassifier: {
      calendarValidation: calendar(startAt, endAt),
      marketRegimeClassifier,
      hashes: {
        calendarHash,
        officialCalendarArtifactHash: null,
        marketRegimeClassifierHash: classifierHash
      }
    }
  };
}

function run(input: {
  planIndex: number;
  runKey: string;
  splitRole: ValidationSplitRole;
  candidateHash: Sha256Hash;
  startAt: string;
  endAt: string;
}): ValidationRoleRegimeReplayPlanRun {
  const sourceAssignment = assignment(input.splitRole);
  return {
    planIndex: input.planIndex,
    runKey: input.runKey,
    splitRole: input.splitRole,
    targetRegime: "bull",
    candidateOrdinalWithinRoleRegime: 0,
    candidateHash: input.candidateHash,
    startAt: input.startAt,
    endAt: input.endAt,
    sourceAssignments: [sourceAssignment],
    executionAssignment: sourceAssignment,
    evidenceGroupHash: input.candidateHash,
    sharedAcrossRoles: true,
    sharedRoles: ["train", "validation"]
  };
}

function assignment(
  splitRole: ValidationSplitRole
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole,
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-01-01T00:00:00.000Z",
    validationEnd: "2025-01-31T23:59:59.999Z",
    testStart: "2025-02-01T00:00:00.000Z",
    testEnd: "2025-02-28T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function snapshot(
  snapshotId: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol: "005930",
    strategyBucket: "short_term",
    observedAt,
    interval: "1d",
    lastPriceKrw,
    sourceRefs: ["fixture:baseline"],
    createdAt: observedAt
  };
}

function calendar(
  firstMarketOpen: string,
  secondMarketOpen: string
): HistoricalDataAvailabilityCalendarOptions {
  return {
    rules: [
      { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }
    ],
    fixtures: [
      {
        calendarId: "calendar.krx.2025-01-02",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-02",
        marketOpen: firstMarketOpen,
        marketClose: "2025-01-02T06:30:00.000Z",
        isHoliday: false,
        sourceRefs: ["fixture:calendar.krx.2025-01-02"],
        createdAt: "2026-07-27T00:00:00.000Z"
      },
      {
        calendarId: "calendar.krx.2025-01-03",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-03",
        marketOpen: secondMarketOpen,
        marketClose: "2025-01-03T06:30:00.000Z",
        isHoliday: false,
        sourceRefs: ["fixture:calendar.krx.2025-01-03"],
        createdAt: "2026-07-27T00:00:00.000Z"
      }
    ]
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
