import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  DEFAULT_TOSS_OPEN_API_BASE_URL,
  readTossOpenApiAuthConfig,
  summarizeTossOpenApiAuthConfig,
  type SafeTossOpenApiAuthConfigSummary
} from "../config/tossOpenApiAuthConfig.js";
import { TOSS_OPEN_API_TOKEN_PATH } from "./tossOpenApiAuthClient.js";
import { TOSS_OPEN_API_CALENDAR_PATHS } from "./tossOpenApiCalendarNetworkTransport.js";

export const TOSS_OPEN_API_CREDENTIAL_READINESS_PREFLIGHT_SCHEMA_VERSION =
  "toss_open_api_credential_readiness_preflight.v1";
export const TOSS_OPEN_API_OUTBOUND_IP_REGISTRATION_ENV =
  "TOSS_OPEN_API_OUTBOUND_IP_REGISTERED";

const OFFICIAL_HOSTNAME = new URL(DEFAULT_TOSS_OPEN_API_BASE_URL).hostname;
const DNS_LOOKUP_TIMEOUT_MILLISECONDS = 3_000;

export type TossOpenApiCredentialReadinessPreflightStatus =
  | "blocked"
  | "ready_for_external_verification";

export type TossOpenApiCredentialReadinessBlockerCode =
  | "BROKER_PROVIDER_NOT_MOCK"
  | "TRADING_ENABLED"
  | "AI_DECISION_MODE_NOT_PAPER_ONLY"
  | "AUTH_DISABLED"
  | "AUTH_CONFIG_INVALID"
  | "NONCANONICAL_BASE_URL"
  | "OFFICIAL_HOST_DNS_UNRESOLVED"
  | "OUTBOUND_IP_REGISTRATION_NOT_ATTESTED"
  | "INVALID_OUTBOUND_IP_REGISTRATION_FLAG";

export interface TossOpenApiCredentialReadinessCheck {
  key:
    | "broker_provider"
    | "trading_enabled"
    | "ai_decision_mode"
    | "auth_config"
    | "canonical_base_url"
    | "official_host_dns"
    | "outbound_ip_registration"
    | "endpoint_allowlist";
  status: "pass" | "blocked";
  detail: string;
}

export interface TossOpenApiCredentialReadinessPreflight {
  schemaVersion: typeof TOSS_OPEN_API_CREDENTIAL_READINESS_PREFLIGHT_SCHEMA_VERSION;
  mode: "paper_only";
  readOnly: true;
  status: TossOpenApiCredentialReadinessPreflightStatus;
  auth: SafeTossOpenApiAuthConfigSummary;
  host: {
    hostname: typeof OFFICIAL_HOSTNAME;
    dnsStatus: "resolved" | "unresolved";
    resolvedAddressCount: number;
    resolvedAddressFamilies: Array<4 | 6>;
  };
  outboundIpRegistration: {
    status: "attested" | "not_attested" | "invalid";
    source: typeof TOSS_OPEN_API_OUTBOUND_IP_REGISTRATION_ENV;
    actualOutboundIpVerified: false;
  };
  endpointAllowlist: Array<{
    method: "GET" | "POST";
    path: string;
  }>;
  externalVerification: {
    dnsLookupAttempted: true;
    tokenIssueAttempted: false;
    calendarRequestAttempted: false;
    providerResponseReceived: false;
    evidenceStatus: "not_claimed";
  };
  checks: TossOpenApiCredentialReadinessCheck[];
  blockers: TossOpenApiCredentialReadinessBlockerCode[];
}

export interface TestOnlyTossOpenApiHostAddress {
  address: string;
  family: 4 | 6;
}

export type TestOnlyTossOpenApiHostResolver = (
  hostname: string
) => Promise<readonly TestOnlyTossOpenApiHostAddress[]>;

export async function runTossOpenApiCredentialReadinessPreflight(
  env: NodeJS.ProcessEnv = process.env
): Promise<TossOpenApiCredentialReadinessPreflight> {
  return runPreflight(env, resolveOfficialHost);
}

export async function runTestOnlyTossOpenApiCredentialReadinessPreflight(
  env: NodeJS.ProcessEnv,
  resolveHost: TestOnlyTossOpenApiHostResolver
): Promise<TossOpenApiCredentialReadinessPreflight> {
  return runPreflight(env, resolveHost);
}

async function runPreflight(
  env: NodeJS.ProcessEnv,
  resolveHost: TestOnlyTossOpenApiHostResolver
): Promise<TossOpenApiCredentialReadinessPreflight> {
  const authConfig = readTossOpenApiAuthConfig(env);
  const canonicalBaseUrl =
    authConfig.baseUrl === DEFAULT_TOSS_OPEN_API_BASE_URL;
  const safeAuthSummary = summarizeTossOpenApiAuthConfig(authConfig);
  const auth: SafeTossOpenApiAuthConfigSummary = {
    ...safeAuthSummary,
    baseUrl: canonicalBaseUrl
      ? DEFAULT_TOSS_OPEN_API_BASE_URL
      : "[noncanonical-url]"
  };
  const brokerProvider = env.BROKER_PROVIDER?.trim() || "mock";
  const tradingEnabled = env.TRADING_ENABLED === "true";
  const aiDecisionMode = env.AI_DECISION_MODE?.trim() || "paper_only";
  const outboundIpRegistration = readOutboundIpRegistration(env);
  const host = await inspectOfficialHost(resolveHost);
  const blockers: TossOpenApiCredentialReadinessBlockerCode[] = [];
  const checks: TossOpenApiCredentialReadinessCheck[] = [];

  addCheck(
    checks,
    blockers,
    "broker_provider",
    brokerProvider === "mock",
    "Broker provider remains on the mock boundary.",
    "Credential preflight requires BROKER_PROVIDER=mock.",
    "BROKER_PROVIDER_NOT_MOCK"
  );
  addCheck(
    checks,
    blockers,
    "trading_enabled",
    !tradingEnabled,
    "Live trading remains disabled.",
    "Credential preflight requires TRADING_ENABLED=false.",
    "TRADING_ENABLED"
  );
  addCheck(
    checks,
    blockers,
    "ai_decision_mode",
    aiDecisionMode === "paper_only",
    "AI decision mode remains paper_only.",
    "Credential preflight requires AI_DECISION_MODE=paper_only.",
    "AI_DECISION_MODE_NOT_PAPER_ONLY"
  );

  if (auth.status === "disabled") {
    blockers.push("AUTH_DISABLED");
    checks.push({
      key: "auth_config",
      status: "blocked",
      detail: "Toss Open API auth is disabled."
    });
  } else if (auth.status === "invalid") {
    blockers.push("AUTH_CONFIG_INVALID");
    checks.push({
      key: "auth_config",
      status: "blocked",
      detail: "Toss Open API auth config is invalid."
    });
  } else {
    checks.push({
      key: "auth_config",
      status: "pass",
      detail: "Credential presence is configured; values are not exposed."
    });
  }

  addCheck(
    checks,
    blockers,
    "canonical_base_url",
    canonicalBaseUrl,
    "Official API base URL matches the canonical origin.",
    "Official API base URL must match the canonical origin exactly.",
    "NONCANONICAL_BASE_URL"
  );
  addCheck(
    checks,
    blockers,
    "official_host_dns",
    host.dnsStatus === "resolved",
    "Official API hostname resolved without making an HTTP request.",
    "Official API hostname did not resolve within the preflight boundary.",
    "OFFICIAL_HOST_DNS_UNRESOLVED"
  );

  if (outboundIpRegistration.status === "attested") {
    checks.push({
      key: "outbound_ip_registration",
      status: "pass",
      detail:
        "Owner attested that the current outbound IP is registered; preflight does not verify the actual egress IP."
    });
  } else {
    const blocker =
      outboundIpRegistration.status === "invalid"
        ? "INVALID_OUTBOUND_IP_REGISTRATION_FLAG"
        : "OUTBOUND_IP_REGISTRATION_NOT_ATTESTED";
    blockers.push(blocker);
    checks.push({
      key: "outbound_ip_registration",
      status: "blocked",
      detail:
        outboundIpRegistration.status === "invalid"
          ? "Outbound IP registration flag must be exactly true or false."
          : "Owner attestation for the registered outbound IP is missing."
    });
  }

  checks.push({
    key: "endpoint_allowlist",
    status: "pass",
    detail:
      "Preflight exposes only the fixed token POST and KR/US calendar GET endpoint identities."
  });

  return deepFreeze({
    schemaVersion: TOSS_OPEN_API_CREDENTIAL_READINESS_PREFLIGHT_SCHEMA_VERSION,
    mode: "paper_only",
    readOnly: true,
    status:
      blockers.length === 0 ? "ready_for_external_verification" : "blocked",
    auth,
    host,
    outboundIpRegistration,
    endpointAllowlist: [
      { method: "POST", path: TOSS_OPEN_API_TOKEN_PATH },
      { method: "GET", path: TOSS_OPEN_API_CALENDAR_PATHS.KR },
      { method: "GET", path: TOSS_OPEN_API_CALENDAR_PATHS.US }
    ],
    externalVerification: {
      dnsLookupAttempted: true,
      tokenIssueAttempted: false,
      calendarRequestAttempted: false,
      providerResponseReceived: false,
      evidenceStatus: "not_claimed"
    },
    checks,
    blockers
  });
}

async function resolveOfficialHost(
  hostname: string
): Promise<readonly TestOnlyTossOpenApiHostAddress[]> {
  const timeout = AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MILLISECONDS);
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timeout.addEventListener(
        "abort",
        () => reject(new Error("official host DNS lookup timed out")),
        { once: true }
      );
    })
  ]);
  return addresses.map((entry) => {
    if (entry.family !== 4 && entry.family !== 6) {
      throw new Error("official host DNS lookup returned an unknown family");
    }
    return { address: entry.address, family: entry.family };
  });
}

async function inspectOfficialHost(
  resolveHost: TestOnlyTossOpenApiHostResolver
): Promise<TossOpenApiCredentialReadinessPreflight["host"]> {
  try {
    const addresses = await resolveHost(OFFICIAL_HOSTNAME);
    if (
      addresses.length === 0 ||
      addresses.some(
        (entry) =>
          isIP(entry.address) !== entry.family ||
          (entry.family !== 4 && entry.family !== 6)
      )
    ) {
      throw new Error("invalid DNS result");
    }
    const resolvedAddressFamilies = [...new Set(addresses.map(({ family }) => family))]
      .sort((left, right) => left - right) as Array<4 | 6>;
    return {
      hostname: OFFICIAL_HOSTNAME,
      dnsStatus: "resolved",
      resolvedAddressCount: addresses.length,
      resolvedAddressFamilies
    };
  } catch {
    return {
      hostname: OFFICIAL_HOSTNAME,
      dnsStatus: "unresolved",
      resolvedAddressCount: 0,
      resolvedAddressFamilies: []
    };
  }
}

function readOutboundIpRegistration(
  env: NodeJS.ProcessEnv
): TossOpenApiCredentialReadinessPreflight["outboundIpRegistration"] {
  const value = env[TOSS_OPEN_API_OUTBOUND_IP_REGISTRATION_ENV]?.trim();
  return {
    status:
      value === "true"
        ? "attested"
        : value === undefined || value === "" || value === "false"
          ? "not_attested"
          : "invalid",
    source: TOSS_OPEN_API_OUTBOUND_IP_REGISTRATION_ENV,
    actualOutboundIpVerified: false
  };
}

function addCheck(
  checks: TossOpenApiCredentialReadinessCheck[],
  blockers: TossOpenApiCredentialReadinessBlockerCode[],
  key: TossOpenApiCredentialReadinessCheck["key"],
  accepted: boolean,
  passDetail: string,
  blockedDetail: string,
  blocker: TossOpenApiCredentialReadinessBlockerCode
): void {
  checks.push({
    key,
    status: accepted ? "pass" : "blocked",
    detail: accepted ? passDetail : blockedDetail
  });
  if (!accepted) {
    blockers.push(blocker);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
