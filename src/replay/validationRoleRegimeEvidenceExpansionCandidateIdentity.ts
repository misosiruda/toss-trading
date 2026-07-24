import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  createValidationFeasibilityCandidateHash
} from "./validationSplitRegimeFeasibility.js";
import {
  evidenceExpansionSourceVariantReferenceSchema,
  type EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export const EVIDENCE_EXPANSION_SOURCE_VARIANT_HASH_VERSION =
  "evidence_expansion_source_variant.v1";

const evidenceGroupHashInputShape = {
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  candidateStrategyBucket: z.literal("short_term"),
  windowMonths: z.number().int().positive(),
  timezoneOffsetMinutes: z.number().int()
} as const;

export const evidenceExpansionCandidateIdentityInputSchema = z
  .object({
    ...evidenceGroupHashInputShape,
    scopeAvailable: z.boolean(),
    calendarHash: sha256HashSchema,
    marketRegimeClassifierHash: sha256HashSchema,
    dataSnapshotHash: sha256HashSchema,
    universeHash: sha256HashSchema,
    coverageHash: sha256HashSchema,
    validationSplitHash: sha256HashSchema,
    observedTradingDatesHash: sha256HashSchema,
    universeMembershipHash: sha256HashSchema,
    legacyReplayPlanEvidenceGroupHash: sha256HashSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) >= Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "evidence group startAt must be before endAt"
      });
    }
  });

const evidenceGroupHashInputSchema = z
  .object(evidenceGroupHashInputShape)
  .strict();

const sourceVariantHashInputSchema = z
  .object({
    evidenceGroupHash: sha256HashSchema,
    feasibilityCandidateHash: sha256HashSchema,
    scopeAvailable: z.boolean(),
    calendarHash: sha256HashSchema,
    marketRegimeClassifierHash: sha256HashSchema,
    dataSnapshotHash: sha256HashSchema,
    universeHash: sha256HashSchema,
    coverageHash: sha256HashSchema,
    validationSplitHash: sha256HashSchema,
    observedTradingDatesHash: sha256HashSchema,
    universeMembershipHash: sha256HashSchema
  })
  .strict();

export interface EvidenceExpansionCandidateIdentity {
  evidenceGroupHash: Sha256Hash;
  sourceVariant: EvidenceExpansionSourceVariantReference;
}

export function createEvidenceExpansionCandidateIdentity(
  value: unknown
): EvidenceExpansionCandidateIdentity {
  const input = evidenceExpansionCandidateIdentityInputSchema.parse(value);
  const evidenceGroupHash = createReplayResearchHash(
    evidenceGroupHashInputSchema.parse({
      startAt: input.startAt,
      endAt: input.endAt,
      candidateStrategyBucket: input.candidateStrategyBucket,
      windowMonths: input.windowMonths,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    })
  );
  const feasibilityCandidateHash =
    createValidationFeasibilityCandidateHash({
      startAt: input.startAt,
      endAt: input.endAt,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      windowMonths: input.windowMonths,
      calendarHash: input.calendarHash,
      marketRegimeClassifierHash: input.marketRegimeClassifierHash,
      candidateStrategyBucket: input.candidateStrategyBucket,
      scopeAvailable: input.scopeAvailable,
      dataSnapshotHash: input.dataSnapshotHash,
      universeHash: input.universeHash,
      coverageHash: input.coverageHash
    });
  if (
    input.legacyReplayPlanEvidenceGroupHash !== null &&
    input.legacyReplayPlanEvidenceGroupHash !== feasibilityCandidateHash
  ) {
    throw new Error(
      "legacy replay-plan evidence group hash does not match feasibility candidate hash"
    );
  }

  const sourceVariantHash = createReplayResearchHash(
    sourceVariantHashInputSchema.parse({
      evidenceGroupHash,
      feasibilityCandidateHash,
      scopeAvailable: input.scopeAvailable,
      calendarHash: input.calendarHash,
      marketRegimeClassifierHash: input.marketRegimeClassifierHash,
      dataSnapshotHash: input.dataSnapshotHash,
      universeHash: input.universeHash,
      coverageHash: input.coverageHash,
      validationSplitHash: input.validationSplitHash,
      observedTradingDatesHash: input.observedTradingDatesHash,
      universeMembershipHash: input.universeMembershipHash
    })
  );

  return {
    evidenceGroupHash,
    sourceVariant: evidenceExpansionSourceVariantReferenceSchema.parse({
      feasibilityCandidateHash,
      legacyReplayPlanEvidenceGroupHash:
        input.legacyReplayPlanEvidenceGroupHash,
      sourceVariantHashVersion:
        EVIDENCE_EXPANSION_SOURCE_VARIANT_HASH_VERSION,
      sourceVariantHash,
      observedTradingDatesHash: input.observedTradingDatesHash,
      universeMembershipHash: input.universeMembershipHash
    })
  };
}
