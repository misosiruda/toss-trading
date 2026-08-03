import { z } from "zod";

import {
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";

export const OFFICIAL_MARKET_CALENDAR_SESSION_PROVENANCE_SCHEMA_VERSION =
  "official_market_calendar_session_provenance.v1";

const exchangeSchema = z.enum(["KRX", "NYSE"]);
const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");

export const officialCalendarSourceDocumentRefSchema = z
  .object({
    exchange: exchangeSchema,
    collectionId: identifierSchema,
    documentId: identifierSchema
  })
  .strict();

export const officialMarketCalendarSessionProvenanceSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SESSION_PROVENANCE_SCHEMA_VERSION
    ),
    sessionId: identifierSchema,
    exchange: exchangeSchema,
    sessionDate: calendarDateSchema,
    sourceDocumentRefs: z
      .array(officialCalendarSourceDocumentRefSchema)
      .min(1),
    regularSessionRegimeId: identifierSchema
  })
  .strict();

export type OfficialCalendarSourceDocumentRef = z.infer<
  typeof officialCalendarSourceDocumentRefSchema
>;
export type OfficialMarketCalendarSessionProvenance = z.infer<
  typeof officialMarketCalendarSessionProvenanceSchema
>;

export interface ResolvedOfficialCalendarSourceDocumentRef {
  ref: OfficialCalendarSourceDocumentRef;
  collectionHash: string;
  metadataHash: string;
  sourceDocumentHash: string;
}

export function resolveOfficialCalendarSourceDocumentRefs(
  refs: readonly unknown[],
  collections: readonly unknown[]
): ResolvedOfficialCalendarSourceDocumentRef[] {
  const parsedCollections = parseCollections(collections);
  const parsedRefs = refs.map((ref) =>
    officialCalendarSourceDocumentRefSchema.parse(ref)
  );
  if (parsedRefs.length === 0) {
    throw new Error(
      "official calendar source document refs must not be empty"
    );
  }
  validateCanonicalRefs(parsedRefs);

  return parsedRefs.map((ref) => {
    const collection = parsedCollections.get(collectionKey(ref));
    if (collection === undefined) {
      throw new Error(
        `official calendar source document ref collection is unknown: ${ref.exchange}:${ref.collectionId}`
      );
    }
    const document = collection.documents.find(
      (candidate) => candidate.documentId === ref.documentId
    );
    if (document === undefined) {
      throw new Error(
        `official calendar source document ref is unknown: ${sourceDocumentRefKey(ref)}`
      );
    }
    return {
      ref,
      collectionHash: collection.collectionHash,
      metadataHash: document.metadataHash,
      sourceDocumentHash: document.sourceDocumentHash
    };
  });
}

export function parseOfficialMarketCalendarSessionProvenance(
  value: unknown,
  options: { collections: readonly unknown[] }
): OfficialMarketCalendarSessionProvenance {
  const provenance = officialMarketCalendarSessionProvenanceSchema.parse(value);
  const resolved = resolveOfficialCalendarSourceDocumentRefs(
    provenance.sourceDocumentRefs,
    options.collections
  );
  if (resolved.some(({ ref }) => ref.exchange !== provenance.exchange)) {
    throw new Error(
      "official calendar session provenance must not cross exchange boundary"
    );
  }

  const collectionIds = new Set(
    resolved.map(({ ref }) => ref.collectionId)
  );
  if (collectionIds.size !== 1) {
    throw new Error(
      "official calendar session provenance must use one source collection"
    );
  }
  const collection = parseCollections(options.collections).get(
    collectionIdentityKey(
      provenance.exchange,
      resolved[0]!.ref.collectionId
    )
  )!;
  if (
    provenance.sessionDate < collection.coverageStartDate ||
    provenance.sessionDate > collection.coverageEndDate
  ) {
    throw new Error(
      "official calendar session date is outside source collection coverage"
    );
  }

  const regime = collection.regularSessionRegimes.find(
    (candidate) =>
      candidate.regimeId === provenance.regularSessionRegimeId
  );
  if (regime === undefined) {
    throw new Error(
      `official calendar session regime is unknown: ${provenance.regularSessionRegimeId}`
    );
  }
  const regimeEnd = regime.effectiveEndDate ?? collection.coverageEndDate;
  if (
    provenance.sessionDate < regime.effectiveStartDate ||
    provenance.sessionDate > regimeEnd
  ) {
    throw new Error(
      "official calendar session date does not match effective regime"
    );
  }

  const referencedDocumentIds = resolved.map(({ ref }) => ref.documentId);
  if (
    referencedDocumentIds.length !== regime.documentIds.length ||
    referencedDocumentIds.some(
      (documentId, index) => documentId !== regime.documentIds[index]
    )
  ) {
    throw new Error(
      "official calendar session document refs must match effective regime provenance"
    );
  }
  return provenance;
}

function parseCollections(
  values: readonly unknown[]
): Map<string, OfficialMarketCalendarSourceCollection> {
  const collections = new Map<string, OfficialMarketCalendarSourceCollection>();
  for (const value of values) {
    const collection = parseOfficialMarketCalendarSourceCollection(value);
    const key = collectionIdentityKey(
      collection.exchange,
      collection.collectionId
    );
    if (collections.has(key)) {
      throw new Error(
        `official calendar source collection identity is duplicated: ${key}`
      );
    }
    collections.set(key, collection);
  }
  return collections;
}

function validateCanonicalRefs(
  refs: readonly OfficialCalendarSourceDocumentRef[]
): void {
  let previousRef: OfficialCalendarSourceDocumentRef | null = null;
  for (const ref of refs) {
    if (previousRef !== null && compareSourceDocumentRefs(previousRef, ref) >= 0) {
      throw new Error(
        "official calendar source document refs must be unique and canonical"
      );
    }
    previousRef = ref;
  }
}

function collectionKey(ref: OfficialCalendarSourceDocumentRef): string {
  return collectionIdentityKey(ref.exchange, ref.collectionId);
}

function collectionIdentityKey(
  exchange: OfficialCalendarSourceDocumentRef["exchange"],
  collectionId: string
): string {
  return JSON.stringify([exchange, collectionId]);
}

function sourceDocumentRefKey(ref: OfficialCalendarSourceDocumentRef): string {
  return JSON.stringify([ref.exchange, ref.collectionId, ref.documentId]);
}

function compareSourceDocumentRefs(
  left: OfficialCalendarSourceDocumentRef,
  right: OfficialCalendarSourceDocumentRef
): number {
  return (
    compareCanonicalText(left.exchange, right.exchange) ||
    compareCanonicalText(left.collectionId, right.collectionId) ||
    compareCanonicalText(left.documentId, right.documentId)
  );
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
