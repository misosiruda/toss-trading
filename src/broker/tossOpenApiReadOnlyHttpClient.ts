import type { TossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";

export type TossOpenApiReadOnlyHttpClientErrorCode =
  | "TOSS_OPEN_API_READONLY_AUTH_DISABLED"
  | "TOSS_OPEN_API_READONLY_AUTH_INVALID_CONFIG"
  | "TOSS_OPEN_API_READONLY_INVALID_BASE_URL"
  | "TOSS_OPEN_API_READONLY_INVALID_PATH"
  | "TOSS_OPEN_API_READONLY_MUTATION_BLOCKED"
  | "TOSS_OPEN_API_READONLY_INVALID_RESPONSE"
  | "TOSS_OPEN_API_READONLY_AUTH_FAILED"
  | "TOSS_OPEN_API_READONLY_FORBIDDEN"
  | "TOSS_OPEN_API_READONLY_RATE_LIMITED"
  | "TOSS_OPEN_API_READONLY_CLIENT_ERROR"
  | "TOSS_OPEN_API_READONLY_SERVER_ERROR";

export type TossOpenApiReadOnlyQueryValue = string | number | boolean;

export interface TossOpenApiReadOnlyRequestInput {
  method?: string;
  path: string;
  query?: ReadonlyArray<
    readonly [string, TossOpenApiReadOnlyQueryValue | undefined]
  >;
}

export interface TossOpenApiReadOnlyHttpRequest {
  method: "GET";
  url: string;
  headers: {
    Accept: "application/json";
    Authorization: string;
  };
}

export interface TossOpenApiReadOnlyHttpResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface TossOpenApiReadOnlyTransport {
  request(
    request: TossOpenApiReadOnlyHttpRequest
  ): Promise<TossOpenApiReadOnlyHttpResponse>;
}

export interface TossOpenApiBearerTokenProvider {
  getAccessToken(): Promise<string>;
  clearToken?(): void | Promise<void>;
}

export interface TossOpenApiReadOnlyHttpClientErrorOptions {
  status?: number | undefined;
  responseCode?: string | undefined;
  retryAfterMs?: number | undefined;
}

export class TossOpenApiReadOnlyHttpClientError extends Error {
  readonly status: number | undefined;
  readonly responseCode: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly code: TossOpenApiReadOnlyHttpClientErrorCode,
    message: string,
    options: TossOpenApiReadOnlyHttpClientErrorOptions = {}
  ) {
    super(message);
    this.name = "TossOpenApiReadOnlyHttpClientError";
    this.status = options.status;
    this.responseCode = options.responseCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class TossOpenApiReadOnlyHttpClient {
  constructor(
    private readonly config: TossOpenApiAuthConfig,
    private readonly tokenProvider: TossOpenApiBearerTokenProvider,
    private readonly transport: TossOpenApiReadOnlyTransport
  ) {}

  async getJson(
    path: string,
    query?: TossOpenApiReadOnlyRequestInput["query"]
  ): Promise<unknown> {
    return this.requestJson({
      method: "GET",
      path,
      ...(query === undefined ? {} : { query })
    });
  }

  async requestJson(input: TossOpenApiReadOnlyRequestInput): Promise<unknown> {
    const url = buildTossOpenApiReadOnlyUrl(this.config.baseUrl, input);
    assertReadyAuthConfig(this.config);
    const response = await this.sendGetRequest(url);
    if (this.shouldRetryAfterTokenFailure(response)) {
      await this.tokenProvider.clearToken?.();
      return parseTossOpenApiReadOnlyHttpResponse(
        await this.sendGetRequest(url)
      );
    }

    return parseTossOpenApiReadOnlyHttpResponse(response);
  }

  private async sendGetRequest(
    url: string
  ): Promise<TossOpenApiReadOnlyHttpResponse> {
    const accessToken = await this.tokenProvider.getAccessToken();
    return this.transport.request(
      buildTossOpenApiReadOnlyHttpRequest(url, accessToken)
    );
  }

  private shouldRetryAfterTokenFailure(
    response: TossOpenApiReadOnlyHttpResponse
  ): boolean {
    return (
      response.status === 401 &&
      this.tokenProvider.clearToken !== undefined &&
      isRefreshableTokenErrorCode(readErrorCode(response.body))
    );
  }
}

export function buildTossOpenApiReadOnlyUrl(
  baseUrl: string,
  input: TossOpenApiReadOnlyRequestInput
): string {
  const method = (input.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_MUTATION_BLOCKED",
      "Toss Open API read-only client only allows GET requests."
    );
  }

  const base = parseHttpsBaseUrl(baseUrl);
  if (!input.path.startsWith("/") || input.path.startsWith("//")) {
    throwInvalidPath();
  }
  if (input.path.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(input.path)) {
    throwInvalidPath();
  }

  const url = new URL(input.path, base);
  if (url.origin !== base.origin) {
    throwInvalidPath();
  }

  for (const [key, value] of input.query ?? []) {
    if (value !== undefined) {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}

export function buildTossOpenApiReadOnlyHttpRequest(
  url: string,
  accessToken: string
): TossOpenApiReadOnlyHttpRequest {
  return {
    method: "GET",
    url,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  };
}

export function parseTossOpenApiReadOnlyHttpResponse(
  response: TossOpenApiReadOnlyHttpResponse
): unknown {
  if (
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599
  ) {
    throw new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_INVALID_RESPONSE",
      "Toss Open API read-only response status is invalid."
    );
  }

  if (response.status >= 200 && response.status < 300) {
    return response.body;
  }

  throw mapTossOpenApiReadOnlyHttpError(response);
}

function assertReadyAuthConfig(config: TossOpenApiAuthConfig): void {
  if (!config.enabled) {
    throw new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_AUTH_DISABLED",
      "Toss Open API read-only auth is disabled."
    );
  }

  if (config.status !== "ready") {
    const issueCodes = config.issues.map((issue) => issue.code).join(",");
    throw new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_AUTH_INVALID_CONFIG",
      issueCodes.length === 0
        ? "Toss Open API read-only auth config is invalid."
        : `Toss Open API read-only auth config is invalid: ${issueCodes}.`
    );
  }
}

function parseHttpsBaseUrl(baseUrl: string): URL {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("base URL must be https");
    }
    return parsed;
  } catch {
    throw new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_INVALID_BASE_URL",
      "Toss Open API base URL must be a valid https URL."
    );
  }
}

function throwInvalidPath(): never {
  throw new TossOpenApiReadOnlyHttpClientError(
    "TOSS_OPEN_API_READONLY_INVALID_PATH",
    "Toss Open API read-only path must be root-relative."
  );
}

function mapTossOpenApiReadOnlyHttpError(
  response: TossOpenApiReadOnlyHttpResponse
): TossOpenApiReadOnlyHttpClientError {
  const responseCode = readErrorCode(response.body);
  if (response.status === 401) {
    return new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_AUTH_FAILED",
      "Toss Open API read-only request authentication failed.",
      { status: response.status, responseCode }
    );
  }
  if (response.status === 403) {
    return new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_FORBIDDEN",
      "Toss Open API read-only request is forbidden.",
      { status: response.status, responseCode }
    );
  }
  if (response.status === 429) {
    return new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_RATE_LIMITED",
      "Toss Open API read-only request was rate limited.",
      {
        status: response.status,
        responseCode,
        retryAfterMs: parseRetryAfterMs(response.headers)
      }
    );
  }
  if (response.status >= 400 && response.status < 500) {
    return new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_CLIENT_ERROR",
      "Toss Open API read-only request failed with a client error.",
      { status: response.status, responseCode }
    );
  }
  if (response.status >= 500) {
    return new TossOpenApiReadOnlyHttpClientError(
      "TOSS_OPEN_API_READONLY_SERVER_ERROR",
      "Toss Open API read-only request failed with a server error.",
      { status: response.status, responseCode }
    );
  }

  return new TossOpenApiReadOnlyHttpClientError(
    "TOSS_OPEN_API_READONLY_INVALID_RESPONSE",
    "Toss Open API read-only response status is not handled.",
    { status: response.status, responseCode }
  );
}

function readErrorCode(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  if (typeof body.code === "string") {
    return body.code;
  }
  if (isRecord(body.error) && typeof body.error.code === "string") {
    return body.error.code;
  }
  if (typeof body.error === "string") {
    return body.error;
  }
  return undefined;
}

function isRefreshableTokenErrorCode(code: string | undefined): boolean {
  return (
    code === "invalid-token" ||
    code === "expired-token" ||
    code === "invalid_token" ||
    code === "expired_token"
  );
}

function parseRetryAfterMs(
  headers: Record<string, string | undefined> | undefined
): number | undefined {
  const retryAfter = readHeader(headers, "retry-after");
  if (retryAfter === undefined) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (!Number.isNaN(retryAt)) {
    const delayMs = retryAt - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return undefined;
}

function readHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name
  );
  return entry?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
