import { createHash } from "node:crypto";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { TextDecoder } from "node:util";

import {
  DEFAULT_TOSS_OPEN_API_BASE_URL,
  type TossOpenApiAuthConfig
} from "../config/tossOpenApiAuthConfig.js";
import {
  OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION,
  verifyOfficialMarketCalendarCacheRequestPolicy
} from "../replay/officialMarketCalendarCacheRequestPolicy.js";
import {
  createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders,
  type ResolvedOfficialMarketCalendarNetworkResponseFreshness
} from "../replay/officialMarketCalendarNetworkResponseFreshness.js";
import {
  verifyOfficialMarketCalendarTransferCompletion,
  type OfficialMarketCalendarTransferCompletion
} from "../replay/officialMarketCalendarTransferCompletion.js";
import type { TossOpenApiBearerTokenProvider } from "./tossOpenApiReadOnlyHttpClient.js";

export const TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_MS = 10_000;
export const TOSS_OPEN_API_CALENDAR_RESPONSE_MAX_BYTES = 1024 * 1024;

const TOSS_OPEN_API_HOSTNAME = "openapi.tossinvest.com";
const TOSS_OPEN_API_HTTPS_PORT = 443;
const TOSS_OPEN_API_CALENDAR_PATHS = {
  KR: "/api/v1/market-calendar/KR",
  US: "/api/v1/market-calendar/US"
} as const;

export type TossOpenApiCalendarMarket = keyof typeof TOSS_OPEN_API_CALENDAR_PATHS;

export interface TossOpenApiCalendarNetworkRequest {
  market: TossOpenApiCalendarMarket;
  date: string;
}

export interface TossOpenApiCalendarNetworkObservation {
  market: TossOpenApiCalendarMarket;
  date: string;
  requestUrl: string;
  httpStatus: 200;
  httpProtocolVersion: "http_1_0" | "http_1_1";
  transferCompletion: OfficialMarketCalendarTransferCompletion;
  completedAt: string;
  responseDelayMilliseconds: number;
  responseByteLength: number;
  responseSha256: string;
  responseBytes: Buffer;
  parsedBody: unknown;
  responseFreshness: ResolvedOfficialMarketCalendarNetworkResponseFreshness;
}

export interface TossOpenApiCalendarNetworkClient {
  getCalendar(
    request: TossOpenApiCalendarNetworkRequest
  ): Promise<TossOpenApiCalendarNetworkObservation>;
}

export type TossOpenApiCalendarNetworkErrorCode =
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_DISABLED"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_REQUEST"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_TOKEN_LEASE"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_NETWORK_FAILURE"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_STATUS"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_HEADERS"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_RESPONSE_TOO_LARGE"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INCOMPLETE_RESPONSE"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_JSON"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_AUTH_FAILED"
  | "TOSS_OPEN_API_CALENDAR_TRANSPORT_FRESHNESS_REJECTED";

export interface TossOpenApiCalendarNetworkErrorOptions {
  status?: number;
  responseByteLength?: number;
}

export class TossOpenApiCalendarNetworkError extends Error {
  readonly status: number | undefined;
  readonly responseByteLength: number | undefined;

  constructor(
    readonly code: TossOpenApiCalendarNetworkErrorCode,
    message: string,
    options: TossOpenApiCalendarNetworkErrorOptions = {}
  ) {
    super(message);
    this.name = "TossOpenApiCalendarNetworkError";
    this.status = options.status;
    this.responseByteLength = options.responseByteLength;
  }
}

export interface TestOnlyTossOpenApiCalendarSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
  nowMonotonicNanoseconds?: () => bigint;
  nowUtc?: () => Date;
}

type HttpsRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

interface TossOpenApiCalendarNetworkTransportOptions {
  deadlineMs: number;
  nowMonotonicNanoseconds: () => bigint;
  nowUtc: () => Date;
  request: HttpsRequest;
}

interface CanonicalCalendarRequest {
  market: TossOpenApiCalendarMarket;
  date: string;
  url: string;
  pathAndQuery: string;
}

interface AttemptResponse {
  status: 200 | 401;
  parsedBody: unknown;
  observation?: TossOpenApiCalendarNetworkObservation;
}

interface ResponseHeaderBoundary {
  declaredContentLength: number | null;
  httpProtocolVersion: "http_1_0" | "http_1_1";
  transferFraming: "content_length" | "chunked";
}

class TossOpenApiCalendarNetworkTransport
  implements TossOpenApiCalendarNetworkClient
{
  constructor(
    private readonly config: TossOpenApiAuthConfig,
    private readonly tokenProvider: TossOpenApiBearerTokenProvider,
    private readonly options: TossOpenApiCalendarNetworkTransportOptions
  ) {}

  async getCalendar(
    input: TossOpenApiCalendarNetworkRequest
  ): Promise<TossOpenApiCalendarNetworkObservation> {
    this.assertReadyConfig();
    const request = buildCanonicalCalendarRequest(input);
    const initialLease = await this.getValidatedTokenLease();
    const initial = await this.executeAttempt(request, initialLease.token.accessToken);
    if (initial.status === 200) {
      return requireObservation(initial);
    }
    if (!isRefreshableTokenError(initial.parsedBody)) {
      throwAuthFailed(initial.status);
    }

    await this.tokenProvider.invalidateTokenLease(initialLease.generation);
    const retryLease = await this.getValidatedTokenLease();
    const retry = await this.executeAttempt(request, retryLease.token.accessToken);
    if (retry.status === 200) {
      return requireObservation(retry);
    }
    if (isRefreshableTokenError(retry.parsedBody)) {
      await this.tokenProvider.invalidateTokenLease(retryLease.generation);
    }
    throwAuthFailed(retry.status);
  }

  private assertReadyConfig(): void {
    if (!this.config.enabled) {
      throw new TossOpenApiCalendarNetworkError(
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_DISABLED",
        "Toss Open API calendar network transport is disabled."
      );
    }
    if (
      this.config.status !== "ready" ||
      this.config.baseUrl !== DEFAULT_TOSS_OPEN_API_BASE_URL ||
      typeof this.config.clientId !== "string" ||
      this.config.clientId.trim().length === 0 ||
      typeof this.config.clientSecret !== "string" ||
      this.config.clientSecret.trim().length === 0
    ) {
      throw new TossOpenApiCalendarNetworkError(
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG",
        "Toss Open API calendar network transport config is invalid."
      );
    }
  }

  private async getValidatedTokenLease(): Promise<{
    token: { accessToken: string };
    generation: number;
  }> {
    const lease = await this.tokenProvider.getTokenLease();
    if (
      typeof lease?.token?.accessToken !== "string" ||
      !isValidBearerAccessToken(lease.token.accessToken) ||
      !Number.isSafeInteger(lease.generation) ||
      lease.generation < 1
    ) {
      throw new TossOpenApiCalendarNetworkError(
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_TOKEN_LEASE",
        "Toss Open API calendar token lease is invalid."
      );
    }
    return lease;
  }

  private executeAttempt(
    request: CanonicalCalendarRequest,
    accessToken: string
  ): Promise<AttemptResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let clientRequest: ClientRequest | undefined;
      let responseStarted = false;
      const startedAtNanoseconds = readMonotonicNanoseconds(
        this.options.nowMonotonicNanoseconds
      );
      const finish = (error: unknown, value?: AttemptResponse): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error === undefined) {
          resolve(value!);
        } else {
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        finish(
          new TossOpenApiCalendarNetworkError(
            "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED",
            "Toss Open API calendar network deadline was exceeded."
          )
        );
        clientRequest?.destroy();
      }, this.options.deadlineMs);

      try {
        clientRequest = this.options.request(
          buildHttpsRequestOptions(request, accessToken),
          (response) => {
            responseStarted = true;
            this.readAttemptResponse(response, request, startedAtNanoseconds).then(
              (value) => finish(undefined, value),
              (error: unknown) => finish(error)
            );
          }
        );
      } catch {
        finish(
          new TossOpenApiCalendarNetworkError(
            responseStarted
              ? "TOSS_OPEN_API_CALENDAR_TRANSPORT_INCOMPLETE_RESPONSE"
              : "TOSS_OPEN_API_CALENDAR_TRANSPORT_NETWORK_FAILURE",
            responseStarted
              ? "Toss Open API calendar response was incomplete."
              : "Toss Open API calendar network request failed."
          )
        );
        return;
      }

      clientRequest.once("error", () => {
        finish(
          new TossOpenApiCalendarNetworkError(
            responseStarted
              ? "TOSS_OPEN_API_CALENDAR_TRANSPORT_INCOMPLETE_RESPONSE"
              : "TOSS_OPEN_API_CALENDAR_TRANSPORT_NETWORK_FAILURE",
            responseStarted
              ? "Toss Open API calendar response was incomplete."
              : "Toss Open API calendar network request failed."
          )
        );
      });
      clientRequest.end();
    });
  }

  private async readAttemptResponse(
    response: IncomingMessage,
    request: CanonicalCalendarRequest,
    startedAtNanoseconds: bigint
  ): Promise<AttemptResponse> {
    const headerBoundary = assertResponseHeaders(response);
    const status = response.statusCode as 200 | 401;
    const chunks: Buffer[] = [];
    let responseByteLength = 0;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: AttemptResponse): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (error === undefined) {
          resolve(value!);
        } else {
          reject(error);
        }
      };

      response.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }
        responseByteLength += chunk.byteLength;
        if (responseByteLength > TOSS_OPEN_API_CALENDAR_RESPONSE_MAX_BYTES) {
          finish(
            new TossOpenApiCalendarNetworkError(
              "TOSS_OPEN_API_CALENDAR_TRANSPORT_RESPONSE_TOO_LARGE",
              "Toss Open API calendar response exceeded the byte limit.",
              { responseByteLength }
            )
          );
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.once("aborted", () => finish(incompleteResponse(responseByteLength)));
      response.once("error", () => finish(incompleteResponse(responseByteLength)));
      response.once("end", () => {
        if (!response.complete) {
          finish(incompleteResponse(responseByteLength));
          return;
        }
        try {
          assertResponseTrailers(response);
          const transferCompletion = verifyOfficialMarketCalendarTransferCompletion({
            httpProtocolVersion: headerBoundary.httpProtocolVersion,
            transferFraming: headerBoundary.transferFraming,
            transferCompleted: true,
            declaredContentLength: headerBoundary.declaredContentLength,
            contentLength: responseByteLength
          });
          const responseBytes = Buffer.concat(chunks, responseByteLength);
          if (status === 401) {
            finish(undefined, {
              status,
              parsedBody: parseJson(responseBytes, responseByteLength)
            });
            return;
          }
          const completedAtNanoseconds = readMonotonicNanoseconds(
            this.options.nowMonotonicNanoseconds
          );
          const responseDelayMilliseconds = resolveResponseDelayMilliseconds(
            startedAtNanoseconds,
            completedAtNanoseconds,
            this.options.deadlineMs
          );
          const completedAt = readCompletedAt(this.options.nowUtc);
          const parsedBody = parseJson(responseBytes, responseByteLength);
          let responseFreshness: ResolvedOfficialMarketCalendarNetworkResponseFreshness;
          try {
            responseFreshness =
              createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders({
                completedAt,
                responseDelayMilliseconds,
                responseCacheHeaders: {
                  dateHeaderValues: readRawHeaderValues(response.rawHeaders, "date"),
                  ageHeaderValues: readRawHeaderValues(response.rawHeaders, "age"),
                  expiresHeaderValues: readRawHeaderValues(
                    response.rawHeaders,
                    "expires"
                  )
                },
                responseCacheControl: {
                  cacheControlHeaderValues: readRawHeaderValues(
                    response.rawHeaders,
                    "cache-control"
                  )
                }
              });
          } catch {
            throw new TossOpenApiCalendarNetworkError(
              "TOSS_OPEN_API_CALENDAR_TRANSPORT_FRESHNESS_REJECTED",
              "Toss Open API calendar response freshness was rejected.",
              { responseByteLength }
            );
          }
          const observation: TossOpenApiCalendarNetworkObservation = {
            market: request.market,
            date: request.date,
            requestUrl: request.url,
            httpStatus: 200,
            httpProtocolVersion: headerBoundary.httpProtocolVersion,
            transferCompletion,
            completedAt,
            responseDelayMilliseconds,
            responseByteLength,
            responseSha256: createHash("sha256").update(responseBytes).digest("hex"),
            responseBytes,
            parsedBody,
            responseFreshness
          };
          finish(undefined, { status, parsedBody, observation });
        } catch (error: unknown) {
          finish(error);
        }
      });
    });
  }
}

export function createTossOpenApiCalendarNetworkTransport(
  config: TossOpenApiAuthConfig,
  tokenProvider: TossOpenApiBearerTokenProvider
): TossOpenApiCalendarNetworkClient {
  return new TossOpenApiCalendarNetworkTransport(config, tokenProvider, {
    deadlineMs: TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_MS,
    nowMonotonicNanoseconds: () => process.hrtime.bigint(),
    nowUtc: () => new Date(),
    request: httpsRequest
  });
}

export function createTestOnlyTossOpenApiCalendarNetworkTransport(
  config: TossOpenApiAuthConfig,
  tokenProvider: TossOpenApiBearerTokenProvider,
  connector: TestOnlyTossOpenApiCalendarSocketConnector
): TossOpenApiCalendarNetworkClient {
  assertTestOnlyConnector(connector);
  const dialAddress = connector.dialAddress;
  const dialPort = connector.dialPort;
  const certificateAuthority = connector.certificateAuthority;
  const deadlineMs =
    connector.deadlineMs ?? TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_MS;
  const nowMonotonicNanoseconds =
    connector.nowMonotonicNanoseconds ?? (() => process.hrtime.bigint());
  const nowUtc = connector.nowUtc ?? (() => new Date());
  const agent = new HttpsAgent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = () =>
    tlsConnect({
      host: dialAddress,
      port: dialPort,
      servername: TOSS_OPEN_API_HOSTNAME,
      ca: certificateAuthority,
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"]
    });
  return new TossOpenApiCalendarNetworkTransport(config, tokenProvider, {
    deadlineMs,
    nowMonotonicNanoseconds,
    nowUtc,
    request: (options, callback) =>
      httpsRequest({ ...options, agent }, callback)
  });
}

function buildCanonicalCalendarRequest(
  input: TossOpenApiCalendarNetworkRequest
): CanonicalCalendarRequest {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(input, "market") ||
    !Object.prototype.hasOwnProperty.call(input, "date") ||
    !Object.prototype.hasOwnProperty.call(TOSS_OPEN_API_CALENDAR_PATHS, input.market) ||
    !isCanonicalDate(input.date)
  ) {
    throwInvalidRequest();
  }
  const path = TOSS_OPEN_API_CALENDAR_PATHS[input.market];
  const pathAndQuery = `${path}?date=${input.date}`;
  return {
    market: input.market,
    date: input.date,
    pathAndQuery,
    url: `${DEFAULT_TOSS_OPEN_API_BASE_URL}${pathAndQuery}`
  };
}

function buildHttpsRequestOptions(
  request: CanonicalCalendarRequest,
  accessToken: string
): RequestOptions {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache"
  } as const;
  verifyOfficialMarketCalendarCacheRequestPolicy({
    cacheRequestPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION,
    cacheControlHeaderValues: [headers["Cache-Control"]],
    pragmaHeaderValues: [headers.Pragma],
    ifNoneMatchHeaderValues: [],
    ifModifiedSinceHeaderValues: []
  });
  return {
    protocol: "https:",
    hostname: TOSS_OPEN_API_HOSTNAME,
    port: TOSS_OPEN_API_HTTPS_PORT,
    servername: TOSS_OPEN_API_HOSTNAME,
    method: "GET",
    path: request.pathAndQuery,
    agent: false,
    rejectUnauthorized: true,
    headers
  };
}

function assertResponseHeaders(response: IncomingMessage): ResponseHeaderBoundary {
  const status = response.statusCode;
  if (status !== 200 && status !== 401) {
    response.destroy();
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_STATUS",
      "Toss Open API calendar response status was not accepted.",
      { ...(status === undefined ? {} : { status }) }
    );
  }
  for (const name of ["content-range", "content-encoding"]) {
    if (readRawHeaderValues(response.rawHeaders, name).length !== 0) {
      response.destroy();
      throwInvalidHeaders();
    }
  }
  const contentTypes = readRawHeaderValues(response.rawHeaders, "content-type");
  if (contentTypes.length !== 1 || !isJsonContentType(contentTypes[0] ?? "")) {
    response.destroy();
    throwInvalidHeaders();
  }
  const contentLengths = readRawHeaderValues(response.rawHeaders, "content-length");
  if (contentLengths.length > 1) {
    response.destroy();
    throwInvalidHeaders();
  }
  const declaredContentLength =
    contentLengths.length === 0
      ? null
      : parseContentLength(contentLengths[0] ?? "");
  if (
    declaredContentLength !== null &&
    declaredContentLength > TOSS_OPEN_API_CALENDAR_RESPONSE_MAX_BYTES
  ) {
    response.destroy();
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_RESPONSE_TOO_LARGE",
      "Toss Open API calendar response exceeded the byte limit.",
      { responseByteLength: declaredContentLength }
    );
  }
  const httpProtocolVersion = parseHttpProtocolVersion(response.httpVersion);
  const transferEncoding = readRawHeaderValues(
    response.rawHeaders,
    "transfer-encoding"
  );
  if (declaredContentLength !== null) {
    if (transferEncoding.length !== 0) {
      response.destroy();
      throwInvalidHeaders();
    }
    return {
      declaredContentLength,
      httpProtocolVersion,
      transferFraming: "content_length"
    };
  }
  if (
    httpProtocolVersion !== "http_1_1" ||
    transferEncoding.length !== 1 ||
    transferEncoding[0]?.toLowerCase() !== "chunked"
  ) {
    response.destroy();
    throwInvalidHeaders();
  }
  return {
    declaredContentLength: null,
    httpProtocolVersion,
    transferFraming: "chunked"
  };
}

function assertResponseTrailers(response: IncomingMessage): void {
  if (response.rawTrailers.length !== 0) {
    throwInvalidHeaders();
  }
}

function parseContentLength(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throwInvalidHeaders();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throwInvalidHeaders();
  }
  return parsed;
}

function parseHttpProtocolVersion(value: string): "http_1_0" | "http_1_1" {
  if (value === "1.0") {
    return "http_1_0";
  }
  if (value === "1.1") {
    return "http_1_1";
  }
  throwInvalidHeaders();
}

function parseJson(bytes: Buffer, responseByteLength: number): unknown {
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(json);
  } catch {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_JSON",
      "Toss Open API calendar response was not valid UTF-8 JSON.",
      { responseByteLength }
    );
  }
}

function resolveResponseDelayMilliseconds(
  startedAtNanoseconds: bigint,
  completedAtNanoseconds: bigint,
  deadlineMs: number
): number {
  if (
    typeof completedAtNanoseconds !== "bigint" ||
    completedAtNanoseconds < startedAtNanoseconds
  ) {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED",
      "Toss Open API calendar monotonic clock was invalid."
    );
  }
  const elapsedNanoseconds = completedAtNanoseconds - startedAtNanoseconds;
  const elapsedMilliseconds = (elapsedNanoseconds + 999_999n) / 1_000_000n;
  if (
    elapsedMilliseconds > BigInt(deadlineMs) ||
    elapsedMilliseconds > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED",
      "Toss Open API calendar network deadline was exceeded."
    );
  }
  return Number(elapsedMilliseconds);
}

function readCompletedAt(nowUtc: () => Date): string {
  try {
    const value = nowUtc();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error("invalid date");
    }
    const completedAt = value.toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(completedAt)) {
      throw new Error("noncanonical date");
    }
    return completedAt;
  } catch {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG",
      "Toss Open API calendar UTC clock is invalid."
    );
  }
}

function readRawHeaderValues(rawHeaders: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      values.push(rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function isJsonContentType(value: string): boolean {
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value);
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toISOString().slice(0, 10) === value;
}

function isRefreshableTokenError(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const record = body as Record<string, unknown>;
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>).code
      : record.error;
  const code = typeof record.code === "string" ? record.code : nested;
  return (
    code === "invalid-token" ||
    code === "expired-token" ||
    code === "invalid_token" ||
    code === "expired_token"
  );
}

function isValidBearerAccessToken(value: string): boolean {
  return /^[A-Za-z0-9\-._~+/]+=*$/.test(value);
}

function readMonotonicNanoseconds(clock: () => bigint): bigint {
  try {
    const value = clock();
    if (typeof value !== "bigint") {
      throw new Error("invalid monotonic value");
    }
    return value;
  } catch {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG",
      "Toss Open API calendar monotonic clock is invalid."
    );
  }
}

function requireObservation(
  response: AttemptResponse
): TossOpenApiCalendarNetworkObservation {
  if (response.observation === undefined) {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_STATUS",
      "Toss Open API calendar accepted response was incomplete."
    );
  }
  return response.observation;
}

function throwAuthFailed(status: number): never {
  throw new TossOpenApiCalendarNetworkError(
    "TOSS_OPEN_API_CALENDAR_TRANSPORT_AUTH_FAILED",
    "Toss Open API calendar request authentication failed.",
    { status }
  );
}

function throwInvalidRequest(): never {
  throw new TossOpenApiCalendarNetworkError(
    "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_REQUEST",
    "Toss Open API calendar network request is invalid."
  );
}

function throwInvalidHeaders(): never {
  throw new TossOpenApiCalendarNetworkError(
    "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_HEADERS",
    "Toss Open API calendar response headers were invalid."
  );
}

function incompleteResponse(responseByteLength: number): Error {
  return new TossOpenApiCalendarNetworkError(
    "TOSS_OPEN_API_CALENDAR_TRANSPORT_INCOMPLETE_RESPONSE",
    "Toss Open API calendar response was incomplete.",
    { responseByteLength }
  );
}

function assertTestOnlyConnector(
  connector: TestOnlyTossOpenApiCalendarSocketConnector
): void {
  if (
    !isLoopbackIp(connector.dialAddress) ||
    !Number.isInteger(connector.dialPort) ||
    connector.dialPort < 1 ||
    connector.dialPort > 65_535 ||
    connector.certificateAuthority.trim().length === 0 ||
    (connector.deadlineMs !== undefined &&
      (!Number.isInteger(connector.deadlineMs) ||
        connector.deadlineMs < 1 ||
        connector.deadlineMs > TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_MS)) ||
    (connector.nowMonotonicNanoseconds !== undefined &&
      typeof connector.nowMonotonicNanoseconds !== "function") ||
    (connector.nowUtc !== undefined && typeof connector.nowUtc !== "function")
  ) {
    throw new TossOpenApiCalendarNetworkError(
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG",
      "Toss Open API test-only calendar connector is invalid."
    );
  }
}

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}
