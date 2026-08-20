import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS,
  getOfficialMarketCalendarRequestHeaderValuePolicyRegistry,
  resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy
} from "./officialMarketCalendarRequestHeaderValuePolicyRegistry.js";

const EXPECTED_POLICIES = [
  {
    version: "krx_form_otp_request_header_values.v1",
    requestHeaderPolicyVersion: "krx_form_otp_request_headers.v1",
    requestParameterPolicyVersion: "krx_form_otp_request_parameters.v1",
    fixedHeaderValues: { "user-agent": "Mozilla/5.0" }
  },
  ...["2013", "2014", "2015"].map((year) => ({
    version: `krx_legacy_download_otp_${year}_request_header_values.v1`,
    requestHeaderPolicyVersion:
      "krx_legacy_download_otp_request_headers.v1",
    requestParameterPolicyVersion:
      `krx_legacy_download_otp_${year}_request_parameters.v1`,
    fixedHeaderValues: {
      referer:
        "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp",
      "user-agent": "Mozilla/5.0"
    }
  }))
].map((policy) => ({
  ...policy,
  exchange: "KRX",
  requestMethod: "GET",
  requestedUrl:
    "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx"
}));

test("calendar request header value policy registry contains the exact OTP User-Agent", () => {
  const registry = getOfficialMarketCalendarRequestHeaderValuePolicyRegistry();

  assert.deepEqual(
    Object.values(OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS),
    EXPECTED_POLICIES.map((policy) => policy.version)
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
    EXPECTED_POLICIES
  );
});

test("calendar request header value policy registry resolves only its exact version", () => {
  for (const expected of EXPECTED_POLICIES) {
    const resolved =
      resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy(
        expected.version
      );
    assert.deepEqual(
      resolved.requestHeaderValuePolicyDefinition.fixedHeaderValues,
      expected.fixedHeaderValues
    );
  }
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
  assert.equal(secondRead.length, EXPECTED_POLICIES.length);
  assert.deepEqual(
    secondRead[0]?.requestHeaderValuePolicyDefinition.fixedHeaderValues,
    EXPECTED_POLICIES[0]?.fixedHeaderValues
  );
});
