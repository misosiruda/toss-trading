import { createHash } from "node:crypto";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync
} from "node:zlib";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarSourceParserContractRegistryEntrySchema,
  resolveOfficialMarketCalendarSourceParserContractFromRegistry
} from "./officialMarketCalendarSourceParserContract.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_REPRESENTATION_DECODE_BOUNDARY_SCHEMA_VERSION =
  "official_market_calendar_source_representation_decode_boundary.v1";
export const OFFICIAL_MARKET_CALENDAR_SOURCE_DECODE_POLICY_VERSION =
  "official_market_calendar_source_decode.v1";
export const OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH =
  64 * 1024 * 1024;

const contentLengthSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const sourceBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (value) => value.byteLength > 0,
    "official calendar encoded source bytes must be non-empty"
  );
const createRepresentationDecodeBoundaryInputSchema = z
  .object({
    sourceBytes: sourceBytesSchema,
    contentType: z.string().min(1),
    contentEncoding: z.enum(["br", "deflate", "gzip"]).nullable(),
    parserContractEntry:
      officialMarketCalendarSourceParserContractRegistryEntrySchema
  })
  .strict();

const representationDecodeBoundaryPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_REPRESENTATION_DECODE_BOUNDARY_SCHEMA_VERSION
    ),
    decodePolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_DECODE_POLICY_VERSION
    ),
    maxDecodedContentLength: z.literal(
      OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH
    ),
    exchange: z.enum(["KRX", "NYSE"]),
    contentType: z.string().min(1),
    contentEncoding: z.enum(["br", "deflate", "gzip"]).nullable(),
    parserContractEntry:
      officialMarketCalendarSourceParserContractRegistryEntrySchema,
    sourceDocumentHash: sha256HashSchema,
    encodedContentLength: contentLengthSchema,
    decodedContentHash: sha256HashSchema,
    decodedContentLength: contentLengthSchema,
    parserResultBound: z.literal(false)
  })
  .strict();

export const officialMarketCalendarSourceRepresentationDecodeBoundarySchema =
  representationDecodeBoundaryPayloadSchema
    .safeExtend({ representationDecodeBoundaryHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceRepresentationDecodeBoundary = z.infer<
  typeof officialMarketCalendarSourceRepresentationDecodeBoundarySchema
>;

export type OfficialMarketCalendarSourceRepresentationDecodeBoundaryPayload =
  z.infer<typeof representationDecodeBoundaryPayloadSchema>;

export interface DecodedOfficialMarketCalendarSourceRepresentation {
  representationDecodeBoundary: OfficialMarketCalendarSourceRepresentationDecodeBoundary;
  decodedBytes: Uint8Array;
}

export function decodeOfficialMarketCalendarSourceRepresentation(
  input: unknown,
  parserContractRegistry: unknown
): DecodedOfficialMarketCalendarSourceRepresentation {
  const parsed = createRepresentationDecodeBoundaryInputSchema.parse(input);
  const parserContractEntry =
    resolveOfficialMarketCalendarSourceParserContractFromRegistry(
      parsed.parserContractEntry,
      parserContractRegistry
    );
  const definition = parserContractEntry.parserContractDefinition;
  if (!definition.acceptedContentTypes.includes(parsed.contentType)) {
    throw new Error(
      "official calendar source content type is not accepted by parser contract"
    );
  }
  if (!definition.acceptedContentEncodings.includes(parsed.contentEncoding)) {
    throw new Error(
      "official calendar source content encoding is not accepted by parser contract"
    );
  }

  const decodedBytes = decodeBytes(parsed.sourceBytes, parsed.contentEncoding);
  const payload = representationDecodeBoundaryPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_REPRESENTATION_DECODE_BOUNDARY_SCHEMA_VERSION,
    decodePolicyVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_DECODE_POLICY_VERSION,
    maxDecodedContentLength:
      OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH,
    exchange: definition.exchange,
    contentType: parsed.contentType,
    contentEncoding: parsed.contentEncoding,
    parserContractEntry,
    sourceDocumentHash: hashBytes(parsed.sourceBytes),
    encodedContentLength: parsed.sourceBytes.byteLength,
    decodedContentHash: hashBytes(decodedBytes),
    decodedContentLength: decodedBytes.byteLength,
    parserResultBound: false
  });
  const representationDecodeBoundary = deepFreeze({
    ...payload,
    representationDecodeBoundaryHash:
      createOfficialMarketCalendarSourceRepresentationDecodeBoundaryHash(payload)
  });
  return {
    representationDecodeBoundary,
    decodedBytes: Uint8Array.from(decodedBytes)
  };
}

export function openOfficialMarketCalendarSourceRepresentationDecodeBoundary(
  value: unknown,
  options: {
    sourceBytes: unknown;
    parserContractRegistry: unknown;
  }
): DecodedOfficialMarketCalendarSourceRepresentation {
  const boundary =
    officialMarketCalendarSourceRepresentationDecodeBoundarySchema.parse(value);
  const sourceBytes = sourceBytesSchema.parse(options.sourceBytes);
  const expected = decodeOfficialMarketCalendarSourceRepresentation(
    {
      sourceBytes,
      contentType: boundary.contentType,
      contentEncoding: boundary.contentEncoding,
      parserContractEntry: boundary.parserContractEntry
    },
    options.parserContractRegistry
  );
  if (!isDeepStrictEqual(boundary, expected.representationDecodeBoundary)) {
    throw new Error(
      "official calendar source representation decode boundary does not match exact source bytes"
    );
  }
  return {
    representationDecodeBoundary: deepFreeze(boundary),
    decodedBytes: Uint8Array.from(expected.decodedBytes)
  };
}

export function createOfficialMarketCalendarSourceRepresentationDecodeBoundaryHash(
  value: OfficialMarketCalendarSourceRepresentationDecodeBoundaryPayload
): Sha256Hash {
  return createReplayResearchHash(
    representationDecodeBoundaryPayloadSchema.parse(value)
  );
}

function decodeBytes(
  sourceBytes: Uint8Array,
  contentEncoding: "br" | "deflate" | "gzip" | null
): Uint8Array {
  if (contentEncoding === null) {
    if (
      sourceBytes.byteLength >
      OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH
    ) {
      throw new Error(
        "official calendar decoded source exceeds the decode policy limit"
      );
    }
    return Uint8Array.from(sourceBytes);
  }
  try {
    const options = {
      maxOutputLength: OFFICIAL_MARKET_CALENDAR_MAX_DECODED_CONTENT_LENGTH,
      info: true as const
    };
    if (contentEncoding === "gzip") {
      const decoded = parseSynchronousDecodeInfo(
        gunzipSync(sourceBytes, options)
      );
      verifyCompressedInputFullyConsumed(
        decoded.engine.bytesWritten,
        sourceBytes.byteLength
      );
      return Uint8Array.from(decoded.buffer);
    }
    if (contentEncoding === "deflate") {
      const decoded = parseSynchronousDecodeInfo(
        inflateSync(sourceBytes, options)
      );
      verifyCompressedInputFullyConsumed(
        decoded.engine.bytesWritten,
        sourceBytes.byteLength
      );
      return Uint8Array.from(decoded.buffer);
    }
    const decoded = parseSynchronousDecodeInfo(
      brotliDecompressSync(sourceBytes, options)
    );
    verifyCompressedInputFullyConsumed(
      decoded.engine.bytesWritten,
      sourceBytes.byteLength
    );
    return Uint8Array.from(decoded.buffer);
  } catch (error) {
    throw new Error(
      "official calendar source representation decode failed or exceeded the policy limit",
      { cause: error }
    );
  }
}

function parseSynchronousDecodeInfo(value: unknown): {
  buffer: Uint8Array;
  engine: { bytesWritten: number };
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("official calendar decoder did not return decode info");
  }
  const record = value as Record<string, unknown>;
  const engine = record.engine;
  if (
    !(record.buffer instanceof Uint8Array) ||
    typeof engine !== "object" ||
    engine === null ||
    typeof (engine as Record<string, unknown>).bytesWritten !== "number"
  ) {
    throw new Error("official calendar decoder returned invalid decode info");
  }
  return {
    buffer: record.buffer,
    engine: {
      bytesWritten: (engine as Record<string, number>).bytesWritten!
    }
  };
}

function verifyCompressedInputFullyConsumed(
  consumedLength: number,
  sourceLength: number
): void {
  if (consumedLength !== sourceLength) {
    throw new Error(
      "official calendar compressed source contains trailing bytes"
    );
  }
}

function hashBytes(value: Uint8Array): Sha256Hash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
