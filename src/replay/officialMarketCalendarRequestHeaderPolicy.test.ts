import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestHeaderPolicyDefinition,
  parseOfficialMarketCalendarRequestHeaderPolicyRegistry,
  parseOfficialMarketCalendarRequestHeaderPolicyRegistryEntry,
  resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry
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

test("calendar request header policy rejects names outside the known-safe set", () => {
  for (const unknownHeaderName of [
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
    "x-rapidapi-key",
    "x-rapidapi_key",
    "x-rapidapikey",
    "ocp-apim-subscription-key",
    "x-client-key",
    "x-custom",
    "x-functions-key",
    "x_auth_key"
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
          policyDefinition({
            allowedHeaderNames: [
              "cache-control",
              unknownHeaderName,
              "pragma"
            ].sort()
          })
        ),
      /must only allow known-safe header names/
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

test("calendar request header policy parses registry entries and resolves exact versions", () => {
  const krxEntry = registryEntry();
  const nyseEntry = registryEntry({
    requestHeaderPolicyVersion: "test.nyse_calendar_request_headers.v1",
    definition: policyDefinition({
      exchange: "NYSE",
      requestedUrl: "https://www.nyse.com/trade/hours-calendars",
      allowedHeaderNames: ["accept", "cache-control", "pragma"]
    })
  });

  assert.deepEqual(
    parseOfficialMarketCalendarRequestHeaderPolicyRegistryEntry(krxEntry),
    krxEntry
  );
  assert.deepEqual(
    parseOfficialMarketCalendarRequestHeaderPolicyRegistry([
      krxEntry,
      nyseEntry
    ]),
    [krxEntry, nyseEntry]
  );
  assert.deepEqual(
    resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry(
      nyseEntry.requestHeaderPolicyVersion,
      [krxEntry, nyseEntry]
    ),
    nyseEntry
  );
});

test("calendar request header policy rejects invalid and duplicate registry versions", () => {
  for (const requestHeaderPolicyVersion of [
    "",
    "-invalid.v1",
    "\uD55C\uAE00.v1"
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarRequestHeaderPolicyRegistryEntry(
          registryEntry({ requestHeaderPolicyVersion })
        ),
      /registered ASCII grammar/
    );
  }
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestHeaderPolicyRegistryEntry({
        ...registryEntry(),
        mutable: false
      }),
    /Unrecognized key/
  );
  const entry = registryEntry();
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestHeaderPolicyRegistry([entry, entry]),
    /versions must be unique/
  );
});

test("calendar request header policy rejects unregistered versions", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry(
        "test.nyse_calendar_request_headers.v1",
        [registryEntry()]
      ),
    /version is not registered/
  );
});

test("calendar request header policy validates the complete registry before lookup", () => {
  const entry = registryEntry();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry(
        entry.requestHeaderPolicyVersion,
        [
          entry,
          {
            ...registryEntry({
              requestHeaderPolicyVersion:
                "test.nyse_calendar_request_headers.v1"
            }),
            mutable: false
          }
        ]
      ),
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

function registryEntry(
  overrides: Partial<{
    requestHeaderPolicyVersion: string;
    definition: ReturnType<typeof policyDefinition>;
  }> = {}
) {
  return {
    requestHeaderPolicyVersion:
      overrides.requestHeaderPolicyVersion ??
      "test.krx_calendar_request_headers.v1",
    requestHeaderPolicyDefinition:
      overrides.definition ?? policyDefinition()
  };
}
