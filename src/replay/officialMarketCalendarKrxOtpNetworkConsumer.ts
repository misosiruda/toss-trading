import type { ClientRequest, IncomingMessage } from "node:http";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

import {
  createOfficialMarketCalendarKrxOtpEphemeralBody,
  disposeOfficialMarketCalendarKrxOtpEphemeralBody,
  type OfficialMarketCalendarKrxOtpEphemeralBody
} from "./officialMarketCalendarKrxOtpEphemeralBody.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy,
  type OfficialMarketCalendarKrxOtpNetworkPolicyDefinition
} from "./officialMarketCalendarKrxOtpNetworkPolicy.js";

export interface OfficialMarketCalendarKrxOtpNetworkConsumer {
  acquire(): Promise<OfficialMarketCalendarKrxOtpEphemeralBody>;
}

export interface TestOnlyOfficialMarketCalendarKrxOtpSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
}

export type OfficialMarketCalendarKrxOtpNetworkErrorCode =
  | "KRX_OTP_NETWORK_INVALID_CONFIG"
  | "KRX_OTP_NETWORK_FAILURE"
  | "KRX_OTP_NETWORK_DEADLINE_EXCEEDED"
  | "KRX_OTP_NETWORK_RESPONSE_REJECTED"
  | "KRX_OTP_NETWORK_INCOMPLETE_RESPONSE";

export class OfficialMarketCalendarKrxOtpNetworkError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxOtpNetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxOtpNetworkError";
  }
}

type HttpsRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

interface ConsumerOptions {
  deadlineMs: number;
  request: HttpsRequest;
}

export function createOfficialMarketCalendarKrxOtpNetworkConsumer(): OfficialMarketCalendarKrxOtpNetworkConsumer {
  const policy = resolvePolicy();
  return createConsumer({
    deadlineMs: policy.networkLimits.absoluteDeadlineMilliseconds,
    request: httpsRequest
  });
}

export function createTestOnlyOfficialMarketCalendarKrxOtpNetworkConsumer(
  connector: TestOnlyOfficialMarketCalendarKrxOtpSocketConnector
): OfficialMarketCalendarKrxOtpNetworkConsumer {
  const normalized = normalizeTestOnlyConnector(connector);
  const policy = resolvePolicy();
  const agent = new HttpsAgent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = () =>
    tlsConnect({
      host: normalized.dialAddress,
      port: normalized.dialPort,
      servername: policy.transportDerivedRequestHeaderValues.host,
      ca: normalized.certificateAuthority,
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"]
    });
  return createConsumer({
    deadlineMs:
      normalized.deadlineMs ??
      policy.networkLimits.absoluteDeadlineMilliseconds,
    request: (options, callback) =>
      httpsRequest({ ...options, agent }, callback)
  });
}

function createConsumer(
  options: ConsumerOptions
): OfficialMarketCalendarKrxOtpNetworkConsumer {
  return Object.freeze({ acquire: () => executeRequest(options) });
}

function executeRequest(
  options: ConsumerOptions
): Promise<OfficialMarketCalendarKrxOtpEphemeralBody> {
  const policy = resolvePolicy();
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let clientRequest: ClientRequest | undefined;
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxOtpEphemeralBody
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxOtpEphemeralBody(value);
        }
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
        new OfficialMarketCalendarKrxOtpNetworkError(
          "KRX_OTP_NETWORK_DEADLINE_EXCEEDED",
          "KRX OTP network deadline was exceeded."
        )
      );
      clientRequest?.destroy();
    }, options.deadlineMs);

    try {
      clientRequest = options.request(buildRequestOptions(policy), (response) => {
        responseStarted = true;
        readResponse(response, policy).then(
          (value) => finish(undefined, value),
          (error: unknown) => finish(error)
        );
      });
      clientRequest.once("error", () => {
        finish(
          responseStarted
            ? incompleteResponse()
            : new OfficialMarketCalendarKrxOtpNetworkError(
                "KRX_OTP_NETWORK_FAILURE",
                "KRX OTP network request failed."
              )
        );
      });
      clientRequest.end();
    } catch {
      finish(
        responseStarted
          ? incompleteResponse()
          : new OfficialMarketCalendarKrxOtpNetworkError(
              "KRX_OTP_NETWORK_FAILURE",
              "KRX OTP network request failed."
            )
      );
    }
  });
}

function buildRequestOptions(
  policy: OfficialMarketCalendarKrxOtpNetworkPolicyDefinition
): RequestOptions {
  const requestedUrl = new URL(policy.sourceSelector.requestedUrl);
  const query = policy.requestParameterOrder
    .map(
      (name) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(
          policy.fixedRequestParameters[name]
        )}`
    )
    .join("&");
  return {
    protocol: "https:",
    hostname: requestedUrl.hostname,
    port: 443,
    servername: requestedUrl.hostname,
    method: "GET",
    path: `${requestedUrl.pathname}?${query}`,
    agent: false,
    rejectUnauthorized: true,
    headers: {
      Accept: policy.fixedRequestHeaderValues.accept,
      "Cache-Control": policy.fixedRequestHeaderValues.cacheControl,
      Pragma: policy.fixedRequestHeaderValues.pragma,
      "User-Agent": policy.fixedRequestHeaderValues.userAgent
    }
  };
}

async function readResponse(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxOtpNetworkPolicyDefinition
): Promise<OfficialMarketCalendarKrxOtpEphemeralBody> {
  try {
    assertResponseHeaders(response, policy);
  } catch (error) {
    response.destroy();
    throw error;
  }
  const responseBytes = new Uint8Array(
    policy.responseBoundary.observedContentLength
  );
  let responseByteLength = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxOtpEphemeralBody
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxOtpEphemeralBody(value);
        }
        return;
      }
      settled = true;
      if (error === undefined) {
        resolve(value!);
      } else {
        zeroizeBytes(responseBytes);
        reject(error);
      }
    };
    response.on("data", (chunk: Buffer) => {
      if (settled) {
        zeroizeBytes(chunk);
        return;
      }
      try {
        if (responseByteLength + chunk.byteLength > responseBytes.byteLength) {
          finish(responseRejected());
          response.destroy();
          return;
        }
        Uint8Array.prototype.set.call(responseBytes, chunk, responseByteLength);
        responseByteLength += chunk.byteLength;
      } finally {
        zeroizeBytes(chunk);
      }
    });
    response.once("aborted", () => finish(incompleteResponse()));
    response.once("error", () => finish(incompleteResponse()));
    response.once("end", () => {
      if (
        !response.complete ||
        responseByteLength !== responseBytes.byteLength ||
        response.rawTrailers.length !== 0 ||
        Object.keys(response.trailers).length !== 0
      ) {
        finish(incompleteResponse());
        return;
      }
      try {
        const handle = createOfficialMarketCalendarKrxOtpEphemeralBody({
          rawResponseBytes: responseBytes
        });
        finish(undefined, handle);
      } catch {
        finish(responseRejected());
      }
    });
  });
}

function assertResponseHeaders(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxOtpNetworkPolicyDefinition
): void {
  if (
    response.statusCode !== policy.responseBoundary.requiredStatus ||
    response.httpVersion !== "1.1"
  ) {
    throw responseRejected();
  }
  for (const name of [
    "location",
    "content-encoding",
    "transfer-encoding",
    "content-range",
    "trailer"
  ]) {
    if (countRawHeaders(response.rawHeaders, name) !== 0) {
      throw responseRejected();
    }
  }
  if (
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-length",
      String(policy.responseBoundary.observedContentLength)
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-type",
      policy.responseBoundary.observedContentType
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "cache-control",
      policy.responseBoundary.observedCacheControl
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "pragma",
      policy.responseBoundary.observedPragma
    ) ||
    countRawHeaders(response.rawHeaders, "age") !== 0 ||
    countRawHeaders(response.rawHeaders, "set-cookie") === 0
  ) {
    throw responseRejected();
  }
  const dates = readRawHeaderValues(response.rawHeaders, "date");
  const expires = readRawHeaderValues(response.rawHeaders, "expires");
  const responseDate = dates[0] ?? "";
  const responseDateMilliseconds = Date.parse(responseDate);
  if (
    dates.length !== 1 ||
    expires.length !== 1 ||
    responseDate !== expires[0] ||
    !Number.isFinite(responseDateMilliseconds) ||
    new Date(responseDateMilliseconds).toUTCString() !== responseDate
  ) {
    throw responseRejected();
  }
}

function hasExactHeaderValue(
  rawHeaders: string[],
  name: string,
  expectedValue: string
): boolean {
  const values = readRawHeaderValues(rawHeaders, name);
  return values.length === 1 && values[0] === expectedValue;
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

function countRawHeaders(rawHeaders: string[], name: string): number {
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      count += 1;
    }
  }
  return count;
}

function normalizeTestOnlyConnector(
  connector: TestOnlyOfficialMarketCalendarKrxOtpSocketConnector
): Readonly<TestOnlyOfficialMarketCalendarKrxOtpSocketConnector> {
  if (connector === null || typeof connector !== "object") {
    throwInvalidConnector();
  }
  let normalized: TestOnlyOfficialMarketCalendarKrxOtpSocketConnector;
  try {
    const deadlineMs = connector.deadlineMs;
    normalized = {
      dialAddress: connector.dialAddress,
      dialPort: connector.dialPort,
      certificateAuthority: connector.certificateAuthority,
      ...(deadlineMs === undefined ? {} : { deadlineMs })
    };
  } catch {
    throwInvalidConnector();
  }
  const maximumDeadline = resolvePolicy().networkLimits.absoluteDeadlineMilliseconds;
  if (
    typeof normalized.dialAddress !== "string" ||
    !isLoopbackIp(normalized.dialAddress) ||
    !Number.isInteger(normalized.dialPort) ||
    normalized.dialPort < 1 ||
    normalized.dialPort > 65_535 ||
    typeof normalized.certificateAuthority !== "string" ||
    normalized.certificateAuthority.trim().length === 0 ||
    (normalized.deadlineMs !== undefined &&
      (!Number.isInteger(normalized.deadlineMs) ||
        normalized.deadlineMs < 1 ||
        normalized.deadlineMs > maximumDeadline))
  ) {
    throwInvalidConnector();
  }
  return Object.freeze(normalized);
}

function resolvePolicy(): OfficialMarketCalendarKrxOtpNetworkPolicyDefinition {
  return resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION
  );
}

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}

function throwInvalidConnector(): never {
  throw new OfficialMarketCalendarKrxOtpNetworkError(
    "KRX_OTP_NETWORK_INVALID_CONFIG",
    "KRX OTP test-only network connector is invalid."
  );
}

function responseRejected(): OfficialMarketCalendarKrxOtpNetworkError {
  return new OfficialMarketCalendarKrxOtpNetworkError(
    "KRX_OTP_NETWORK_RESPONSE_REJECTED",
    "KRX OTP response was rejected."
  );
}

function incompleteResponse(): OfficialMarketCalendarKrxOtpNetworkError {
  return new OfficialMarketCalendarKrxOtpNetworkError(
    "KRX_OTP_NETWORK_INCOMPLETE_RESPONSE",
    "KRX OTP response was incomplete."
  );
}

function zeroizeBytes(value: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(value, 0);
  } catch {
    // Detached views own no remaining bytes to clear.
  }
}
