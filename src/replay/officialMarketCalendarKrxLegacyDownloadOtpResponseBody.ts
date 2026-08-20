import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy
} from "./officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_RESPONSE_BODY_VERSION =
  "official_market_calendar_krx_legacy_download_otp_response_body.v1";

const ENCODED_BYTE_LENGTH = 300;
const DECODED_BYTE_LENGTH = 224;
const PADDING_CHARACTERS = 1;
const ASCII_EQUALS = 0x3d;

const responseBodyShapeSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_RESPONSE_BODY_VERSION
    ),
    encoding: z.literal("base64"),
    encodedByteLength: z.literal(ENCODED_BYTE_LENGTH),
    decodedByteLength: z.literal(DECODED_BYTE_LENGTH),
    paddingCharacters: z.literal(PADDING_CHARACTERS)
  })
  .strict()
  .readonly();

export type OfficialMarketCalendarKrxLegacyDownloadOtpResponseBodyShape =
  z.infer<typeof responseBodyShapeSchema>;

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength"
)?.get;

export function verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(
  rawResponseBytes: unknown
): OfficialMarketCalendarKrxLegacyDownloadOtpResponseBodyShape {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION
    );
  if (
    policy.otpBodyBoundary.requiredAsciiByteLength !== ENCODED_BYTE_LENGTH ||
    policy.otpBodyBoundary.requiredDecodedByteLength !== DECODED_BYTE_LENGTH ||
    policy.otpBodyBoundary.requiredPaddingCharacterCount !==
      PADDING_CHARACTERS ||
    policy.otpBodyBoundary.requiredEncoding !== "canonical_base64"
  ) {
    throw new Error(
      "KRX legacy download OTP response body must match the registered network policy"
    );
  }

  const byteLength = readUint8ArrayByteLength(rawResponseBytes);
  if (byteLength !== ENCODED_BYTE_LENGTH) {
    throw new Error(
      `KRX legacy download OTP response body must be exactly ${ENCODED_BYTE_LENGTH} bytes`
    );
  }

  const ownedBytes = new Uint8Array(byteLength);
  try {
    Uint8Array.prototype.set.call(
      ownedBytes,
      rawResponseBytes as Uint8Array
    );
    verifyCanonicalBase64Bytes(ownedBytes);
    return responseBodyShapeSchema.parse({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_RESPONSE_BODY_VERSION,
      encoding: "base64",
      encodedByteLength: ENCODED_BYTE_LENGTH,
      decodedByteLength: DECODED_BYTE_LENGTH,
      paddingCharacters: PADDING_CHARACTERS
    });
  } finally {
    Uint8Array.prototype.fill.call(ownedBytes, 0);
  }
}

function readUint8ArrayByteLength(value: unknown): number {
  if (
    !(value instanceof Uint8Array) ||
    typedArrayByteLengthGetter === undefined
  ) {
    throw new Error(
      "KRX legacy download OTP response body must be a Uint8Array"
    );
  }
  try {
    return typedArrayByteLengthGetter.call(value) as number;
  } catch {
    throw new Error(
      "KRX legacy download OTP response body must be an attached Uint8Array"
    );
  }
}

function verifyCanonicalBase64Bytes(bytes: Uint8Array): void {
  for (
    let index = 0;
    index < ENCODED_BYTE_LENGTH - PADDING_CHARACTERS;
    index += 1
  ) {
    if (base64Sextet(bytes[index]!) === null) {
      throw new Error(
        "KRX legacy download OTP response body must contain only canonical base64 bytes"
      );
    }
  }
  if (bytes[ENCODED_BYTE_LENGTH - 1] !== ASCII_EQUALS) {
    throw new Error(
      "KRX legacy download OTP response body must end with exact = padding"
    );
  }
  const finalSextet = base64Sextet(bytes[ENCODED_BYTE_LENGTH - 2]!);
  if (finalSextet === null || (finalSextet & 0x03) !== 0) {
    throw new Error(
      "KRX legacy download OTP response body must use zero canonical base64 padding bits"
    );
  }
}

function base64Sextet(byte: number): number | null {
  if (byte >= 0x41 && byte <= 0x5a) {
    return byte - 0x41;
  }
  if (byte >= 0x61 && byte <= 0x7a) {
    return byte - 0x61 + 26;
  }
  if (byte >= 0x30 && byte <= 0x39) {
    return byte - 0x30 + 52;
  }
  if (byte === 0x2b) {
    return 62;
  }
  if (byte === 0x2f) {
    return 63;
  }
  return null;
}
