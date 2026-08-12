import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
  officialBrokerObservedCalendarResponseSchema,
  parseOfficialBrokerObservedCalendarResponse
} from "./officialBrokerObservedCalendarResponse.js";

test("normalizes synthetic KR business-day response in canonical order", () => {
  const result = parseOfficialBrokerObservedCalendarResponse(krResponse(), {
    market: "KR",
    requestedDate: "2026-03-25"
  });

  assert.equal(
    result.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
  );
  assert.equal(result.sourceEvidenceClass, "official_broker_observed");
  assert.deepEqual(
    result.days.map(({ relation, marketDate, status }) => ({
      relation,
      marketDate,
      status
    })),
    [
      {
        relation: "previous_business_day",
        marketDate: "2026-03-24",
        status: "open"
      },
      { relation: "today", marketDate: "2026-03-25", status: "open" },
      {
        relation: "next_business_day",
        marketDate: "2026-03-26",
        status: "open"
      }
    ]
  );
  assert.deepEqual(result.days[1].sessions, [
    {
      sessionType: "pre_market",
      startAt: "2026-03-24T23:00:00.000Z",
      endAt: "2026-03-25T00:00:00.000Z",
      singlePriceAuctionStartAt: "2026-03-24T23:50:00.000Z",
      singlePriceAuctionEndAt: null
    },
    {
      sessionType: "regular_market",
      startAt: "2026-03-25T00:00:00.000Z",
      endAt: "2026-03-25T06:30:00.000Z",
      singlePriceAuctionStartAt: "2026-03-25T06:20:00.000Z",
      singlePriceAuctionEndAt: null
    },
    {
      sessionType: "after_market",
      startAt: "2026-03-25T06:30:00.000Z",
      endAt: "2026-03-25T11:00:00.000Z",
      singlePriceAuctionStartAt: null,
      singlePriceAuctionEndAt: "2026-03-25T06:40:00.000Z"
    }
  ]);
});

test("normalizes KR closure and nullable partial-session operation", () => {
  const response = krResponse();
  response.result.today.integrated = null;
  response.result.nextBusinessDay.integrated = {
    ...krIntegrated("2026-03-26"),
    preMarket: null
  };

  const result = parseOfficialBrokerObservedCalendarResponse(response, {
    market: "KR",
    requestedDate: "2026-03-25"
  });

  assert.deepEqual(result.days[1], {
    relation: "today",
    marketDate: "2026-03-25",
    status: "closed",
    sessions: []
  });
  assert.deepEqual(
    result.days[2].sessions.map(({ sessionType }) => sessionType),
    ["regular_market", "after_market"]
  );
});

test("normalizes synthetic US sessions and closure without exchange claims", () => {
  const response = usResponse();
  response.result.today = usDay("2026-03-25", true);

  const result = parseOfficialBrokerObservedCalendarResponse(response, {
    market: "US",
    requestedDate: "2026-03-25"
  });

  assert.equal(result.days[1].status, "closed");
  assert.deepEqual(result.days[1].sessions, []);
  assert.deepEqual(
    result.days[0].sessions.map(({ sessionType }) => sessionType),
    ["day_market", "pre_market", "regular_market", "after_market"]
  );
  assert.deepEqual(result.days[0].sessions[2], {
    sessionType: "regular_market",
    startAt: "2026-03-24T13:30:00.000Z",
    endAt: "2026-03-24T20:00:00.000Z",
    singlePriceAuctionStartAt: null,
    singlePriceAuctionEndAt: null
  });
});

test("rejects missing and unknown response fields", () => {
  const missingDay = structuredClone(krResponse());
  delete (missingDay.result as Record<string, unknown>)["nextBusinessDay"];
  assert.throws(() =>
    parseOfficialBrokerObservedCalendarResponse(missingDay, {
      market: "KR",
      requestedDate: "2026-03-25"
    })
  );

  const missingSession = structuredClone(krResponse());
  delete (
    missingSession.result.today.integrated as unknown as Record<string, unknown>
  )["afterMarket"];
  assert.throws(() =>
    parseOfficialBrokerObservedCalendarResponse(missingSession, {
      market: "KR",
      requestedDate: "2026-03-25"
    })
  );

  assert.throws(() =>
    parseOfficialBrokerObservedCalendarResponse(
      { ...krResponse(), unexpected: true },
      { market: "KR", requestedDate: "2026-03-25" }
    )
  );
});

test("rejects requested-date mismatch and non-chronological days", () => {
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(krResponse(), {
        market: "KR",
        requestedDate: "2026-03-24"
      }),
    /requestedDate must match returned today date/
  );

  const duplicateDate = krResponse();
  duplicateDate.result.nextBusinessDay.date = "2026-03-25";
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(duplicateDate, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /strictly chronological/
  );
});

test("binds KR and overnight US sessions to each returned market date", () => {
  const wrongKrDay = krResponse();
  wrongKrDay.result.today.integrated = krIntegrated("2026-03-24");
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(wrongKrDay, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /must match marketDate KST relationship/
  );

  const wrongUsDay = usResponse();
  wrongUsDay.result.today = usDay("2026-03-24");
  wrongUsDay.result.today.date = "2026-03-25";
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(wrongUsDay, {
        market: "US",
        requestedDate: "2026-03-25"
      }),
    /must match marketDate KST relationship/
  );

  const validUs = parseOfficialBrokerObservedCalendarResponse(usResponse(), {
    market: "US",
    requestedDate: "2026-03-25"
  });
  assert.equal(
    validUs.days[1].sessions.find(
      ({ sessionType }) => sessionType === "regular_market"
    )?.endAt,
    "2026-03-25T20:00:00.000Z"
  );
  assert.equal(
    validUs.days[1].sessions.find(
      ({ sessionType }) => sessionType === "after_market"
    )?.startAt,
    "2026-03-25T20:00:00.000Z"
  );
});

test("rejects session overlap across returned US market days", () => {
  const response = usResponse();
  response.result.previousBusinessDay.afterMarket!.endTime =
    "2026-03-25T10:00:00+09:00";

  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(response, {
        market: "US",
        requestedDate: "2026-03-25"
      }),
    /returned market-day sessions must not overlap/
  );
});

test("rejects zero-length KR auction intervals in raw and normalized responses", () => {
  const zeroStartInterval = krResponse();
  zeroStartInterval.result.today.integrated!.regularMarket!.singlePriceAuctionStartTime =
    zeroStartInterval.result.today.integrated!.regularMarket!.endTime;
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(zeroStartInterval, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /must remain inside session/
  );

  const normalized = parseOfficialBrokerObservedCalendarResponse(krResponse(), {
    market: "KR",
    requestedDate: "2026-03-25"
  });
  const afterMarket = normalized.days[1].sessions[2]!;
  afterMarket.singlePriceAuctionEndAt = afterMarket.startAt;
  assert.equal(
    officialBrokerObservedCalendarResponseSchema.safeParse(normalized).success,
    false
  );
});

test("rejects malformed, inverted, and overlapping session timestamps", () => {
  const missingOffset = krResponse();
  missingOffset.result.today.integrated!.regularMarket!.startTime =
    "2026-03-25T09:00:00";
  assert.throws(() =>
    parseOfficialBrokerObservedCalendarResponse(missingOffset, {
      market: "KR",
      requestedDate: "2026-03-25"
    })
  );

  const wrongOffset = krResponse();
  wrongOffset.result.today.integrated!.regularMarket!.startTime =
    "2026-03-25T00:00:00Z";
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(wrongOffset, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /KST \+09:00/
  );

  const inverted = krResponse();
  inverted.result.today.integrated!.regularMarket!.endTime =
    "2026-03-25T08:00:00+09:00";
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(inverted, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /startTime must be before endTime/
  );

  const overlapping = krResponse();
  overlapping.result.today.integrated!.afterMarket!.startTime =
    "2026-03-25T15:00:00+09:00";
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(overlapping, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /must not overlap/
  );
});

test("rejects ambiguous all-null KR integrated object and cross-market shape", () => {
  const allNull = krResponse();
  allNull.result.today.integrated = {
    preMarket: null,
    regularMarket: null,
    afterMarket: null
  };
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarResponse(allNull, {
        market: "KR",
        requestedDate: "2026-03-25"
      }),
    /integrated market must be null/
  );

  assert.throws(() =>
    parseOfficialBrokerObservedCalendarResponse(usResponse(), {
      market: "KR",
      requestedDate: "2026-03-25"
    })
  );
});

test("normalized response schema rejects broker-to-exchange promotion", () => {
  const result = parseOfficialBrokerObservedCalendarResponse(krResponse(), {
    market: "KR",
    requestedDate: "2026-03-25"
  });
  assert.equal(
    officialBrokerObservedCalendarResponseSchema.safeParse({
      ...result,
      sourceEvidenceClass: "official_exchange"
    }).success,
    false
  );

  const inverted = structuredClone(result);
  inverted.days[0].sessions[0]!.endAt =
    inverted.days[0].sessions[0]!.startAt;
  assert.equal(
    officialBrokerObservedCalendarResponseSchema.safeParse(inverted).success,
    false
  );

  const invalidAuction = structuredClone(result);
  invalidAuction.days[0].sessions[0]!.singlePriceAuctionStartAt =
    "2026-03-24T01:00:00.000Z";
  assert.equal(
    officialBrokerObservedCalendarResponseSchema.safeParse(invalidAuction)
      .success,
    false
  );
});

test("normalized response schema rejects invalid canonical UTC timestamps without throwing", () => {
  const result = parseOfficialBrokerObservedCalendarResponse(krResponse(), {
    market: "KR",
    requestedDate: "2026-03-25"
  });

  for (const timestamp of [
    "2026-03-24T99:99:99.999Z",
    "2026-03-24T24:00:00.000Z"
  ]) {
    const malformed = structuredClone(result);
    malformed.days[0].sessions[0]!.startAt = timestamp;
    let success: boolean | undefined;
    assert.doesNotThrow(() => {
      success =
        officialBrokerObservedCalendarResponseSchema.safeParse(
          malformed
        ).success;
    });
    assert.equal(success, false);
  }
});

test("normalized response schema rejects unsupported auction fields", () => {
  const kr = parseOfficialBrokerObservedCalendarResponse(krResponse(), {
    market: "KR",
    requestedDate: "2026-03-25"
  });
  kr.days[0].sessions[2]!.singlePriceAuctionStartAt =
    kr.days[0].sessions[2]!.startAt;
  assert.equal(
    officialBrokerObservedCalendarResponseSchema.safeParse(kr).success,
    false
  );

  const us = parseOfficialBrokerObservedCalendarResponse(usResponse(), {
    market: "US",
    requestedDate: "2026-03-25"
  });
  us.days[0].sessions[0]!.singlePriceAuctionStartAt =
    us.days[0].sessions[0]!.startAt;
  assert.equal(
    officialBrokerObservedCalendarResponseSchema.safeParse(us).success,
    false
  );
});

interface KrMarketDayFixture {
  date: string;
  integrated: KrIntegratedFixture | null;
}

interface KrResponseFixture {
  result: {
    today: KrMarketDayFixture;
    previousBusinessDay: KrMarketDayFixture;
    nextBusinessDay: KrMarketDayFixture;
  };
}

function krResponse(): KrResponseFixture {
  return {
    result: {
      today: { date: "2026-03-25", integrated: krIntegrated("2026-03-25") },
      previousBusinessDay: {
        date: "2026-03-24",
        integrated: krIntegrated("2026-03-24")
      },
      nextBusinessDay: {
        date: "2026-03-26",
        integrated: krIntegrated("2026-03-26")
      }
    }
  };
}

interface KrIntegratedFixture {
  preMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  } | null;
  regularMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  } | null;
  afterMarket: {
    startTime: string;
    singlePriceAuctionEndTime: string;
    endTime: string;
  } | null;
}

function krIntegrated(date: string): KrIntegratedFixture {
  return {
    preMarket: {
      startTime: `${date}T08:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T08:50:00+09:00`,
      endTime: `${date}T09:00:00+09:00`
    },
    regularMarket: {
      startTime: `${date}T09:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T15:20:00+09:00`,
      endTime: `${date}T15:30:00+09:00`
    },
    afterMarket: {
      startTime: `${date}T15:30:00+09:00`,
      singlePriceAuctionEndTime: `${date}T15:40:00+09:00`,
      endTime: `${date}T20:00:00+09:00`
    }
  };
}

function usResponse() {
  return {
    result: {
      today: usDay("2026-03-25"),
      previousBusinessDay: usDay("2026-03-24"),
      nextBusinessDay: usDay("2026-03-26")
    }
  };
}

function usDay(date: string, closed = false) {
  if (closed) {
    return {
      date,
      dayMarket: null,
      preMarket: null,
      regularMarket: null,
      afterMarket: null
    };
  }
  const nextDate = nextCalendarDate(date);
  return {
    date,
    dayMarket: session(date, "09:00:00", date, "16:50:00"),
    preMarket: session(date, "17:00:00", date, "22:30:00"),
    regularMarket: session(date, "22:30:00", nextDate, "05:00:00"),
    afterMarket: session(nextDate, "05:00:00", nextDate, "07:00:00")
  };
}

function session(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
) {
  return {
    startTime: `${startDate}T${startTime}+09:00`,
    endTime: `${endDate}T${endTime}+09:00`
  };
}

function nextCalendarDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
