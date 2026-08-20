import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy
} from "./officialMarketCalendarKrxHolidayDataPostNetworkPolicy.js";

test("KRX holiday data POST network policy fixes the observed request", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.applicationRequestHeaderNames, [
    "accept",
    "cache-control",
    "content-length",
    "content-type",
    "pragma"
  ]);
  assert.deepEqual(policy.transportDerivedRequestHeaderValues, {
    host: "global.krx.co.kr",
    connection: "close"
  });
  assert.deepEqual(policy.fixedRequestHeaderValues, {
    accept: "*/*",
    cacheControl: "no-cache",
    contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    pragma: "no-cache"
  });
  assert.equal(
    policy.derivedRequestHeaderBindings.contentLength,
    "exact_wire_body_byte_length"
  );
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.applicationRequestHeaderNames), true);
  assert.equal(
    Object.isFrozen(policy.transportDerivedRequestHeaderValues),
    true
  );
  assert.equal(Object.isFrozen(policy.requestIsolation), true);
});

test("KRX holiday data POST network policy fixes isolation and limits", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.requestIsolation, {
    automaticRedirectFollow: false,
    cookieJarEnabled: false,
    requestCookieHeaderCount: 0,
    requestAuthorizationHeaderCount: 0,
    requestProxyAuthorizationHeaderCount: 0,
    connectionReuseEnabled: false
  });
  assert.deepEqual(policy.networkLimits, {
    absoluteDeadlineMilliseconds: 10_000,
    maximumRequestBodyByteLength: 1_024,
    maximumResponseBodyByteLength: 1_000_000
  });
  assert.equal(policy.resultBoundary.durableEvidenceReusable, false);
  assert.equal(policy.resultBoundary.acceptedAcquisition, false);
});

test("KRX holiday data POST network policy fixes fail-closed response gates", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.responseBoundary, {
    requiredHttpProtocolVersion: "http_1_1",
    requiredStatus: 200,
    requireContentLengthFraming: true,
    rejectLocation: true,
    rejectContentEncoding: true,
    rejectTransferEncoding: true,
    rejectContentRange: true,
    rejectTrailers: true,
    responseSetCookieHandling: "count_without_value_retention_or_replay"
  });
});

test("KRX holiday data POST network policy rejects unsafe drift", () => {
  const policy = validPolicy();
  for (const value of [
    {
      ...policy,
      applicationRequestHeaderNames: [
        ...policy.applicationRequestHeaderNames,
        "cookie"
      ]
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
      fixedRequestHeaderValues: {
        ...policy.fixedRequestHeaderValues,
        accept: "application/json"
      }
    },
    {
      ...policy,
      requestIsolation: { ...policy.requestIsolation, cookieJarEnabled: true }
    },
    {
      ...policy,
      networkLimits: {
        ...policy.networkLimits,
        absoluteDeadlineMilliseconds: 10_001
      }
    },
    {
      ...policy,
      responseBoundary: { ...policy.responseBoundary, rejectTrailers: false }
    },
    {
      ...policy,
      resultBoundary: { ...policy.resultBoundary, acceptedAcquisition: true }
    },
    { ...policy, extra: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition(
        value
      )
    );
  }
});

test("KRX holiday data POST network policy rejects unregistered versions", () => {
  for (const policyVersion of [
    "krx_holiday_data_post_network_request.v2",
    "",
    null
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
        policyVersion
      )
    );
  }
});

test("KRX holiday data POST network policy returns fresh immutable definitions", () => {
  const first = validPolicy();
  const second = validPolicy();

  assert.notEqual(first, second);
  assert.throws(() => {
    (first.applicationRequestHeaderNames as unknown as string[]).push(
      "cookie"
    );
  });
  assert.deepEqual(second.applicationRequestHeaderNames, [
    "accept",
    "cache-control",
    "content-length",
    "content-type",
    "pragma"
  ]);
});

function validPolicy() {
  return resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
  );
}
