import { verifyOfficialMarketCalendarKrxOtpResponseBody } from "./officialMarketCalendarKrxOtpResponseBody.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy
} from "./officialMarketCalendarKrxHolidayDataPostPolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayTargetYear,
  resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy,
  type OfficialMarketCalendarKrxHolidayTargetYear
} from "./officialMarketCalendarKrxHolidayTargetYear.js";

declare const krxOtpEphemeralBodyBrand: unique symbol;
declare const krxHolidayDataPostParametersBrand: unique symbol;

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

const bodyStates = new WeakMap<object, BodyState>();
const postParametersStates = new WeakMap<object, PostParametersState>();
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
