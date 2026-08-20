import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition,
  parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry,
  resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry
} from "./officialMarketCalendarRequestHeaderValuePolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS } from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

test("calendar request header value policy accepts an exact OTP User-Agent", () => {
  const definition = policyDefinition();

  assert.deepEqual(
    parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(definition),
    definition
  );
});

test("calendar request header value policy rejects non-canonical names", () => {
  assert.throws(() =>
    parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(
      policyDefinition({
        fixedHeaderValues: {
          "user-agent": "Mozilla/5.0",
          accept: "text/html"
        }
      })
    )
  );
  assert.throws(() =>
    parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(
      policyDefinition({
        fixedHeaderValues: {
          "user-agent": "Mozilla/5.0",
          authorization: "value"
        }
      })
    )
  );
});

test("calendar request header value policy rejects unsafe values", () => {
  for (const fixedHeaderValue of [
    "",
    " Mozilla/5.0",
    "Mozilla/5.0 ",
    "Mozilla/5.0\n",
    "한글"
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(
        policyDefinition({
          fixedHeaderValues: { "user-agent": fixedHeaderValue }
        })
      )
    );
  }
});

test("calendar request header value policy rejects mismatched source policies", () => {
  for (const definition of [
    policyDefinition({
      requestedUrl:
        "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp"
    }),
    policyDefinition({ requestMethod: "POST" }),
    policyDefinition({ requestHeaderPolicyVersion: "unknown.v1" }),
    policyDefinition({ requestParameterPolicyVersion: "unknown.v1" })
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(definition)
    );
  }
});

test("calendar request header value policy rejects empty values and unknown fields", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(
        policyDefinition({ fixedHeaderValues: {} })
      ),
    /must contain fixed header values/
  );
  assert.throws(() =>
    parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition({
      ...policyDefinition(),
      sendsRequest: false
    })
  );
});

test("calendar request header value policy resolves unique exact versions", () => {
  const entry = {
    requestHeaderValuePolicyVersion:
      "test.krx_form_otp_request_header_values.v1",
    requestHeaderValuePolicyDefinition: policyDefinition()
  };

  assert.deepEqual(
    resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry(
      entry.requestHeaderValuePolicyVersion,
      [entry]
    ),
    entry
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry([
        entry,
        entry
      ]),
    /versions must be unique/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry(
        "unknown.v1",
        [entry]
      ),
    /version is not registered/
  );
});

function policyDefinition(
  overrides: Partial<{
    requestMethod: "GET" | "POST";
    requestedUrl: string;
    requestHeaderPolicyVersion: string;
    requestParameterPolicyVersion: string;
    fixedHeaderValues: Record<string, string>;
  }> = {}
) {
  return {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION,
    sourceSelector: {
      exchange: "KRX" as const,
      requestMethod: overrides.requestMethod ?? ("GET" as const),
      requestedUrl:
        overrides.requestedUrl ??
        "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
      requestHeaderPolicyVersion:
        overrides.requestHeaderPolicyVersion ??
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP,
      requestParameterPolicyVersion:
        overrides.requestParameterPolicyVersion ??
        OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_FORM_OTP
    },
    fixedHeaderValues: overrides.fixedHeaderValues ?? {
      "user-agent": "Mozilla/5.0"
    }
  };
}
