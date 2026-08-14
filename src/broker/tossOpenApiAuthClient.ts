import type { TossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";

export const TOSS_OPEN_API_TOKEN_PATH = "/oauth2/token";
export const TOSS_OPEN_API_TOKEN_CONTENT_TYPE =
  "application/x-www-form-urlencoded";

export type TossOpenApiAuthClientErrorCode =
  | "TOSS_OPEN_API_AUTH_DISABLED"
  | "TOSS_OPEN_API_AUTH_INVALID_CONFIG"
  | "TOSS_OPEN_API_INVALID_TOKEN_RESPONSE";

export interface TossOpenApiTokenIssueRequest {
  method: "POST";
  url: string;
  headers: {
    "Content-Type": typeof TOSS_OPEN_API_TOKEN_CONTENT_TYPE;
    Accept: "application/json";
  };
  body: string;
}

export interface TossOpenApiTokenIssueResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface TossOpenApiIssuedToken {
  accessToken: string;
  tokenType: "Bearer";
  issuedAt: Date;
  expiresAt: Date;
}

export interface TossOpenApiTokenLease {
  token: TossOpenApiIssuedToken;
  generation: number;
}

export interface TossOpenApiTokenIssuer {
  issueToken(
    request: TossOpenApiTokenIssueRequest
  ): Promise<unknown>;
}

export interface TossOpenApiAuthClientOptions {
  now?: () => Date;
  expirySafetyMarginMs?: number;
}

export class TossOpenApiAuthClientError extends Error {
  constructor(
    readonly code: TossOpenApiAuthClientErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TossOpenApiAuthClientError";
  }
}

export class TossOpenApiAuthClient {
  private cachedLease: TossOpenApiTokenLease | undefined;
  private pendingIssue: Promise<TossOpenApiTokenLease> | undefined;
  private generation = 0;

  constructor(
    private readonly config: TossOpenApiAuthConfig,
    private readonly issuer: TossOpenApiTokenIssuer,
    private readonly options: TossOpenApiAuthClientOptions = {}
  ) {}

  async getAccessToken(): Promise<string> {
    const lease = await this.getTokenLease();
    return lease.token.accessToken;
  }

  async getToken(): Promise<TossOpenApiIssuedToken> {
    const lease = await this.getTokenLease();
    return lease.token;
  }

  async getTokenLease(): Promise<TossOpenApiTokenLease> {
    this.assertReadyConfig();

    const now = this.now();
    if (
      this.cachedLease !== undefined &&
      this.isTokenUsable(this.cachedLease.token, now)
    ) {
      return this.cachedLease;
    }

    const pendingIssue = (this.pendingIssue ??= this.issueAndCacheToken());
    try {
      return await pendingIssue;
    } finally {
      if (this.pendingIssue === pendingIssue) {
        this.pendingIssue = undefined;
      }
    }
  }

  invalidateTokenLease(generation: number): boolean {
    if (this.cachedLease?.generation !== generation) {
      return false;
    }
    this.cachedLease = undefined;
    return true;
  }

  private async issueAndCacheToken(): Promise<TossOpenApiTokenLease> {
    const issuedAt = this.now();
    const response = await this.issuer.issueToken(
      buildTossOpenApiTokenIssueRequest(this.config)
    );
    const token = parseTossOpenApiTokenIssueResponse(response, issuedAt);
    const generation = this.nextGeneration();
    const lease = Object.freeze({ token: Object.freeze(token), generation });
    this.cachedLease = lease;
    return lease;
  }

  private nextGeneration(): number {
    if (this.generation === Number.MAX_SAFE_INTEGER) {
      throw new TossOpenApiAuthClientError(
        "TOSS_OPEN_API_INVALID_TOKEN_RESPONSE",
        "Toss Open API token lease generation is exhausted."
      );
    }
    this.generation += 1;
    return this.generation;
  }

  private assertReadyConfig(): void {
    assertReadyAuthConfig(this.config);
  }

  private isTokenUsable(token: TossOpenApiIssuedToken, now: Date): boolean {
    return (
      now.getTime() + this.expirySafetyMarginMs() < token.expiresAt.getTime()
    );
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private expirySafetyMarginMs(): number {
    return this.options.expirySafetyMarginMs ?? 60_000;
  }
}

export function buildTossOpenApiTokenIssueRequest(
  config: TossOpenApiAuthConfig
): TossOpenApiTokenIssueRequest {
  assertReadyAuthConfig(config);

  const body = new URLSearchParams([
    ["grant_type", "client_credentials"],
    ["client_id", config.clientId],
    ["client_secret", config.clientSecret]
  ]);

  return {
    method: "POST",
    url: new URL(TOSS_OPEN_API_TOKEN_PATH, config.baseUrl).toString(),
    headers: {
      "Content-Type": TOSS_OPEN_API_TOKEN_CONTENT_TYPE,
      Accept: "application/json"
    },
    body: body.toString()
  };
}

function assertReadyAuthConfig(
  config: TossOpenApiAuthConfig
): asserts config is TossOpenApiAuthConfig & {
  clientId: string;
  clientSecret: string;
} {
  if (!config.enabled) {
    throw new TossOpenApiAuthClientError(
      "TOSS_OPEN_API_AUTH_DISABLED",
      "Toss Open API auth is disabled."
    );
  }

  if (config.status !== "ready") {
    const issueCodes = config.issues.map((issue) => issue.code).join(",");
    throw new TossOpenApiAuthClientError(
      "TOSS_OPEN_API_AUTH_INVALID_CONFIG",
      issueCodes.length === 0
        ? "Toss Open API auth config is invalid."
        : `Toss Open API auth config is invalid: ${issueCodes}.`
    );
  }
}

export function parseTossOpenApiTokenIssueResponse(
  response: unknown,
  issuedAt: Date
): TossOpenApiIssuedToken {
  if (
    !isRecord(response) ||
    typeof response.access_token !== "string" ||
    response.access_token.trim().length === 0 ||
    response.token_type !== "Bearer" ||
    typeof response.expires_in !== "number" ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new TossOpenApiAuthClientError(
      "TOSS_OPEN_API_INVALID_TOKEN_RESPONSE",
      "Toss Open API token response is invalid."
    );
  }

  return {
    accessToken: response.access_token,
    tokenType: "Bearer",
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + response.expires_in * 1000)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
