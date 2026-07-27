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
  createValidationFeasibilityCandidateHash
} from "./validationSplitRegimeFeasibility.js";
import {
  buildEvidenceExpansionBaselineRunVariant
} from "./validationRoleRegimeEvidenceExpansionBaselineRunVariant.js";
import type {
  ValidationRoleRegimeReplayPlan,
  ValidationRoleRegimeReplayPlanRun
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

test("baseline run variant uses verified baseline provenance", () => {
  const value = input();

  const result = buildEvidenceExpansionBaselineRunVariant(value);

  assert.equal(
    result.sourceVariant.feasibilityCandidateHash,
    value.run.candidateHash
  );
  assert.equal(
    result.sourceVariant.legacyReplayPlanEvidenceGroupHash,
    value.run.evidenceGroupHash
  );
});

test("baseline run variant rejects a run outside the verified plan", () => {
  const value = input();
  value.run = { ...value.run, runKey: "other-run" };

  assert.throws(
    () => buildEvidenceExpansionBaselineRunVariant(value),
    /does not match the verified plan/
  );
});

test("baseline run variant rejects a non-ready plan", () => {
  const value = input();
  value.plan.status = "insufficient";

  assert.throws(
    () => buildEvidenceExpansionBaselineRunVariant(value),
    /requires a ready baseline plan/
  );
});

test("baseline run variant rejects source provenance drift", () => {
  const value = input();
  value.source.baselineProvenanceHashes.universeHash = hash("f");

  assert.throws(
    () => buildEvidenceExpansionBaselineRunVariant(value),
    /baseline raw source hash mismatch: universeHash/
  );
});

test("baseline run variant rejects calendar and classifier drift", () => {
  const calendarDrift = input();
  calendarDrift.calendarClassifier.hashes.calendarHash = hash("f");
  assert.throws(
    () => buildEvidenceExpansionBaselineRunVariant(calendarDrift),
    /calendar hash does not match/
  );

  const classifierDrift = input();
  classifierDrift.calendarClassifier.hashes
    .marketRegimeClassifierHash = hash("f");
  assert.throws(
    () => buildEvidenceExpansionBaselineRunVariant(classifierDrift),
    /classifier hash does not match/
  );
});

test("baseline run variant rejects legacy identity drift", () => {
  const value = input();
  const changedRun = {
    ...value.run,
    evidenceGroupHash: hash("f")
  };
  value.run = changedRun;
  value.plan.runs = [changedRun];

  assert.throws(
    () => buildEvidenceExpansionBaselineRunVariant(value),
    /legacy evidence group hash must match candidate hash/
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
  const classifierHash = hash("2");
  const startAt = "2025-01-02T00:00:00.000Z";
  const endAt = "2025-01-02T06:30:00.000Z";
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
  const sourceAssignment = assignment();
  const run: ValidationRoleRegimeReplayPlanRun = {
    planIndex: 0,
    runKey: "baseline-train-bull-0",
    splitRole: "train",
    targetRegime: "bull",
    candidateOrdinalWithinRoleRegime: 0,
    candidateHash,
    startAt,
    endAt,
    sourceAssignments: [sourceAssignment],
    executionAssignment: sourceAssignment,
    evidenceGroupHash: candidateHash,
    sharedAcrossRoles: false,
    sharedRoles: ["train"]
  };
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
    runs: [run]
  };
  return {
    run,
    plan,
    source: {
      snapshots: [snapshot(startAt)],
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
      hashes: {
        calendarHash,
        officialCalendarArtifactHash: null,
        marketRegimeClassifierHash: classifierHash
      }
    }
  };
}

function assignment(): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole: "train",
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: "2025-03-01T00:00:00.000Z",
    testEnd: "2025-03-31T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function snapshot(observedAt: string): HistoricalMarketSnapshot {
  return {
    snapshotId: "baseline-snapshot",
    market: "KR",
    symbol: "005930",
    strategyBucket: "short_term",
    observedAt,
    interval: "1d",
    lastPriceKrw: 10_000,
    sourceRefs: ["fixture:baseline"],
    createdAt: observedAt
  };
}

function calendar(
  marketOpen: string,
  marketClose: string
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
        marketOpen,
        marketClose,
        isHoliday: false,
        sourceRefs: ["fixture:calendar.krx.2025-01-02"],
        createdAt: "2026-07-27T00:00:00.000Z"
      }
    ]
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
