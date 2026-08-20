import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS,
  getOfficialMarketCalendarRequestParameterPolicyRegistry,
  resolveRegisteredOfficialMarketCalendarRequestParameterPolicy
} from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

const EXPECTED_POLICY = {
  version: "krx_form_otp_request_parameters.v1",
  exchange: "KRX",
  requestMethod: "GET",
  requestedUrl:
    "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
  requestHeaderPolicyVersion: "krx_form_otp_request_headers.v1",
  requestParameters: {
    bld: "GLB/05/0501/0501110000/glb0501110000_01",
    name: "form"
  }
} as const;

test("calendar request parameter policy registry contains the exact KRX OTP request", () => {
  const registry = getOfficialMarketCalendarRequestParameterPolicyRegistry();

  assert.deepEqual(
    Object.values(OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS),
    [EXPECTED_POLICY.version]
  );
  assert.deepEqual(
    registry.map((entry) => ({
      version: entry.requestParameterPolicyVersion,
      exchange: entry.requestParameterPolicyDefinition.sourceSelector.exchange,
      requestMethod:
        entry.requestParameterPolicyDefinition.sourceSelector.requestMethod,
      requestedUrl:
        entry.requestParameterPolicyDefinition.sourceSelector.requestedUrl,
      requestHeaderPolicyVersion:
        entry.requestParameterPolicyDefinition.sourceSelector
          .requestHeaderPolicyVersion,
      requestParameters:
        entry.requestParameterPolicyDefinition.requestParameters
    })),
    [EXPECTED_POLICY]
  );
});

test("calendar request parameter policy registry resolves only the registered version", () => {
  const resolved =
    resolveRegisteredOfficialMarketCalendarRequestParameterPolicy(
      EXPECTED_POLICY.version
    );

  assert.deepEqual(
    resolved.requestParameterPolicyDefinition.requestParameters,
    EXPECTED_POLICY.requestParameters
  );
  assert.throws(
    () =>
      resolveRegisteredOfficialMarketCalendarRequestParameterPolicy(
        "krx_unknown_request_parameters.v1"
      ),
    /version is not registered/
  );
});

test("calendar request parameter policy registry returns detached parsed entries", () => {
  const firstRead = getOfficialMarketCalendarRequestParameterPolicyRegistry();
  firstRead[0]!.requestParameterPolicyDefinition.requestParameters.name =
    "changed";
  firstRead.splice(0);

  const secondRead = getOfficialMarketCalendarRequestParameterPolicyRegistry();
  assert.equal(secondRead.length, 1);
  assert.deepEqual(
    secondRead[0]?.requestParameterPolicyDefinition.requestParameters,
    EXPECTED_POLICY.requestParameters
  );
});
