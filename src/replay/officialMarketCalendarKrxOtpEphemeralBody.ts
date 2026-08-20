import { verifyOfficialMarketCalendarKrxOtpResponseBody } from "./officialMarketCalendarKrxOtpResponseBody.js";
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
}

interface DisposedWireBodyState {
  status: "disposed";
}

type WireBodyState = ReadyWireBodyState | DisposedWireBodyState;

const bodyStates = new WeakMap<object, BodyState>();
const postParametersStates = new WeakMap<object, PostParametersState>();
const wireBodyStates = new WeakMap<object, WireBodyState>();
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
      requestContentType: wirePolicy.requestContentType
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
