import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS,
  getOfficialMarketCalendarRequestHeaderValuePolicyRegistry,
  resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy
} from "./officialMarketCalendarRequestHeaderValuePolicyRegistry.js";

const EXPECTED_POLICY = {
  version: "krx_form_otp_request_header_values.v1",
  exchange: "KRX",
  requestMethod: "GET",
  requestedUrl:
    "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
  requestHeaderPolicyVersion: "krx_form_otp_request_headers.v1",
  requestParameterPolicyVersion: "krx_form_otp_request_parameters.v1",
  fixedHeaderValues: { "user-agent": "Mozilla/5.0" }
} as const;

test("calendar request header value policy registry contains the exact OTP User-Agent", () => {
  const registry = getOfficialMarketCalendarRequestHeaderValuePolicyRegistry();

  assert.deepEqual(
    Object.values(OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS),
    [EXPECTED_POLICY.version]
  );
  assert.deepEqual(
    registry.map((entry) => ({
      version: entry.requestHeaderValuePolicyVersion,
      exchange: entry.requestHeaderValuePolicyDefinition.sourceSelector.exchange,
      requestMethod:
        entry.requestHeaderValuePolicyDefinition.sourceSelector.requestMethod,
      requestedUrl:
        entry.requestHeaderValuePolicyDefinition.sourceSelector.requestedUrl,
      requestHeaderPolicyVersion:
        entry.requestHeaderValuePolicyDefinition.sourceSelector
          .requestHeaderPolicyVersion,
      requestParameterPolicyVersion:
        entry.requestHeaderValuePolicyDefinition.sourceSelector
          .requestParameterPolicyVersion,
      fixedHeaderValues:
        entry.requestHeaderValuePolicyDefinition.fixedHeaderValues
    })),
    [EXPECTED_POLICY]
  );
});

test("calendar request header value policy registry resolves only its exact version", () => {
  const resolved =
    resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy(
      EXPECTED_POLICY.version
    );

  assert.deepEqual(
    resolved.requestHeaderValuePolicyDefinition.fixedHeaderValues,
    EXPECTED_POLICY.fixedHeaderValues
  );
  assert.throws(
    () =>
      resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy(
        "krx_unknown_request_header_values.v1"
      ),
    /version is not registered/
  );
});

test("calendar request header value policy registry returns detached entries", () => {
  const firstRead = getOfficialMarketCalendarRequestHeaderValuePolicyRegistry();
  firstRead[0]!.requestHeaderValuePolicyDefinition.fixedHeaderValues[
    "user-agent"
  ] = "changed";
  firstRead.splice(0);

  const secondRead = getOfficialMarketCalendarRequestHeaderValuePolicyRegistry();
  assert.equal(secondRead.length, 1);
  assert.deepEqual(
    secondRead[0]?.requestHeaderValuePolicyDefinition.fixedHeaderValues,
    EXPECTED_POLICY.fixedHeaderValues
  );
});
