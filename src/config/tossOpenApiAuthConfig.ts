export const DEFAULT_TOSS_OPEN_API_BASE_URL =
  "https://openapi.tossinvest.com";

export type TossOpenApiAuthConfigStatus = "disabled" | "ready" | "invalid";

export type TossOpenApiAuthConfigIssueCode =
  | "INVALID_BASE_URL"
  | "MISSING_CLIENT_ID"
  | "MISSING_CLIENT_SECRET";

export interface TossOpenApiAuthConfigIssue {
  code: TossOpenApiAuthConfigIssueCode;
  message: string;
}

export interface TossOpenApiAuthConfig {
  enabled: boolean;
  status: TossOpenApiAuthConfigStatus;
  baseUrl: string;
  issues: TossOpenApiAuthConfigIssue[];
  clientId?: string;
  clientSecret?: string;
}

export interface SafeTossOpenApiAuthConfigSummary {
  enabled: boolean;
  status: TossOpenApiAuthConfigStatus;
  baseUrl: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  issues: TossOpenApiAuthConfigIssue[];
}

export function readTossOpenApiAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): TossOpenApiAuthConfig {
  const enabled = env.TOSS_OPEN_API_AUTH_ENABLED === "true";
  const baseUrl =
    readOptionalEnvValue(env.TOSS_OPEN_API_BASE_URL) ??
    DEFAULT_TOSS_OPEN_API_BASE_URL;
  const clientId = readOptionalEnvValue(env.TOSS_OPEN_API_CLIENT_ID);
  const clientSecret = readOptionalEnvValue(env.TOSS_OPEN_API_CLIENT_SECRET);

  if (!enabled) {
    return {
      enabled: false,
      status: "disabled",
      baseUrl,
      issues: [],
      ...(clientId === undefined ? {} : { clientId }),
      ...(clientSecret === undefined ? {} : { clientSecret })
    };
  }

  const issues: TossOpenApiAuthConfigIssue[] = [];
  if (!isHttpsUrl(baseUrl)) {
    issues.push({
      code: "INVALID_BASE_URL",
      message: "TOSS_OPEN_API_BASE_URL must be an https URL."
    });
  }
  if (clientId === undefined) {
    issues.push({
      code: "MISSING_CLIENT_ID",
      message: "TOSS_OPEN_API_CLIENT_ID is required when auth is enabled."
    });
  }
  if (clientSecret === undefined) {
    issues.push({
      code: "MISSING_CLIENT_SECRET",
      message: "TOSS_OPEN_API_CLIENT_SECRET is required when auth is enabled."
    });
  }

  return {
    enabled: true,
    status: issues.length === 0 ? "ready" : "invalid",
    baseUrl,
    issues,
    ...(clientId === undefined ? {} : { clientId }),
    ...(clientSecret === undefined ? {} : { clientSecret })
  };
}

export function summarizeTossOpenApiAuthConfig(
  config: TossOpenApiAuthConfig
): SafeTossOpenApiAuthConfigSummary {
  return {
    enabled: config.enabled,
    status: config.status,
    baseUrl: config.baseUrl,
    hasClientId: config.clientId !== undefined,
    hasClientSecret: config.clientSecret !== undefined,
    issues: config.issues
  };
}

function readOptionalEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
