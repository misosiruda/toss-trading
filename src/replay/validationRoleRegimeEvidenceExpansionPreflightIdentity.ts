import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
  evidenceExpansionPreflightConfigSchema,
  evidenceExpansionPreflightSourceSchema,
  type EvidenceExpansionTargetMatrix,
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";

const preflightIdentityInputSchema = z
  .object({
    baseline: z
      .object({
        hashes: z
          .object({
            baselineFeasibilityArtifactHash: sha256HashSchema,
            baselinePlanHash: sha256HashSchema,
            baselineReadinessArtifactHash: sha256HashSchema
          })
          .strict(),
        provenance: z
          .object({
            validationSplitHash: sha256HashSchema,
            calendarHash: sha256HashSchema,
            marketRegimeClassifierHash: sha256HashSchema
          })
          .strict(),
        config: z
          .object({
            candidateStrategyBucket: z.literal("short_term"),
            windowMonths: z.number().int().positive(),
            timezoneOffsetMinutes: z.number().int()
          })
          .strict()
      })
      .strict(),
    expansion: z
      .object({
        hashes: z
          .object({
            expansionDataSnapshotHash: sha256HashSchema,
            expansionUniverseHash: sha256HashSchema,
            expansionCoverageHash: sha256HashSchema,
            validationSplitHash: sha256HashSchema
          })
          .strict(),
        coverageTimezoneOffsetMinutes: z.number().int()
      })
      .strict(),
    calendarClassifier: z
      .object({
        calendarHash: sha256HashSchema,
        officialCalendarArtifactHash: sha256HashSchema.nullable(),
        marketRegimeClassifierHash: sha256HashSchema
      })
      .strict(),
    roleRegimeSampleMinimum: z.number().int().positive().nullable()
  })
  .strict();

export interface EvidenceExpansionPreflightIdentity {
  source: ValidationRoleRegimeEvidenceExpansionPreflightArtifact["source"];
  config: ValidationRoleRegimeEvidenceExpansionPreflightArtifact["config"];
  targetMatrix: EvidenceExpansionTargetMatrix;
}

export function buildEvidenceExpansionPreflightIdentity(
  input: unknown
): EvidenceExpansionPreflightIdentity {
  const parsed = preflightIdentityInputSchema.parse(input);
  assertIdentityLinks(parsed);

  const source = evidenceExpansionPreflightSourceSchema.parse({
    ...parsed.baseline.hashes,
    ...parsed.expansion.hashes,
    calendarHash: parsed.calendarClassifier.calendarHash,
    officialCalendarArtifactHash:
      parsed.calendarClassifier.officialCalendarArtifactHash,
    marketRegimeClassifierHash:
      parsed.calendarClassifier.marketRegimeClassifierHash
  });
  const config = evidenceExpansionPreflightConfigSchema.parse({
    candidateStrategyBucket:
      parsed.baseline.config.candidateStrategyBucket,
    targetRegimes: ["bull", "bear", "sideways", "mixed"],
    windowMonths: parsed.baseline.config.windowMonths,
    timezoneOffsetMinutes: parsed.baseline.config.timezoneOffsetMinutes,
    roleSampleMinimum: EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
    roleRegimeSampleMinimum: parsed.roleRegimeSampleMinimum,
    inputPolicyVersion: "result_blind_capacity_scan.v1",
    dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
  });

  return {
    source,
    config,
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: config.roleSampleMinimum,
      roleRegimeSampleMinimum: config.roleRegimeSampleMinimum
    })
  };
}

function assertIdentityLinks(
  input: z.infer<typeof preflightIdentityInputSchema>
): void {
  if (
    input.expansion.hashes.validationSplitHash !==
    input.baseline.provenance.validationSplitHash
  ) {
    throw new Error(
      "expansion validation split hash does not match baseline"
    );
  }
  if (
    input.calendarClassifier.calendarHash !==
    input.baseline.provenance.calendarHash
  ) {
    throw new Error("expansion calendar hash does not match baseline");
  }
  if (
    input.calendarClassifier.marketRegimeClassifierHash !==
    input.baseline.provenance.marketRegimeClassifierHash
  ) {
    throw new Error("expansion classifier hash does not match baseline");
  }
  if (
    input.expansion.coverageTimezoneOffsetMinutes !==
    input.baseline.config.timezoneOffsetMinutes
  ) {
    throw new Error(
      "expansion coverage timezone does not match baseline config"
    );
  }
}
