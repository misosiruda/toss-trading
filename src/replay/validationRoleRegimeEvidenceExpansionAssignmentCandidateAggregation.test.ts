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
  createValidationFeasibilityClassifierHash,
  defaultMarketRegimeClassifierConfig
} from "./validationSplitRegimeFeasibility.js";
import {
  aggregateEvidenceExpansionAssignmentCandidates
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

test("assignment aggregation uses canonical split and role order", () => {
  const result = aggregateEvidenceExpansionAssignmentCandidates(input());

  assert.deepEqual(
    result.assignmentCandidates.map(
      ({ assignment }) =>
        `${assignment.splitIndex}:${assignment.splitRole}`
    ),
    ["0:train", "0:validation", "0:test"]
  );
  assert.equal(result.structuralCapacityCount, 3);
  assert.equal(result.calendarValidCandidateCount, 3);
  assert.equal(result.calendarRejectedCandidateCount, 0);
  assert.equal(result.scopeUnavailableCandidateCount, 0);
});

test("assignment aggregation preserves rejection and scope totals", () => {
  const value = input();
  value.calendarClassifier.calendarValidation.fixtures =
    value.calendarClassifier.calendarValidation.fixtures.filter(
      (fixture) => fixture.sessionDate !== "2025-02-03"
    );
  value.source.snapshots = value.source.snapshots.map((entry) =>
    entry.snapshotId === "test-session"
      ? { ...entry, strategyBucket: "long_term" }
      : entry
  );

  const result = aggregateEvidenceExpansionAssignmentCandidates(value);

  assert.equal(result.structuralCapacityCount, 3);
  assert.equal(result.calendarValidCandidateCount, 2);
  assert.equal(result.calendarRejectedCandidateCount, 1);
  assert.equal(result.scopeUnavailableCandidateCount, 1);
  assert.equal(
    result.assignmentCandidates[1]?.result
      .calendarRejectedCandidateCount,
    1
  );
  assert.equal(
    result.assignmentCandidates[2]?.result
      .scopeUnavailableCandidateCount,
    1
  );
});

test("assignment aggregation rejects an empty verified assignment set", () => {
  const value = input();
  value.source.assignments = [];

  assert.throws(
    () => aggregateEvidenceExpansionAssignmentCandidates(value),
    /requires verified assignments/
  );
});

function input() {
  const marketRegimeClassifier = defaultMarketRegimeClassifierConfig();
  const assignments = [
    assignment("test"),
    assignment("train"),
    assignment("validation")
  ];
  return {
    source: {
      snapshots: [
        snapshot("train-session", "2025-01-02T00:00:00.000Z"),
        snapshot("validation-session", "2025-02-03T00:00:00.000Z"),
        snapshot("test-session", "2025-03-04T00:00:00.000Z")
      ],
      assignments,
      hashes: {
        expansionDataSnapshotHash: hash("3"),
        expansionUniverseHash: hash("4"),
        expansionCoverageHash: hash("5"),
        validationSplitHash: hash("6")
      },
      baselineProvenanceHashes: {
        dataSnapshotHash: hash("3"),
        universeHash: hash("4"),
        coverageHash: hash("5"),
        validationSplitHash: hash("6")
      }
    },
    calendarClassifier: {
      calendarValidation: calendar(),
      marketRegimeClassifier,
      hashes: {
        calendarHash: hash("1"),
        officialCalendarArtifactHash: null,
        marketRegimeClassifierHash:
          createValidationFeasibilityClassifierHash(
            marketRegimeClassifier
          )
      }
    },
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  };
}

function assignment(
  splitRole: ValidationSplitAssignment["splitRole"]
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole,
    trainStart: "2025-01-01T00:00:00+09:00",
    trainEnd: "2025-01-31T23:59:59.999+09:00",
    validationStart: "2025-02-01T00:00:00+09:00",
    validationEnd: "2025-02-28T23:59:59.999+09:00",
    testStart: "2025-03-01T00:00:00+09:00",
    testEnd: "2025-03-31T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function calendar(): HistoricalDataAvailabilityCalendarOptions {
  return {
    rules: [
      { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }
    ],
    fixtures: [
      fixture("2025-01-02", "2025-01-02T00:00:00.000Z"),
      fixture("2025-02-03", "2025-02-03T00:00:00.000Z"),
      fixture("2025-03-04", "2025-03-04T00:00:00.000Z")
    ]
  };
}

function fixture(
  sessionDate: string,
  marketOpen: string
): HistoricalDataAvailabilityCalendarOptions["fixtures"][number] {
  return {
    calendarId: `calendar.krx.${sessionDate}`,
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate,
    marketOpen,
    marketClose: new Date(
      Date.parse(marketOpen) + 6.5 * 60 * 60 * 1_000
    ).toISOString(),
    isHoliday: false,
    sourceRefs: [`fixture:calendar.krx.${sessionDate}`],
    createdAt: "2026-07-27T00:00:00.000Z"
  };
}

function snapshot(
  snapshotId: string,
  observedAt: string
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol: "005930",
    strategyBucket: "short_term",
    observedAt,
    interval: "1d",
    lastPriceKrw: 10_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
