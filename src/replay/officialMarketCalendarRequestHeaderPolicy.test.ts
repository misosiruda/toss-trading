import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestHeaderPolicyDefinition
} from "./officialMarketCalendarRequestHeaderPolicy.js";

test("calendar request header policy accepts canonical source definitions", () => {
  const krxDefinition = policyDefinition();
  const nyseDefinition = policyDefinition({
    exchange: "NYSE",
    requestedUrl: "https://www.nyse.com/trade/hours-calendars",
    allowedHeaderNames: ["accept", "cache-control", "pragma"]
  });

  assert.deepEqual(
    parseOfficialMarketCalendarRequestHeaderPolicyDefinition(krxDefinition),
    krxDefinition
  );
  assert.deepEqual(
    parseOfficialMarketCalendarRequestHeaderPolicyDefinition(nyseDefinition),
    nyseDefinition
  );
});

test("calendar request header policy rejects non-canonical names and duplicates", () => {
  for (const allowedHeaderNames of [
    ["pragma", "cache-control"],
    ["cache-control", "cache-control", "pragma"]
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
          policyDefinition({ allowedHeaderNames })
        ),
      /canonical order without duplicates/
    );
  }
});

test("calendar request header policy rejects missing required cache names", () => {
  for (const allowedHeaderNames of [
    ["accept", "pragma"],
    ["accept", "cache-control"]
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
          policyDefinition({ allowedHeaderNames })
        ),
      /must allow cache-control and pragma/
    );
  }
});

test("calendar request header policy rejects hard-prohibited names", () => {
  for (const hardProhibitedHeaderName of [
    "authorization",
    "cookie",
    "if-modified-since",
    "if-none-match",
    "if-range",
    "proxy-authorization",
    "range",
    "api-key",
    "x-access-token",
    "x-api-key",
    "x-auth-key",
    "x-authentication",
    "x-authorization",
    "x-client-secret",
    "x-cookie",
    "x-goog-api-key",
    "x_auth_key"
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
          policyDefinition({
            allowedHeaderNames: [
              "cache-control",
              hardProhibitedHeaderName,
              "pragma"
            ].sort()
          })
        ),
      /must not allow hard-prohibited header/
    );
  }
});

test("calendar request header policy rejects invalid source selectors", () => {
  for (const definition of [
    policyDefinition({
      requestedUrl: "https://www.nyse.com/trade/hours-calendars"
    }),
    policyDefinition({
      requestedUrl: "http://global.krx.co.kr/contents/calendar"
    }),
    policyDefinition({
      requestedUrl: "https://GLOBAL.KRX.CO.KR/contents/calendar"
    })
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarRequestHeaderPolicyDefinition(definition)
    );
  }
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
        policyDefinition({
          requestedUrl:
            "https://global.krx.co.kr/contents/calendar#variant"
        })
      ),
    /requested URL must not contain a fragment/
  );
});

test("calendar request header policy rejects invalid schema versions and unknown fields", () => {
  assert.throws(() =>
    parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
      policyDefinition({
        schemaVersion:
          "official_market_calendar_request_header_policy_definition.v2"
      })
    )
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestHeaderPolicyDefinition({
        ...policyDefinition(),
        allowCredentialHeaders: false
      }),
    /Unrecognized key/
  );
});

function policyDefinition(
  overrides: Partial<{
    schemaVersion: string;
    exchange: "KRX" | "NYSE";
    requestedUrl: string;
    allowedHeaderNames: string[];
  }> = {}
) {
  return {
    schemaVersion:
      overrides.schemaVersion ??
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
    sourceSelector: {
      exchange: overrides.exchange ?? ("KRX" as const),
      requestedUrl:
        overrides.requestedUrl ??
        "https://global.krx.co.kr/contents/calendar"
    },
    allowedHeaderNames: overrides.allowedHeaderNames ?? [
      "accept",
      "accept-language",
      "cache-control",
      "content-type",
      "pragma"
    ]
  };
}
