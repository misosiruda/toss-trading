import type { ClientRequest, IncomingMessage } from "node:http";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

import {
  createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  type OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
} from "./officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy,
  type OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition
} from "./officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy.js";

type LegacyFileName =
  OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition["dynamicRequestParameterBinding"]["allowedValues"][number];

export interface OfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer {
  acquire(
    requestedFileName: unknown
  ): Promise<OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody>;
}

export interface TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
}

export type OfficialMarketCalendarKrxLegacyDownloadOtpNetworkErrorCode =
  | "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INVALID_CONFIG"
  | "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INVALID_REQUEST"
  | "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_FAILURE"
  | "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_DEADLINE_EXCEEDED"
  | "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_RESPONSE_REJECTED"
  | "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INCOMPLETE_RESPONSE";

export class OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyDownloadOtpNetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError";
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

export function createOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer(): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer {
  const policy = resolvePolicy();
  return createConsumer({
    deadlineMs: policy.networkLimits.absoluteDeadlineMilliseconds,
    request: httpsRequest
  });
}

export function createTestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer(
  connector: TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector
): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer {
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
): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer {
  return Object.freeze({
    acquire: async (requestedFileName: unknown) =>
      executeRequest(resolveRequestedFileName(requestedFileName), options)
  });
}

function executeRequest(
  requestedFileName: LegacyFileName,
  options: ConsumerOptions
): Promise<OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody> {
  const policy = resolvePolicy();
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let clientRequest: ClientRequest | undefined;
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
            value
          );
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
        new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
          "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_DEADLINE_EXCEEDED",
          "KRX legacy download OTP network deadline was exceeded."
        )
      );
      clientRequest?.destroy();
    }, options.deadlineMs);

    try {
      clientRequest = options.request(
        buildRequestOptions(policy, requestedFileName),
        (response) => {
          responseStarted = true;
          readResponse(response, policy, requestedFileName).then(
            (value) => finish(undefined, value),
            (error: unknown) => finish(error)
          );
        }
      );
      clientRequest.once("error", () => {
        finish(
          responseStarted
            ? incompleteResponse()
            : new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
                "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_FAILURE",
                "KRX legacy download OTP network request failed."
              )
        );
      });
      clientRequest.end();
    } catch {
      finish(
        responseStarted
          ? incompleteResponse()
          : new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
              "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_FAILURE",
              "KRX legacy download OTP network request failed."
            )
      );
    }
  });
}

function buildRequestOptions(
  policy: OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition,
  requestedFileName: LegacyFileName
): RequestOptions {
  const requestedUrl = new URL(policy.sourceSelector.requestedUrl);
  const query = policy.requestParameterOrder
    .map((name) => {
      const value =
        name === policy.dynamicRequestParameterBinding.fileNameParameter
          ? requestedFileName
          : policy.fixedRequestParameters[name];
      return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    })
    .join("&");
  return {
    protocol: "https:",
    hostname: requestedUrl.hostname,
    port: 443,
    servername: requestedUrl.hostname,
    method: policy.sourceSelector.requestMethod,
    path: `${requestedUrl.pathname}?${query}`,
    agent: false,
    rejectUnauthorized: true,
    headers: {
      Accept: policy.fixedRequestHeaderValues.accept,
      "Cache-Control": policy.fixedRequestHeaderValues.cacheControl,
      Pragma: policy.fixedRequestHeaderValues.pragma,
      Referer: policy.fixedRequestHeaderValues.referer,
      "User-Agent": policy.fixedRequestHeaderValues.userAgent,
      Host: policy.transportDerivedRequestHeaderValues.host,
      Connection: policy.transportDerivedRequestHeaderValues.connection
    }
  };
}

async function readResponse(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition,
  requestedFileName: LegacyFileName
): Promise<OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody> {
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
      value?: OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
            value
          );
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
        Uint8Array.prototype.set.call(
          responseBytes,
          chunk,
          responseByteLength
        );
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
        const handle =
          createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
            rawResponseBytes: responseBytes,
            requestedFileName
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
  policy: OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition
): void {
  if (
    response.statusCode !== policy.responseBoundary.requiredStatus ||
    response.httpVersion !== "1.1"
  ) {
    throw responseRejected();
  }
  for (const name of [
    "age",
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
    countRawHeaders(response.rawHeaders, "set-cookie") !==
      policy.responseBoundary.observedSetCookieHeaderCount
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

function resolveRequestedFileName(value: unknown): LegacyFileName {
  const policy = resolvePolicy();
  const fileName = policy.dynamicRequestParameterBinding.allowedValues.find(
    (candidate) => candidate === value
  );
  if (fileName === undefined) {
    throw new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
      "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INVALID_REQUEST",
      "KRX legacy download OTP request file name is not registered."
    );
  }
  return fileName;
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
  connector: TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector
): Readonly<TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector> {
  if (connector === null || typeof connector !== "object") {
    throwInvalidConnector();
  }
  let dialAddress: unknown;
  let dialPort: unknown;
  let certificateAuthority: unknown;
  let deadlineMs: unknown;
  try {
    dialAddress = connector.dialAddress;
    dialPort = connector.dialPort;
    certificateAuthority = connector.certificateAuthority;
    deadlineMs = connector.deadlineMs;
  } catch {
    throwInvalidConnector();
  }
  const maximumDeadline =
    resolvePolicy().networkLimits.absoluteDeadlineMilliseconds;
  if (
    typeof dialAddress !== "string" ||
    !isLoopbackIp(dialAddress) ||
    !Number.isInteger(dialPort) ||
    (dialPort as number) < 1 ||
    (dialPort as number) > 65_535 ||
    typeof certificateAuthority !== "string" ||
    certificateAuthority.trim().length === 0 ||
    (deadlineMs !== undefined &&
      (!Number.isInteger(deadlineMs) ||
        (deadlineMs as number) < 1 ||
        (deadlineMs as number) > maximumDeadline))
  ) {
    throwInvalidConnector();
  }
  return Object.freeze({
    dialAddress,
    dialPort,
    certificateAuthority,
    ...(deadlineMs === undefined ? {} : { deadlineMs })
  }) as Readonly<TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector>;
}

function resolvePolicy(): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition {
  return resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION
  );
}

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}

function throwInvalidConnector(): never {
  throw new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
    "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INVALID_CONFIG",
    "KRX legacy download OTP test-only connector is invalid."
  );
}

function responseRejected(): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
    "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_RESPONSE_REJECTED",
    "KRX legacy download OTP response was rejected."
  );
}

function incompleteResponse(): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError(
    "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INCOMPLETE_RESPONSE",
    "KRX legacy download OTP response was incomplete."
  );
}

function zeroizeBytes(value: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(value, 0);
  } catch {
    // Detached views own no remaining bytes to clear.
  }
}
