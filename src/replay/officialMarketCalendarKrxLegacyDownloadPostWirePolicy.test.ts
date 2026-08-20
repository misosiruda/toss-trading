import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION,
  parseOfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy
} from "./officialMarketCalendarKrxLegacyDownloadPostWirePolicy.js";

test("KRX legacy download wire policy binds the registered POST source", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.sourceSelector, {
    exchange: "KRX",
    marketScope: "derivatives",
    requestMethod: "POST",
    requestedUrl: "https://file.krx.co.kr/download.jspx"
  });
  assert.equal(policy.requestContentType, "application/x-www-form-urlencoded");
  assert.deepEqual(policy.parameterOrder, ["code"]);
  assert.equal(
    policy.parameterValueSource,
    "bound_process_local_otp_parameter_handle_only"
  );
  assert.equal(
    policy.otpNetworkPolicyVersion,
    "krx_legacy_download_otp_network_request.v1"
  );
  assert.equal(
    policy.otpResponseBodyVersion,
    "official_market_calendar_krx_legacy_download_otp_response_body.v1"
  );
});

test("KRX legacy download wire policy fixes byte encoding", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.encodingBoundary, {
    sourceByteEncoding: "ascii",
    literalByteCategory: "rfc3986_unreserved",
    plusByteEncoding: "%2B",
    slashByteEncoding: "%2F",
    equalsByteEncoding: "%3D",
    percentHexCase: "uppercase",
    spaceAsPlusAllowed: false
  });
});

test("KRX legacy download wire policy fixes exact local limits", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.wireLimits, {
    exactRawOtpByteLength: 300,
    exactDecodedOtpByteLength: 224,
    parameterNameAndEqualsByteLength: 5,
    minimumRequestBodyByteLength: 307,
    maximumRequestBodyByteLength: 903
  });
  assert.deepEqual(policy.resultBoundary, {
    rawOtpStringMaterializationAllowed: false,
    encodedBodyProcessLocalOnly: true,
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  });
});

test("KRX legacy download wire policy rejects unsafe drift", () => {
  const policy = validPolicy();
  for (const value of [
    { ...policy, parameterOrder: ["file_nm", "code"] },
    {
      ...policy,
      otpNetworkPolicyVersion: "krx_form_otp_network_request.v1"
    },
    {
      ...policy,
      encodingBoundary: {
        ...policy.encodingBoundary,
        plusByteEncoding: "+"
      }
    },
    {
      ...policy,
      wireLimits: {
        ...policy.wireLimits,
        maximumRequestBodyByteLength: 904
      }
    },
    {
      ...policy,
      resultBoundary: {
        ...policy.resultBoundary,
        rawOtpStringMaterializationAllowed: true
      }
    },
    { ...policy, extra: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition(
        value
      )
    );
  }
});

test("KRX legacy download wire policy rejects unknown versions", () => {
  for (const value of [
    "krx_legacy_download_post_wire.v2",
    "",
    null,
    undefined
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy(
        value
      )
    );
  }
});

test("KRX legacy download wire policy returns fresh immutable definitions", () => {
  const first = validPolicy();
  const second = validPolicy();

  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.encodingBoundary), true);
  assert.equal(Object.isFrozen(first.parameterOrder), true);
  assert.throws(() => {
    (first.parameterOrder as unknown as string[]).push("file_nm");
  });
  assert.deepEqual(second.parameterOrder, ["code"]);
});

function validPolicy() {
  return resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION
  );
}
