import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRepresentationHeadersBoundary } from "./officialMarketCalendarRepresentationHeadersBoundary.js";

test("calendar representation headers boundary accepts canonical requests", () => {
  const boundary = requests();

  assert.deepEqual(
    verifyOfficialMarketCalendarRepresentationHeadersBoundary(boundary),
    boundary
  );
});

test("calendar representation headers boundary rejects invalid header names", () => {
  for (const representationHeaders of [
    { Accept: "application/pdf" },
    { "accept language": "ko-KR" },
    { "": "application/pdf" }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({ effectiveRequests: [{ representationHeaders }] })
        ),
      /lowercase HTTP field name/
    );
  }
});

test("calendar representation headers boundary accepts canonical safe ASCII field values", () => {
  for (const value of [
    "",
    "application/pdf",
    "text/html, application/xhtml+xml",
    "en-US,\ten;q=0.8"
  ]) {
    assert.doesNotThrow(() =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({
          effectiveRequests: [
            { representationHeaders: { "x-representation": value } }
          ]
        })
      )
    );
  }
});

test("calendar representation headers boundary rejects non-canonical field values", () => {
  for (const value of [
    " application/pdf",
    "application/pdf ",
    "\tapplication/pdf",
    "application/pdf\t",
    "application/\u0000pdf",
    "application/\u001fpdf",
    "application/\u007fpdf",
    "application/\r\nx-injected: value",
    "text/\ud55c\uae00"
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({
            effectiveRequests: [
              { representationHeaders: { accept: value } }
            ]
          })
        ),
      /canonical safe ASCII HTTP field-value characters/
    );
  }
});

test("calendar representation headers boundary accepts canonical Accept media ranges", () => {
  for (const value of [
    "*/*",
    "application/pdf",
    "text/*;q=0.8",
    "text/html;level=1, application/xhtml+xml;q=0.9",
    'application/json;profile="calendar v1"',
    'application/json;profile="calendar\tv1"'
  ]) {
    assert.doesNotThrow(() =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({
          effectiveRequests: [
            { representationHeaders: { accept: value } }
          ]
        })
      )
    );
  }
});

test("calendar representation headers boundary bounds field value length", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({
          effectiveRequests: [
            {
              representationHeaders: {
                accept: `application/json;profile="${"a".repeat(8_192)}"`
              }
            }
          ]
        })
      ),
    /must not exceed 8192 characters/
  );
});

test("calendar representation headers boundary rejects duplicate Accept parameters", () => {
  for (const value of [
    "application/json;profile=v1;profile=v2",
    "application/json;profile=v1;PROFILE=v2"
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({
            effectiveRequests: [
              { representationHeaders: { accept: value } }
            ]
          })
        ),
      /must not repeat case-insensitive parameter names/
    );
  }
});

test("calendar representation headers boundary rejects malformed Accept values", () => {
  for (const value of [
    "",
    "application",
    "*/pdf",
    "application/",
    "/pdf",
    "application/pdf,",
    ",application/pdf",
    "application/pdf;;q=0.8",
    "application/pdf;q",
    "application/pdf;q=2",
    "application/pdf;q=bogus",
    'application/pdf;q="0.8"',
    "application/pdf;q=0.1234",
    "application/pdf;Q=1.1",
    "application/pdf;q=0.8;q=0.7",
    "application/pdf;q=0.8;Q=0.7",
    "application/pdf;q=0.8;profile=v1",
    "application/*json",
    "**/**",
    'application/json;profile="unterminated'
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({
            effectiveRequests: [
              { representationHeaders: { accept: value } }
            ]
          })
        ),
      /canonical Accept media-range list/
    );
  }
});

test("calendar representation headers boundary accepts canonical Accept-Language ranges", () => {
  for (const value of [
    "*",
    "ko",
    "ko-KR",
    "en-US, en;q=0.8",
    "zh-Hant-TW;q=0.125",
    "de-DE-1996;Q=1.000"
  ]) {
    assert.doesNotThrow(() =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({
          effectiveRequests: [
            { representationHeaders: { "accept-language": value } }
          ]
        })
      )
    );
  }
});

test("calendar representation headers boundary rejects malformed Accept-Language values", () => {
  for (const value of [
    "",
    "-ko",
    "ko-",
    "ko--KR",
    "languagex-KR",
    "ko-123456789",
    "ko_KR",
    "*/KR",
    "ko-KR,",
    ",ko-KR",
    "ko-KR;;q=0.8",
    "ko-KR;q",
    "ko-KR;q=2",
    "ko-KR;q=bogus",
    'ko-KR;q="0.8"',
    "ko-KR;q=0.1234",
    "ko-KR;q=0.8;q=0.7",
    "ko-KR;level=1"
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({
            effectiveRequests: [
              { representationHeaders: { "accept-language": value } }
            ]
          })
        ),
      /canonical Accept-Language language-range list/
    );
  }
});

test("calendar representation headers boundary rejects duplicate Accept-Language ranges", () => {
  for (const value of [
    "ko-KR, KO-kr",
    "en;q=0.8, EN;q=0.7",
    "*, *;q=0.5"
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({
            effectiveRequests: [
              { representationHeaders: { "accept-language": value } }
            ]
          })
        ),
      /must not repeat case-insensitive language ranges/
    );
  }
});

test("calendar representation headers boundary rejects non-canonical key order", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({
          effectiveRequests: [
            {
              representationHeaders: {
                "accept-language": "ko-KR",
                accept: "application/pdf"
              }
            }
          ]
        })
      ),
    /must use canonical key order/
  );
});

test("calendar representation headers boundary rejects non-string values", () => {
  for (const representationHeaders of [
    { accept: null },
    { accept: false },
    { accept: 1 },
    { accept: ["application/pdf"] },
    { accept: { mediaType: "application/pdf" } },
    { accept: undefined },
    { accept: Number.NaN },
    { accept: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({ effectiveRequests: [{ representationHeaders }] })
      )
    );
  }
});

test("calendar representation headers boundary rejects invalid shape and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRepresentationHeadersBoundary(
      requests({ effectiveRequests: [] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary({
        ...requests(),
        headersMasked: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary({
        effectiveRequests: [
          {
            representationHeaders: {},
            requestHeaderNames: []
          }
        ]
      }),
    /Unrecognized key/
  );
});

function requests(
  overrides: Partial<{
    effectiveRequests: Array<{
      representationHeaders: Record<string, unknown>;
    }>;
  }> = {}
) {
  return {
    effectiveRequests: [
      {
        representationHeaders: {
          accept: "application/pdf",
          "accept-language": "ko-KR"
        }
      },
      { representationHeaders: {} }
    ],
    ...overrides
  };
}
