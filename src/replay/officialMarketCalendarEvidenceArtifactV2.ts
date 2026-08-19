import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  officialMarketCalendarSessionHoursExceptionSchema
} from "./officialMarketCalendarSessionHoursException.js";
import {
  officialMarketCalendarSessionProvenanceSchema,
  type OfficialMarketCalendarSessionProvenance
} from "./officialMarketCalendarSessionProvenance.js";
import {
  officialMarketCalendarSessionSetSchema,
  resolveOfficialMarketCalendarSessionSet
} from "./officialMarketCalendarSessionSet.js";
import {
  createOfficialMarketCalendarSourceArchivePath,
  officialMarketCalendarSourceArchiveBindingSchema,
  resolveOfficialMarketCalendarSourceArchiveBindings
} from "./officialMarketCalendarSourceArchiveBinding.js";
import {
  officialMarketCalendarSourceCollectionAssemblySchema,
  parseOfficialMarketCalendarSourceCollectionAssembly
} from "./officialMarketCalendarSourceCollectionAssembly.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION =
  "official_market_calendar_evidence.v2";

const explicitOffsetDateTimeSchema = isoDateTimeSchema.refine(
  hasExplicitTimeZoneOffset,
  "date-time must include an explicit timezone offset"
);
const sourceBytesByExchangeSchema = z
  .object({
    KRX: z.record(z.string(), z.instanceof(Uint8Array)),
    NYSE: z.record(z.string(), z.instanceof(Uint8Array))
  })
  .strict();
const createArtifactInputSchema = z
  .object({
    generatedAt: explicitOffsetDateTimeSchema,
    sourceCollectionAssemblies: z.tuple([
      officialMarketCalendarSourceCollectionAssemblySchema,
      officialMarketCalendarSourceCollectionAssemblySchema
    ]),
    sessionSet: officialMarketCalendarSessionSetSchema,
    sessionProvenances: z.array(
      officialMarketCalendarSessionProvenanceSchema
    ),
    sessionHoursExceptions: z.array(
      officialMarketCalendarSessionHoursExceptionSchema
    )
  })
  .strict();
const artifactPayloadSchema = createArtifactInputSchema
  .safeExtend({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    purpose: z.literal("official_exchange_calendar_evidence"),
    sourceArchiveBindings: z.array(
      officialMarketCalendarSourceArchiveBindingSchema
    )
  })
  .omit({ generatedAt: true })
  .safeExtend({ generatedAt: explicitOffsetDateTimeSchema })
  .strict();

export const officialMarketCalendarEvidenceArtifactV2Schema =
  artifactPayloadSchema.safeExtend({ artifactHash: sha256HashSchema }).strict();

export type OfficialMarketCalendarEvidenceArtifactV2 = z.infer<
  typeof officialMarketCalendarEvidenceArtifactV2Schema
>;
export type OfficialMarketCalendarEvidenceArtifactV2Payload = z.infer<
  typeof artifactPayloadSchema
>;

interface EvidenceArtifactV2Options {
  sourceBytesByExchange: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function createOfficialMarketCalendarEvidenceArtifactV2(
  input: unknown,
  options: EvidenceArtifactV2Options
): OfficialMarketCalendarEvidenceArtifactV2 {
  const parsed = createArtifactInputSchema.parse(input);
  const sourceBytesByExchange = sourceBytesByExchangeSchema.parse(
    options.sourceBytesByExchange
  );
  const sourceCollectionAssemblies = parsed.sourceCollectionAssemblies.map(
    (assembly, index) => {
      const exchange = index === 0 ? "KRX" : "NYSE";
      if (assembly.sourceCollection.exchange !== exchange) {
        throw new Error(
          "official calendar evidence collections must use canonical KRX then NYSE order"
        );
      }
      const reopened = parseOfficialMarketCalendarSourceCollectionAssembly(
        assembly,
        {
          sourceBytesByDocumentId: sourceBytesByExchange[exchange],
          freshnessPolicyRegistry: options.freshnessPolicyRegistry,
          parserContractRegistry: options.parserContractRegistry
        }
      );
      return reopened;
    }
  ) as [
    OfficialMarketCalendarEvidenceArtifactV2Payload["sourceCollectionAssemblies"][0],
    OfficialMarketCalendarEvidenceArtifactV2Payload["sourceCollectionAssemblies"][1]
  ];
  const collections = sourceCollectionAssemblies.map(
    ({ sourceCollection }) => sourceCollection
  );
  validateCanonicalSessionProvenances(parsed.sessionProvenances);
  validateExactSessionEvidenceCoverage(
    parsed.sessionSet,
    parsed.sessionProvenances,
    parsed.sessionHoursExceptions
  );
  const { sessionSet } = resolveOfficialMarketCalendarSessionSet(
    parsed.sessionSet,
    {
      collections,
      sessionProvenances: parsed.sessionProvenances,
      sessionHoursExceptions: parsed.sessionHoursExceptions
    }
  );
  validateGeneratedAtFreshness(parsed.generatedAt, sourceCollectionAssemblies);
  const sourceArchiveBindings = sourceCollectionAssemblies.flatMap(
    (assembly) =>
      assembly.documentProjections.map(({ sourceDocumentMetadata }) => ({
        sourceDocumentRef: {
          exchange: assembly.sourceCollection.exchange,
          collectionId: assembly.sourceCollection.collectionId,
          documentId: sourceDocumentMetadata.documentId
        },
        archivePath: createOfficialMarketCalendarSourceArchivePath(
          sourceDocumentMetadata.sourceDocumentHash
        ),
        sourceDocumentHash: sourceDocumentMetadata.sourceDocumentHash,
        contentLength: sourceDocumentMetadata.contentLength
      }))
  );
  resolveOfficialMarketCalendarSourceArchiveBindings(sourceArchiveBindings, {
    collections
  });
  const payload = artifactPayloadSchema.parse({
    schemaVersion: OFFICIAL_MARKET_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION,
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: parsed.generatedAt,
    sourceCollectionAssemblies,
    sessionSet,
    sessionProvenances: parsed.sessionProvenances,
    sessionHoursExceptions: parsed.sessionHoursExceptions,
    sourceArchiveBindings
  });
  return deepFreeze({
    ...payload,
    artifactHash: createOfficialMarketCalendarEvidenceArtifactV2Hash(payload)
  });
}

export function parseOfficialMarketCalendarEvidenceArtifactV2(
  value: unknown,
  options: EvidenceArtifactV2Options
): OfficialMarketCalendarEvidenceArtifactV2 {
  const artifact = officialMarketCalendarEvidenceArtifactV2Schema.parse(value);
  const expected = createOfficialMarketCalendarEvidenceArtifactV2(
    {
      generatedAt: artifact.generatedAt,
      sourceCollectionAssemblies: artifact.sourceCollectionAssemblies,
      sessionSet: artifact.sessionSet,
      sessionProvenances: artifact.sessionProvenances,
      sessionHoursExceptions: artifact.sessionHoursExceptions
    },
    options
  );
  if (!isDeepStrictEqual(artifact, expected)) {
    throw new Error(
      "official calendar evidence v2 artifact does not match verified source evidence"
    );
  }
  return deepFreeze(artifact);
}

export function createOfficialMarketCalendarEvidenceArtifactV2Hash(
  value: OfficialMarketCalendarEvidenceArtifactV2Payload
): Sha256Hash {
  return createReplayResearchHash(artifactPayloadSchema.parse(value));
}

function validateCanonicalSessionProvenances(
  values: readonly OfficialMarketCalendarSessionProvenance[]
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    const previousKey = JSON.stringify([
      previous.exchange,
      previous.sessionDate,
      previous.sessionId
    ]);
    const currentKey = JSON.stringify([
      current.exchange,
      current.sessionDate,
      current.sessionId
    ]);
    if (previousKey >= currentKey) {
      throw new Error(
        "official calendar evidence session provenances must use unique canonical order"
      );
    }
  }
}

function validateExactSessionEvidenceCoverage(
  sessionSet: z.infer<typeof officialMarketCalendarSessionSetSchema>,
  sessionProvenances: readonly OfficialMarketCalendarSessionProvenance[],
  sessionHoursExceptions: readonly z.infer<
    typeof officialMarketCalendarSessionHoursExceptionSchema
  >[]
): void {
  const expectedProvenanceIds = sessionSet.openSessions.map(
    ({ sessionId }) => sessionId
  );
  const actualProvenanceIds = sessionProvenances.map(
    ({ sessionId }) => sessionId
  );
  if (!isDeepStrictEqual(actualProvenanceIds, expectedProvenanceIds)) {
    throw new Error(
      "official calendar evidence session provenances must exactly cover open sessions"
    );
  }
  const expectedExceptionIds = sessionSet.openSessions.flatMap(
    ({ sessionHoursExceptionId }) =>
      sessionHoursExceptionId === null ? [] : [sessionHoursExceptionId]
  );
  const actualExceptionIds = sessionHoursExceptions.map(
    ({ exceptionId }) => exceptionId
  );
  if (!isDeepStrictEqual(actualExceptionIds, expectedExceptionIds)) {
    throw new Error(
      "official calendar evidence session hours exceptions must exactly cover referenced exceptions"
    );
  }
}

function validateGeneratedAtFreshness(
  generatedAt: string,
  assemblies: OfficialMarketCalendarEvidenceArtifactV2Payload["sourceCollectionAssemblies"]
): void {
  const generatedAtTime = Date.parse(generatedAt);
  for (const { documentProjections } of assemblies) {
    for (const { sourceDocumentMetadata } of documentProjections) {
      if (generatedAtTime < Date.parse(sourceDocumentMetadata.retrievedAt)) {
        throw new Error(
          "official calendar evidence source is not yet retrieved at generatedAt"
        );
      }
      if (generatedAtTime >= Date.parse(sourceDocumentMetadata.staleAfter)) {
        throw new Error(
          "official calendar evidence source is stale at generatedAt"
        );
      }
    }
  }
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
