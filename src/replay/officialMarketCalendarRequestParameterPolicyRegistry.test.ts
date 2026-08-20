import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS,
  getOfficialMarketCalendarRequestParameterPolicyRegistry,
  resolveRegisteredOfficialMarketCalendarRequestParameterPolicy
} from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

const EXPECTED_POLICIES = [
  {
    version: "krx_form_otp_request_parameters.v1",
    requestHeaderPolicyVersion: "krx_form_otp_request_headers.v1",
    requestParameters: {
      bld: "GLB/05/0501/0501110000/glb0501110000_01",
      name: "form"
    }
  },
  ...["2013", "2014", "2015"].map((year) => ({
    version: `krx_legacy_download_otp_${year}_request_parameters.v1`,
    requestHeaderPolicyVersion:
      "krx_legacy_download_otp_request_headers.v1",
    requestParameters: {
      file_nm: `E_Trading_Calendar${year}.doc`,
      filetype: "att",
      name: "fileDown",
      url: "MKD/01/0110/01100303/mkd01100303_DN"
    }
  }))
].map((policy) => ({
  ...policy,
  exchange: "KRX",
  requestMethod: "GET",
  requestedUrl:
    "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx"
}));

test("calendar request parameter policy registry contains the exact KRX OTP request", () => {
  const registry = getOfficialMarketCalendarRequestParameterPolicyRegistry();

  assert.deepEqual(
    Object.values(OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS),
    EXPECTED_POLICIES.map((policy) => policy.version)
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
    EXPECTED_POLICIES
  );
});

test("calendar request parameter policy registry resolves only the registered version", () => {
  for (const expected of EXPECTED_POLICIES) {
    const resolved =
      resolveRegisteredOfficialMarketCalendarRequestParameterPolicy(
        expected.version
      );
    assert.deepEqual(
      resolved.requestParameterPolicyDefinition.requestParameters,
      expected.requestParameters
    );
  }
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
  assert.equal(secondRead.length, EXPECTED_POLICIES.length);
  assert.deepEqual(
    secondRead[0]?.requestParameterPolicyDefinition.requestParameters,
    EXPECTED_POLICIES[0]?.requestParameters
  );
});
