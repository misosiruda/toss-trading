import type { ClientRequest, IncomingMessage } from "node:http";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy,
  type OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";
import { verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody } from "./officialMarketCalendarKrxLegacyDownloadOtpResponseBody.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy,
  type OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition
} from "./officialMarketCalendarKrxLegacyDownloadPostNetworkPolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy
} from "./officialMarketCalendarKrxLegacyDownloadPostWirePolicy.js";

declare const krxLegacyDownloadOtpEphemeralBodyBrand: unique symbol;
declare const krxLegacyDownloadEphemeralParametersBrand: unique symbol;
declare const krxLegacyDownloadPostEphemeralWireBodyBrand: unique symbol;
declare const krxLegacyDownloadEphemeralResponseBrand: unique symbol;

export interface OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody {
  readonly [krxLegacyDownloadOtpEphemeralBodyBrand]: true;
  toJSON(): never;
}

export interface CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput {
  rawResponseBytes: Uint8Array;
  requestedFileName: unknown;
}

export interface OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters {
  readonly [krxLegacyDownloadEphemeralParametersBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody {
  readonly [krxLegacyDownloadPostEphemeralWireBodyBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse {
  readonly [krxLegacyDownloadEphemeralResponseBrand]: true;
  toJSON(): never;
}

export interface OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  consume(
    handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
  ): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse>;
}

export interface TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector {
  dialAddress: string;
  dialPort: number;
  certificateAuthority: string;
  deadlineMs?: number;
}

export type OfficialMarketCalendarKrxLegacyDownloadNetworkErrorCode =
  | "KRX_LEGACY_DOWNLOAD_NETWORK_INVALID_CONFIG"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_DEADLINE_EXCEEDED"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_REJECTED"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_TOO_LARGE"
  | "KRX_LEGACY_DOWNLOAD_NETWORK_INCOMPLETE_RESPONSE";

export class OfficialMarketCalendarKrxLegacyDownloadNetworkError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyDownloadNetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyDownloadNetworkError";
  }
}

type LegacyDocument =
  OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition["documents"][number];
type LegacyFileName = LegacyDocument["fileName"];

interface ReadyBodyState {
  status: "ready";
  rawResponseBytes: Uint8Array;
  fileName: LegacyFileName;
}

interface ReadyParametersState {
  status: "ready";
  rawOtpBytes: Uint8Array;
  fileName: LegacyFileName;
}

interface DisposedState {
  status: "disposed";
}

type BodyState = ReadyBodyState | DisposedState;
type ParametersState = ReadyParametersState | DisposedState;

interface ReadyWireBodyState {
  status: "ready";
  bodyBytes: Uint8Array;
  fileName: LegacyFileName;
  requestContentType: "application/x-www-form-urlencoded";
}

interface ReadyResponseState {
  status: "ready";
  rawResponseBytes: Uint8Array;
  fileName: LegacyFileName;
  contentLength: LegacyDocument["contentLength"];
}

type WireBodyState = ReadyWireBodyState | DisposedState;
type ResponseState = ReadyResponseState | DisposedState;

const bodyStates = new WeakMap<object, BodyState>();
const parameterStates = new WeakMap<object, ParametersState>();
const wireBodyStates = new WeakMap<object, WireBodyState>();
const responseStates = new WeakMap<object, ResponseState>();
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
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer"
)?.get;
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength"
      )?.get;

export function createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
  input: CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput
): OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody {
  const transferredRawResponseBytes = input.rawResponseBytes;
  let requestedFileName: unknown;
  try {
    requestedFileName = input.requestedFileName;
  } catch (error) {
    zeroizeBytes(transferredRawResponseBytes);
    throw error;
  }
  let byteLength: number;
  try {
    byteLength = readTransferredByteLength(transferredRawResponseBytes);
  } catch (error) {
    zeroizeBytes(transferredRawResponseBytes);
    throw error;
  }
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
    verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(
      ownedRawResponseBytes
    );
    const fileName = resolveRegisteredFileName(requestedFileName);

    const handle = createOpaqueHandle(() => {
      disposeBodyObject(handle);
      throw new Error(
        "KRX legacy download OTP ephemeral body cannot be serialized or exported"
      );
    });
    bodyStates.set(handle, {
      status: "ready",
      rawResponseBytes: ownedRawResponseBytes,
      fileName
    });
    return handle as OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody;
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

export function consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
  handle: OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
): OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters {
  const handleObject = assertHandleObject(handle);
  const state = bodyStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX legacy download OTP ephemeral body must come from the process-local factory"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX legacy download OTP ephemeral body has already been consumed"
    );
  }

  bodyStates.set(handleObject, { status: "disposed" });
  let transferred = false;
  try {
    const fileName = resolveRegisteredFileName(state.fileName);

    const parameterHandle = createOpaqueHandle(() => {
      disposeParametersObject(parameterHandle);
      throw new Error(
        "KRX legacy download parameters cannot be serialized or exported"
      );
    });
    parameterStates.set(parameterHandle, {
      status: "ready",
      rawOtpBytes: state.rawResponseBytes,
      fileName
    });
    transferred = true;
    return parameterHandle as OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters;
  } finally {
    if (!transferred) {
      zeroizeBytes(state.rawResponseBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
  handle: OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
): void {
  const handleObject = assertHandleObject(handle);
  if (!bodyStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download OTP ephemeral body must come from the process-local factory"
    );
  }
  disposeBodyObject(handleObject);
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
): void {
  const handleObject = assertHandleObject(handle);
  if (!parameterStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download parameters must come from the fixed process-local consumer"
    );
  }
  disposeParametersObject(handleObject);
}

export function consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
): OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody {
  const handleObject = assertHandleObject(handle);
  const state = parameterStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX legacy download parameters must come from the fixed process-local consumer"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX legacy download parameters have already been consumed"
    );
  }

  parameterStates.set(handleObject, { status: "disposed" });
  let bodyBytes: Uint8Array | undefined;
  let transferred = false;
  try {
    const wirePolicy =
      resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION
      );
    const document = resolveRegisteredDocument(state.fileName);
    bodyBytes = encodeDownloadPostWireBody(
      state.rawOtpBytes,
      wirePolicy.wireLimits.maximumRequestBodyByteLength
    );
    verifyDownloadPostWireBody(bodyBytes, state.rawOtpBytes, wirePolicy);

    const wireBodyHandle = createOpaqueHandle(() => {
      disposeWireBodyObject(wireBodyHandle);
      throw new Error(
        "KRX legacy download POST wire body cannot be serialized or exported"
      );
    });
    wireBodyStates.set(wireBodyHandle, {
      status: "ready",
      bodyBytes,
      fileName: document.fileName,
      requestContentType: wirePolicy.requestContentType
    });
    transferred = true;
    return wireBodyHandle as OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody;
  } finally {
    zeroizeBytes(state.rawOtpBytes);
    if (!transferred && bodyBytes !== undefined) {
      zeroizeBytes(bodyBytes);
    }
  }
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody(
  handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
): void {
  const handleObject = assertHandleObject(handle);
  if (!wireBodyStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download POST wire body must come from the fixed byte encoder"
    );
  }
  disposeWireBodyObject(handleObject);
}

export function disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
  handle: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
): void {
  const handleObject = assertHandleObject(handle);
  if (!responseStates.has(handleObject)) {
    throw new Error(
      "KRX legacy download response must come from the fixed network consumer"
    );
  }
  disposeResponseObject(handleObject);
}

export function createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(): OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  const policy = resolveDownloadNetworkPolicy();
  return createNetworkConsumer({
    deadlineMs: policy.networkLimits.absoluteDeadlineMilliseconds,
    request: httpsRequest
  });
}

export function createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(
  connector: TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector
): OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  const normalizedConnector = normalizeTestOnlyNetworkConnector(connector);
  const policy = resolveDownloadNetworkPolicy();
  const agent = new HttpsAgent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = () =>
    tlsConnect({
      host: normalizedConnector.dialAddress,
      port: normalizedConnector.dialPort,
      servername: policy.transportDerivedRequestHeaderValues.host,
      ca: normalizedConnector.certificateAuthority,
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
): OfficialMarketCalendarKrxLegacyDownloadNetworkConsumer {
  return Object.freeze({
    consume: (
      handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
    ) => consumeWireBodyOverNetwork(handle, options)
  });
}

async function consumeWireBodyOverNetwork(
  handle: OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody,
  options: NetworkConsumerOptions
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  const handleObject = assertHandleObject(handle);
  const state = wireBodyStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX legacy download POST wire body must come from the fixed byte encoder"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX legacy download POST wire body has already been consumed"
    );
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
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  const policy = resolveDownloadNetworkPolicy();
  const document = resolveRegisteredDocument(state.fileName);
  if (
    state.requestContentType !== policy.fixedRequestHeaderValues.contentType ||
    state.bodyBytes.byteLength < 1 ||
    state.bodyBytes.byteLength >
      policy.networkLimits.maximumRequestBodyByteLength
  ) {
    throw responseRejected();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let clientRequest: ClientRequest | undefined;
    let requestBodyCleared = false;
    const clearRequestBody = (): void => {
      if (!requestBodyCleared) {
        requestBodyCleared = true;
        zeroizeBytes(state.bodyBytes);
      }
    };
    const finish = (
      error: unknown,
      value?: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
            value
          );
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
        new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
          "KRX_LEGACY_DOWNLOAD_NETWORK_DEADLINE_EXCEEDED",
          "KRX legacy download network deadline was exceeded."
        )
      );
      clientRequest?.destroy();
    }, options.deadlineMs);

    try {
      clientRequest = options.request(
        buildDownloadRequestOptions(policy, state.bodyBytes.byteLength),
        (response) => {
          responseStarted = true;
          readNetworkResponse(response, policy, document).then(
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
            : new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
                "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE",
                "KRX legacy download network request failed."
              )
        );
      });
      clientRequest.end(state.bodyBytes);
    } catch {
      finish(
        responseStarted
          ? incompleteResponse()
          : new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
              "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE",
              "KRX legacy download network request failed."
            )
      );
    }
  });
}

function buildDownloadRequestOptions(
  policy: OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  bodyByteLength: number
): RequestOptions {
  const requestedUrl = new URL(policy.sourceSelector.requestedUrl);
  return {
    protocol: policy.dedicatedDomainBoundary.scheme,
    hostname: policy.dedicatedDomainBoundary.hostname,
    port: 443,
    servername: policy.dedicatedDomainBoundary.hostname,
    method: policy.sourceSelector.requestMethod,
    path: requestedUrl.pathname,
    agent: false,
    rejectUnauthorized: true,
    headers: {
      Accept: policy.fixedRequestHeaderValues.accept,
      "Cache-Control": policy.fixedRequestHeaderValues.cacheControl,
      "Content-Length": String(bodyByteLength),
      "Content-Type": policy.fixedRequestHeaderValues.contentType,
      Origin: policy.fixedRequestHeaderValues.origin,
      Pragma: policy.fixedRequestHeaderValues.pragma,
      Referer: policy.fixedRequestHeaderValues.referer,
      "User-Agent": policy.fixedRequestHeaderValues.userAgent,
      Host: policy.transportDerivedRequestHeaderValues.host,
      Connection: policy.transportDerivedRequestHeaderValues.connection
    }
  };
}

async function readNetworkResponse(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  document: LegacyDocument
): Promise<OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse> {
  let declaredContentLength: number;
  try {
    declaredContentLength = assertResponseHeaderBoundary(
      response,
      policy,
      document
    );
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
      value?: OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
    ): void => {
      if (settled) {
        if (value !== undefined) {
          disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
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
        if (responseByteLength + chunk.byteLength > declaredContentLength) {
          finish(responseTooLarge());
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
        responseByteLength !== declaredContentLength ||
        response.rawTrailers.length !== 0 ||
        Object.keys(response.trailers).length !== 0
      ) {
        finish(incompleteResponse());
        return;
      }
      const handle = createOpaqueHandle(() => {
        disposeResponseObject(handle);
        throw new Error(
          "KRX legacy download response cannot be serialized or exported"
        );
      });
      responseStates.set(handle, {
        status: "ready",
        rawResponseBytes: responseBytes,
        fileName: document.fileName,
        contentLength: document.contentLength
      });
      finish(
        undefined,
        handle as OfficialMarketCalendarKrxLegacyDownloadEphemeralResponse
      );
    });
  });
}

function assertResponseHeaderBoundary(
  response: IncomingMessage,
  policy: OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition,
  document: LegacyDocument
): number {
  if (
    response.statusCode !== policy.responseBoundary.requiredStatus ||
    response.httpVersion !== "1.1"
  ) {
    throw responseRejected();
  }
  const declaredContentLengths = readRawHeaderValues(
    response.rawHeaders,
    "content-length"
  );
  if (
    declaredContentLengths.length === 1 &&
    /^(0|[1-9][0-9]*)$/.test(declaredContentLengths[0] ?? "") &&
    Number(declaredContentLengths[0]) >
      policy.networkLimits.maximumResponseBodyByteLength
  ) {
    throw responseTooLarge();
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
  const expectedContentLength = String(document.contentLength);
  if (
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-length",
      expectedContentLength
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-type",
      policy.responseBoundary.requiredContentType
    ) ||
    !hasExactHeaderValue(
      response.rawHeaders,
      "content-disposition",
      `attachment; filename=${document.fileName}`
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
      policy.responseBoundary.requiredSetCookieHeaderCount
  ) {
    throw responseRejected();
  }
  if (
    document.contentLength >
    policy.networkLimits.maximumResponseBodyByteLength
  ) {
    throw responseTooLarge();
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
  return document.contentLength;
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

function normalizeTestOnlyNetworkConnector(
  connector: TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector
): Readonly<TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector> {
  if (connector === null || typeof connector !== "object") {
    throwInvalidNetworkConnector();
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
    throwInvalidNetworkConnector();
  }
  const maximumDeadline =
    resolveDownloadNetworkPolicy().networkLimits.absoluteDeadlineMilliseconds;
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
    throwInvalidNetworkConnector();
  }
  return Object.freeze({
    dialAddress,
    dialPort,
    certificateAuthority,
    ...(deadlineMs === undefined ? {} : { deadlineMs })
  }) as Readonly<TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector>;
}

function resolveDownloadNetworkPolicy(): OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition {
  return resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION
  );
}

function encodeDownloadPostWireBody(
  rawOtpBytes: Uint8Array,
  maximumBodyByteLength: number
): Uint8Array {
  const workspace = new Uint8Array(maximumBodyByteLength);
  try {
    let offset = 0;
    for (const byte of [0x63, 0x6f, 0x64, 0x65, 0x3d]) {
      offset = appendLiteralByte(workspace, offset, byte);
    }
    for (const byte of rawOtpBytes) {
      offset = appendEncodedByte(workspace, offset, byte);
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

function verifyDownloadPostWireBody(
  bodyBytes: Uint8Array,
  rawOtpBytes: Uint8Array,
  wirePolicy: ReturnType<
    typeof resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy
  >
): void {
  if (
    bodyBytes.byteLength < wirePolicy.wireLimits.minimumRequestBodyByteLength ||
    bodyBytes.byteLength > wirePolicy.wireLimits.maximumRequestBodyByteLength
  ) {
    throw new Error(
      "KRX legacy download POST wire body violates the registered byte limits"
    );
  }
  let offset = 0;
  for (const byte of [0x63, 0x6f, 0x64, 0x65, 0x3d]) {
    offset = expectLiteralByte(bodyBytes, offset, byte);
  }
  for (const byte of rawOtpBytes) {
    offset = expectEncodedByte(bodyBytes, offset, byte);
  }
  if (offset !== bodyBytes.byteLength) {
    throw new Error("KRX legacy download POST wire body has trailing bytes");
  }
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

function appendLiteralByte(
  destination: Uint8Array,
  offset: number,
  byte: number
): number {
  if (offset >= destination.byteLength) {
    throw new Error(
      "KRX legacy download POST wire body exceeds the registered byte limit"
    );
  }
  destination[offset] = byte;
  return offset + 1;
}

function expectLiteralByte(
  bodyBytes: Uint8Array,
  offset: number,
  expectedByte: number
): number {
  if (offset >= bodyBytes.byteLength || bodyBytes[offset] !== expectedByte) {
    throw new Error(
      "KRX legacy download POST wire body verification failed"
    );
  }
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

function isLoopbackIp(value: string): boolean {
  return isIP(value) !== 0 && (value === "127.0.0.1" || value === "::1");
}

function throwInvalidNetworkConnector(): never {
  throw new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_INVALID_CONFIG",
    "KRX legacy download test-only network connector is invalid."
  );
}

function responseRejected(): OfficialMarketCalendarKrxLegacyDownloadNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_REJECTED",
    "KRX legacy download response was rejected."
  );
}

function responseTooLarge(): OfficialMarketCalendarKrxLegacyDownloadNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_TOO_LARGE",
    "KRX legacy download response exceeded the registered byte length."
  );
}

function incompleteResponse(): OfficialMarketCalendarKrxLegacyDownloadNetworkError {
  return new OfficialMarketCalendarKrxLegacyDownloadNetworkError(
    "KRX_LEGACY_DOWNLOAD_NETWORK_INCOMPLETE_RESPONSE",
    "KRX legacy download response was incomplete."
  );
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

function disposeParametersObject(handle: object): void {
  const state = parameterStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawOtpBytes);
  } finally {
    parameterStates.set(handle, { status: "disposed" });
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

function disposeResponseObject(handle: object): void {
  const state = responseStates.get(handle);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawResponseBytes);
  } finally {
    responseStates.set(handle, { status: "disposed" });
  }
}

function resolveRegisteredFileName(value: unknown): LegacyFileName {
  return resolveRegisteredDocument(value).fileName;
}

function resolveRegisteredDocument(value: unknown): LegacyDocument {
  const sourcePolicy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );
  const document = sourcePolicy.documents.find(
    (candidate) => candidate.fileName === value
  );
  if (document === undefined) {
    throw new Error(
      "KRX legacy download OTP target must be a registered document file name"
    );
  }
  return document;
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
    throw new Error("KRX legacy download ephemeral handle is invalid");
  }
  return value;
}

function readTransferredByteLength(value: unknown): number {
  if (
    !(value instanceof Uint8Array) ||
    typedArrayByteLengthGetter === undefined ||
    typedArrayBufferGetter === undefined
  ) {
    throw new Error(
      "KRX legacy download OTP ephemeral bytes must be a Uint8Array"
    );
  }
  try {
    const buffer = typedArrayBufferGetter.call(value) as ArrayBufferLike;
    if (hasSharedArrayBufferBacking(buffer)) {
      throw new Error(
        "KRX legacy download OTP ephemeral bytes must not use shared backing memory"
      );
    }
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    if (byteLength !== 300) {
      throw new Error(
        "KRX legacy download OTP ephemeral bytes must be attached and exactly 300 bytes"
      );
    }
    return byteLength;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("shared") ||
        error.message.includes("exactly 300"))
    ) {
      throw error;
    }
    throw new Error(
      "KRX legacy download OTP ephemeral bytes must be attached and exactly 300 bytes"
    );
  }
}

function hasSharedArrayBufferBacking(buffer: ArrayBufferLike): boolean {
  if (sharedArrayBufferByteLengthGetter === undefined) {
    return false;
  }
  try {
    sharedArrayBufferByteLengthGetter.call(buffer);
    return true;
  } catch {
    return false;
  }
}

function zeroizeBytes(value: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(value, 0);
  } catch {
    // A detached transferred view owns no remaining bytes to clear.
  }
}
