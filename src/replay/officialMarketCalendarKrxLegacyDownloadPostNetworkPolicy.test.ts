import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION,
  parseOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy
} from "./officialMarketCalendarKrxLegacyDownloadPostNetworkPolicy.js";

test("KRX legacy download network policy fixes the dedicated file host", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.sourceSelector, {
    exchange: "KRX",
    marketScope: "derivatives",
    requestMethod: "POST",
    requestedUrl: "https://file.krx.co.kr/download.jspx"
  });
  assert.deepEqual(policy.dedicatedDomainBoundary, {
    policyVersion: "krx_file_download_host.v1",
    scheme: "https:",
    hostname: "file.krx.co.kr",
    port: "",
    pathname: "/download.jspx",
    search: "",
    hash: ""
  });
  assert.deepEqual(policy.transportDerivedRequestHeaderValues, {
    host: "file.krx.co.kr",
    connection: "close"
  });
});

test("KRX legacy download network policy fixes exact request headers", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.applicationRequestHeaderNames, [
    "accept",
    "cache-control",
    "content-length",
    "content-type",
    "origin",
    "pragma",
    "referer",
    "user-agent"
  ]);
  assert.deepEqual(policy.fixedRequestHeaderValues, {
    accept: "*/*",
    cacheControl: "no-cache",
    contentType: "application/x-www-form-urlencoded",
    origin: "https://global.krx.co.kr",
    pragma: "no-cache",
    referer:
      "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp",
    userAgent: "Mozilla/5.0"
  });
});

test("KRX legacy download network policy fixes isolation and limits", () => {
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
    maximumRequestBodyByteLength: 903,
    maximumResponseBodyByteLength: 252_928
  });
});

test("KRX legacy download network policy fixes response identity", () => {
  const policy = validPolicy();

  assert.deepEqual(policy.responseBoundary, {
    requiredHttpProtocolVersion: "http_1_1",
    requiredStatus: 200,
    requireContentLengthFraming: true,
    requiredContentType: "application/octet-stream",
    contentLengthBinding: "registered_document_exact_content_length",
    contentDispositionBinding: "attachment_exact_registered_file_name",
    observedCacheControl: "max-age=0, no-cache, no-store",
    observedPragma: "no-cache",
    requireExpiresEqualDate: true,
    requiredSetCookieHeaderCount: 0,
    rejectAge: true,
    rejectLocation: true,
    rejectContentEncoding: true,
    rejectTransferEncoding: true,
    rejectContentRange: true,
    rejectTrailers: true
  });
  assert.equal(policy.resultBoundary.durableEvidenceReusable, false);
  assert.equal(policy.resultBoundary.acceptedAcquisition, false);
});

test("KRX legacy download network policy rejects unsafe drift", () => {
  const policy = validPolicy();
  for (const value of [
    {
      ...policy,
      dedicatedDomainBoundary: {
        ...policy.dedicatedDomainBoundary,
        hostname: "global.krx.co.kr"
      }
    },
    {
      ...policy,
      fixedRequestHeaderValues: {
        ...policy.fixedRequestHeaderValues,
        referer: "https://file.krx.co.kr/"
      }
    },
    {
      ...policy,
      requestIsolation: { ...policy.requestIsolation, cookieJarEnabled: true }
    },
    {
      ...policy,
      responseBoundary: {
        ...policy.responseBoundary,
        requiredSetCookieHeaderCount: 1
      }
    },
    {
      ...policy,
      resultBoundary: { ...policy.resultBoundary, acceptedAcquisition: true }
    },
    { ...policy, extra: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition(
        value
      )
    );
  }
});

test("KRX legacy download network policy rejects unknown versions", () => {
  for (const value of [
    "krx_legacy_download_post_network_request.v2",
    "",
    null,
    undefined
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy(
        value
      )
    );
  }
});

test("KRX legacy download network policy returns fresh immutable definitions", () => {
  const first = validPolicy();
  const second = validPolicy();

  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.responseBoundary), true);
  assert.equal(Object.isFrozen(first.applicationRequestHeaderNames), true);
  assert.throws(() => {
    (first.applicationRequestHeaderNames as unknown as string[]).push("cookie");
  });
  assert.equal(
    second.applicationRequestHeaderNames.includes("cookie" as never),
    false
  );
});

function validPolicy() {
  return resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION
  );
}
