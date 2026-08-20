import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  createOfficialMarketCalendarEvidenceArtifactV2Hash,
  officialMarketCalendarEvidenceArtifactV2Schema
} from "./officialMarketCalendarEvidenceArtifactV2.js";
import {
  officialCalendarSourceDocumentRefSchema,
  type OfficialCalendarSourceDocumentRef
} from "./officialMarketCalendarSessionProvenance.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_PUBLICATION_READER_FRESHNESS_SCHEMA_VERSION =
  "official_market_calendar_publication_reader_freshness.v1";

const explicitOffsetDateTimeSchema = isoDateTimeSchema.refine(
  hasExplicitTimeZoneOffset,
  "date-time must include an explicit timezone offset"
);
const documentFreshnessStatusSchema = z.enum([
  "fresh",
  "not_yet_retrieved",
  "stale"
]);
const auditEventTypeSchema = z.enum([
  "publication_freshness_rejected",
  "source_not_yet_retrieved"
]);
const documentFreshnessEvaluationSchema = z
  .object({
    sourceDocumentRef: officialCalendarSourceDocumentRefSchema,
    retrievedAt: explicitOffsetDateTimeSchema,
    staleAfter: explicitOffsetDateTimeSchema,
    status: documentFreshnessStatusSchema
  })
  .strict();
const requiredAuditEventSchema = z
  .object({
    eventType: auditEventTypeSchema,
    artifactHash: sha256HashSchema,
    asOf: explicitOffsetDateTimeSchema,
    sourceDocumentRefs: z.array(officialCalendarSourceDocumentRefSchema).min(1)
  })
  .strict();
const handleBindingPayloadSchema = z
  .object({
    artifactHash: sha256HashSchema,
    asOf: explicitOffsetDateTimeSchema,
    sourceDocumentRefs: z.array(officialCalendarSourceDocumentRefSchema).min(1)
  })
  .strict();
const handleBindingSchema = handleBindingPayloadSchema
  .safeExtend({ handleBindingHash: sha256HashSchema })
  .strict();
const readerFreshnessPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_READER_FRESHNESS_SCHEMA_VERSION
    ),
    artifactHash: sha256HashSchema,
    asOf: explicitOffsetDateTimeSchema,
    status: z.enum(["accepted", "rejected"]),
    documentEvaluations: z.array(documentFreshnessEvaluationSchema).min(1),
    requiredAuditEvents: z.array(requiredAuditEventSchema),
    membershipAction: z.literal("unchanged"),
    handleBinding: handleBindingSchema.nullable()
  })
  .strict()
  .superRefine(validateReaderFreshnessPayload);

export const officialMarketCalendarPublicationReaderFreshnessSchema =
  readerFreshnessPayloadSchema
    .safeExtend({ decisionHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarPublicationReaderFreshness = z.infer<
  typeof officialMarketCalendarPublicationReaderFreshnessSchema
>;
export type OfficialMarketCalendarPublicationReaderFreshnessPayload = z.infer<
  typeof readerFreshnessPayloadSchema
>;
export type OfficialMarketCalendarPublicationReaderHandleBinding = z.infer<
  typeof handleBindingSchema
>;

export function evaluateOfficialMarketCalendarPublicationReaderFreshness(
  input: unknown
): OfficialMarketCalendarPublicationReaderFreshness {
  const parsed = z
    .object({
      artifact: officialMarketCalendarEvidenceArtifactV2Schema,
      asOf: explicitOffsetDateTimeSchema
    })
    .strict()
    .parse(input);
  const { artifactHash, ...artifactPayload } = parsed.artifact;
  if (
    artifactHash !==
    createOfficialMarketCalendarEvidenceArtifactV2Hash(artifactPayload)
  ) {
    throw new Error(
      "official calendar publication reader artifact hash mismatch"
    );
  }

  const documentEvaluations = parsed.artifact.sourceCollectionAssemblies
    .flatMap((assembly) =>
      assembly.documentProjections.map(({ sourceDocumentMetadata }) => ({
        sourceDocumentRef: {
          exchange: assembly.sourceCollection.exchange,
          collectionId: assembly.sourceCollection.collectionId,
          documentId: sourceDocumentMetadata.documentId
        },
        retrievedAt: sourceDocumentMetadata.retrievedAt,
        staleAfter: sourceDocumentMetadata.staleAfter,
        status: evaluateDocumentFreshness(
          parsed.asOf,
          sourceDocumentMetadata.retrievedAt,
          sourceDocumentMetadata.staleAfter
        )
      }))
    )
    .sort((left, right) =>
      compareSourceDocumentRefs(left.sourceDocumentRef, right.sourceDocumentRef)
    );
  const bindingRefs = parsed.artifact.sourceArchiveBindings.map(
    ({ sourceDocumentRef }) => sourceDocumentRef
  );
  if (
    documentEvaluations.length === 0 ||
    !isDeepStrictEqual(
      documentEvaluations.map(({ sourceDocumentRef }) => sourceDocumentRef),
      bindingRefs
    )
  ) {
    throw new Error(
      "official calendar publication reader documents must exactly match archive bindings"
    );
  }

  const requiredAuditEvents = createRequiredAuditEvents(
    artifactHash,
    parsed.asOf,
    documentEvaluations
  );
  const status = requiredAuditEvents.length === 0 ? "accepted" : "rejected";
  const sourceDocumentRefs = documentEvaluations.map(
    ({ sourceDocumentRef }) => sourceDocumentRef
  );
  const handleBindingPayload = {
    artifactHash,
    asOf: parsed.asOf,
    sourceDocumentRefs
  };
  const payload = readerFreshnessPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_READER_FRESHNESS_SCHEMA_VERSION,
    artifactHash,
    asOf: parsed.asOf,
    status,
    documentEvaluations,
    requiredAuditEvents,
    membershipAction: "unchanged",
    handleBinding:
      status === "accepted"
        ? {
            ...handleBindingPayload,
            handleBindingHash:
              createOfficialMarketCalendarPublicationReaderHandleBindingHash(
                handleBindingPayload
              )
          }
        : null
  });
  return deepFreeze({
    ...payload,
    decisionHash:
      createOfficialMarketCalendarPublicationReaderFreshnessHash(payload)
  });
}

export function parseOfficialMarketCalendarPublicationReaderFreshness(
  value: unknown
): OfficialMarketCalendarPublicationReaderFreshness {
  const parsed =
    officialMarketCalendarPublicationReaderFreshnessSchema.parse(value);
  const { decisionHash, ...payload } = parsed;
  if (
    decisionHash !==
    createOfficialMarketCalendarPublicationReaderFreshnessHash(payload)
  ) {
    throw new Error(
      "official calendar publication reader freshness hash mismatch"
    );
  }
  return deepFreeze(parsed);
}

export function requireOfficialMarketCalendarPublicationReaderHandle(
  value: unknown
): OfficialMarketCalendarPublicationReaderHandleBinding {
  const decision =
    parseOfficialMarketCalendarPublicationReaderFreshness(value);
  if (decision.status !== "accepted" || decision.handleBinding === null) {
    throw new Error(
      `official calendar publication reader freshness rejected: ${decision.requiredAuditEvents
        .map(({ eventType }) => eventType)
        .join(",")}`
    );
  }
  return decision.handleBinding;
}

export function createOfficialMarketCalendarPublicationReaderFreshnessHash(
  value: OfficialMarketCalendarPublicationReaderFreshnessPayload
): Sha256Hash {
  return createReplayResearchHash(readerFreshnessPayloadSchema.parse(value));
}

export function createOfficialMarketCalendarPublicationReaderHandleBindingHash(
  value: z.infer<typeof handleBindingPayloadSchema>
): Sha256Hash {
  return createReplayResearchHash(handleBindingPayloadSchema.parse(value));
}

function evaluateDocumentFreshness(
  asOf: string,
  retrievedAt: string,
  staleAfter: string
): z.infer<typeof documentFreshnessStatusSchema> {
  const retrievedAtTime = Date.parse(retrievedAt);
  const staleAfterTime = Date.parse(staleAfter);
  if (retrievedAtTime >= staleAfterTime) {
    throw new Error(
      "official calendar publication reader source freshness window is invalid"
    );
  }
  const asOfTime = Date.parse(asOf);
  if (asOfTime < retrievedAtTime) {
    return "not_yet_retrieved";
  }
  return asOfTime >= staleAfterTime ? "stale" : "fresh";
}

function createRequiredAuditEvents(
  artifactHash: Sha256Hash,
  asOf: string,
  evaluations: readonly z.infer<typeof documentFreshnessEvaluationSchema>[]
): z.infer<typeof requiredAuditEventSchema>[] {
  return [
    {
      eventType: "publication_freshness_rejected" as const,
      artifactHash,
      asOf,
      sourceDocumentRefs: evaluations
        .filter(({ status }) => status === "stale")
        .map(({ sourceDocumentRef }) => sourceDocumentRef)
    },
    {
      eventType: "source_not_yet_retrieved" as const,
      artifactHash,
      asOf,
      sourceDocumentRefs: evaluations
        .filter(({ status }) => status === "not_yet_retrieved")
        .map(({ sourceDocumentRef }) => sourceDocumentRef)
    }
  ].filter(({ sourceDocumentRefs }) => sourceDocumentRefs.length > 0);
}

function validateReaderFreshnessPayload(
  value: z.infer<typeof readerFreshnessPayloadSchema>,
  context: z.RefinementCtx
): void {
  const refs = value.documentEvaluations.map(
    ({ sourceDocumentRef }) => sourceDocumentRef
  );
  validateCanonicalRefs(refs, context, ["documentEvaluations"]);
  const expectedStatuses = value.documentEvaluations.map((evaluation) =>
    evaluateDocumentFreshness(
      value.asOf,
      evaluation.retrievedAt,
      evaluation.staleAfter
    )
  );
  if (
    expectedStatuses.some(
      (expected, index) =>
        value.documentEvaluations[index]!.status !== expected
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["documentEvaluations"],
      message: "publication reader document freshness statuses must match asOf"
    });
  }
  const expectedAuditEvents = createRequiredAuditEvents(
    value.artifactHash,
    value.asOf,
    value.documentEvaluations
  );
  if (!isDeepStrictEqual(value.requiredAuditEvents, expectedAuditEvents)) {
    context.addIssue({
      code: "custom",
      path: ["requiredAuditEvents"],
      message: "publication reader audit events must match rejected documents"
    });
  }
  const expectedStatus =
    expectedAuditEvents.length === 0 ? "accepted" : "rejected";
  if (value.status !== expectedStatus) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "publication reader status must match document freshness"
    });
  }
  if (expectedStatus === "rejected") {
    if (value.handleBinding !== null) {
      context.addIssue({
        code: "custom",
        path: ["handleBinding"],
        message: "rejected publication reader decision must not bind a handle"
      });
    }
    return;
  }
  if (value.handleBinding === null) {
    context.addIssue({
      code: "custom",
      path: ["handleBinding"],
      message: "accepted publication reader decision must bind a handle"
    });
    return;
  }
  const { handleBindingHash, ...handleBindingPayload } = value.handleBinding;
  if (
    handleBindingPayload.artifactHash !== value.artifactHash ||
    handleBindingPayload.asOf !== value.asOf ||
    !isDeepStrictEqual(handleBindingPayload.sourceDocumentRefs, refs) ||
    handleBindingHash !==
      createOfficialMarketCalendarPublicationReaderHandleBindingHash(
        handleBindingPayload
      )
  ) {
    context.addIssue({
      code: "custom",
      path: ["handleBinding"],
      message: "publication reader handle must bind the exact artifact, asOf and sources"
    });
  }
}

function validateCanonicalRefs(
  refs: readonly OfficialCalendarSourceDocumentRef[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  for (let index = 1; index < refs.length; index += 1) {
    if (compareSourceDocumentRefs(refs[index - 1]!, refs[index]!) >= 0) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: "publication reader source refs must be unique and canonical"
      });
    }
  }
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

function hasExplicitTimeZoneOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
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
