import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_COMPATIBILITY_SCHEMA_VERSION,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256,
  officialTossOpenApiCalendarCompatibilityResultSchema,
  verifyOfficialTossOpenApiCalendarCompatibility as verifyUntrustedCompatibility
} from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import { OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION } from "./officialBrokerObservedCalendarResponse.js";

const PINNED_OPENAPI_BYTES = readFileSync(
  "src/replay/officialTossCalendarOpenApi-1.2.14.json"
);
const PINNED_OPENAPI_DOCUMENT = JSON.parse(
  PINNED_OPENAPI_BYTES.toString("utf8")
) as {
  paths: Record<
    string,
    {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                examples: Record<string, { value: unknown }>;
              };
            };
          };
        };
      };
    }
  >;
};

function pinnedExample(market: "KR" | "US", name: string): unknown {
  return PINNED_OPENAPI_DOCUMENT.paths[
    `/api/v1/market-calendar/${market}`
  ]!.get.responses["200"].content["application/json"].examples[name]!.value;
}

function verifyPinnedCompatibility(value: Record<string, unknown>) {
  return verifyUntrustedCompatibility({
    ...value,
    rawOpenApiDocumentBytes: PINNED_OPENAPI_BYTES
  });
}

const OPENAPI_EXAMPLE_CASES = [
  {
    name: "KR businessDay",
    market: "KR" as const,
    requestedDate: "2026-03-25",
    response: pinnedExample("KR", "businessDay"),
    todayStatus: "open",
    todaySessionTypes: ["pre_market", "regular_market", "after_market"],
    operation: {
      path: "/api/v1/market-calendar/KR",
      operationId: "getKrMarketCalendar",
      responseSchemaRef: "#/components/schemas/KrMarketCalendarResponse"
    }
  },
  {
    name: "KR holidayToday",
    market: "KR" as const,
    requestedDate: "2026-05-05",
    response: pinnedExample("KR", "holidayToday"),
    todayStatus: "closed",
    todaySessionTypes: [],
    operation: {
      path: "/api/v1/market-calendar/KR",
      operationId: "getKrMarketCalendar",
      responseSchemaRef: "#/components/schemas/KrMarketCalendarResponse"
    }
  },
  {
    name: "KR nxtPreMarketHoliday",
    market: "KR" as const,
    requestedDate: "2026-03-25",
    response: pinnedExample("KR", "nxtPreMarketHoliday"),
    todayStatus: "open",
    todaySessionTypes: ["regular_market", "after_market"],
    operation: {
      path: "/api/v1/market-calendar/KR",
      operationId: "getKrMarketCalendar",
      responseSchemaRef: "#/components/schemas/KrMarketCalendarResponse"
    }
  },
  {
    name: "US businessDay",
    market: "US" as const,
    requestedDate: "2026-03-25",
    response: pinnedExample("US", "businessDay"),
    todayStatus: "open",
    todaySessionTypes: [
      "day_market",
      "pre_market",
      "regular_market",
      "after_market"
    ],
    operation: {
      path: "/api/v1/market-calendar/US",
      operationId: "getUsMarketCalendar",
      responseSchemaRef: "#/components/schemas/UsMarketCalendarResponse"
    }
  },
  {
    name: "US holidayToday",
    market: "US" as const,
    requestedDate: "2026-07-03",
    response: pinnedExample("US", "holidayToday"),
    todayStatus: "closed",
    todaySessionTypes: [],
    operation: {
      path: "/api/v1/market-calendar/US",
      operationId: "getUsMarketCalendar",
      responseSchemaRef: "#/components/schemas/UsMarketCalendarResponse"
    }
  }
] as const;

for (const fixture of OPENAPI_EXAMPLE_CASES) {
  test(`accepts OpenAPI 1.2.14 ${fixture.name} example-derived bytes`, () => {
    const result = verifyPinnedCompatibility({
      market: fixture.market,
      requestedDate: fixture.requestedDate,
      rawResponseBytes: bytes(fixture.response)
    });

    assert.equal(
      result.schemaVersion,
      OFFICIAL_TOSS_OPEN_API_CALENDAR_COMPATIBILITY_SCHEMA_VERSION
    );
    assert.equal(result.mode, "paper_only");
    assert.equal(result.sourceEvidenceClass, "official_broker_observed");
    assert.equal(result.replayEvidenceClass, "observed_session_only");
    assert.equal(result.compatibilityStatus, "compatible");
    assert.equal(result.compatibilityScope, "pinned_document_examples_only");
    assert.equal(
      result.evidenceHandoffStatus,
      "blocked_pending_version_aware_evidence"
    );
    assert.equal(result.providerDeploymentVersion, "not_claimed");
    assert.equal(
      result.apiContract.apiContractVersion,
      OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION
    );
    assert.equal(
      result.apiContract.documentSha256,
      OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256
    );
    assert.equal(
      result.apiContract.responseParserContractVersion,
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
    );
    assert.equal(result.apiContract.operation.market, fixture.market);
    assert.equal(result.apiContract.operation.method, "GET");
    assert.equal(result.apiContract.operation.path, fixture.operation.path);
    assert.equal(
      result.apiContract.operation.operationId,
      fixture.operation.operationId
    );
    assert.equal(
      result.apiContract.operation.responseSchemaRef,
      fixture.operation.responseSchemaRef
    );
    assert.equal(result.response.days[1].status, fixture.todayStatus);
    assert.deepEqual(
      result.response.days[1].sessions.map(({ sessionType }) => sessionType),
      fixture.todaySessionTypes
    );
    assert.equal(Object.hasOwn(result, "rawResponseBytes"), false);
    assert.equal(Object.hasOwn(result, "artifactHash"), false);
  });
}

test("calendar compatibility gate rejects unverified OpenAPI document bytes", () => {
  assert.throws(
    () =>
      verifyUntrustedCompatibility({
        market: "KR",
        requestedDate: "2026-03-25",
        rawOpenApiDocumentBytes: bytes({ openapi: "3.1.0" }),
        rawResponseBytes: bytes(krResponse("2026-03-24", "2026-03-25", "2026-03-26"))
      }),
    /snapshot hash mismatch/
  );
});

test("calendar compatibility matches pinned examples independent of object order", () => {
  const example = pinnedExample("KR", "businessDay") as {
    result: Record<string, unknown>;
  };
  const reordered = {
    result: {
      previousBusinessDay: example.result.previousBusinessDay,
      today: example.result.today,
      nextBusinessDay: example.result.nextBusinessDay
    }
  };

  assert.equal(
    verifyPinnedCompatibility({
      market: "KR",
      requestedDate: "2026-03-25",
      rawResponseBytes: bytes(reordered)
    }).compatibilityStatus,
    "compatible"
  );
});

test("calendar compatibility gate rejects malformed byte inputs", () => {
  const base = {
    market: "KR",
    requestedDate: "2026-03-25"
  } as const;

  assert.throws(
    () =>
      verifyPinnedCompatibility({
        ...base,
        rawResponseBytes: new Uint8Array()
      }),
    /must be non-empty/
  );
  assert.throws(
    () =>
      verifyPinnedCompatibility({
        ...base,
        rawResponseBytes: new Uint8Array([0xc3, 0x28])
      }),
    /must be valid UTF-8/
  );
  assert.throws(
    () =>
      verifyPinnedCompatibility({
        ...base,
        rawResponseBytes: new TextEncoder().encode("{")
      }),
    /must be valid JSON/
  );
  assert.throws(() =>
      verifyPinnedCompatibility({
      ...base,
      rawResponseBytes: bytes(
        krResponse("2026-03-24", "2026-03-25", "2026-03-26")
      ),
      unexpected: true
    })
  );
});

test("calendar compatibility gate rejects schema and request binding mismatches", () => {
  const response = krResponse("2026-03-24", "2026-03-25", "2026-03-26");
  const unknownField = structuredClone(response) as unknown as Record<
    string,
    unknown
  >;
  unknownField["unexpected"] = true;

  assert.throws(() =>
    verifyPinnedCompatibility({
      market: "KR",
      requestedDate: "2026-03-25",
      rawResponseBytes: bytes(unknownField)
    })
  );
  assert.throws(
    () =>
      verifyPinnedCompatibility({
        market: "KR",
        requestedDate: "2026-03-24",
        rawResponseBytes: bytes(response)
      }),
    /requestedDate must match returned today date/
  );
  assert.throws(() =>
    verifyPinnedCompatibility({
      market: "US",
      requestedDate: "2026-03-25",
      rawResponseBytes: bytes(response)
    })
  );
});

test("calendar compatibility result rejects identity drift and evidence promotion", () => {
  const result = verifyPinnedCompatibility({
    market: "KR",
    requestedDate: "2026-03-25",
    rawResponseBytes: bytes(pinnedExample("KR", "businessDay"))
  });

  for (const tampered of [
    { ...result, sourceEvidenceClass: "official_exchange" },
    { ...result, replayEvidenceClass: "official_exchange" },
    { ...result, evidenceHandoffStatus: "ready" },
    { ...result, providerDeploymentVersion: "1.2.14" },
    {
      ...result,
      apiContract: { ...result.apiContract, apiContractVersion: "1.2.13" }
    },
    {
      ...result,
      apiContract: {
        ...result.apiContract,
        documentSha256: `sha256:${"0".repeat(64)}`
      }
    },
    {
      ...result,
      apiContract: {
        ...result.apiContract,
        responseParserContractVersion:
          "official_broker_observed_calendar_response.v2"
      }
    },
    {
      ...result,
      apiContract: {
        ...result.apiContract,
        operation: {
          ...result.apiContract.operation,
          path: "/api/v1/market-calendar/US"
        }
      }
    },
    { ...result, unexpected: true }
  ]) {
    assert.equal(
      officialTossOpenApiCalendarCompatibilityResultSchema.safeParse(tampered)
        .success,
      false
    );
  }
});

interface KrIntegratedFixture {
  preMarket: KrPreOrRegularSessionFixture | null;
  regularMarket: KrPreOrRegularSessionFixture | null;
  afterMarket: KrAfterMarketSessionFixture | null;
}

interface KrPreOrRegularSessionFixture {
  startTime: string;
  singlePriceAuctionStartTime: string;
  endTime: string;
}

interface KrAfterMarketSessionFixture {
  startTime: string;
  singlePriceAuctionEndTime: string;
  endTime: string;
}

function krResponse(
  previousDate: string,
  todayDate: string,
  nextDate: string,
  todayIntegrated: KrIntegratedFixture | null = krIntegrated(todayDate)
) {
  return {
    result: {
      today: { date: todayDate, integrated: todayIntegrated },
      previousBusinessDay: {
        date: previousDate,
        integrated: krIntegrated(previousDate)
      },
      nextBusinessDay: {
        date: nextDate,
        integrated: krIntegrated(nextDate)
      }
    }
  };
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

function usResponse(
  previousDate: string,
  todayDate: string,
  nextDate: string,
  todayClosed = false
) {
  return {
    result: {
      today: usDay(todayDate, todayClosed),
      previousBusinessDay: usDay(previousDate),
      nextBusinessDay: usDay(nextDate)
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

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
