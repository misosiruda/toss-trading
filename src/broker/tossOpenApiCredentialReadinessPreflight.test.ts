import assert from "node:assert/strict";
import test from "node:test";

import {
  runTestOnlyTossOpenApiCredentialReadinessPreflight,
  TOSS_OPEN_API_CREDENTIAL_READINESS_PREFLIGHT_SCHEMA_VERSION
} from "./tossOpenApiCredentialReadinessPreflight.js";
import { TOSS_OPEN_API_CALENDAR_PATHS } from "./tossOpenApiCalendarNetworkTransport.js";

test("credential preflight reports secret-free readiness without external HTTP", async () => {
  const seenHosts: string[] = [];
  const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
    readyEnv(),
    async (hostname) => {
      seenHosts.push(hostname);
      return [
        { address: "203.0.113.10", family: 4 },
        { address: "2001:db8::10", family: 6 }
      ];
    }
  );
  const serialized = JSON.stringify(result);

  assert.equal(
    result.schemaVersion,
    TOSS_OPEN_API_CREDENTIAL_READINESS_PREFLIGHT_SCHEMA_VERSION
  );
  assert.equal(result.status, "ready_for_external_verification");
  assert.deepEqual(seenHosts, ["openapi.tossinvest.com"]);
  assert.deepEqual(result.host, {
    hostname: "openapi.tossinvest.com",
    dnsStatus: "resolved",
    resolvedAddressCount: 2,
    resolvedAddressFamilies: [4, 6]
  });
  assert.deepEqual(result.endpointAllowlist, [
    { method: "POST", path: "/oauth2/token" },
    { method: "GET", path: "/api/v1/market-calendar/KR" },
    { method: "GET", path: "/api/v1/market-calendar/US" }
  ]);
  assert.equal(Object.isFrozen(TOSS_OPEN_API_CALENDAR_PATHS), true);
  assert.deepEqual(result.externalVerification, {
    dnsLookupAttempted: true,
    tokenIssueAttempted: false,
    calendarRequestAttempted: false,
    providerResponseReceived: false,
    evidenceStatus: "not_claimed"
  });
  assert.equal(result.outboundIpRegistration.actualOutboundIpVerified, false);
  assert.equal(result.auth.hasClientId, true);
  assert.equal(result.auth.hasClientSecret, true);
  assert.equal(serialized.includes("synthetic-client-id"), false);
  assert.equal(serialized.includes("synthetic-client-secret"), false);
  assert.equal(serialized.includes("203.0.113.10"), false);
  assert.equal(serialized.includes("2001:db8::10"), false);
});

test("credential preflight keeps missing setup and DNS failure as explicit blockers", async () => {
  const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
    {},
    async () => {
      throw new Error("synthetic resolver detail must not escape");
    }
  );

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, [
    "AUTH_DISABLED",
    "OFFICIAL_HOST_DNS_UNRESOLVED",
    "OUTBOUND_IP_REGISTRATION_NOT_ATTESTED"
  ]);
  assert.equal(result.host.dnsStatus, "unresolved");
  assert.equal(
    JSON.stringify(result).includes("synthetic resolver detail"),
    false
  );
  assert.equal(
    result.checks.find(({ key }) => key === "endpoint_allowlist")?.status,
    "pass"
  );
});

test("credential preflight rejects unsafe runtime boundaries and invalid attestation", async () => {
  const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
    {
      ...readyEnv(),
      BROKER_PROVIDER: "official_toss_open_api",
      TRADING_ENABLED: "true",
      AI_DECISION_MODE: "live",
      TOSS_OPEN_API_BASE_URL:
        "https://url-user:url-secret@openapi.tossinvest.com/access-token?token=url-token#frag",
      TOSS_OPEN_API_OUTBOUND_IP_REGISTERED: "yes"
    },
    async () => [{ address: "not-an-ip", family: 4 }]
  );
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, [
    "BROKER_PROVIDER_NOT_MOCK",
    "TRADING_ENABLED",
    "AI_DECISION_MODE_NOT_PAPER_ONLY",
    "NONCANONICAL_BASE_URL",
    "OFFICIAL_HOST_DNS_UNRESOLVED",
    "INVALID_OUTBOUND_IP_REGISTRATION_FLAG"
  ]);
  assert.equal(result.auth.baseUrl, "[noncanonical-url]");
  assert.equal(serialized.includes("url-user"), false);
  assert.equal(serialized.includes("url-secret"), false);
  assert.equal(serialized.includes("url-token"), false);
  assert.equal(serialized.includes("frag"), false);
  assert.equal(serialized.includes("access-token"), false);
});

test("credential preflight rejects every explicit trading flag except exact false", async () => {
  for (const tradingEnabled of ["true ", "FALSE", "false ", "disabled", ""]) {
    const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
      {
        ...readyEnv(),
        TRADING_ENABLED: tradingEnabled
      },
      async () => [{ address: "203.0.113.10", family: 4 }]
    );

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["TRADING_ENABLED"]);
    assert.equal(
      result.checks.find(({ key }) => key === "trading_enabled")?.status,
      "blocked"
    );
  }
});

test("credential preflight rejects non-exact broker and AI mode values", async () => {
  const cases: Array<{
    key: "BROKER_PROVIDER" | "AI_DECISION_MODE";
    value: string;
    blocker: "BROKER_PROVIDER_NOT_MOCK" | "AI_DECISION_MODE_NOT_PAPER_ONLY";
  }> = [
    { key: "BROKER_PROVIDER", value: " mock ", blocker: "BROKER_PROVIDER_NOT_MOCK" },
    { key: "BROKER_PROVIDER", value: "", blocker: "BROKER_PROVIDER_NOT_MOCK" },
    {
      key: "AI_DECISION_MODE",
      value: " paper_only ",
      blocker: "AI_DECISION_MODE_NOT_PAPER_ONLY"
    },
    {
      key: "AI_DECISION_MODE",
      value: "",
      blocker: "AI_DECISION_MODE_NOT_PAPER_ONLY"
    }
  ];

  for (const { key, value, blocker } of cases) {
    const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
      {
        ...readyEnv(),
        [key]: value
      },
      async () => [{ address: "203.0.113.10", family: 4 }]
    );

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [blocker]);
  }
});

test("credential preflight compares the raw base URL before config normalization", async () => {
  for (const baseUrl of [
    "",
    "   ",
    " https://openapi.tossinvest.com",
    "https://openapi.tossinvest.com "
  ]) {
    const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
      {
        ...readyEnv(),
        TOSS_OPEN_API_BASE_URL: baseUrl
      },
      async () => [{ address: "203.0.113.10", family: 4 }]
    );

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["NONCANONICAL_BASE_URL"]);
    assert.equal(result.auth.baseUrl, "[noncanonical-url]");
  }
});

test("credential preflight accepts only exact outbound IP attestation flags", async () => {
  for (const outboundIpRegistered of [" true ", "false ", "TRUE", "yes", ""]) {
    const result = await runTestOnlyTossOpenApiCredentialReadinessPreflight(
      {
        ...readyEnv(),
        TOSS_OPEN_API_OUTBOUND_IP_REGISTERED: outboundIpRegistered
      },
      async () => [{ address: "203.0.113.10", family: 4 }]
    );

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      "INVALID_OUTBOUND_IP_REGISTRATION_FLAG"
    ]);
    assert.equal(result.outboundIpRegistration.status, "invalid");
  }
});

function readyEnv(): NodeJS.ProcessEnv {
  return {
    BROKER_PROVIDER: "mock",
    TRADING_ENABLED: "false",
    AI_DECISION_MODE: "paper_only",
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_CLIENT_ID: "synthetic-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "synthetic-client-secret",
    TOSS_OPEN_API_OUTBOUND_IP_REGISTERED: "true"
  };
}
