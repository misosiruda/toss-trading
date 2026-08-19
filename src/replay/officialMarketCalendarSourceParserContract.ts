import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION =
  "official_market_calendar_source_parser_contract_definition.v1";

const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const mediaTypeSchema = z
  .string()
  .regex(
    /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/,
    "accepted content type must use canonical lowercase parameter-free media type grammar"
  );
const contentEncodingSchema = z.enum(["br", "deflate", "gzip"]);

export const officialMarketCalendarSourceParserContractDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_CONTRACT_DEFINITION_SCHEMA_VERSION
    ),
    exchange: z.enum(["KRX", "NYSE"]),
    acceptedContentTypes: z.array(mediaTypeSchema).min(1),
    acceptedContentEncodings: z
      .array(z.union([z.null(), contentEncodingSchema]))
      .min(1),
    parserOutputSchemaVersion: identifierSchema
  })
  .strict()
  .superRefine((value, context) => {
    validateCanonicalStrings(
      value.acceptedContentTypes,
      context,
      ["acceptedContentTypes"],
      "accepted content types"
    );
    validateCanonicalStrings(
      value.acceptedContentEncodings.map((encoding) => encoding ?? ""),
      context,
      ["acceptedContentEncodings"],
      "accepted content encodings"
    );
  });

export type OfficialMarketCalendarSourceParserContractDefinition = z.infer<
  typeof officialMarketCalendarSourceParserContractDefinitionSchema
>;

const sourceParserContractRegistryEntrySchema = z
  .object({
    parserContractVersion: identifierSchema,
    parserContractDefinition:
      officialMarketCalendarSourceParserContractDefinitionSchema,
    parserContractHash: sha256HashSchema
  })
  .strict();

export type OfficialMarketCalendarSourceParserContractRegistryEntry = z.infer<
  typeof sourceParserContractRegistryEntrySchema
>;

export function parseOfficialMarketCalendarSourceParserContractDefinition(
  value: unknown
): OfficialMarketCalendarSourceParserContractDefinition {
  return officialMarketCalendarSourceParserContractDefinitionSchema.parse(value);
}

export function createOfficialMarketCalendarSourceParserContractHash(
  value: unknown
): Sha256Hash {
  return createReplayResearchHash(
    parseOfficialMarketCalendarSourceParserContractDefinition(value)
  );
}

export function parseOfficialMarketCalendarSourceParserContractRegistryEntry(
  value: unknown
): OfficialMarketCalendarSourceParserContractRegistryEntry {
  const entry = sourceParserContractRegistryEntrySchema.parse(value);
  if (
    entry.parserContractHash !==
    createOfficialMarketCalendarSourceParserContractHash(
      entry.parserContractDefinition
    )
  ) {
    throw new Error("official calendar source parser contract hash mismatch");
  }
  return entry;
}

export function parseOfficialMarketCalendarSourceParserContractRegistry(
  value: unknown
): OfficialMarketCalendarSourceParserContractRegistryEntry[] {
  const entries = z
    .array(z.unknown())
    .parse(value)
    .map(parseOfficialMarketCalendarSourceParserContractRegistryEntry);
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.parserContractVersion)) {
      throw new Error(
        "official calendar source parser contract versions must be unique"
      );
    }
    versions.add(entry.parserContractVersion);
  }
  return entries;
}

export function resolveOfficialMarketCalendarSourceParserContractFromRegistry(
  value: unknown,
  registry: unknown
): OfficialMarketCalendarSourceParserContractRegistryEntry {
  const recorded =
    parseOfficialMarketCalendarSourceParserContractRegistryEntry(value);
  const registered =
    parseOfficialMarketCalendarSourceParserContractRegistry(registry).find(
      (entry) =>
        entry.parserContractVersion === recorded.parserContractVersion
    );
  if (registered === undefined) {
    throw new Error(
      "official calendar source parser contract version is not registered"
    );
  }
  if (!isDeepStrictEqual(recorded, registered)) {
    throw new Error(
      "official calendar recorded source parser contract does not match registry"
    );
  }
  return registered;
}

function validateCanonicalStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `${label} must use canonical order without duplicates`
      });
    }
  }
}
