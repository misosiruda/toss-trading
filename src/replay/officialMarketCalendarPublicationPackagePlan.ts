import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarEvidenceArtifactV2Schema,
  parseOfficialMarketCalendarEvidenceArtifactV2
} from "./officialMarketCalendarEvidenceArtifactV2.js";
import {
  createOfficialMarketCalendarPublicationRecord,
  createOfficialMarketCalendarPublicationRecordPath,
  officialMarketCalendarPublicationRecordSchema
} from "./officialMarketCalendarPublicationRecord.js";
import { verifyOfficialMarketCalendarSourceArchiveSidecars } from "./officialMarketCalendarSourceArchiveSidecar.js";
import {
  createReplayResearchHash,
  stableStringifyResearchInput
} from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_PUBLICATION_PACKAGE_PLAN_SCHEMA_VERSION =
  "official_market_calendar_publication_package_plan.v1";

const contentLengthSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const artifactFileSchema = z
  .object({
    packageRelativePath: z.literal("artifact.json"),
    contentHash: sha256HashSchema,
    contentLength: contentLengthSchema
  })
  .strict();
const sourceArchiveFileSchema = z
  .object({
    archivePath: z
      .string()
      .regex(/^sources\/sha256\/[a-f0-9]{64}\.bin$/),
    sourceDocumentHash: sha256HashSchema,
    contentLength: contentLengthSchema
  })
  .strict();
const publicationRecordPathSchema = z
  .string()
  .regex(/^published\/sha256\/[a-f0-9]{64}\.json$/);
const planPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_PACKAGE_PLAN_SCHEMA_VERSION
    ),
    artifact: officialMarketCalendarEvidenceArtifactV2Schema,
    packagePath: z.string().regex(/^sha256\/[a-f0-9]{64}$/),
    publicationRecord: officialMarketCalendarPublicationRecordSchema,
    publicationRecordPath: publicationRecordPathSchema,
    artifactFile: artifactFileSchema,
    sourceArchiveFiles: z.array(sourceArchiveFileSchema)
  })
  .strict();

export const officialMarketCalendarPublicationPackagePlanSchema =
  planPayloadSchema.safeExtend({ planHash: sha256HashSchema }).strict();

export type OfficialMarketCalendarPublicationPackagePlan = z.infer<
  typeof officialMarketCalendarPublicationPackagePlanSchema
>;
export type OfficialMarketCalendarPublicationPackagePlanPayload = z.infer<
  typeof planPayloadSchema
>;

interface PublicationPackagePlanOptions {
  sourceBytesByExchange: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export interface PreparedOfficialMarketCalendarPublicationPackagePlan {
  plan: OfficialMarketCalendarPublicationPackagePlan;
  artifactBytes: Uint8Array;
}

export function createOfficialMarketCalendarPublicationPackagePlan(
  input: { artifact: unknown; sidecars: readonly unknown[] },
  options: PublicationPackagePlanOptions
): PreparedOfficialMarketCalendarPublicationPackagePlan {
  const artifact = parseOfficialMarketCalendarEvidenceArtifactV2(
    input.artifact,
    options
  );
  const collections = artifact.sourceCollectionAssemblies.map(
    ({ sourceCollection }) => sourceCollection
  );
  const verifiedSidecars = verifyOfficialMarketCalendarSourceArchiveSidecars({
    bindings: artifact.sourceArchiveBindings,
    collections,
    sidecars: input.sidecars
  });
  const artifactBytes = new TextEncoder().encode(
    `${stableStringifyResearchInput(artifact)}\n`
  );
  const publicationRecord = createOfficialMarketCalendarPublicationRecord(
    artifact.artifactHash
  );
  const payload = planPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_PACKAGE_PLAN_SCHEMA_VERSION,
    artifact,
    packagePath: publicationRecord.packagePath,
    publicationRecord,
    publicationRecordPath: createOfficialMarketCalendarPublicationRecordPath(
      artifact.artifactHash
    ),
    artifactFile: {
      packageRelativePath: "artifact.json",
      contentHash: hashBytes(artifactBytes),
      contentLength: artifactBytes.byteLength
    },
    sourceArchiveFiles: verifiedSidecars
  });
  return {
    plan: deepFreeze({
      ...payload,
      planHash: createOfficialMarketCalendarPublicationPackagePlanHash(payload)
    }),
    artifactBytes
  };
}

export function parseOfficialMarketCalendarPublicationPackagePlan(
  value: unknown,
  input: { sidecars: readonly unknown[] },
  options: PublicationPackagePlanOptions
): PreparedOfficialMarketCalendarPublicationPackagePlan {
  const plan = officialMarketCalendarPublicationPackagePlanSchema.parse(value);
  const expected = createOfficialMarketCalendarPublicationPackagePlan(
    { artifact: plan.artifact, sidecars: input.sidecars },
    options
  );
  if (!isDeepStrictEqual(plan, expected.plan)) {
    throw new Error(
      "official calendar publication package plan does not match verified artifact and sidecars"
    );
  }
  return expected;
}

export function createOfficialMarketCalendarPublicationPackagePlanHash(
  value: OfficialMarketCalendarPublicationPackagePlanPayload
): Sha256Hash {
  return createReplayResearchHash(planPayloadSchema.parse(value));
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
