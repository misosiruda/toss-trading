import { TextDecoder } from "node:util";

import { z } from "zod";

import { OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION =
  "krx_holiday_data_response_body.v1";

const MAXIMUM_BODY_BYTE_LENGTH = 1_000_000;
const MAXIMUM_ROW_COUNT = 1_000;
const MAXIMUM_ROW_VALUE_LENGTH = 8_192;
const MAXIMUM_JSON_NESTING_DEPTH = 16;
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
    assertNoDuplicateJsonMemberNames(text);
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

function assertNoDuplicateJsonMemberNames(text: string): void {
  const finalIndex = skipJsonWhitespace(text, scanJsonValue(text, 0, 0));
  if (finalIndex !== text.length) {
    throw new Error("KRX holiday data response body must be valid JSON");
  }
}

function scanJsonValue(text: string, startIndex: number, depth: number): number {
  if (depth > MAXIMUM_JSON_NESTING_DEPTH) {
    throw new Error(
      "KRX holiday data response body exceeds the JSON nesting boundary"
    );
  }
  const index = skipJsonWhitespace(text, startIndex);
  const character = text[index];
  if (character === "{") {
    return scanJsonObject(text, index, depth);
  }
  if (character === "[") {
    return scanJsonArray(text, index, depth);
  }
  if (character === '"') {
    return scanJsonString(text, index).nextIndex;
  }
  for (const literal of ["true", "false", "null"] as const) {
    if (text.startsWith(literal, index)) {
      return index + literal.length;
    }
  }
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  numberPattern.lastIndex = index;
  const number = numberPattern.exec(text);
  if (number !== null) {
    return numberPattern.lastIndex;
  }
  throw new Error("KRX holiday data response body must be valid JSON");
}

function scanJsonObject(text: string, startIndex: number, depth: number): number {
  let index = skipJsonWhitespace(text, startIndex + 1);
  if (text[index] === "}") {
    return index + 1;
  }

  const memberNames = new Set<string>();
  while (index < text.length) {
    if (text[index] !== '"') {
      throw new Error("KRX holiday data response body must be valid JSON");
    }
    const key = scanJsonString(text, index);
    if (memberNames.has(key.value)) {
      throw new Error(
        "KRX holiday data response body must not contain duplicate JSON member names"
      );
    }
    memberNames.add(key.value);

    index = skipJsonWhitespace(text, key.nextIndex);
    if (text[index] !== ":") {
      throw new Error("KRX holiday data response body must be valid JSON");
    }
    index = skipJsonWhitespace(
      text,
      scanJsonValue(text, index + 1, depth + 1)
    );
    if (text[index] === "}") {
      return index + 1;
    }
    if (text[index] !== ",") {
      throw new Error("KRX holiday data response body must be valid JSON");
    }
    index = skipJsonWhitespace(text, index + 1);
  }
  throw new Error("KRX holiday data response body must be valid JSON");
}

function scanJsonArray(text: string, startIndex: number, depth: number): number {
  let index = skipJsonWhitespace(text, startIndex + 1);
  if (text[index] === "]") {
    return index + 1;
  }
  while (index < text.length) {
    index = skipJsonWhitespace(text, scanJsonValue(text, index, depth + 1));
    if (text[index] === "]") {
      return index + 1;
    }
    if (text[index] !== ",") {
      throw new Error("KRX holiday data response body must be valid JSON");
    }
    index = skipJsonWhitespace(text, index + 1);
  }
  throw new Error("KRX holiday data response body must be valid JSON");
}

function scanJsonString(
  text: string,
  startIndex: number
): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  while (index < text.length) {
    if (text[index] === '"') {
      const nextIndex = index + 1;
      let value: unknown;
      try {
        value = JSON.parse(text.slice(startIndex, nextIndex)) as unknown;
      } catch {
        throw new Error("KRX holiday data response body must be valid JSON");
      }
      if (typeof value !== "string") {
        throw new Error("KRX holiday data response body must be valid JSON");
      }
      return { value, nextIndex };
    }
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    index += 1;
  }
  throw new Error("KRX holiday data response body must be valid JSON");
}

function skipJsonWhitespace(text: string, startIndex: number): number {
  let index = startIndex;
  while (
    text[index] === " " ||
    text[index] === "\t" ||
    text[index] === "\r" ||
    text[index] === "\n"
  ) {
    index += 1;
  }
  return index;
}
