import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION,
  parseOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy
} from "./officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy.js";

test("KRX legacy download OTP network policy binds the registered document request", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.sourceSelector, {
    exchange: "KRX",
    marketScope: "derivatives",
    requestMethod: "GET",
    requestedUrl:
      "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx"
  });
  assert.deepEqual(policy.fixedRequestParameters, {
    name: "fileDown",
    filetype: "att",
    url: "MKD/01/0110/01100303/mkd01100303_DN"
  });
  assert.deepEqual(policy.dynamicRequestParameterBinding.allowedValues, [
    "E_Trading_Calendar2013.doc",
    "E_Trading_Calendar2014.doc",
    "E_Trading_Calendar2015.doc"
  ]);
  assert.equal(
    policy.requestHeaderPolicyVersion,
    "krx_legacy_download_otp_request_headers.v1"
  );
  assert.deepEqual(policy.requestParameterPolicyVersions, [
    "krx_legacy_download_otp_2013_request_parameters.v1",
    "krx_legacy_download_otp_2014_request_parameters.v1",
    "krx_legacy_download_otp_2015_request_parameters.v1"
  ]);
  assert.deepEqual(policy.requestHeaderValuePolicyVersions, [
    "krx_legacy_download_otp_2013_request_header_values.v1",
    "krx_legacy_download_otp_2014_request_header_values.v1",
    "krx_legacy_download_otp_2015_request_header_values.v1"
  ]);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.dynamicRequestParameterBinding), true);
  assert.equal(
    Object.isFrozen(policy.dynamicRequestParameterBinding.allowedValues),
    true
  );
});

test("KRX legacy download OTP network policy fixes isolated HTTP/1.1 boundaries", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.transportDerivedRequestHeaderValues, {
    host: "global.krx.co.kr",
    connection: "close"
  });
  assert.deepEqual(policy.requestIsolation, {
    automaticRedirectFollow: false,
    cookieJarEnabled: false,
    requestCookieHeaderCount: 0,
    requestAuthorizationHeaderCount: 0,
    requestProxyAuthorizationHeaderCount: 0,
    connectionReuseEnabled: false
  });
  assert.equal(policy.responseBoundary.requiredHttpProtocolVersion, "http_1_1");
  assert.equal(policy.responseBoundary.observedContentLength, 300);
  assert.equal(policy.responseBoundary.observedSetCookieHeaderCount, 2);
  assert.equal(policy.responseBoundary.rejectTransferEncoding, true);
});

test("KRX legacy download OTP network policy keeps raw OTP process-local", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.otpBodyBoundary, {
    requiredAsciiByteLength: 300,
    requiredEncoding: "canonical_base64",
    requiredDecodedByteLength: 224,
    requiredPaddingCharacterCount: 1
  });
  assert.deepEqual(policy.resultBoundary, {
    rawOtpBytesProcessLocalOnly: true,
    rawOtpRetention: "forbidden",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  });
  assert.equal(JSON.stringify(policy).includes("otpValue"), false);
});

test("KRX legacy download OTP network policy rejects unsafe drift", () => {
  const policy = validPolicy();

  for (const value of [
    {
      ...policy,
      requestHeaderPolicyVersion: "krx_form_otp_request_headers.v1"
    },
    {
      ...policy,
      dynamicRequestParameterBinding: {
        ...policy.dynamicRequestParameterBinding,
        allowedValues: [
          ...policy.dynamicRequestParameterBinding.allowedValues
        ].reverse()
      }
    },
    {
      ...policy,
      requestIsolation: { ...policy.requestIsolation, cookieJarEnabled: true }
    },
    {
      ...policy,
      transportDerivedRequestHeaderValues: {
        ...policy.transportDerivedRequestHeaderValues,
        connection: "keep-alive"
      }
    },
    {
      ...policy,
      responseBoundary: {
        ...policy.responseBoundary,
        observedContentLength: 301
      }
    },
    {
      ...policy,
      resultBoundary: { ...policy.resultBoundary, acceptedAcquisition: true }
    },
    { ...policy, extra: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition(
        value
      )
    );
  }
});

test("KRX legacy download OTP network policy rejects unknown versions", () => {
  for (const policyVersion of [
    "krx_legacy_download_otp_network_request.v2",
    "",
    null,
    undefined
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy(
        policyVersion
      )
    );
  }
});

test("KRX legacy download OTP network policy returns fresh definitions", () => {
  const first = validPolicy();
  const second = validPolicy();

  assert.notEqual(first, second);
  assert.throws(() => {
    (
      first.dynamicRequestParameterBinding.allowedValues as unknown as string[]
    ).push("E_Trading_Calendar2016.doc");
  });
  assert.equal(
    second.dynamicRequestParameterBinding.allowedValues.includes(
      "E_Trading_Calendar2016.doc" as never
    ),
    false
  );
});

function validPolicy() {
  return resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION
  );
}
