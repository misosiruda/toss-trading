import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarPublicationFilesystemPreflightSchema,
  parseOfficialMarketCalendarPublicationFilesystemPreflight
} from "./officialMarketCalendarPublicationFilesystemPreflight.js";
import {
  parseOfficialMarketCalendarPublicationPackagePlan
} from "./officialMarketCalendarPublicationPackagePlan.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION =
  "official_market_calendar_publication_activation_preflight.v1";

const activationPreflightPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION
    ),
    operation: z.literal("publish_and_activate"),
    artifactHash: sha256HashSchema,
    packagePlanHash: sha256HashSchema,
    filesystemPreflightHash: sha256HashSchema,
    publicationRootIdentityHash: sha256HashSchema,
    status: z.literal("blocked"),
    blockers: z.array(z.enum([
      "atomic_no_replace_directory_publish_unavailable",
      "directory_durability_sync_unavailable",
      "exclusive_staging_file_create_unavailable",
      "file_durability_sync_unavailable",
      "atomic_no_replace_file_publish_unavailable",
      "safe_mutation_probe_cleanup_unavailable"
    ])).min(1),
    filesystemMutationAction: z.literal("none"),
    verifiedSetAction: z.literal("unchanged")
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.blockers.length; index += 1) {
      if (value.blockers[index - 1]! >= value.blockers[index]!) {
        context.addIssue({
          code: "custom",
          path: ["blockers", index],
          message: "publication activation blockers must be unique and canonical"
        });
      }
    }
  });

export const officialMarketCalendarPublicationActivationPreflightSchema =
  activationPreflightPayloadSchema
    .safeExtend({ decisionHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarPublicationActivationPreflight = z.infer<
  typeof officialMarketCalendarPublicationActivationPreflightSchema
>;
export type OfficialMarketCalendarPublicationActivationPreflightPayload =
  z.infer<typeof activationPreflightPayloadSchema>;

interface ActivationPreflightOptions {
  sourceBytesByExchange: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function evaluateOfficialMarketCalendarPublicationActivationPreflight(
  input: unknown,
  options: ActivationPreflightOptions
): OfficialMarketCalendarPublicationActivationPreflight {
  const parsed = z
    .object({
      packagePlan: z.unknown(),
      sidecars: z.array(z.unknown()),
      filesystemPreflight:
        officialMarketCalendarPublicationFilesystemPreflightSchema
    })
    .strict()
    .parse(input);
  const packagePlan = parseOfficialMarketCalendarPublicationPackagePlan(
    parsed.packagePlan,
    { sidecars: parsed.sidecars },
    options
  ).plan;
  const filesystemPreflight =
    parseOfficialMarketCalendarPublicationFilesystemPreflight(
      parsed.filesystemPreflight
    );
  const payload = activationPreflightPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_PUBLICATION_ACTIVATION_PREFLIGHT_SCHEMA_VERSION,
    operation: "publish_and_activate",
    artifactHash: packagePlan.artifact.artifactHash,
    packagePlanHash: packagePlan.planHash,
    filesystemPreflightHash: filesystemPreflight.preflightHash,
    publicationRootIdentityHash:
      filesystemPreflight.publicationRootIdentityHash,
    status: "blocked",
    blockers: filesystemPreflight.blockers,
    filesystemMutationAction: "none",
    verifiedSetAction: "unchanged"
  });
  return deepFreeze({
    ...payload,
    decisionHash:
      createOfficialMarketCalendarPublicationActivationPreflightHash(payload)
  });
}

export function parseOfficialMarketCalendarPublicationActivationPreflight(
  value: unknown
): OfficialMarketCalendarPublicationActivationPreflight {
  const parsed =
    officialMarketCalendarPublicationActivationPreflightSchema.parse(value);
  const { decisionHash, ...payload } = parsed;
  if (
    decisionHash !==
    createOfficialMarketCalendarPublicationActivationPreflightHash(payload)
  ) {
    throw new Error(
      "official calendar publication activation preflight hash mismatch"
    );
  }
  return deepFreeze(parsed);
}

export function assertOfficialMarketCalendarPublicationActivationPermitted(
  value: unknown
): never {
  const decision =
    parseOfficialMarketCalendarPublicationActivationPreflight(value);
  throw new Error(
    `official calendar publication activation is blocked: ${decision.blockers.join(",")}`
  );
}

export function createOfficialMarketCalendarPublicationActivationPreflightHash(
  value: OfficialMarketCalendarPublicationActivationPreflightPayload
): Sha256Hash {
  return createReplayResearchHash(
    activationPreflightPayloadSchema.parse(value)
  );
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
