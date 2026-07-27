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
  createEvidenceExpansionCandidateIdentity
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";

test("source candidate variant assembles canonical entries and identity hashes", () => {
  const result = buildEvidenceExpansionSourceCandidateVariant(input());
  const expected = createEvidenceExpansionCandidateIdentity({
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T06:30:00.000Z",
    candidateStrategyBucket: "short_term",
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    scopeAvailable: true,
    calendarHash: hash("1"),
    marketRegimeClassifierHash: hash("2"),
    dataSnapshotHash: hash("3"),
    universeHash: hash("4"),
    coverageHash: hash("5"),
    validationSplitHash: hash("6"),
    observedTradingDatesHash:
      result.sourceVariant.observedTradingDatesHash,
    universeMembershipHash:
      result.sourceVariant.universeMembershipHash,
    legacyReplayPlanEvidenceGroupHash: null
  });

  assert.deepEqual(result.observedTradingDates, [
    { market: "KR", sessionDate: "2025-01-02" },
    { market: "KR", sessionDate: "2025-01-03" }
  ]);
  assert.deepEqual(result.universeMembership, [
    { market: "KR", symbol: "005930" }
  ]);
  assert.equal(result.evidenceGroupHash, expected.evidenceGroupHash);
  assert.deepEqual(result.sourceVariant, expected.sourceVariant);
});

test("source candidate variant is invariant to verified snapshot order", () => {
  const forward = input();
  const reversed = input();
  reversed.source.snapshots = [...reversed.source.snapshots].reverse();

  assert.deepEqual(
    buildEvidenceExpansionSourceCandidateVariant(reversed),
    buildEvidenceExpansionSourceCandidateVariant(forward)
  );
});

test("source candidate variant rejects scope availability mismatch", () => {
  const value = input();
  value.candidate.scopeAvailable = false;

  assert.throws(
    () => buildEvidenceExpansionSourceCandidateVariant(value),
    /scopeAvailable does not match observed short-term membership/
  );
});

test("source candidate variant preserves an empty short-term scope", () => {
  const value = input();
  value.source.snapshots = value.source.snapshots.map((snapshot) => ({
    ...snapshot,
    strategyBucket: "long_term"
  }));
  value.candidate.scopeAvailable = false;

  const result = buildEvidenceExpansionSourceCandidateVariant(value);

  assert.deepEqual(result.observedTradingDates, [
    { market: "KR", sessionDate: "2025-01-02" },
    { market: "KR", sessionDate: "2025-01-03" }
  ]);
  assert.deepEqual(result.universeMembership, []);
});

test("source candidate variant propagates calendar validation failure", () => {
  const value = input();
  value.source.snapshots = [
    snapshot("shifted", "2025-01-02T00:01:00.000Z")
  ];

  assert.throws(
    () => buildEvidenceExpansionSourceCandidateVariant(value),
    /must match marketOpen/
  );
});

function input() {
  return {
    candidate: {
      startAt: "2025-01-02T00:00:00.000Z",
      endAt: "2025-01-03T06:30:00.000Z",
      scopeAvailable: true,
      legacyReplayPlanEvidenceGroupHash: null
    },
    source: {
      snapshots: [
        snapshot("later", "2025-01-03T00:00:00.000Z"),
        snapshot("first", "2025-01-02T00:00:00.000Z")
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

function calendar(): HistoricalDataAvailabilityCalendarOptions {
  return {
    rules: [
      { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }
    ],
    fixtures: [
      fixture("2025-01-02", "2025-01-02T00:00:00.000Z"),
      fixture("2025-01-03", "2025-01-03T00:00:00.000Z")
    ]
  };
}

function fixture(sessionDate: string, marketOpen: string) {
  return {
    calendarId: `calendar.krx.${sessionDate}`,
    exchange: "KRX",
    market: "KR" as const,
    timezone: "Asia/Seoul" as const,
    sessionDate,
    marketOpen,
    marketClose: marketOpen.replace("T00:00:00", "T06:30:00"),
    isHoliday: false,
    sourceRefs: [`fixture:krx:${sessionDate}`],
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
