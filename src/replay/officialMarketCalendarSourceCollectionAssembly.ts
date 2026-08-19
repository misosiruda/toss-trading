import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  createOfficialMarketCalendarSourceCollection,
  officialMarketCalendarSourceCollectionSchema
} from "./officialMarketCalendarSourceCollection.js";
import {
  officialMarketCalendarSourceCollectionDocumentProjectionSchema,
  parseOfficialMarketCalendarSourceCollectionDocumentProjection
} from "./officialMarketCalendarSourceCollectionDocumentProjection.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_ASSEMBLY_SCHEMA_VERSION =
  "official_market_calendar_source_collection_assembly.v1";

const collectionPlanSchema = z.record(z.string(), z.unknown());
const createAssemblyInputSchema = z
  .object({
    collectionPlan: collectionPlanSchema,
    documentProjections: z
      .array(officialMarketCalendarSourceCollectionDocumentProjectionSchema)
      .min(1)
  })
  .strict();
const assemblyPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_ASSEMBLY_SCHEMA_VERSION
    ),
    sourceCollection: officialMarketCalendarSourceCollectionSchema,
    documentProjections: z.array(
      officialMarketCalendarSourceCollectionDocumentProjectionSchema
    )
  })
  .strict();

export const officialMarketCalendarSourceCollectionAssemblySchema =
  assemblyPayloadSchema.safeExtend({ assemblyHash: sha256HashSchema }).strict();

export type OfficialMarketCalendarSourceCollectionAssembly = z.infer<
  typeof officialMarketCalendarSourceCollectionAssemblySchema
>;
export type OfficialMarketCalendarSourceCollectionAssemblyPayload = z.infer<
  typeof assemblyPayloadSchema
>;

interface AssemblyOptions {
  sourceBytesByDocumentId: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function createOfficialMarketCalendarSourceCollectionAssembly(
  input: unknown,
  options: AssemblyOptions
): OfficialMarketCalendarSourceCollectionAssembly {
  const parsed = createAssemblyInputSchema.parse(input);
  if ("documents" in parsed.collectionPlan || "collectionHash" in parsed.collectionPlan) {
    throw new Error(
      "official calendar collection plan must not supply documents or collectionHash"
    );
  }
  const sourceBytesByDocumentId = z
    .record(z.string(), z.instanceof(Uint8Array))
    .parse(options.sourceBytesByDocumentId);
  const projectionIds = parsed.documentProjections.map(
    (projection) => projection.collectionDocument.documentId
  );
  validateCanonicalDocumentIds(projectionIds);
  validateExactSourceByteKeys(sourceBytesByDocumentId, projectionIds);
  const documentProjections = parsed.documentProjections.map((projection) => {
    const documentId = projection.collectionDocument.documentId;
    return parseOfficialMarketCalendarSourceCollectionDocumentProjection(
      projection,
      {
        sourceBytes: sourceBytesByDocumentId[documentId],
        freshnessPolicyRegistry: options.freshnessPolicyRegistry,
        parserContractRegistry: options.parserContractRegistry
      }
    );
  });
  const collectionPayload = {
    ...parsed.collectionPlan,
    documents: documentProjections.map(
      (projection) => projection.collectionDocument
    )
  };
  const sourceCollection =
    createOfficialMarketCalendarSourceCollection(collectionPayload);
  if (
    documentProjections.some(
      (projection) => projection.exchange !== sourceCollection.exchange
    )
  ) {
    throw new Error(
      "official calendar collection projections must match collection exchange"
    );
  }
  const payload = assemblyPayloadSchema.parse({
    schemaVersion: OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_ASSEMBLY_SCHEMA_VERSION,
    sourceCollection,
    documentProjections
  });
  return deepFreeze({
    ...payload,
    assemblyHash: createOfficialMarketCalendarSourceCollectionAssemblyHash(payload)
  });
}

export function parseOfficialMarketCalendarSourceCollectionAssembly(
  value: unknown,
  options: AssemblyOptions
): OfficialMarketCalendarSourceCollectionAssembly {
  const assembly = officialMarketCalendarSourceCollectionAssemblySchema.parse(value);
  const { documents: _documents, collectionHash: _collectionHash, ...collectionPlan } =
    assembly.sourceCollection;
  const expected = createOfficialMarketCalendarSourceCollectionAssembly(
    {
      collectionPlan,
      documentProjections: assembly.documentProjections
    },
    options
  );
  if (!isDeepStrictEqual(assembly, expected)) {
    throw new Error(
      "official calendar source collection assembly does not match verified projections"
    );
  }
  return deepFreeze(assembly);
}

export function createOfficialMarketCalendarSourceCollectionAssemblyHash(
  value: OfficialMarketCalendarSourceCollectionAssemblyPayload
): Sha256Hash {
  return createReplayResearchHash(assemblyPayloadSchema.parse(value));
}

function validateCanonicalDocumentIds(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new Error(
        "official calendar collection projections must use unique canonical document IDs"
      );
    }
  }
}

function validateExactSourceByteKeys(
  sourceBytesByDocumentId: Record<string, Uint8Array>,
  documentIds: readonly string[]
): void {
  const byteKeys = Object.keys(sourceBytesByDocumentId).sort();
  if (!isDeepStrictEqual(byteKeys, [...documentIds])) {
    throw new Error(
      "official calendar collection source bytes must exactly cover projected documents"
    );
  }
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
