import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions
} from "./historicalDataAvailability.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionObservedTradingDates,
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";

test("observed trading dates canonicalize market sessions and duplicate rows", () => {
  const snapshots = [
    snapshot("us-spy", "US", "SPY", "2025-01-02T14:30:00.000Z"),
    snapshot("kr-second", "KR", "000660", "2025-01-02T00:00:00.000Z"),
    snapshot("kr-first", "KR", "005930", "2025-01-02T00:00:00.000Z")
  ];
  const calendarValidation = calendar();

  const result = buildEvidenceExpansionObservedTradingDates({
    snapshots,
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T14:30:00.000Z",
    calendarValidation
  });
  const reordered = buildEvidenceExpansionObservedTradingDates({
    snapshots: [...snapshots].reverse(),
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T14:30:00.000Z",
    calendarValidation
  });

  assert.deepEqual(result.sessions, [
    { market: "KR", sessionDate: "2025-01-02" },
    { market: "US", sessionDate: "2025-01-02" }
  ]);
  assert.equal(
    result.observedTradingDatesHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: result.sessions
    })
  );
  assert.deepEqual(reordered, result);
});

test("observed trading dates ignore snapshots outside the inclusive interval", () => {
  const result = buildEvidenceExpansionObservedTradingDates({
    snapshots: [
      snapshot("outside", "KR", "005930", "2025-01-02T00:00:00.000Z"),
      snapshot("inside", "KR", "005930", "2025-01-03T00:00:00.000Z")
    ],
    startAt: "2025-01-03T00:00:00.000Z",
    endAt: "2025-01-03T00:00:00.001Z",
    calendarValidation: calendar()
  });

  assert.deepEqual(result.sessions, [
    { market: "KR", sessionDate: "2025-01-03" }
  ]);
});

test("observed trading dates hash an empty canonical set deterministically", () => {
  const result = buildEvidenceExpansionObservedTradingDates({
    snapshots: [
      snapshot("outside", "KR", "005930", "2025-01-02T00:00:00.000Z")
    ],
    startAt: "2025-01-04T00:00:00.000Z",
    endAt: "2025-01-05T00:00:00.000Z",
    calendarValidation: calendar()
  });

  assert.deepEqual(result.sessions, []);
  assert.equal(
    result.observedTradingDatesHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: []
    })
  );
});

test("observed trading dates reject unsupported cadence and shifted timestamps", () => {
  const intraday = {
    ...snapshot("intraday", "KR", "005930", "2025-01-02T00:00:00.000Z"),
    interval: "1h" as const
  };
  assert.throws(
    () =>
      buildEvidenceExpansionObservedTradingDates({
        snapshots: [intraday],
        startAt: "2025-01-02T00:00:00.000Z",
        endAt: "2025-01-02T06:30:00.000Z",
        calendarValidation: calendar()
      }),
    /must use 1d interval/
  );

  assert.throws(
    () =>
      buildEvidenceExpansionObservedTradingDates({
        snapshots: [
          snapshot("shifted", "KR", "005930", "2025-01-02T00:01:00.000Z")
        ],
        startAt: "2025-01-02T00:00:00.000Z",
        endAt: "2025-01-02T06:30:00.000Z",
        calendarValidation: calendar()
      }),
    /must match marketOpen/
  );
});

test("observed trading dates reject missing calendar identity", () => {
  const input = {
    snapshots: [
      snapshot("missing", "US", "SPY", "2025-01-02T14:30:00.000Z")
    ],
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T23:59:59.999Z"
  };
  assert.throws(
    () =>
      buildEvidenceExpansionObservedTradingDates({
        ...input,
        calendarValidation: {
          ...calendar(),
          rules: calendar().rules.filter((rule) => rule.market !== "US")
        }
      }),
    /calendar rule is missing: US/
  );
  assert.throws(
    () =>
      buildEvidenceExpansionObservedTradingDates({
        ...input,
        calendarValidation: {
          ...calendar(),
          fixtures: calendar().fixtures.filter(
            (fixture) => fixture.market !== "US"
          )
        }
      }),
    /calendar fixture is missing: NYSE:2025-01-02/
  );
});

test("observed trading dates reject invalid candidate boundaries", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionObservedTradingDates({
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
      fixture({
        calendarId: "calendar.krx.2025-01-02",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-02",
        marketOpen: "2025-01-02T00:00:00.000Z",
        marketClose: "2025-01-02T06:30:00.000Z"
      }),
      fixture({
        calendarId: "calendar.krx.2025-01-03",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-03",
        marketOpen: "2025-01-03T00:00:00.000Z",
        marketClose: "2025-01-03T06:30:00.000Z"
      }),
      fixture({
        calendarId: "calendar.nyse.2025-01-02",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-01-02",
        marketOpen: "2025-01-02T14:30:00.000Z",
        marketClose: "2025-01-02T21:00:00.000Z"
      })
    ]
  };
}

function fixture(input: {
  calendarId: string;
  exchange: string;
  market: "KR" | "US";
  timezone: "Asia/Seoul" | "America/New_York";
  sessionDate: string;
  marketOpen: string;
  marketClose: string;
}) {
  return {
    ...input,
    isHoliday: false,
    sourceRefs: [`fixture:${input.calendarId}`],
    createdAt: "2026-07-27T00:00:00.000Z"
  };
}

function snapshot(
  snapshotId: string,
  market: "KR" | "US",
  symbol: string,
  observedAt: string
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market,
    symbol,
    strategyBucket: "short_term",
    observedAt,
    interval: "1d",
    lastPriceKrw: 10_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}
