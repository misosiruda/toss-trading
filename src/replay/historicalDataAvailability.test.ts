import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { assessHistoricalDataAvailability } from "./historicalDataAvailability.js";
import { parseFxRateSnapshotFixture } from "./fxSnapshotFreshness.js";
import {
  parseMarketCalendarFixture,
  type MarketCalendarFixture
} from "./marketCalendar.js";

test("historical data availability summarizes window and symbol coverage", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_before", "005930", "2025-01-31T09:00:00+09:00"),
      snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_005930_002", "005930", "2025-02-03T09:01:00+09:00"),
      snapshot("hist_000660_001", "000660", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_005930_after", "005930", "2025-03-01T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minWindowSnapshots: 3,
    minSnapshotsPerRequiredSymbol: 1,
    requiredSymbols: [
      { market: "KR", symbol: "005930" },
      { market: "KR", symbol: "000660" }
    ]
  });

  assert.equal(report.status, "available");
  assert.equal(report.totalSnapshotCount, 5);
  assert.equal(report.windowSnapshotCount, 3);
  assert.equal(report.symbolCount, 2);
  assert.equal(report.requiredSymbolCount, 2);
  assert.equal(report.availableRequiredSymbolCount, 2);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(
    report.symbolSummaries.map((summary) => ({
      symbol: summary.symbol,
      totalSnapshotCount: summary.totalSnapshotCount,
      windowSnapshotCount: summary.windowSnapshotCount,
      required: summary.required,
      available: summary.available
    })),
    [
      {
        symbol: "000660",
        totalSnapshotCount: 1,
        windowSnapshotCount: 1,
        required: true,
        available: true
      },
      {
        symbol: "005930",
        totalSnapshotCount: 4,
        windowSnapshotCount: 2,
        required: true,
        available: true
      }
    ]
  );
});

test("historical data availability fails closed for missing window data", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_before", "005930", "2025-01-31T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00")
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.windowSnapshotCount, 0);
  assert.ok(report.issues.includes("WINDOW_SNAPSHOT_MISSING"));
  assert.ok(report.issues.includes("WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM"));
});

test("historical data availability reports required symbol gaps", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_000660_old", "000660", "2025-01-31T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minSnapshotsPerRequiredSymbol: 1,
    requiredSymbols: [
      { market: "KR", symbol: "005930" },
      { market: "KR", symbol: "000660" },
      { market: "KR", symbol: "035420" }
    ]
  });

  assert.equal(report.status, "insufficient");
  assert.deepEqual(report.missingRequiredSymbols, [
    { market: "KR", symbol: "035420" }
  ]);
  assert.deepEqual(
    report.insufficientRequiredSymbols.map((summary) => summary.symbol),
    ["000660"]
  );
  assert.ok(report.issues.includes("REQUIRED_SYMBOL_MISSING"));
  assert.ok(
    report.issues.includes("REQUIRED_SYMBOL_SNAPSHOT_COUNT_BELOW_MINIMUM")
  );
});

test("historical data availability treats corrupt snapshot lines as insufficient", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    corruptLineCount: 1
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.corruptLineCount, 1);
  assert.ok(report.issues.includes("CORRUPT_SNAPSHOT_LINES"));
});

test("historical data availability fails closed for calendar validation warnings", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_open", "005930", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_000660_holiday", "000660", "2025-02-04T10:00:00+09:00"),
      snapshot("hist_035420_missing", "035420", "2025-02-05T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-03T00:00:00+09:00"),
    windowEnd: new Date("2025-02-05T23:59:59.999+09:00"),
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "KRX",
          timezone: "Asia/Seoul"
        }
      ],
      fixtures: [
        calendarFixture({
          calendarId: "calendar.krx.2025-02-03",
          sessionDate: "2025-02-03",
          marketOpen: "2025-02-03T00:00:00.000Z",
          marketClose: "2025-02-03T06:30:00.000Z",
          isHoliday: false
        }),
        calendarFixture({
          calendarId: "calendar.krx.2025-02-04",
          sessionDate: "2025-02-04",
          marketOpen: null,
          marketClose: null,
          isHoliday: true,
          holidayName: "KRX holiday fixture"
        })
      ]
    }
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.windowSnapshotCount, 3);
  assert.ok(report.issues.includes("CALENDAR_HOLIDAY_SAMPLE"));
  assert.ok(report.issues.includes("CALENDAR_FIXTURE_MISSING"));
  assert.equal(report.calendarValidation?.checkedSnapshotCount, 3);
  assert.equal(report.calendarValidation?.rejectedSnapshotCount, 2);
  assert.equal(
    report.calendarValidation?.warningCounts.CALENDAR_HOLIDAY_SAMPLE,
    1
  );
  assert.equal(
    report.calendarValidation?.warningCounts.CALENDAR_FIXTURE_MISSING,
    1
  );
  assert.deepEqual(
    report.calendarValidation?.rejectedSnapshots.map((summary) => ({
      snapshotId: summary.snapshotId,
      exchange: summary.exchange,
      sessionDate: summary.sessionDate,
      status: summary.status,
      warningCodes: summary.warningCodes
    })),
    [
      {
        snapshotId: "hist_000660_holiday",
        exchange: "KRX",
        sessionDate: "2025-02-04",
        status: "holiday",
        warningCodes: ["CALENDAR_HOLIDAY_SAMPLE"]
      },
      {
        snapshotId: "hist_035420_missing",
        exchange: "KRX",
        sessionDate: "2025-02-05",
        status: "fixture_missing",
        warningCodes: ["CALENDAR_FIXTURE_MISSING"]
      }
    ]
  );
});

test("historical data availability rejects calendar fixtures with mismatched rule metadata", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_wrong_fixture", "005930", "2025-02-04T15:00:00.000Z")
    ],
    windowStart: new Date("2025-02-04T00:00:00.000Z"),
    windowEnd: new Date("2025-02-04T23:59:59.999Z"),
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "NYSE",
          timezone: "America/New_York"
        }
      ],
      fixtures: [
        parseMarketCalendarFixture({
          calendarId: "calendar.nyse.2025-02-04",
          exchange: "NYSE",
          market: "US",
          timezone: "America/New_York",
          sessionDate: "2025-02-04",
          marketOpen: "2025-02-04T14:30:00.000Z",
          marketClose: "2025-02-04T21:00:00.000Z",
          isHoliday: false,
          sourceRefs: ["manual_calendar_fixture:NYSE:2025-02-04"],
          createdAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    }
  });

  assert.equal(report.status, "insufficient");
  assert.ok(report.issues.includes("CALENDAR_FIXTURE_MISSING"));
  assert.equal(report.calendarValidation?.rejectedSnapshotCount, 1);
  assert.deepEqual(report.calendarValidation?.rejectedSnapshots, [
    {
      snapshotId: "hist_005930_wrong_fixture",
      market: "KR",
      symbol: "005930",
      observedAt: "2025-02-04T15:00:00.000Z",
      exchange: "NYSE",
      timezone: "America/New_York",
      sessionDate: "2025-02-04",
      calendarId: null,
      status: "fixture_missing",
      warningCodes: ["CALENDAR_FIXTURE_MISSING"]
    }
  ]);
});

test("historical data availability fails closed for FX validation warnings", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_spy_fresh", "SPY", "2025-01-02T14:30:00.000Z", {
        market: "US",
        sourceRefs: [
          "fixture:hist_spy_fresh",
          "yahoo_fx:KRW=X:2025-01-02"
        ]
      }),
      snapshot("hist_qqq_missing_fx", "QQQ", "2025-01-02T15:00:00.000Z", {
        market: "US",
        sourceRefs: ["fixture:hist_qqq_missing_fx"]
      }),
      snapshot("hist_005930_ignored", "005930", "2025-01-02T16:00:00.000Z"),
      snapshot("hist_iwm_stale_fx", "IWM", "2025-01-03T00:00:00.000Z", {
        market: "US",
        sourceRefs: [
          "fixture:hist_iwm_stale_fx",
          "yahoo_fx:KRW=X:2025-01-02"
        ]
      })
    ],
    windowStart: new Date("2025-01-02T00:00:00.000Z"),
    windowEnd: new Date("2025-01-03T00:00:00.000Z"),
    minWindowSnapshots: 1,
    fxValidation: {
      fixtures: [
        parseFxRateSnapshotFixture({
          fxId: "fx.usdkrw.2025-01-02",
          pair: "USD/KRW",
          sourceSymbol: "KRW=X",
          observedAt: "2025-01-02T00:00:00.000Z",
          rate: 1460.25,
          staleAfter: "2025-01-03T00:00:00.000Z",
          sourceRefs: ["yahoo_fx:KRW=X:2025-01-02"],
          createdAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    }
  });

  assert.equal(report.status, "insufficient");
  assert.ok(report.issues.includes("VIRTUAL_FX_MISSING"));
  assert.ok(report.issues.includes("VIRTUAL_FX_STALE"));
  assert.equal(report.fxValidation?.checkedSnapshotCount, 3);
  assert.equal(report.fxValidation?.rejectedSnapshotCount, 2);
  assert.equal(report.fxValidation?.warningCounts.VIRTUAL_FX_MISSING, 1);
  assert.equal(report.fxValidation?.warningCounts.VIRTUAL_FX_STALE, 1);
  assert.deepEqual(
    report.fxValidation?.rejectedSnapshots.map((summary) => ({
      snapshotId: summary.snapshotId,
      sourceRef: summary.sourceRef,
      status: summary.status,
      warningCodes: summary.warningCodes
    })),
    [
      {
        snapshotId: "hist_qqq_missing_fx",
        sourceRef: null,
        status: "missing",
        warningCodes: ["VIRTUAL_FX_MISSING"]
      },
      {
        snapshotId: "hist_iwm_stale_fx",
        sourceRef: "yahoo_fx:KRW=X:2025-01-02",
        status: "stale",
        warningCodes: ["VIRTUAL_FX_STALE"]
      }
    ]
  );
});

test("historical data availability rejects invalid options", () => {
  assert.throws(
    () =>
      assessHistoricalDataAvailability({
        snapshots: [],
        windowStart: new Date("2025-03-01T00:00:00+09:00"),
        windowEnd: new Date("2025-02-01T00:00:00+09:00")
      }),
    /windowStart/
  );

  assert.throws(
    () =>
      assessHistoricalDataAvailability({
        snapshots: [],
        windowStart: new Date("2025-02-01T00:00:00+09:00"),
        windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
        minWindowSnapshots: -1
      }),
    /minWindowSnapshots/
  );

  assert.throws(
    () =>
      assessHistoricalDataAvailability({
        snapshots: [],
        windowStart: new Date("2025-02-01T00:00:00+09:00"),
        windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
        calendarValidation: {
          rules: [],
          fixtures: []
        }
      }),
    /calendarValidation\.rules/
  );
});

function snapshot(
  snapshotId: string,
  symbol: string,
  observedAt: string,
  options: {
    market?: HistoricalMarketSnapshot["market"];
    sourceRefs?: string[];
  } = {}
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: options.market ?? "KR",
    symbol,
    observedAt,
    interval: "1m",
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: options.sourceRefs ?? [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function calendarFixture(input: {
  calendarId: string;
  sessionDate: string;
  marketOpen: string | null;
  marketClose: string | null;
  isHoliday: boolean;
  holidayName?: string | undefined;
}): MarketCalendarFixture {
  return parseMarketCalendarFixture({
    calendarId: input.calendarId,
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate: input.sessionDate,
    marketOpen: input.marketOpen,
    marketClose: input.marketClose,
    isHoliday: input.isHoliday,
    ...(input.holidayName === undefined
      ? {}
      : { holidayName: input.holidayName }),
    sourceRefs: [`manual_calendar_fixture:KRX:${input.sessionDate}`],
    createdAt: "2026-07-01T00:00:00.000Z"
  });
}
