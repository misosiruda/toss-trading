import type { ClientRequest, IncomingMessage } from "node:http";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

import { verifyOfficialMarketCalendarKrxOtpResponseBody } from "./officialMarketCalendarKrxOtpResponseBody.js";
import {
  createOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  type OfficialMarketCalendarKrxHolidayDataEphemeralResponse
} from "./officialMarketCalendarKrxHolidayDataEphemeralResponse.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy
} from "./officialMarketCalendarKrxHolidayDataPostNetworkPolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy
} from "./officialMarketCalendarKrxHolidayDataPostPolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy
} from "./officialMarketCalendarKrxHolidayDataPostWirePolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayTargetYear,
  resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy,
  type OfficialMarketCalendarKrxHolidayTargetYear
} from "./officialMarketCalendarKrxHolidayTargetYear.js";
import { verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

declare const krxOtpEphemeralBodyBrand: unique symbol;
declare const krxHolidayDataPostParametersBrand: unique symbol;
declare const krxHolidayDataPostWireBodyBrand: unique symbol;

export interface OfficialMarketCalendarKrxOtpEphemeralBody {
  readonly [krxOtpEphemeralBodyBrand]: true;
  toJSON(): never;
}

export interface CreateOfficialMarketCalendarKrxOtpEphemeralBodyInput {
  rawResponseBytes: Uint8Array;
}

export interface OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters {
  readonly [krxHolidayDataPostParametersBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody {
  readonly [krxHolidayDataPostWireBodyBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxHolidayDataNetworkConsumer {
  consume(
    handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
  ): Promise<OfficialMarketCalendarKrxHolidayDataEphemeralResponse>;
}

export interface TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
}

export type OfficialMarketCalendarKrxHolidayDataNetworkErrorCode =
  | "KRX_HOLIDAY_DATA_NETWORK_INVALID_CONFIG"
  | "KRX_HOLIDAY_DATA_NETWORK_FAILURE"
  | "KRX_HOLIDAY_DATA_NETWORK_DEADLINE_EXCEEDED"
  | "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_REJECTED"
  | "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_TOO_LARGE"
  | "KRX_HOLIDAY_DATA_NETWORK_INCOMPLETE_RESPONSE";

export class OfficialMarketCalendarKrxHolidayDataNetworkError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxHolidayDataNetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxHolidayDataNetworkError";
  }
}

interface ReadyBodyState {
  status: "ready";
  rawResponseBytes: Uint8Array;
}

interface DisposedBodyState {
  status: "disposed";
}

type BodyState = ReadyBodyState | DisposedBodyState;

interface ReadyPostParametersState {
  status: "ready";
  rawOtpBytes: Uint8Array;
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear;
}

interface DisposedPostParametersState {
  status: "disposed";
}

type PostParametersState =
  | ReadyPostParametersState
  | DisposedPostParametersState;

interface ReadyWireBodyState {
  status: "ready";
  bodyBytes: Uint8Array;
  requestContentType: "application/x-www-form-urlencoded; charset=UTF-8";
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear;
}

interface DisposedWireBodyState {
  status: "disposed";
}

type WireBodyState = ReadyWireBodyState | DisposedWireBodyState;

const bodyStates = new WeakMap<object, BodyState>();
const postParametersStates = new WeakMap<object, PostParametersState>();
const wireBodyStates = new WeakMap<object, WireBodyState>();
type HttpsRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;
interface NetworkConsumerOptions {
  deadlineMs: number;
  request: HttpsRequest;
}
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength"
)?.get;

export function createOfficialMarketCalendarKrxOtpEphemeralBody(
  input: CreateOfficialMarketCalendarKrxOtpEphemeralBodyInput
): OfficialMarketCalendarKrxOtpEphemeralBody {
  const transferredRawResponseBytes = input.rawResponseBytes;
  const byteLength = readTransferredByteLength(transferredRawResponseBytes);
  let ownedRawResponseBytes: Uint8Array | undefined;
  let transferredBytesZeroized = false;

  try {
    ownedRawResponseBytes = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(
      ownedRawResponseBytes,
      transferredRawResponseBytes
    );
    zeroizeBytes(transferredRawResponseBytes);
    transferredBytesZeroized = true;
    verifyOfficialMarketCalendarKrxOtpResponseBody(ownedRawResponseBytes);

    const handle = createOpaqueHandle(() => {
      disposeBodyObject(handle);
      throw new Error(
        "KRX OTP ephemeral body cannot be serialized or exported"
      );
    });
    bodyStates.set(handle, {
      status: "ready",
      rawResponseBytes: ownedRawResponseBytes
    });
    return handle as OfficialMarketCalendarKrxOtpEphemeralBody;
  } catch (error) {
    if (ownedRawResponseBytes !== undefined) {
      zeroizeBytes(ownedRawResponseBytes);
    }
    throw error;
  } finally {
    if (!transferredBytesZeroized) {
      zeroizeBytes(transferredRawResponseBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxOtpEphemeralBody(
  handle: OfficialMarketCalendarKrxOtpEphemeralBody
): void {
  const handleObject = assertHandleObject(handle);
  if (!bodyStates.has(handleObject)) {
    throw new Error(
      "KRX OTP ephemeral body must come from the process-local factory"
    );
  }
  disposeBodyObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(
  handle: OfficialMarketCalendarKrxOtpEphemeralBody,
  targetYear: unknown
): OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters {
  const handleObject = assertHandleObject(handle);
  const state = bodyStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX OTP ephemeral body must come from the process-local factory"
    );
  }
  if (state.status !== "ready") {
    throw new Error("KRX OTP ephemeral body has already been consumed");
  }

  bodyStates.set(handleObject, { status: "disposed" });
  let transferred = false;
  try {
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
    );
    resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
    );
    const parsedTargetYear =
      parseOfficialMarketCalendarKrxHolidayTargetYear(targetYear);
    const postParametersHandle = createOpaqueHandle(() => {
      disposePostParametersObject(postParametersHandle);
      throw new Error(
        "KRX holiday data POST parameters cannot be serialized or exported"
      );
    });
    postParametersStates.set(postParametersHandle, {
      status: "ready",
      rawOtpBytes: state.rawResponseBytes,
      targetYear: parsedTargetYear
    });
    transferred = true;
    return postParametersHandle as OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters;
  } finally {
    if (!transferred) {
      zeroizeBytes(state.rawResponseBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
  handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
): void {
  const handleObject = assertHandleObject(handle);
  if (!postParametersStates.has(handleObject)) {
    throw new Error(
      "KRX holiday data POST parameters must come from the fixed process-local consumer"
    );
  }
  disposePostParametersObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
  handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
): OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody {
  const handleObject = assertHandleObject(handle);
  const state = postParametersStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX holiday data POST parameters must come from the fixed process-local consumer"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX holiday data POST parameters have already been consumed"
    );
  }

  postParametersStates.set(handleObject, { status: "disposed" });
  let bodyBytes: Uint8Array | undefined;
  let transferred = false;
  try {
    const staticPolicy =
      resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
      );
    const wirePolicy =
      resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION
      );
    assertMatchingPostSelectors(staticPolicy.sourceSelector, wirePolicy.sourceSelector);
    bodyBytes = encodeHolidayDataPostWireBody(
      state.rawOtpBytes,
      state.targetYear,
      staticPolicy.fixedRequestParameters,
      wirePolicy.parameterOrder,
      wirePolicy.maximumRequestBodyByteLength
    );
    verifyHolidayDataPostWireBody(
      bodyBytes,
      state.rawOtpBytes,
      state.targetYear,
      staticPolicy.fixedRequestParameters
    );
    const wireBodyHandle = createOpaqueHandle(() => {
      disposeWireBodyObject(wireBodyHandle);
      throw new Error(
        "KRX holiday data POST wire body cannot be serialized or exported"
      );
    });
    wireBodyStates.set(wireBodyHandle, {
      status: "ready",
      bodyBytes,
      requestContentType: wirePolicy.requestContentType,
      targetYear: state.targetYear
    });
    transferred = true;
    return wireBodyHandle as OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody;
  } finally {
    zeroizeBytes(state.rawOtpBytes);
    if (!transferred && bodyBytes !== undefined) {
      zeroizeBytes(bodyBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(
  handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
): void {
  const handleObject = assertHandleObject(handle);
  if (!wireBodyStates.has(handleObject)) {
    throw new Error(
      "KRX holiday data POST wire body must come from the fixed byte encoder"
    );
  }
  disposeWireBodyObject(handleObject);
}

export function createOfficialMarketCalendarKrxHolidayDataNetworkConsumer(): OfficialMarketCalendarKrxHolidayDataNetworkConsumer {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
    );
  return createNetworkConsumer({
    deadlineMs: policy.networkLimits.absoluteDeadlineMilliseconds,
    request: httpsRequest
  });
}

export function createTestOnlyOfficialMarketCalendarKrxHolidayDataNetworkConsumer(
  connector: TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector
): OfficialMarketCalendarKrxHolidayDataNetworkConsumer {
  const normalizedConnector = normalizeTestOnlyNetworkConnector(connector);
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
    );
  const dialAddress = normalizedConnector.dialAddress;
  const dialPort = normalizedConnector.dialPort;
  const certificateAuthority = normalizedConnector.certificateAuthority;
  const agent = new HttpsAgent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = () =>
    tlsConnect({
      host: dialAddress,
      port: dialPort,
      servername: policy.transportDerivedRequestHeaderValues.host,
      ca: certificateAuthority,
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"]
    });
  return createNetworkConsumer({
    deadlineMs:
      normalizedConnector.deadlineMs ??
      policy.networkLimits.absoluteDeadlineMilliseconds,
    request: (options, callback) =>
      httpsRequest({ ...options, agent }, callback)
  });
}

function createNetworkConsumer(
  options: NetworkConsumerOptions
): OfficialMarketCalendarKrxHolidayDataNetworkConsumer {
  return Object.freeze({
    consume: (
      handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
    ) => consumeWireBodyOverNetwork(handle, options)
  });
}

async function consumeWireBodyOverNetwork(
  handle: OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody,
  options: NetworkConsumerOptions
): Promise<OfficialMarketCalendarKrxHolidayDataEphemeralResponse> {
  const handleObject = assertHandleObject(handle);
  const state = wireBodyStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX holiday data POST wire body must come from the fixed byte encoder"
    );
  }
  if (state.status !== "ready") {
    throw new Error("KRX holiday data POST wire body has already been consumed");
  }

  wireBodyStates.set(handleObject, { status: "disposed" });
  try {
    return await executeNetworkRequest(state, options);
  } finally {
    zeroizeBytes(state.bodyBytes);
  }
}

function executeNetworkRequest(
  state: ReadyWireBodyState,
  options: NetworkConsumerOptions
): Promise<OfficialMarketCalendarKrxHolidayDataEphemeralResponse> {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
    );
  if (
    state.requestContentType !== policy.fixedRequestHeaderValues.contentType ||
    state.bodyBytes.byteLength === 0 ||
    state.bodyBytes.byteLength > policy.networkLimits.maximumRequestBodyByteLength
  ) {
    throw responseRejected();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let clientRequest: ClientRequest | undefined;
    let responseStarted = false;
    let requestBodyCleared = false;
    const clearRequestBody = (): void => {
      if (!requestBodyCleared) {
        requestBodyCleared = true;
        zeroizeBytes(state.bodyBytes);
      }
    };
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxHolidayDataEphemeralResponse
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(value);
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearRequestBody();
      if (error === undefined) {
        resolve(value!);
      } else {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      finish(
        new OfficialMarketCalendarKrxHolidayDataNetworkError(
          "KRX_HOLIDAY_DATA_NETWORK_DEADLINE_EXCEEDED",
          "KRX holiday data network deadline was exceeded."
        )
      );
      clientRequest?.destroy();
    }, options.deadlineMs);

    try {
      clientRequest = options.request(
        buildHolidayDataRequestOptions(policy, state.bodyBytes.byteLength),
        (response) => {
          responseStarted = true;
          readNetworkResponse(response, policy, state.targetYear).then(
            (value) => finish(undefined, value),
            (error: unknown) => finish(error)
          );
        }
      );
      clientRequest.once("finish", clearRequestBody);
      clientRequest.once("error", () => {
        finish(
          responseStarted
            ? incompleteResponse()
            : new OfficialMarketCalendarKrxHolidayDataNetworkError(
                "KRX_HOLIDAY_DATA_NETWORK_FAILURE",
                "KRX holiday data network request failed."
              )
        );
      });
      clientRequest.end(state.bodyBytes);
    } catch {
      finish(
        responseStarted
          ? incompleteResponse()
          : new OfficialMarketCalendarKrxHolidayDataNetworkError(
              "KRX_HOLIDAY_DATA_NETWORK_FAILURE",
              "KRX holiday data network request failed."
            )
      );
    }
  });
}

function buildHolidayDataRequestOptions(
  policy: ReturnType<
    typeof resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy
  >,
  bodyByteLength: number
): RequestOptions {
  const requestedUrl = new URL(policy.sourceSelector.requestedUrl);
  return {
    protocol: "https:",
    hostname: requestedUrl.hostname,
    port: 443,
    servername: requestedUrl.hostname,
    method: "POST",
    path: `${requestedUrl.pathname}${requestedUrl.search}`,
    agent: false,
    rejectUnauthorized: true,
    headers: {
      Accept: policy.fixedRequestHeaderValues.accept,
      "Cache-Control": policy.fixedRequestHeaderValues.cacheControl,
      "Content-Length": String(bodyByteLength),
      "Content-Type": policy.fixedRequestHeaderValues.contentType,
      Pragma: policy.fixedRequestHeaderValues.pragma
    }
  };
}

async function readNetworkResponse(
  response: IncomingMessage,
  policy: ReturnType<
    typeof resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy
  >,
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear
): Promise<OfficialMarketCalendarKrxHolidayDataEphemeralResponse> {
  let declaredContentLength: number;
  try {
    declaredContentLength = assertResponseHeaderBoundary(response, policy);
  } catch (error) {
    response.destroy();
    throw error;
  }
  const responseBytes = new Uint8Array(declaredContentLength);
  let responseByteLength = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxHolidayDataEphemeralResponse
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(value);
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
        if (responseByteLength + chunk.byteLength > declaredContentLength) {
          finish(responseTooLarge());
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
        responseByteLength !== declaredContentLength ||
        response.rawTrailers.length !== 0 ||
        Object.keys(response.trailers).length !== 0
      ) {
        finish(incompleteResponse());
        return;
      }
      try {
        const metadata =
          verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
            requestIsolation: {
              automaticRedirectFollow: false,
              cookieJarEnabled: false,
              requestCookieHeaderCount: 0
            },
            responseUrl: policy.sourceSelector.requestedUrl,
            httpStatus: response.statusCode,
            redirectLocationHeaderValues: readRawHeaderValues(
              response.rawHeaders,
              "location"
            ),
            contentTypeHeaderValues: readRawHeaderValues(
              response.rawHeaders,
              "content-type"
            ),
            contentEncodingHeaderValues: readRawHeaderValues(
              response.rawHeaders,
              "content-encoding"
            ),
            transferEncodingHeaderValues: readRawHeaderValues(
              response.rawHeaders,
              "transfer-encoding"
            ),
            pragmaHeaderValues: readRawHeaderValues(
              response.rawHeaders,
              "pragma"
            ),
            setCookieHeaderCount: countRawHeaders(
              response.rawHeaders,
              "set-cookie"
            ),
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
            },
            transferCompletion: {
              httpProtocolVersion: "http_1_1",
              transferFraming: "content_length",
              transferCompleted: true,
              declaredContentLength,
              contentLength: responseByteLength
            }
          });
        const result =
          createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
            rawResponseBytes: responseBytes,
            responseMetadata: metadata,
            targetYear
          });
        finish(undefined, result);
      } catch {
        finish(responseRejected());
      }
    });
  });
}

function assertResponseHeaderBoundary(
  response: IncomingMessage,
  policy: ReturnType<
    typeof resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy
  >
): number {
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
  const contentLengths = readRawHeaderValues(
    response.rawHeaders,
    "content-length"
  );
  if (contentLengths.length !== 1) {
    throw responseRejected();
  }
  const rawContentLength = contentLengths[0] ?? "";
  if (!/^[1-9]\d*$/.test(rawContentLength)) {
    throw responseRejected();
  }
  const contentLength = Number(rawContentLength);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength > policy.networkLimits.maximumResponseBodyByteLength
  ) {
    throw responseTooLarge();
  }
  return contentLength;
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

function responseRejected(): OfficialMarketCalendarKrxHolidayDataNetworkError {
  return new OfficialMarketCalendarKrxHolidayDataNetworkError(
    "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_REJECTED",
    "KRX holiday data response was rejected."
  );
}

function responseTooLarge(): OfficialMarketCalendarKrxHolidayDataNetworkError {
  return new OfficialMarketCalendarKrxHolidayDataNetworkError(
    "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_TOO_LARGE",
    "KRX holiday data response exceeded the byte limit."
  );
}

function incompleteResponse(): OfficialMarketCalendarKrxHolidayDataNetworkError {
  return new OfficialMarketCalendarKrxHolidayDataNetworkError(
    "KRX_HOLIDAY_DATA_NETWORK_INCOMPLETE_RESPONSE",
    "KRX holiday data response was incomplete."
  );
}

function normalizeTestOnlyNetworkConnector(
  connector: TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector
): Readonly<TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector> {
  const maximumDeadline =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
    ).networkLimits.absoluteDeadlineMilliseconds;
  if (connector === null || typeof connector !== "object") {
    throwInvalidNetworkConnector();
  }
  let normalized: TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector;
  try {
    const deadlineMs = connector.deadlineMs;
    normalized = {
      dialAddress: connector.dialAddress,
      dialPort: connector.dialPort,
      certificateAuthority: connector.certificateAuthority,
      ...(deadlineMs === undefined ? {} : { deadlineMs })
    };
  } catch {
    throwInvalidNetworkConnector();
  }
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
    throwInvalidNetworkConnector();
  }
  return Object.freeze(normalized);
}

function throwInvalidNetworkConnector(): never {
  throw new OfficialMarketCalendarKrxHolidayDataNetworkError(
    "KRX_HOLIDAY_DATA_NETWORK_INVALID_CONFIG",
    "KRX holiday data test-only network connector is invalid."
  );
}

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}

function disposeBodyObject(handle: object): void {
  const state = bodyStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawResponseBytes);
  } finally {
    bodyStates.set(handle, { status: "disposed" });
  }
}

function disposePostParametersObject(handle: object): void {
  const state = postParametersStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawOtpBytes);
  } finally {
    postParametersStates.set(handle, { status: "disposed" });
  }
}

function disposeWireBodyObject(handle: object): void {
  const state = wireBodyStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.bodyBytes);
  } finally {
    wireBodyStates.set(handle, { status: "disposed" });
  }
}

function assertMatchingPostSelectors(
  staticSelector: {
    exchange: "KRX";
    requestMethod: "POST";
    requestedUrl: string;
  },
  wireSelector: {
    exchange: "KRX";
    requestMethod: "POST";
    requestedUrl: string;
  }
): void {
  if (
    staticSelector.exchange !== wireSelector.exchange ||
    staticSelector.requestMethod !== wireSelector.requestMethod ||
    staticSelector.requestedUrl !== wireSelector.requestedUrl
  ) {
    throw new Error(
      "KRX holiday data POST static and wire policies must select the same request"
    );
  }
}

function encodeHolidayDataPostWireBody(
  rawOtpBytes: Uint8Array,
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear,
  fixedParameters: { readonly gridTp: "KRX"; readonly pagePath: string },
  parameterOrder: readonly [
    "search_bas_yy",
    "gridTp",
    "pagePath",
    "code"
  ],
  maximumByteLength: 1_024
): Uint8Array {
  const workspace = new Uint8Array(maximumByteLength);
  let offset = 0;
  try {
    for (const [index, parameterName] of parameterOrder.entries()) {
      if (index > 0) {
        offset = appendLiteralByte(workspace, offset, 0x26);
      }
      offset = appendEncodedAsciiString(workspace, offset, parameterName);
      offset = appendLiteralByte(workspace, offset, 0x3d);
      switch (parameterName) {
        case "search_bas_yy":
          offset = appendEncodedAsciiString(workspace, offset, targetYear);
          break;
        case "gridTp":
          offset = appendEncodedAsciiString(
            workspace,
            offset,
            fixedParameters.gridTp
          );
          break;
        case "pagePath":
          offset = appendEncodedAsciiString(
            workspace,
            offset,
            fixedParameters.pagePath
          );
          break;
        case "code":
          offset = appendEncodedBytes(workspace, offset, rawOtpBytes);
          break;
      }
    }

    const encodedBody = new Uint8Array(offset);
    Uint8Array.prototype.set.call(
      encodedBody,
      Uint8Array.prototype.subarray.call(workspace, 0, offset)
    );
    return encodedBody;
  } finally {
    zeroizeBytes(workspace);
  }
}

function appendEncodedAsciiString(
  destination: Uint8Array,
  offset: number,
  value: string
): number {
  let nextOffset = offset;
  for (let index = 0; index < value.length; index += 1) {
    const byte = value.charCodeAt(index);
    if (byte > 0x7f) {
      throw new Error("KRX holiday data POST values must use ASCII");
    }
    nextOffset = appendEncodedByte(destination, nextOffset, byte);
  }
  return nextOffset;
}

function verifyHolidayDataPostWireBody(
  bodyBytes: Uint8Array,
  rawOtpBytes: Uint8Array,
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear,
  fixedParameters: { readonly gridTp: "KRX"; readonly pagePath: string }
): void {
  let offset = 0;
  offset = expectEncodedAsciiString(bodyBytes, offset, "search_bas_yy");
  offset = expectLiteralByte(bodyBytes, offset, 0x3d);
  offset = expectEncodedAsciiString(bodyBytes, offset, targetYear);
  offset = expectLiteralByte(bodyBytes, offset, 0x26);
  offset = expectEncodedAsciiString(bodyBytes, offset, "gridTp");
  offset = expectLiteralByte(bodyBytes, offset, 0x3d);
  offset = expectEncodedAsciiString(bodyBytes, offset, fixedParameters.gridTp);
  offset = expectLiteralByte(bodyBytes, offset, 0x26);
  offset = expectEncodedAsciiString(bodyBytes, offset, "pagePath");
  offset = expectLiteralByte(bodyBytes, offset, 0x3d);
  offset = expectEncodedAsciiString(
    bodyBytes,
    offset,
    fixedParameters.pagePath
  );
  offset = expectLiteralByte(bodyBytes, offset, 0x26);
  offset = expectEncodedAsciiString(bodyBytes, offset, "code");
  offset = expectLiteralByte(bodyBytes, offset, 0x3d);
  offset = expectEncodedBytes(bodyBytes, offset, rawOtpBytes);
  if (offset !== bodyBytes.byteLength) {
    throw new Error("KRX holiday data POST wire body has trailing bytes");
  }
}

function expectEncodedAsciiString(
  bodyBytes: Uint8Array,
  offset: number,
  value: string
): number {
  let nextOffset = offset;
  for (let index = 0; index < value.length; index += 1) {
    const byte = value.charCodeAt(index);
    if (byte > 0x7f) {
      throw new Error("KRX holiday data POST values must use ASCII");
    }
    nextOffset = expectEncodedByte(bodyBytes, nextOffset, byte);
  }
  return nextOffset;
}

function expectEncodedBytes(
  bodyBytes: Uint8Array,
  offset: number,
  value: Uint8Array
): number {
  let nextOffset = offset;
  for (const byte of value) {
    nextOffset = expectEncodedByte(bodyBytes, nextOffset, byte);
  }
  return nextOffset;
}

function expectEncodedByte(
  bodyBytes: Uint8Array,
  offset: number,
  byte: number
): number {
  if (isUnreservedAscii(byte)) {
    return expectLiteralByte(bodyBytes, offset, byte);
  }
  let nextOffset = expectLiteralByte(bodyBytes, offset, 0x25);
  nextOffset = expectLiteralByte(
    bodyBytes,
    nextOffset,
    uppercaseHexNibble(byte >>> 4)
  );
  return expectLiteralByte(
    bodyBytes,
    nextOffset,
    uppercaseHexNibble(byte & 0x0f)
  );
}

function expectLiteralByte(
  bodyBytes: Uint8Array,
  offset: number,
  expectedByte: number
): number {
  if (offset >= bodyBytes.byteLength || bodyBytes[offset] !== expectedByte) {
    throw new Error("KRX holiday data POST wire body verification failed");
  }
  return offset + 1;
}

function appendEncodedBytes(
  destination: Uint8Array,
  offset: number,
  value: Uint8Array
): number {
  let nextOffset = offset;
  for (const byte of value) {
    nextOffset = appendEncodedByte(destination, nextOffset, byte);
  }
  return nextOffset;
}

function appendEncodedByte(
  destination: Uint8Array,
  offset: number,
  byte: number
): number {
  if (isUnreservedAscii(byte)) {
    return appendLiteralByte(destination, offset, byte);
  }
  let nextOffset = appendLiteralByte(destination, offset, 0x25);
  nextOffset = appendLiteralByte(
    destination,
    nextOffset,
    uppercaseHexNibble(byte >>> 4)
  );
  return appendLiteralByte(
    destination,
    nextOffset,
    uppercaseHexNibble(byte & 0x0f)
  );
}

function appendLiteralByte(
  destination: Uint8Array,
  offset: number,
  byte: number
): number {
  if (offset >= destination.byteLength) {
    throw new Error(
      "KRX holiday data POST wire body exceeds the local byte-length limit"
    );
  }
  destination[offset] = byte;
  return offset + 1;
}

function isUnreservedAscii(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    (byte >= 0x30 && byte <= 0x39) ||
    byte === 0x2d ||
    byte === 0x2e ||
    byte === 0x5f ||
    byte === 0x7e
  );
}

function uppercaseHexNibble(value: number): number {
  return value < 10 ? 0x30 + value : 0x41 + value - 10;
}

function createOpaqueHandle(toJSON: () => never): object {
  const handle = Object.create(null) as object;
  Object.defineProperty(handle, "toJSON", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: toJSON
  });
  return Object.freeze(handle);
}

function assertHandleObject(value: unknown): object {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new Error("KRX OTP ephemeral body handle is invalid");
  }
  return value;
}

function readTransferredByteLength(value: unknown): number {
  if (
    !(value instanceof Uint8Array) ||
    typedArrayByteLengthGetter === undefined
  ) {
    throw new Error(
      "KRX OTP ephemeral body raw response bytes must be a Uint8Array"
    );
  }
  try {
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    if (byteLength === 0) {
      throw new Error(
        "KRX OTP ephemeral body raw response bytes must be attached and non-empty"
      );
    }
    return byteLength;
  } catch (error) {
    if (error instanceof Error && error.message.includes("attached")) {
      throw error;
    }
    throw new Error(
      "KRX OTP ephemeral body raw response bytes must be attached and non-empty"
    );
  }
}

function zeroizeBytes(value: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(value, 0);
  } catch {
    // A detached transferred view owns no remaining bytes to clear.
  }
}
