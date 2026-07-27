import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  StrategyBucket
} from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions
} from "./historicalDataAvailability.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionUniverseMembership,
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

test("universe membership canonicalizes observed short-term symbols", () => {
  const snapshots = [
    snapshot("us", "US", "SAME", "2025-01-02T14:30:00.000Z"),
    snapshot("kr-later", "KR", "SAME", "2025-01-03T00:00:00.000Z"),
    snapshot("kr-first", "KR", "SAME", "2025-01-02T00:00:00.000Z"),
    snapshot("kr-other", "KR", "000660", "2025-01-02T00:00:00.000Z")
  ];

  const result = buildEvidenceExpansionUniverseMembership({
    snapshots,
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T06:30:00.000Z",
    calendarValidation: calendar()
  });
  const reordered = buildEvidenceExpansionUniverseMembership({
    snapshots: [...snapshots].reverse(),
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T06:30:00.000Z",
    calendarValidation: calendar()
  });

  assert.deepEqual(result.members, [
    { market: "KR", symbol: "000660" },
    { market: "KR", symbol: "SAME" },
    { market: "US", symbol: "SAME" }
  ]);
  assert.equal(
    result.universeMembershipHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: result.members
    })
  );
  assert.deepEqual(reordered, result);
});

test("universe membership excludes out-of-window and non-short-term rows", () => {
  const result = buildEvidenceExpansionUniverseMembership({
    snapshots: [
      snapshot("outside", "KR", "OUTSIDE", "2025-01-02T00:00:00.000Z"),
      snapshot(
        "long-term",
        "KR",
        "LONG",
        "2025-01-03T00:00:00.000Z",
        "long_term"
      ),
      snapshot("invalid-long-term", "KR", "IGNORED", "invalid", "long_term"),
      snapshot("inside", "KR", "INSIDE", "2025-01-03T00:00:00.000Z")
    ],
    startAt: "2025-01-03T00:00:00.000Z",
    endAt: "2025-01-03T00:00:00.001Z",
    calendarValidation: calendar()
  });

  assert.deepEqual(result.members, [{ market: "KR", symbol: "INSIDE" }]);
});

test("universe membership hashes an empty observed scope deterministically", () => {
  const result = buildEvidenceExpansionUniverseMembership({
    snapshots: [
      snapshot(
        "long-term",
        "KR",
        "LONG",
        "2025-01-03T00:00:00.000Z",
        "long_term"
      )
    ],
    startAt: "2025-01-03T00:00:00.000Z",
    endAt: "2025-01-03T00:00:00.001Z",
    calendarValidation: calendar()
  });

  assert.deepEqual(result.members, []);
  assert.equal(
    result.universeMembershipHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: []
    })
  );
});

test("universe membership fails closed through observed-session validation", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionUniverseMembership({
        snapshots: [
          snapshot(
            "shifted",
            "KR",
            "005930",
            "2025-01-02T00:01:00.000Z"
          )
        ],
        startAt: "2025-01-02T00:00:00.000Z",
        endAt: "2025-01-02T06:30:00.000Z",
        calendarValidation: calendar()
      }),
    /must match marketOpen/
  );
});

test("universe membership rejects invalid candidate boundaries", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionUniverseMembership({
        snapshots: [],
        startAt: "2025-01-03T00:00:00.000Z",
        endAt: "2025-01-02T00:00:00.000Z",
        calendarValidation: calendar()
      }),
    /startAt must be before endAt/
  );
});

function calendar(): HistoricalDataAvailabilityCalendarOptions {
  return {
    rules: [
      { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" },
      { market: "US", exchange: "NYSE", timezone: "America/New_York" }
    ],
    fixtures: [
      fixture(
        "KRX",
        "KR",
        "Asia/Seoul",
        "2025-01-02",
        "2025-01-02T00:00:00.000Z",
        "2025-01-02T06:30:00.000Z"
      ),
      fixture(
        "KRX",
        "KR",
        "Asia/Seoul",
        "2025-01-03",
        "2025-01-03T00:00:00.000Z",
        "2025-01-03T06:30:00.000Z"
      ),
      fixture(
        "NYSE",
        "US",
        "America/New_York",
        "2025-01-02",
        "2025-01-02T14:30:00.000Z",
        "2025-01-02T21:00:00.000Z"
      )
    ]
  };
}

function fixture(
  exchange: string,
  market: "KR" | "US",
  timezone: "Asia/Seoul" | "America/New_York",
  sessionDate: string,
  marketOpen: string,
  marketClose: string
) {
  const calendarId = `calendar.${exchange.toLowerCase()}.${sessionDate}`;
  return {
    calendarId,
    exchange,
    market,
    timezone,
    sessionDate,
    marketOpen,
    marketClose,
    isHoliday: false,
    sourceRefs: [`fixture:${calendarId}`],
    createdAt: "2026-07-27T00:00:00.000Z"
  };
}

function snapshot(
  snapshotId: string,
  market: "KR" | "US",
  symbol: string,
  observedAt: string,
  strategyBucket: StrategyBucket = "short_term"
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market,
    symbol,
    strategyBucket,
    observedAt,
    interval: "1d",
    lastPriceKrw: 10_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}
