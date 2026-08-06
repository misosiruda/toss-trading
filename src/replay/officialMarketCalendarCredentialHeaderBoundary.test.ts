import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarCredentialHeaderBoundary } from "./officialMarketCalendarCredentialHeaderBoundary.js";

test("calendar credential header boundary accepts credential-free requests", () => {
  const boundary = requests();

  assert.deepEqual(
    verifyOfficialMarketCalendarCredentialHeaderBoundary(boundary),
    boundary
  );
});

test("calendar credential header boundary rejects each credential header", () => {
  for (const override of [
    { authorizationHeaderValues: ["secret"] },
    { proxyAuthorizationHeaderValues: ["secret"] },
    { cookieHeaderValues: ["session=secret"] }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarCredentialHeaderBoundary(
          requests({ effectiveRequests: [request(override)] })
        ),
      /must not contain credential headers/
    );
  }
});

test("calendar credential header boundary rejects credential headers on redirects", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarCredentialHeaderBoundary(
        requests({
          effectiveRequests: [
            request(),
            request({ cookieHeaderValues: ["session=secret"] })
          ]
        })
      ),
    /must not contain credential headers/
  );
});

test("calendar credential header boundary rejects invalid shape and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarCredentialHeaderBoundary(
      requests({ effectiveRequests: [] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarCredentialHeaderBoundary({
        ...requests(),
        credentialsMasked: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarCredentialHeaderBoundary(
        {
          effectiveRequests: [
            {
              ...request(),
              apiKeyHeaderValues: []
            }
          ]
        }
      ),
    /Unrecognized key/
  );
});

function requests(
  overrides: Partial<{
    effectiveRequests: ReturnType<typeof request>[];
  }> = {}
) {
  return {
    effectiveRequests: [request(), request()],
    ...overrides
  };
}

function request(
  overrides: Partial<{
    authorizationHeaderValues: string[];
    proxyAuthorizationHeaderValues: string[];
    cookieHeaderValues: string[];
  }> = {}
) {
  return {
    authorizationHeaderValues: [],
    proxyAuthorizationHeaderValues: [],
    cookieHeaderValues: [],
    ...overrides
  };
}
