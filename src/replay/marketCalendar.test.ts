import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMarketCalendarTimestamp,
  localDatePart,
  MarketCalendarFixtureIndex,
  parseMarketCalendarFixture,
  parseMarketCalendarFixtures
} from "./marketCalendar.js";

test("market calendar fixture classifies KR session timestamps", () => {
  const fixture = parseMarketCalendarFixture({
    calendarId: "calendar.krx.2025-01-02",
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate: "2025-01-02",
    marketOpen: "2025-01-02T00:00:00.000Z",
    marketClose: "2025-01-02T06:30:00.000Z",
    isHoliday: false,
    sourceRefs: ["manual_calendar_fixture:KRX:2025-01-02"],
    createdAt: "2026-07-01T00:00:00.000Z"
  });

  assert.deepEqual(
    classifyMarketCalendarTimestamp({
      observedAt: "2025-01-02T00:15:00.000Z",
      fixture
    }),
    {
      status: "session_open",
      calendarId: "calendar.krx.2025-01-02",
      exchange: "KRX",
      market: "KR",
      timezone: "Asia/Seoul",
      sessionDate: "2025-01-02",
      localDate: "2025-01-02",
      marketOpen: "2025-01-02T00:00:00.000Z",
      marketClose: "2025-01-02T06:30:00.000Z",
      isHoliday: false,
      warningCodes: []
    }
  );
});

test("market calendar helper applies IANA timezone local dates", () => {
  assert.equal(
    localDatePart(new Date("2025-01-02T00:30:00.000Z"), "Asia/Seoul"),
    "2025-01-02"
  );
  assert.equal(
    localDatePart(new Date("2025-01-02T02:00:00.000Z"), "America/New_York"),
    "2025-01-01"
  );
});

test("market calendar fixture reports session boundary and timezone warnings", () => {
  const fixture = parseMarketCalendarFixture({
    calendarId: "calendar.nyse.2025-01-02",
    exchange: "NYSE",
    market: "US",
    timezone: "America/New_York",
    sessionDate: "2025-01-02",
    marketOpen: "2025-01-02T14:30:00.000Z",
    marketClose: "2025-01-02T21:00:00.000Z",
    isHoliday: false,
    sourceRefs: ["manual_calendar_fixture:NYSE:2025-01-02"],
    createdAt: "2026-07-01T00:00:00.000Z"
  });

  assert.deepEqual(
    classifyMarketCalendarTimestamp({
      observedAt: "2025-01-02T13:59:00.000Z",
      fixture
    }).warningCodes,
    ["CALENDAR_SESSION_MISMATCH"]
  );
  assert.deepEqual(
    classifyMarketCalendarTimestamp({
      observedAt: "2025-01-03T05:00:00.000Z",
      fixture
    }).warningCodes,
    ["CALENDAR_TIMEZONE_MISMATCH", "CALENDAR_SESSION_MISMATCH"]
  );
});

test("market calendar fixture classifies holidays as explicit warnings", () => {
  const fixture = parseMarketCalendarFixture({
    calendarId: "calendar.nyse.2025-01-01",
    exchange: "NYSE",
    market: "US",
    timezone: "America/New_York",
    sessionDate: "2025-01-01",
    marketOpen: null,
    marketClose: null,
    isHoliday: true,
    holidayName: "New Year holiday fixture",
    sourceRefs: ["manual_calendar_fixture:NYSE:2025-01-01"],
    createdAt: "2026-07-01T00:00:00.000Z"
  });

  const classification = classifyMarketCalendarTimestamp({
    observedAt: new Date("2025-01-01T15:00:00.000Z"),
    fixture
  });

  assert.equal(classification.status, "holiday");
  assert.deepEqual(classification.warningCodes, ["CALENDAR_HOLIDAY_SAMPLE"]);
});

test("market calendar helper treats missing fixtures as fail-closed metadata", () => {
  assert.deepEqual(
    classifyMarketCalendarTimestamp({
      observedAt: "2025-01-02T00:00:00.000Z"
    }),
    {
      status: "fixture_missing",
      calendarId: null,
      exchange: null,
      market: null,
      timezone: null,
      sessionDate: null,
      localDate: null,
      marketOpen: null,
      marketClose: null,
      isHoliday: null,
      warningCodes: ["CALENDAR_FIXTURE_MISSING"]
    }
  );
});

test("market calendar fixture parser rejects malformed session fixtures", () => {
  assert.throws(
    () =>
      parseMarketCalendarFixture({
        calendarId: "calendar.krx.invalid",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-02",
        marketOpen: "2025-01-02T06:30:00.000Z",
        marketClose: "2025-01-02T00:00:00.000Z",
        isHoliday: false,
        sourceRefs: ["manual_calendar_fixture:KRX:2025-01-02"],
        createdAt: "2026-07-01T00:00:00.000Z"
      }),
    /marketOpen/
  );
  assert.throws(
    () =>
      parseMarketCalendarFixture({
        calendarId: "calendar.nyse.invalid",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-01-01",
        marketOpen: "2025-01-01T14:30:00.000Z",
        marketClose: null,
        isHoliday: true,
        sourceRefs: ["manual_calendar_fixture:NYSE:2025-01-01"],
        createdAt: "2026-07-01T00:00:00.000Z"
      }),
    /holiday fixture/
  );
});

test("market calendar index rejects duplicate exchange session dates", () => {
  const fixtures = parseMarketCalendarFixtures([
    {
      calendarId: "calendar.krx.first",
      exchange: "KRX",
      market: "KR",
      timezone: "Asia/Seoul",
      sessionDate: "2025-01-02",
      marketOpen: "2025-01-02T00:00:00.000Z",
      marketClose: "2025-01-02T06:30:00.000Z",
      isHoliday: false,
      sourceRefs: ["manual_calendar_fixture:KRX:2025-01-02:first"],
      createdAt: "2026-07-01T00:00:00.000Z"
    },
    {
      calendarId: "calendar.krx.second",
      exchange: "KRX",
      market: "KR",
      timezone: "Asia/Seoul",
      sessionDate: "2025-01-02",
      marketOpen: "2025-01-02T00:00:00.000Z",
      marketClose: "2025-01-02T06:30:00.000Z",
      isHoliday: false,
      sourceRefs: ["manual_calendar_fixture:KRX:2025-01-02:second"],
      createdAt: "2026-07-01T00:00:00.000Z"
    }
  ]);

  assert.throws(() => new MarketCalendarFixtureIndex(fixtures), /duplicate/);
});

test("market calendar index looks up fixture by exchange and sessionDate", () => {
  const fixtures = parseMarketCalendarFixtures([
    {
      calendarId: "calendar.krx.2025-01-02",
      exchange: "KRX",
      market: "KR",
      timezone: "Asia/Seoul",
      sessionDate: "2025-01-02",
      marketOpen: "2025-01-02T00:00:00.000Z",
      marketClose: "2025-01-02T06:30:00.000Z",
      isHoliday: false,
      sourceRefs: ["manual_calendar_fixture:KRX:2025-01-02"],
      createdAt: "2026-07-01T00:00:00.000Z"
    }
  ]);
  const index = new MarketCalendarFixtureIndex(fixtures);

  assert.equal(
    index.get({ exchange: "KRX", sessionDate: "2025-01-02" })?.calendarId,
    "calendar.krx.2025-01-02"
  );
  assert.equal(
    index.get({ exchange: "KRX", sessionDate: "2025-01-03" }),
    undefined
  );
});
