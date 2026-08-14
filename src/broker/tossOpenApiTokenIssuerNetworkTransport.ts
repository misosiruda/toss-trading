import { isDeepStrictEqual, TextDecoder } from "node:util";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { connect as tlsConnect } from "node:tls";

import {
  DEFAULT_TOSS_OPEN_API_BASE_URL,
  type TossOpenApiAuthConfig
} from "../config/tossOpenApiAuthConfig.js";
import {
  buildTossOpenApiTokenIssueRequest,
  TOSS_OPEN_API_TOKEN_PATH,
  type TossOpenApiTokenIssueRequest,
  type TossOpenApiTokenIssuer
} from "./tossOpenApiAuthClient.js";

export const TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_MS = 10_000;
export const TOSS_OPEN_API_TOKEN_RESPONSE_MAX_BYTES = 256 * 1024;

const TOSS_OPEN_API_HOSTNAME = "openapi.tossinvest.com";
const TOSS_OPEN_API_HTTPS_PORT = 443;

export type TossOpenApiTokenIssuerNetworkErrorCode =
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_DISABLED"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_REQUEST"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_NETWORK_FAILURE"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_EXCEEDED"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_STATUS"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_HEADERS"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_RESPONSE_TOO_LARGE"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_INCOMPLETE_RESPONSE"
  | "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_JSON";

export interface TossOpenApiTokenIssuerNetworkErrorOptions {
  status?: number;
  responseByteLength?: number;
}

export class TossOpenApiTokenIssuerNetworkError extends Error {
  readonly status: number | undefined;
  readonly responseByteLength: number | undefined;

  constructor(
    readonly code: TossOpenApiTokenIssuerNetworkErrorCode,
    message: string,
    options: TossOpenApiTokenIssuerNetworkErrorOptions = {}
  ) {
    super(message);
    this.name = "TossOpenApiTokenIssuerNetworkError";
    this.status = options.status;
    this.responseByteLength = options.responseByteLength;
  }
}

export interface TestOnlyTossOpenApiTokenSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
}

type HttpsRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

interface TossOpenApiTokenIssuerNetworkTransportOptions {
  deadlineMs: number;
  request: HttpsRequest;
}

class TossOpenApiTokenIssuerNetworkTransport
  implements TossOpenApiTokenIssuer
{
  constructor(
    private readonly config: TossOpenApiAuthConfig,
    private readonly options: TossOpenApiTokenIssuerNetworkTransportOptions
  ) {}

  async issueToken(request: TossOpenApiTokenIssueRequest): Promise<unknown> {
    this.assertReadyConfig();
    this.assertCanonicalRequest(request);
    return this.execute(request);
  }

  private assertReadyConfig(): void {
    if (!this.config.enabled) {
      throw new TossOpenApiTokenIssuerNetworkError(
        "TOSS_OPEN_API_TOKEN_TRANSPORT_DISABLED",
        "Toss Open API token network transport is disabled."
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
      throw new TossOpenApiTokenIssuerNetworkError(
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG",
        "Toss Open API token network transport config is invalid."
      );
    }
  }

  private assertCanonicalRequest(request: TossOpenApiTokenIssueRequest): void {
    const expected = buildTossOpenApiTokenIssueRequest(this.config);
    if (!isDeepStrictEqual(request, expected)) {
      throw new TossOpenApiTokenIssuerNetworkError(
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_REQUEST",
        "Toss Open API token network request is not canonical."
      );
    }
  }

  private execute(request: TossOpenApiTokenIssueRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let clientRequest: ClientRequest | undefined;
      let responseStarted = false;
      const startedAt = performance.now();
      const finish = (error: unknown, value?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error === undefined) {
          resolve(value);
        } else {
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        finish(
          new TossOpenApiTokenIssuerNetworkError(
            "TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_EXCEEDED",
            "Toss Open API token network deadline was exceeded."
          )
        );
        clientRequest?.destroy();
      }, this.options.deadlineMs);

      try {
        clientRequest = this.options.request(
          buildHttpsRequestOptions(request),
          (response) => {
            responseStarted = true;
            this.readResponse(response, startedAt).then(
              (value) => finish(undefined, value),
              (error: unknown) => finish(error)
            );
          }
        );
      } catch {
        finish(
          new TossOpenApiTokenIssuerNetworkError(
            responseStarted
              ? "TOSS_OPEN_API_TOKEN_TRANSPORT_INCOMPLETE_RESPONSE"
              : "TOSS_OPEN_API_TOKEN_TRANSPORT_NETWORK_FAILURE",
            responseStarted
              ? "Toss Open API token response was incomplete."
              : "Toss Open API token network request failed."
          )
        );
        return;
      }

      clientRequest.once("error", () => {
        if (performance.now() - startedAt >= this.options.deadlineMs) {
          finish(
            new TossOpenApiTokenIssuerNetworkError(
              "TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_EXCEEDED",
              "Toss Open API token network deadline was exceeded."
            )
          );
          return;
        }
        finish(
          new TossOpenApiTokenIssuerNetworkError(
            "TOSS_OPEN_API_TOKEN_TRANSPORT_NETWORK_FAILURE",
            "Toss Open API token network request failed."
          )
        );
      });
      clientRequest.end(request.body);
    });
  }

  private async readResponse(
    response: IncomingMessage,
    startedAt: number
  ): Promise<unknown> {
    assertResponseHeaders(response);
    const chunks: Buffer[] = [];
    let responseByteLength = 0;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (error === undefined) {
          resolve(value);
        } else {
          reject(error);
        }
      };

      response.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }
        responseByteLength += chunk.byteLength;
        if (responseByteLength > TOSS_OPEN_API_TOKEN_RESPONSE_MAX_BYTES) {
          finish(
            new TossOpenApiTokenIssuerNetworkError(
              "TOSS_OPEN_API_TOKEN_TRANSPORT_RESPONSE_TOO_LARGE",
              "Toss Open API token response exceeded the byte limit.",
              { responseByteLength }
            )
          );
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.once("aborted", () => {
        finish(
          new TossOpenApiTokenIssuerNetworkError(
            "TOSS_OPEN_API_TOKEN_TRANSPORT_INCOMPLETE_RESPONSE",
            "Toss Open API token response was incomplete.",
            { responseByteLength }
          )
        );
      });
      response.once("error", () => {
        finish(
          new TossOpenApiTokenIssuerNetworkError(
            "TOSS_OPEN_API_TOKEN_TRANSPORT_INCOMPLETE_RESPONSE",
            "Toss Open API token response was incomplete.",
            { responseByteLength }
          )
        );
      });
      response.once("end", () => {
        if (!response.complete) {
          finish(
            new TossOpenApiTokenIssuerNetworkError(
              "TOSS_OPEN_API_TOKEN_TRANSPORT_INCOMPLETE_RESPONSE",
              "Toss Open API token response was incomplete.",
              { responseByteLength }
            )
          );
          return;
        }
        if (performance.now() - startedAt > this.options.deadlineMs) {
          finish(
            new TossOpenApiTokenIssuerNetworkError(
              "TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_EXCEEDED",
              "Toss Open API token network deadline was exceeded."
            )
          );
          return;
        }
        try {
          const json = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks, responseByteLength)
          );
          finish(undefined, JSON.parse(json));
        } catch {
          finish(
            new TossOpenApiTokenIssuerNetworkError(
              "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_JSON",
              "Toss Open API token response was not valid UTF-8 JSON.",
              { responseByteLength }
            )
          );
        }
      });
    });
  }
}

export function createTossOpenApiTokenIssuerNetworkTransport(
  config: TossOpenApiAuthConfig
): TossOpenApiTokenIssuer {
  return new TossOpenApiTokenIssuerNetworkTransport(config, {
    deadlineMs: TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_MS,
    request: httpsRequest
  });
}

export function createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
  config: TossOpenApiAuthConfig,
  connector: TestOnlyTossOpenApiTokenSocketConnector
): TossOpenApiTokenIssuer {
  assertTestOnlyConnector(connector);
  const dialAddress = connector.dialAddress;
  const dialPort = connector.dialPort;
  const certificateAuthority = connector.certificateAuthority;
  const deadlineMs =
    connector.deadlineMs ?? TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_MS;
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
  return new TossOpenApiTokenIssuerNetworkTransport(config, {
    deadlineMs,
    request: (options, callback) =>
      httpsRequest(
        {
          ...options,
          agent
        },
        callback
      )
  });
}

function buildHttpsRequestOptions(
  request: TossOpenApiTokenIssueRequest
): RequestOptions {
  return {
    protocol: "https:",
    hostname: TOSS_OPEN_API_HOSTNAME,
    port: TOSS_OPEN_API_HTTPS_PORT,
    servername: TOSS_OPEN_API_HOSTNAME,
    method: "POST",
    path: TOSS_OPEN_API_TOKEN_PATH,
    agent: false,
    rejectUnauthorized: true,
    headers: {
      Accept: request.headers.Accept,
      "Accept-Encoding": "identity",
      "Content-Type": request.headers["Content-Type"],
      "Content-Length": Buffer.byteLength(request.body)
    }
  };
}

function assertResponseHeaders(response: IncomingMessage): void {
  if (response.statusCode !== 200) {
    response.destroy();
    throw new TossOpenApiTokenIssuerNetworkError(
      "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_STATUS",
      "Toss Open API token response status was not 200.",
      { ...(response.statusCode === undefined ? {} : { status: response.statusCode }) }
    );
  }
  if (readRawHeaderValues(response.rawHeaders, "content-range").length !== 0) {
    response.destroy();
    throwInvalidHeaders("Toss Open API token response contained Content-Range.");
  }
  if (readRawHeaderValues(response.rawHeaders, "content-encoding").length !== 0) {
    response.destroy();
    throwInvalidHeaders("Toss Open API token response contained Content-Encoding.");
  }
  const contentTypes = readRawHeaderValues(response.rawHeaders, "content-type");
  if (
    contentTypes.length !== 1 ||
    !isJsonContentType(contentTypes[0] ?? "")
  ) {
    response.destroy();
    throwInvalidHeaders("Toss Open API token response Content-Type was invalid.");
  }
  const contentLengths = readRawHeaderValues(response.rawHeaders, "content-length");
  if (contentLengths.length > 1) {
    response.destroy();
    throwInvalidHeaders("Toss Open API token response Content-Length was duplicated.");
  }
  if (contentLengths.length === 1) {
    const contentLength = contentLengths[0] ?? "";
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      response.destroy();
      throwInvalidHeaders("Toss Open API token response Content-Length was invalid.");
    }
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed)) {
      response.destroy();
      throwInvalidHeaders("Toss Open API token response Content-Length was invalid.");
    }
    if (parsed > TOSS_OPEN_API_TOKEN_RESPONSE_MAX_BYTES) {
      response.destroy();
      throw new TossOpenApiTokenIssuerNetworkError(
        "TOSS_OPEN_API_TOKEN_TRANSPORT_RESPONSE_TOO_LARGE",
        "Toss Open API token response exceeded the byte limit.",
        { responseByteLength: parsed }
      );
    }
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

function throwInvalidHeaders(message: string): never {
  throw new TossOpenApiTokenIssuerNetworkError(
    "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_HEADERS",
    message
  );
}

function assertTestOnlyConnector(
  connector: TestOnlyTossOpenApiTokenSocketConnector
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
        connector.deadlineMs > TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_MS))
  ) {
    throw new TossOpenApiTokenIssuerNetworkError(
      "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG",
      "Toss Open API test-only token connector is invalid."
    );
  }
}

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}
