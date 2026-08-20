import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION,
  parseOfficialMarketCalendarKrxOtpNetworkPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy
} from "./officialMarketCalendarKrxOtpNetworkPolicy.js";

test("KRX OTP network policy binds the exact registered request and observed response", () => {
  const policy = resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION
  );

  assert.deepEqual(policy.sourceSelector, {
    exchange: "KRX",
    requestMethod: "GET",
    requestedUrl:
      "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx"
  });
  assert.deepEqual(policy.applicationRequestHeaderNames, [
    "accept",
    "cache-control",
    "pragma",
    "user-agent"
  ]);
  assert.deepEqual(policy.fixedRequestParameters, {
    bld: "GLB/05/0501/0501110000/glb0501110000_01",
    name: "form"
  });
  assert.equal(policy.responseBoundary.observedContentLength, 216);
  assert.equal(
    policy.responseBoundary.responseSetCookieHandling,
    "count_without_value_retention_or_replay"
  );
  assert.equal(policy.resultBoundary.rawOtpBytesProcessLocalOnly, true);
  assert.equal(policy.resultBoundary.durableEvidenceReusable, false);
  assert.equal(policy.resultBoundary.acceptedAcquisition, false);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.responseBoundary), true);
});

test("KRX OTP network policy parser rejects drift and unknown fields", () => {
  const policy = resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION
  );
  for (const candidate of [
    { ...policy, policyVersion: "krx_form_otp_network_request.v2" },
    {
      ...policy,
      requestIsolation: { ...policy.requestIsolation, cookieJarEnabled: true }
    },
    {
      ...policy,
      responseBoundary: {
        ...policy.responseBoundary,
        observedContentLength: 217
      }
    },
    { ...policy, acceptedAcquisition: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxOtpNetworkPolicyDefinition(candidate)
    );
  }
});

test("KRX OTP network policy rejects unregistered versions", () => {
  for (const value of [
    "krx_form_otp_network_request.v2",
    "",
    null,
    undefined
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy(value)
    );
  }
});
