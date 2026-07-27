import { classifyMarketRegime } from "../analytics/marketRegimeClassifier.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  assertEvidenceExpansionBaselineSourceMatches
} from "./validationRoleRegimeEvidenceExpansionBaselineSourceMatch.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionSourceCandidateVariant,
  type EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import type {
  ValidationRoleRegimeReplayPlan,
  ValidationRoleRegimeReplayPlanRun
} from "./validationRoleRegimeReplayPlan.js";

export function buildEvidenceExpansionBaselineRunVariant(input: {
  run: ValidationRoleRegimeReplayPlanRun;
  plan: Pick<
    ValidationRoleRegimeReplayPlan,
    "status" | "source" | "config" | "runs"
  >;
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "snapshots" | "hashes" | "baselineProvenanceHashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "calendarValidation" | "marketRegimeClassifier" | "hashes"
  >;
}): EvidenceExpansionSourceCandidateVariant {
  if (input.plan.status !== "ready_for_paper_diagnostic") {
    throw new Error(
      "baseline run variant requires a ready baseline plan"
    );
  }
  const plannedRun = input.plan.runs.find(
    (run) => run.runKey === input.run.runKey
  );
  if (
    plannedRun === undefined ||
    createReplayResearchHash(plannedRun) !==
      createReplayResearchHash(input.run)
  ) {
    throw new Error(
      "baseline run variant does not match the verified plan"
    );
  }
  if (input.run.candidateHash !== input.run.evidenceGroupHash) {
    throw new Error(
      "baseline run legacy evidence group hash must match candidate hash"
    );
  }
  assertEvidenceExpansionBaselineSourceMatches({
    baselineProvenance: input.plan.source,
    verifiedSourceProvenance:
      input.source.baselineProvenanceHashes
  });
  if (
    input.calendarClassifier.hashes.calendarHash !==
    input.plan.source.calendarHash
  ) {
    throw new Error(
      "baseline run calendar hash does not match the verified plan"
    );
  }
  if (
    input.calendarClassifier.hashes.marketRegimeClassifierHash !==
    input.plan.source.marketRegimeClassifierHash
  ) {
    throw new Error(
      "baseline run classifier hash does not match the verified plan"
    );
  }
  const {
    version: _classifierVersion,
    ...classifierConfig
  } = input.calendarClassifier.marketRegimeClassifier;
  const classifiedRegime = classifyMarketRegime({
    snapshots: input.source.snapshots,
    windowStart: new Date(input.run.startAt),
    windowEnd: new Date(input.run.endAt),
    ...classifierConfig
  }).label;
  if (classifiedRegime !== input.run.targetRegime) {
    throw new Error(
      "baseline run regime does not match the verified classifier"
    );
  }

  return buildEvidenceExpansionSourceCandidateVariant({
    candidate: {
      startAt: input.run.startAt,
      endAt: input.run.endAt,
      scopeAvailable: true,
      legacyReplayPlanEvidenceGroupHash:
        input.run.evidenceGroupHash
    },
    source: input.source,
    sourceIdentity: "baseline",
    calendarClassifier: input.calendarClassifier,
    windowMonths: input.plan.config.windowMonths,
    timezoneOffsetMinutes: input.plan.config.timezoneOffsetMinutes
  });
}
