import { TextDecoder } from "node:util";

import { z } from "zod";

import { OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION =
  "krx_holiday_data_response_body.v1";

const MAXIMUM_BODY_BYTE_LENGTH = 1_000_000;
const MAXIMUM_ROW_COUNT = 1_000;
const MAXIMUM_ROW_VALUE_LENGTH = 8_192;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const ROW_KEYS = [
  "calnd_dd",
  "dy_tp_cd",
  "calnd_dd_dy",
  "kr_dy_tp",
  "holdy_eng_nm"
] as const;

const responseMetadataBindingSchema = z
  .object({
    responseMetadataVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION
    ),
    transferCompletion: z
      .object({
        contentLength: z
          .number()
          .int()
          .min(1)
          .max(MAXIMUM_BODY_BYTE_LENGTH)
      }),
    bodyValidationEligible: z.literal(true),
    durableEvidenceReusable: z.literal(false),
    acceptedAcquisition: z.literal(false)
  });

const rowValueSchema = z.string().max(MAXIMUM_ROW_VALUE_LENGTH);
const responseRowSchema = z
  .object({
    calnd_dd: rowValueSchema,
    dy_tp_cd: rowValueSchema,
    calnd_dd_dy: rowValueSchema,
    kr_dy_tp: rowValueSchema,
    holdy_eng_nm: rowValueSchema
  })
  .strict();
const responseBodySchema = z
  .object({
    block1: z.array(responseRowSchema).min(1).max(MAXIMUM_ROW_COUNT)
  })
  .strict();

export interface OfficialMarketCalendarKrxHolidayDataResponseBodyShape {
  responseBodyVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION;
  responseMetadataVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION;
  bodyByteLength: number;
  topLevelKey: "block1";
  rowCount: number;
  rowKeys: typeof ROW_KEYS;
  rowValueType: "string";
  bodyShapeValidated: true;
  returnedRowValues: false;
  durableEvidenceReusable: false;
  acceptedAcquisition: false;
}

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength"
)?.get;

export function verifyOfficialMarketCalendarKrxHolidayDataResponseBody(
  rawResponseBytes: unknown,
  responseMetadata: unknown
): OfficialMarketCalendarKrxHolidayDataResponseBodyShape {
  const metadata = responseMetadataBindingSchema.parse(responseMetadata);
  const byteLength = readUint8ArrayByteLength(rawResponseBytes);
  if (byteLength !== metadata.transferCompletion.contentLength) {
    throw new Error(
      "KRX holiday data response body length must match verified transfer metadata"
    );
  }

  const ownedBytes = new Uint8Array(byteLength);
  try {
    Uint8Array.prototype.set.call(
      ownedBytes,
      rawResponseBytes as Uint8Array
    );
    if (hasUtf8Bom(ownedBytes)) {
      throw new Error("KRX holiday data response body must not contain a UTF-8 BOM");
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(ownedBytes);
    } catch {
      throw new Error("KRX holiday data response body must be valid UTF-8");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error("KRX holiday data response body must be valid JSON");
    }
    const body = responseBodySchema.parse(parsed);

    return Object.freeze({
      responseBodyVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION,
      responseMetadataVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION,
      bodyByteLength: byteLength,
      topLevelKey: "block1" as const,
      rowCount: body.block1.length,
      rowKeys: Object.freeze([...ROW_KEYS]) as typeof ROW_KEYS,
      rowValueType: "string" as const,
      bodyShapeValidated: true as const,
      returnedRowValues: false as const,
      durableEvidenceReusable: false as const,
      acceptedAcquisition: false as const
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
    throw new Error("KRX holiday data response body must be a Uint8Array");
  }
  try {
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    if (byteLength === 0) {
      try {
        Uint8Array.prototype.slice.call(value, 0, 0);
      } catch {
        throw new Error(
          "KRX holiday data response body must be an attached Uint8Array"
        );
      }
    }
    return byteLength;
  } catch {
    throw new Error(
      "KRX holiday data response body must be an attached Uint8Array"
    );
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= UTF8_BOM.length &&
    UTF8_BOM.every((byte, index) => bytes[index] === byte)
  );
}
