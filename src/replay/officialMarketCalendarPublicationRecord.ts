import { z } from "zod";

import {
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_PUBLICATION_RECORD_SCHEMA_VERSION =
  "official_market_calendar_publication_record.v1";

const packagePathSchema = z
  .string()
  .regex(
    /^sha256\/[a-f0-9]{64}$/,
    "official calendar package path must use the hash-addressed namespace"
  );

const officialMarketCalendarPublicationRecordBaseSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_RECORD_SCHEMA_VERSION
    ),
    artifactHash: sha256HashSchema,
    packagePath: packagePathSchema
  })
  .strict()
  .superRefine((value, context) => {
    const expectedPath = createOfficialMarketCalendarPackagePath(
      value.artifactHash
    );
    if (value.packagePath !== expectedPath) {
      context.addIssue({
        code: "custom",
        path: ["packagePath"],
        message:
          "official calendar package path must match the artifact hash"
      });
    }
  });

export const officialMarketCalendarPublicationRecordSchema =
  officialMarketCalendarPublicationRecordBaseSchema
    .safeExtend({
      publicationRecordHash: sha256HashSchema
    })
    .strict();

export type OfficialMarketCalendarPublicationRecord = z.infer<
  typeof officialMarketCalendarPublicationRecordSchema
>;

export type OfficialMarketCalendarPublicationRecordPayload = z.infer<
  typeof officialMarketCalendarPublicationRecordBaseSchema
>;

export function createOfficialMarketCalendarPublicationRecord(
  artifactHash: unknown
): OfficialMarketCalendarPublicationRecord {
  const parsedArtifactHash = sha256HashSchema.parse(artifactHash);
  const payload = officialMarketCalendarPublicationRecordBaseSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_RECORD_SCHEMA_VERSION,
    artifactHash: parsedArtifactHash,
    packagePath: createOfficialMarketCalendarPackagePath(parsedArtifactHash)
  });
  return Object.freeze({
    ...payload,
    publicationRecordHash:
      createOfficialMarketCalendarPublicationRecordHash(payload)
  });
}

export function parseOfficialMarketCalendarPublicationRecord(
  value: unknown
): OfficialMarketCalendarPublicationRecord {
  const record = officialMarketCalendarPublicationRecordSchema.parse(value);
  const { publicationRecordHash, ...payload } = record;
  const expectedHash =
    createOfficialMarketCalendarPublicationRecordHash(payload);
  if (publicationRecordHash !== expectedHash) {
    throw new Error(
      "official market calendar publication record hash mismatch"
    );
  }
  return Object.freeze(record);
}

export function createOfficialMarketCalendarPublicationRecordHash(
  value: OfficialMarketCalendarPublicationRecordPayload
): Sha256Hash {
  return createReplayResearchHash(
    officialMarketCalendarPublicationRecordBaseSchema.parse(value)
  );
}

export function createOfficialMarketCalendarPackagePath(
  artifactHash: Sha256Hash
): string {
  const parsedArtifactHash = sha256HashSchema.parse(artifactHash);
  return `sha256/${parsedArtifactHash.slice("sha256:".length)}`;
}

export function createOfficialMarketCalendarPublicationRecordPath(
  artifactHash: Sha256Hash
): string {
  const parsedArtifactHash = sha256HashSchema.parse(artifactHash);
  return `published/sha256/${parsedArtifactHash.slice("sha256:".length)}.json`;
}
