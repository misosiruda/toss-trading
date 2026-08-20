import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy,
  type OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";
import { verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody } from "./officialMarketCalendarKrxLegacyDownloadOtpResponseBody.js";

declare const krxLegacyDownloadOtpEphemeralBodyBrand: unique symbol;
declare const krxLegacyDownloadEphemeralParametersBrand: unique symbol;

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

const bodyStates = new WeakMap<object, BodyState>();
const parameterStates = new WeakMap<object, ParametersState>();
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

function resolveRegisteredFileName(value: unknown): LegacyFileName {
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
  return document.fileName;
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
