import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION,
  verifyOfficialMarketCalendarTlsClientPolicy
} from "./officialMarketCalendarTlsClientPolicy.js";

test("calendar TLS client policy accepts the fail-closed platform policy", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarTlsClientPolicy(policy()),
    policy()
  );
});

test("calendar TLS client policy rejects a custom trust store", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarTlsClientPolicy(
      policy({ trustStore: "custom_ca" })
    )
  );
});

test("calendar TLS client policy requires certificate and hostname verification", () => {
  for (const overrides of [
    { certificateChainVerification: "disabled" },
    { hostnameVerification: "disabled" }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarTlsClientPolicy(policy(overrides))
    );
  }
});

test("calendar TLS client policy rejects bypass and client certificates", () => {
  for (const overrides of [
    { insecureTlsBypassEnabled: true },
    { clientCertificateConfigured: true }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarTlsClientPolicy(policy(overrides))
    );
  }
});

test("calendar TLS client policy rejects unknown version and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarTlsClientPolicy(
      policy({
        tlsClientPolicyVersion: "official_market_calendar_tls_client.v2"
      })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarTlsClientPolicy({
        ...policy(),
        rejectUnauthorized: true
      }),
    /Unrecognized key/
  );
});

function policy(
  overrides: Partial<{
    tlsClientPolicyVersion: string;
    trustStore: string;
    certificateChainVerification: string;
    hostnameVerification: string;
    insecureTlsBypassEnabled: boolean;
    clientCertificateConfigured: boolean;
  }> = {}
) {
  return {
    tlsClientPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION,
    trustStore: "platform_default",
    certificateChainVerification: "required",
    hostnameVerification: "required",
    insecureTlsBypassEnabled: false,
    clientCertificateConfigured: false,
    ...overrides
  };
}
