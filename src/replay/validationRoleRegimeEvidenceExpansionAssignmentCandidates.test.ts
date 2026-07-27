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
  enumerateEvidenceExpansionAssignmentCandidates
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidates.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

test("assignment enumeration builds calendar-valid source variants", () => {
  const result = enumerateEvidenceExpansionAssignmentCandidates(input());

  assert.equal(result.structuralCapacityCount, 1);
  assert.equal(result.calendarRejectedCandidateCount, 0);
  assert.equal(result.scopeUnavailableCandidateCount, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.startAt, "2024-12-31T15:00:00.000Z");
  assert.equal(result.candidates[0]?.endAt, "2025-01-31T14:59:59.999Z");
  assert.equal(result.candidates[0]?.scopeAvailable, true);
  assert.deepEqual(result.candidates[0]?.variant.universeMembership, [
    { market: "KR", symbol: "005930" }
  ]);
});

test("assignment enumeration preserves calendar rejection counts", () => {
  const value = input();
  value.source.snapshots = [
    snapshot("missing-fixture", "2025-01-03T00:00:00.000Z")
  ];

  const result = enumerateEvidenceExpansionAssignmentCandidates(value);

  assert.equal(result.structuralCapacityCount, 1);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.calendarRejectedCandidateCount, 1);
  assert.equal(result.scopeUnavailableCandidateCount, 0);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "ROLE_CANDIDATE_CALENDAR_REJECTED"
    )
  );
});

test("assignment enumeration fails closed for stricter market-open policy", () => {
  const value = input();
  value.source.snapshots = [
    snapshot("shifted", "2025-01-02T00:01:00.000Z")
  ];

  assert.throws(
    () => enumerateEvidenceExpansionAssignmentCandidates(value),
    /must match marketOpen/
  );
});

test("assignment enumeration preserves scope-unavailable candidates", () => {
  const value = input();
  value.source.snapshots = value.source.snapshots.map((entry) => ({
    ...entry,
    strategyBucket: "long_term"
  }));

  const result = enumerateEvidenceExpansionAssignmentCandidates(value);

  assert.equal(result.structuralCapacityCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.scopeAvailable, false);
  assert.deepEqual(result.candidates[0]?.variant.universeMembership, []);
  assert.equal(result.scopeUnavailableCandidateCount, 1);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "ROLE_CANDIDATE_SCOPE_UNAVAILABLE"
    )
  );
});

test("assignment enumeration preserves zero structural capacity", () => {
  const value = input();
  value.assignment = {
    ...value.assignment,
    trainStart: "2025-01-15T00:00:00+09:00",
    trainEnd: "2025-01-20T23:59:59.999+09:00"
  };

  const result = enumerateEvidenceExpansionAssignmentCandidates(value);

  assert.equal(result.structuralCapacityCount, 0);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.calendarRejectedCandidateCount, 0);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "ROLE_FULL_WINDOW_CAPACITY_ZERO"
    )
  );
});

function input() {
  return {
    assignment: assignment(),
    source: {
      snapshots: [
        snapshot("session", "2025-01-02T00:00:00.000Z")
      ],
      hashes: {
        expansionDataSnapshotHash: hash("3"),
        expansionUniverseHash: hash("4"),
        expansionCoverageHash: hash("5"),
        validationSplitHash: hash("6")
      }
    },
    calendarClassifier: {
      calendarValidation: calendar(),
      hashes: {
        calendarHash: hash("1"),
        officialCalendarArtifactHash: null,
        marketRegimeClassifierHash: hash("2")
      }
    },
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  };
}

function assignment(): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole: "train",
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
      {
        calendarId: "calendar.krx.2025-01-02",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-02",
        marketOpen: "2025-01-02T00:00:00.000Z",
        marketClose: "2025-01-02T06:30:00.000Z",
        isHoliday: false,
        sourceRefs: ["fixture:calendar.krx.2025-01-02"],
        createdAt: "2026-07-27T00:00:00.000Z"
      }
    ]
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
