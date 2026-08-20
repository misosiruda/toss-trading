import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import { verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";
import { verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics } from "./officialMarketCalendarKrxHolidayDataResponseBody.js";

const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

test("KRX holiday response semantics returns only an observed-row summary", () => {
  const bytes = encodeBody({
    block1: [
      validRow("2026-01-01", "신정", "New Year's Day"),
      validRow("2026-02-16", "설날", "")
    ]
  });
  const original = bytes.slice();
  const summary = verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
    bytes,
    verifiedMetadata(bytes.byteLength),
    "2026"
  );

  assert.deepEqual(bytes, original);
  assert.deepEqual(summary, {
    responseSemanticsVersion: "krx_holiday_data_response_semantics.v1",
    responseBodyVersion: "krx_holiday_data_response_body.v1",
    rowPolicyVersion: "krx_holiday_data_row_semantics_2016_2026.v1",
    targetYear: "2026",
    bodyByteLength: bytes.byteLength,
    rowCount: 2,
    englishHolidayNameEmptyCount: 1,
    dateRangeCoverage: "observed_rows_only",
    datesTargetYearValidated: true,
    datesStrictlyAscending: true,
    duplicateDateCount: 0,
    calendarDayBindingValidated: true,
    weekdayBindingValidated: true,
    holidayNamesValidated: true,
    returnedRowValues: false,
    historicalCompletenessClaim: "not_claimed",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.doesNotMatch(JSON.stringify(summary), /신정|New Year's Day/);
});

test("KRX holiday response semantics binds canonical dates to target year", () => {
  for (const [date, targetYear] of [
    ["2026-02-30", "2026"],
    ["2025-01-01", "2026"],
    ["2026/01/01", "2026"]
  ] as const) {
    assertInvalidRow({ ...validRow("2026-01-01"), calnd_dd: date }, targetYear);
  }
  const bytes = encodeBody({ block1: [validRow("2026-01-01")] });
  assert.throws(() =>
    verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
      bytes,
      verifiedMetadata(bytes.byteLength),
      "2015"
    )
  );
});

test("KRX holiday response semantics binds calendar-day field to date", () => {
  assertInvalidRow({
    ...validRow("2026-01-01"),
    calnd_dd_dy: "2026-01-02"
  });
});

test("KRX holiday response semantics binds weekday code to date", () => {
  for (const dy_tp_cd of ["FRI", "THURSDAY", ""] as const) {
    assertInvalidRow({ ...validRow("2026-01-01"), dy_tp_cd });
  }
});

test("KRX holiday response semantics requires safe Korean names", () => {
  for (const kr_dy_tp of ["", " 신정", "신정 ", "신정\n휴일"]) {
    assertInvalidRow({ ...validRow("2026-01-01"), kr_dy_tp });
  }
});

test("KRX holiday response semantics allows empty English names only when trimmed", () => {
  const empty = encodeBody({
    block1: [validRow("2026-01-01", "신정", "")]
  });
  assert.equal(
    verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
      empty,
      verifiedMetadata(empty.byteLength),
      "2026"
    ).englishHolidayNameEmptyCount,
    1
  );
  for (const holdy_eng_nm of [" Holiday", "Holiday ", "Holiday\tName"]) {
    assertInvalidRow({ ...validRow("2026-01-01"), holdy_eng_nm });
  }
});

test("KRX holiday response semantics rejects duplicate and unordered dates", () => {
  for (const rows of [
    [validRow("2026-01-01"), validRow("2026-01-01")],
    [validRow("2026-02-16"), validRow("2026-01-01")]
  ]) {
    const bytes = encodeBody({ block1: rows });
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
        bytes,
        verifiedMetadata(bytes.byteLength),
        "2026"
      )
    );
  }
});

test("KRX holiday response semantics retains body shape and length gates", () => {
  const duplicateJson = new TextEncoder().encode(
    `{"block1":[{"calnd_dd":"2026-01-01","calnd_dd":"2026-01-02","dy_tp_cd":"THU","calnd_dd_dy":"2026-01-01","kr_dy_tp":"신정","holdy_eng_nm":""}]}`
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
        duplicateJson,
        verifiedMetadata(duplicateJson.byteLength),
        "2026"
      ),
    /duplicate JSON member names/
  );

  const bytes = encodeBody({ block1: [validRow("2026-01-01")] });
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
        bytes,
        verifiedMetadata(bytes.byteLength + 1),
        "2026"
      ),
    /length must match verified transfer metadata/
  );
});

test("KRX holiday response semantics accepts each registered target year", () => {
  for (let year = 2026; year >= 2016; year -= 1) {
    const targetYear = String(year);
    const date = `${targetYear}-01-01`;
    const bytes = encodeBody({ block1: [validRow(date)] });
    const summary = verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
      bytes,
      verifiedMetadata(bytes.byteLength),
      targetYear
    );
    assert.equal(summary.targetYear, targetYear);
  }
});

function assertInvalidRow(row: Record<string, unknown>, targetYear = "2026"): void {
  const bytes = encodeBody({ block1: [row] });
  assert.throws(() =>
    verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
      bytes,
      verifiedMetadata(bytes.byteLength),
      targetYear
    )
  );
}

function encodeBody(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

function validRow(
  date: string,
  kr_dy_tp = "휴장일",
  holdy_eng_nm = "Holiday"
) {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return {
    calnd_dd: date,
    dy_tp_cd: WEEKDAY_CODES[new Date(timestamp).getUTCDay()]!,
    calnd_dd_dy: date,
    kr_dy_tp,
    holdy_eng_nm
  };
}

function verifiedMetadata(contentLength: number) {
  return verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
    requestIsolation: {
      automaticRedirectFollow: false,
      cookieJarEnabled: false,
      requestCookieHeaderCount: 0
    },
    responseUrl:
      "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx",
    httpStatus: 200,
    redirectLocationHeaderValues: [],
    contentTypeHeaderValues: ["text/html; charset=UTF-8"],
    contentEncodingHeaderValues: [],
    transferEncodingHeaderValues: [],
    pragmaHeaderValues: ["no-cache"],
    setCookieHeaderCount: 2,
    responseCacheHeaders: {
      dateHeaderValues: ["Thu, 20 Aug 2026 05:33:51 GMT"],
      ageHeaderValues: [],
      expiresHeaderValues: ["Thu, 20 Aug 2026 05:33:51 GMT"]
    },
    responseCacheControl: {
      cacheControlHeaderValues: ["no-store, no-cache, max-age=0"]
    },
    transferCompletion: {
      httpProtocolVersion: "http_1_1",
      transferFraming: "content_length",
      transferCompleted: true,
      declaredContentLength: contentLength,
      contentLength
    }
  });
}
