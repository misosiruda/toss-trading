import {
  verifyOfficialMarketCalendarKrxHolidayDataResponseBody,
  verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics,
  type OfficialMarketCalendarKrxHolidayDataResponseSemantics
} from "./officialMarketCalendarKrxHolidayDataResponseBody.js";
import {
  parseOfficialMarketCalendarKrxHolidayTargetYear,
  type OfficialMarketCalendarKrxHolidayTargetYear
} from "./officialMarketCalendarKrxHolidayTargetYear.js";

declare const krxHolidayDataEphemeralResponseBrand: unique symbol;

export interface OfficialMarketCalendarKrxHolidayDataEphemeralResponse {
  readonly [krxHolidayDataEphemeralResponseBrand]: true;
  toJSON(): never;
}

export interface CreateOfficialMarketCalendarKrxHolidayDataEphemeralResponseInput {
  rawResponseBytes: Uint8Array;
  responseMetadata: unknown;
  targetYear: unknown;
}

interface ReadyResponseState {
  status: "ready";
  rawResponseBytes: Uint8Array;
  responseMetadata: Readonly<{
    responseMetadataVersion: "krx_holiday_data_response_metadata.v1";
    transferCompletion: Readonly<{ contentLength: number }>;
    bodyValidationEligible: true;
    durableEvidenceReusable: false;
    acceptedAcquisition: false;
  }>;
  targetYear: OfficialMarketCalendarKrxHolidayTargetYear;
}

interface DisposedResponseState {
  status: "disposed";
}

type ResponseState = ReadyResponseState | DisposedResponseState;

const responseStates = new WeakMap<object, ResponseState>();
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

export function createOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
  input: CreateOfficialMarketCalendarKrxHolidayDataEphemeralResponseInput
): OfficialMarketCalendarKrxHolidayDataEphemeralResponse {
  const transferredRawResponseBytes = input.rawResponseBytes;
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

    const responseMetadataInput = input.responseMetadata;
    const targetYearInput = input.targetYear;
    const bodyShape = verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
      ownedRawResponseBytes,
      responseMetadataInput
    );
    const targetYear =
      parseOfficialMarketCalendarKrxHolidayTargetYear(targetYearInput);
    const responseMetadata = Object.freeze({
      responseMetadataVersion: bodyShape.responseMetadataVersion,
      transferCompletion: Object.freeze({
        contentLength: bodyShape.bodyByteLength
      }),
      bodyValidationEligible: true as const,
      durableEvidenceReusable: false as const,
      acceptedAcquisition: false as const
    });

    const handle = createOpaqueHandle(() => {
      disposeResponseObject(handle);
      throw new Error(
        "KRX holiday data ephemeral response cannot be serialized or exported"
      );
    });
    responseStates.set(handle, {
      status: "ready",
      rawResponseBytes: ownedRawResponseBytes,
      responseMetadata,
      targetYear
    });
    return handle as OfficialMarketCalendarKrxHolidayDataEphemeralResponse;
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

export function consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
  handle: OfficialMarketCalendarKrxHolidayDataEphemeralResponse
): OfficialMarketCalendarKrxHolidayDataResponseSemantics {
  const handleObject = assertHandleObject(handle);
  const state = responseStates.get(handleObject);
  if (state === undefined) {
    throw new Error(
      "KRX holiday data ephemeral response must come from the process-local factory"
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      "KRX holiday data ephemeral response has already been consumed"
    );
  }

  responseStates.set(handleObject, { status: "disposed" });
  try {
    return verifyOfficialMarketCalendarKrxHolidayDataResponseSemantics(
      state.rawResponseBytes,
      state.responseMetadata,
      state.targetYear
    );
  } finally {
    zeroizeBytes(state.rawResponseBytes);
  }
}

export function disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
  handle: OfficialMarketCalendarKrxHolidayDataEphemeralResponse
): void {
  const handleObject = assertHandleObject(handle);
  if (!responseStates.has(handleObject)) {
    throw new Error(
      "KRX holiday data ephemeral response must come from the process-local factory"
    );
  }
  disposeResponseObject(handleObject);
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
    throw new Error("KRX holiday data ephemeral response handle is invalid");
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
      "KRX holiday data ephemeral response bytes must be a Uint8Array"
    );
  }
  try {
    const buffer = typedArrayBufferGetter.call(value) as ArrayBufferLike;
    if (
      typeof SharedArrayBuffer !== "undefined" &&
      buffer instanceof SharedArrayBuffer
    ) {
      throw new Error(
        "KRX holiday data ephemeral response bytes must not use shared backing memory"
      );
    }
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    if (byteLength === 0) {
      throw new Error(
        "KRX holiday data ephemeral response bytes must be attached and non-empty"
      );
    }
    return byteLength;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("attached") || error.message.includes("shared"))
    ) {
      throw error;
    }
    throw new Error(
      "KRX holiday data ephemeral response bytes must be attached and non-empty"
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
