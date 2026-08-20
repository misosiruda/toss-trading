import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS,
  getOfficialMarketCalendarRequestHeaderPolicyRegistry,
  resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy
} from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";

const EXPECTED_POLICIES = [
  {
    version: "krx_form_otp_request_headers.v1",
    exchange: "KRX",
    requestedUrl:
      "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
    allowedHeaderNames: [
      "accept",
      "cache-control",
      "pragma",
      "user-agent"
    ]
  },
  {
    version: "krx_market_closing_holiday_request_headers.v1",
    exchange: "KRX",
    requestedUrl:
      "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp",
    allowedHeaderNames: [
      "accept",
      "accept-language",
      "cache-control",
      "content-type",
      "pragma"
    ]
  },
  {
    version: "krx_regular_session_request_headers.v1",
    exchange: "KRX",
    requestedUrl:
      "https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp",
    allowedHeaderNames: [
      "accept",
      "accept-language",
      "cache-control",
      "content-type",
      "pragma"
    ]
  },
  {
    version: "krx_2016_session_extension_brochure_request_headers.v1",
    exchange: "KRX",
    requestedUrl:
      "https://global.krx.co.kr/contents/GLB/01/0107/0107010000/20170630_eng_brochure.pdf",
    allowedHeaderNames: [
      "accept",
      "accept-language",
      "cache-control",
      "content-type",
      "pragma"
    ]
  },
  {
    version: "nyse_trade_hours_calendars_request_headers.v1",
    exchange: "NYSE",
    requestedUrl: "https://www.nyse.com/trade/hours-calendars",
    allowedHeaderNames: ["accept", "cache-control", "pragma"]
  }
] as const;

test("calendar request header policy registry contains the preregistered official entry points", () => {
  const registry = getOfficialMarketCalendarRequestHeaderPolicyRegistry();

  assert.deepEqual(
    Object.values(OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS),
    EXPECTED_POLICIES.map((policy) => policy.version)
  );
  assert.deepEqual(
    registry.map((entry) => ({
      version: entry.requestHeaderPolicyVersion,
      exchange: entry.requestHeaderPolicyDefinition.sourceSelector.exchange,
      requestedUrl:
        entry.requestHeaderPolicyDefinition.sourceSelector.requestedUrl,
      allowedHeaderNames:
        entry.requestHeaderPolicyDefinition.allowedHeaderNames
    })),
    EXPECTED_POLICIES
  );
});

test("calendar request header policy registry resolves every registered version exactly", () => {
  for (const expected of EXPECTED_POLICIES) {
    const resolved =
      resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
        expected.version
      );
    assert.equal(
      resolved.requestHeaderPolicyDefinition.sourceSelector.requestedUrl,
      expected.requestedUrl
    );
  }

  assert.throws(
    () =>
      resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
        "krx_unknown_request_headers.v1"
      ),
    /version is not registered/
  );
});

test("calendar request header policy registry returns detached parsed entries", () => {
  const firstRead = getOfficialMarketCalendarRequestHeaderPolicyRegistry();
  const firstEntry = firstRead[0];
  assert.ok(firstEntry);
  firstEntry.requestHeaderPolicyDefinition.allowedHeaderNames.splice(0);
  firstRead.splice(0);

  const secondRead = getOfficialMarketCalendarRequestHeaderPolicyRegistry();
  assert.equal(secondRead.length, EXPECTED_POLICIES.length);
  assert.deepEqual(
    secondRead[0]?.requestHeaderPolicyDefinition.allowedHeaderNames,
    EXPECTED_POLICIES[0].allowedHeaderNames
  );
});
