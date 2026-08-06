import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION,
  verifyOfficialMarketCalendarCredentialFreeClientPolicy
} from "./officialMarketCalendarCredentialFreeClientPolicy.js";

test("calendar credential-free client policy accepts disabled credential sources", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarCredentialFreeClientPolicy(policy()),
    policy()
  );
});

test("calendar credential-free client policy rejects configured credential sources", () => {
  for (const overrides of [
    { credentialProviderConfigured: true },
    { proxyCredentialConfigured: true },
    { httpAuthHandlerConfigured: true },
    { cookieJarConfigured: true }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarCredentialFreeClientPolicy(
        policy(overrides)
      )
    );
  }
});

test("calendar credential-free client policy rejects unknown version", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarCredentialFreeClientPolicy(
      policy({
        credentialFreeClientPolicyVersion:
          "official_market_calendar_credential_free_client.v2"
      })
    )
  );
});

test("calendar credential-free client policy rejects unknown fields", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarCredentialFreeClientPolicy({
        ...policy(),
        apiKey: null
      }),
    /Unrecognized key/
  );
});

function policy(
  overrides: Partial<{
    credentialFreeClientPolicyVersion: string;
    credentialProviderConfigured: boolean;
    proxyCredentialConfigured: boolean;
    httpAuthHandlerConfigured: boolean;
    cookieJarConfigured: boolean;
  }> = {}
) {
  return {
    credentialFreeClientPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION,
    credentialProviderConfigured: false,
    proxyCredentialConfigured: false,
    httpAuthHandlerConfigured: false,
    cookieJarConfigured: false,
    ...overrides
  };
}
