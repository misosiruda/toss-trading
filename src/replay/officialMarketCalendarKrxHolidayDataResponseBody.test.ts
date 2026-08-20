import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import { verifyOfficialMarketCalendarKrxHolidayDataResponseBody } from "./officialMarketCalendarKrxHolidayDataResponseBody.js";
import { verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

test("KRX holiday response body returns only a non-reusable shape summary", () => {
  const bytes = encodeBody(validBody());
  const original = bytes.slice();
  const shape = verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
    bytes,
    verifiedMetadata(bytes.byteLength)
  );

  assert.deepEqual(bytes, original);
  assert.deepEqual(shape, {
    responseBodyVersion: "krx_holiday_data_response_body.v1",
    responseMetadataVersion: "krx_holiday_data_response_metadata.v1",
    bodyByteLength: bytes.byteLength,
    topLevelKey: "block1",
    rowCount: 2,
    rowKeys: [
      "calnd_dd",
      "dy_tp_cd",
      "calnd_dd_dy",
      "kr_dy_tp",
      "holdy_eng_nm"
    ],
    rowValueType: "string",
    bodyShapeValidated: true,
    returnedRowValues: false,
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  });
  assert.equal(Object.isFrozen(shape), true);
  assert.equal(Object.isFrozen(shape.rowKeys), true);
  assert.doesNotMatch(JSON.stringify(shape), /New Year's Day|신정/);
});

test("KRX holiday response body binds exact transfer content length", () => {
  const bytes = encodeBody(validBody());
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
        bytes,
        verifiedMetadata(bytes.byteLength + 1)
      ),
    /length must match verified transfer metadata/
  );
});

test("KRX holiday response body requires attached Uint8Array input", () => {
  const bytes = encodeBody(validBody());
  const metadata = verifiedMetadata(bytes.byteLength);
  assert.throws(
    () => verifyOfficialMarketCalendarKrxHolidayDataResponseBody("{}", metadata),
    /must be a Uint8Array/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
        new Proxy(bytes, {}),
        metadata
      ),
    /must be an attached Uint8Array/
  );

  const detached = bytes.slice();
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseBody(detached, metadata),
    /must be an attached Uint8Array/
  );
});

test("KRX holiday response body rejects BOM, invalid UTF-8, and malformed JSON", () => {
  for (const bytes of [
    new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode('{"block1":[')
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
        bytes,
        verifiedMetadata(bytes.byteLength)
      )
    );
  }
});

test("KRX holiday response body requires exact top-level block1 shape", () => {
  for (const body of [
    {},
    { block1: validBody().block1, extra: true },
    { block1: "not-an-array" }
  ]) {
    assertInvalidBody(body);
  }
});

test("KRX holiday response body requires a bounded non-empty row array", () => {
  assertInvalidBody({ block1: [] });
  assertInvalidBody({
    block1: Array.from({ length: 1_001 }, () => validRow())
  });
});

test("KRX holiday response body requires exact row keys and string values", () => {
  const row = validRow();
  const { holdy_eng_nm: _removed, ...missingKey } = row;
  for (const invalidRow of [
    missingKey,
    { ...row, unexpected: "value" },
    { ...row, calnd_dd: 20260101 },
    { ...row, holdy_eng_nm: null }
  ]) {
    assertInvalidBody({ block1: [invalidRow] });
  }
});

test("KRX holiday response body rejects duplicate decoded JSON member names", () => {
  for (const text of [
    `{"block1":[],"block1":[${JSON.stringify(validRow())}]}`,
    `{"block1":[{"calnd_dd":"first","calnd_dd":"second","dy_tp_cd":"1","calnd_dd_dy":"date","kr_dy_tp":"holiday","holdy_eng_nm":"holiday"}]}`,
    `{"block1":[],"\\u0062lock1":[${JSON.stringify(validRow())}]}`
  ]) {
    const bytes = new TextEncoder().encode(text);
    assert.throws(
      () =>
        verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
          bytes,
          verifiedMetadata(bytes.byteLength)
        ),
      /must not contain duplicate JSON member names/
    );
  }
});

test("KRX holiday response body bounds every external row string", () => {
  assertInvalidBody({
    block1: [{ ...validRow(), holdy_eng_nm: "x".repeat(8_193) }]
  });
});

test("KRX holiday response body requires a non-reusable verified metadata projection", () => {
  const bytes = encodeBody(validBody());
  const metadata = verifiedMetadata(bytes.byteLength);
  for (const invalidMetadata of [
    { ...metadata, bodyValidationEligible: false },
    { ...metadata, durableEvidenceReusable: true },
    { ...metadata, acceptedAcquisition: true },
    { ...metadata, responseMetadataVersion: "unknown" }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
        bytes,
        invalidMetadata
      )
    );
  }
});

function assertInvalidBody(body: unknown): void {
  const bytes = encodeBody(body);
  assert.throws(() =>
    verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
      bytes,
      verifiedMetadata(bytes.byteLength)
    )
  );
}

function encodeBody(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

function validBody() {
  return {
    block1: [
      validRow(),
      {
        calnd_dd: "2026-02-16",
        dy_tp_cd: "MON",
        calnd_dd_dy: "2026-02-16",
        kr_dy_tp: "설날",
        holdy_eng_nm: "Lunar New Year's Day"
      }
    ]
  };
}

function validRow() {
  return {
    calnd_dd: "2026-01-01",
    dy_tp_cd: "THU",
    calnd_dd_dy: "2026-01-01",
    kr_dy_tp: "신정",
    holdy_eng_nm: "New Year's Day"
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
