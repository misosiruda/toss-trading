import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

test("KRX holiday response metadata permits body validation but forbids reuse", () => {
  const metadata = verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata(
    observedMetadata()
  );

  assert.equal(metadata.bodyValidationEligible, true);
  assert.equal(metadata.durableEvidenceReusable, false);
  assert.equal(metadata.acceptedAcquisition, false);
  assert.deepEqual(metadata.requestIsolation, {
    automaticRedirectFollow: false,
    cookieJarEnabled: false,
    requestCookieHeaderCount: 0
  });
  assert.deepEqual(metadata.durableRejectionReasons, [
    "cache_control_max_age_zero",
    "cache_control_no_cache",
    "cache_control_no_store",
    "expires_not_after_response_date",
    "response_sets_cookie"
  ]);
  assert.equal(metadata.setCookieHeaderCount, 2);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.durableRejectionReasons), true);
});

test("KRX holiday response metadata fixes URL, status, and redirect absence", () => {
  const base = observedMetadata();
  for (const value of [
    { ...base, responseUrl: "https://global.krx.co.kr/other.jspx" },
    { ...base, httpStatus: 204 },
    { ...base, redirectLocationHeaderValues: ["/redirect"] }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata(value)
    );
  }
});

test("KRX holiday response metadata fixes representation and framing headers", () => {
  const base = observedMetadata();
  for (const value of [
    { ...base, contentTypeHeaderValues: ["application/json"] },
    { ...base, contentTypeHeaderValues: [] },
    { ...base, contentEncodingHeaderValues: ["gzip"] },
    { ...base, transferEncodingHeaderValues: ["chunked"] },
    { ...base, pragmaHeaderValues: [] }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata(value)
    );
  }
});

test("KRX holiday response metadata requires observed no-reuse cache headers", () => {
  const base = observedMetadata();
  for (const value of [
    {
      ...base,
      responseCacheControl: { cacheControlHeaderValues: ["max-age=60"] }
    },
    {
      ...base,
      responseCacheHeaders: {
        ...base.responseCacheHeaders,
        expiresHeaderValues: ["Thu, 20 Aug 2026 05:34:52 GMT"]
      }
    },
    {
      ...base,
      responseCacheHeaders: {
        ...base.responseCacheHeaders,
        ageHeaderValues: ["0"]
      }
    }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata(value)
    );
  }
});

test("KRX holiday response metadata records Set-Cookie presence without values", () => {
  const base = observedMetadata();
  for (const setCookieHeaderCount of [0, -1, 101]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
        ...base,
        setCookieHeaderCount
      })
    );
  }
});

test("KRX holiday response metadata requires isolated request client state", () => {
  const base = observedMetadata();
  for (const requestIsolation of [
    { ...base.requestIsolation, automaticRedirectFollow: true },
    { ...base.requestIsolation, cookieJarEnabled: true },
    { ...base.requestIsolation, requestCookieHeaderCount: 1 },
    { ...base.requestIsolation, cookieHeaderValues: ["must-not-be-recorded"] }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
        ...base,
        requestIsolation
      })
    );
  }
});

test("KRX holiday response metadata requires complete bounded HTTP/1.1 content length", () => {
  const base = observedMetadata();
  for (const transferCompletion of [
    { ...base.transferCompletion, transferCompleted: false },
    { ...base.transferCompletion, httpProtocolVersion: "http_2" },
    { ...base.transferCompletion, transferFraming: "chunked" },
    {
      ...base.transferCompletion,
      declaredContentLength: 2_221,
      contentLength: 2_220
    },
    {
      ...base.transferCompletion,
      declaredContentLength: 0,
      contentLength: 0
    },
    {
      ...base.transferCompletion,
      declaredContentLength: 1_000_001,
      contentLength: 1_000_001
    }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
        ...base,
        transferCompletion
      })
    );
  }
});

test("KRX holiday response metadata rejects unknown fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
      ...observedMetadata(),
      setCookieHeaderValues: ["must-not-be-recorded"]
    })
  );
});

test("KRX holiday response metadata bounds external header values", () => {
  const base = observedMetadata();
  for (const value of [
    { ...base, pragmaHeaderValues: ["x".repeat(8_193)] },
    { ...base, pragmaHeaderValues: Array.from({ length: 17 }, () => "x") },
    { ...base, pragmaHeaderValues: ["no-cache\nset-cookie: raw"] },
    {
      ...base,
      responseCacheControl: {
        cacheControlHeaderValues: [
          "no-store, no-cache, max-age=0" + " ".repeat(8_193)
        ]
      }
    },
    {
      ...base,
      responseCacheControl: {
        cacheControlHeaderValues: Array.from({ length: 17 }, () => "no-store")
      }
    },
    {
      ...base,
      responseCacheHeaders: {
        ...base.responseCacheHeaders,
        dateHeaderValues: ["x".repeat(8_193)]
      }
    },
    {
      ...base,
      responseCacheHeaders: {
        ...base.responseCacheHeaders,
        ageHeaderValues: Array.from({ length: 17 }, () => "0")
      }
    }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata(value)
    );
  }
});

function observedMetadata() {
  return {
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
      declaredContentLength: 2_221,
      contentLength: 2_221
    }
  };
}
