import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PaperFillExecutionFileRepository, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { type PortfolioSizingSnapshotFileRepositoryOptions } from "./portfolioSizingSnapshotFiles.js";
import { replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { getDurableSourcePriceEvidenceObservation, resolveVerifiedSourcePriceEvidenceOrigin, SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { resolveStoredSnapshotPendingActions } from "./storedSnapshotPendingActions.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();

/** Historical pending reconciliation, including the actual fill/Risk sources behind every included plan prefix. */
export async function resolveStoredSnapshotPendingExecutionOrigins(value: z.input<typeof inputSchema>,
  options: PortfolioSizingSnapshotFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("snapshot pending execution input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const pending = await resolveStoredSnapshotPendingActions({ baseDir, portfolioSnapshotId: input.portfolioSnapshotId }, lockOptions);
  // Separate historical reads, not a current-generation lease or atomic execution transaction.
  const riskDecisionHistory = await new PortfolioActionRiskDecisionFileRepository(baseDir, lockOptions).readVerifiedHistory();
  const paperFillHistory = await new PaperFillExecutionFileRepository(baseDir, lockOptions).readVerifiedHistory();
  return new SourcePriceEvidenceFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (sourcePriceEvidenceHistory) => {
    const priceObservation = getDurableSourcePriceEvidenceObservation(sourcePriceEvidenceHistory);
    const priorObservation = pending.priceObservation?.observedAt ?? pending.planReplay.assessment.observedAt;
    if (Date.parse(priceObservation.observedAt) < Date.parse(priorObservation)) throw new Error("pending execution source observation clock moved backwards");
    const usedFills = new Set<string>(), usedRisk = new Set<string>();
    const executionBindings = pending.planReplay.projection.planReplays.flatMap((planReplay) => {
      const { plan, events } = planReplay.calculation.input;
      // Terminal plans also contribute: a fabricated completion must not silently remove pending exposure.
      return replayRebalancePlanExecutionContexts({ plan, events }).executionContexts.map(({ event, eventIndex: index, priorState }) => {
        const binding = validateRebalancePlanExecutionFillRiskBinding({ event, riskDecisionHistory, paperFillHistory, sourcePriceEvidenceHistory });
        if (usedFills.has(binding.paperFill.fillId) || usedRisk.has(binding.riskDecision.riskDecisionId)) {
          throw new Error("snapshot pending execution reuses a portfolio fill or Risk decision");
        }
        usedFills.add(binding.paperFill.fillId); usedRisk.add(binding.riskDecision.riskDecisionId);
        validateRiskDecisionPlanState(binding.riskDecision, priorState);
        const predecessor = planReplay.eventOrigins[index - 1]!;
        const riskOrigin = resolveVerifiedPortfolioActionRiskDecisionOrigin(riskDecisionHistory, event.riskDecisionId);
        if (Date.parse(predecessor.appendedAt) >= Date.parse(binding.riskDecision.decidedAt)) {
          throw new Error("snapshot pending Risk decision predates its stored plan predecessor");
        }
        // A stored receipt, when present, must identify this exact observed historical prefix.
        if (riskOrigin.planOrigin !== null) {
          const { observedAt, ...receipt } = riskOrigin.planOrigin;
          const expected = { planId: plan.planId, planHash: plan.planHash, planCommitHash: planReplay.planOrigin.commitHash,
            planAppendedAt: planReplay.planOrigin.appendedAt, predecessorEventId: predecessor.event.planEventId,
            predecessorEventHash: predecessor.event.planEventHash, predecessorCommitHash: predecessor.commitHash,
            predecessorAppendedAt: predecessor.appendedAt };
          if (!isDeepStrictEqual(receipt, expected) || Date.parse(observedAt) < Date.parse(predecessor.appendedAt) ||
            Date.parse(observedAt) > Date.parse(binding.riskDecision.decidedAt)) throw new Error("snapshot pending Risk plan receipt mismatch");
        }
        return Object.freeze({ ...binding, eventOrigin: planReplay.eventOrigins[index]!, riskOrigin,
          fillOrigin: resolvePersistedPaperFillExecutionOrigin(paperFillHistory, event.paperFillRecordId),
          priceOrigin: resolveVerifiedSourcePriceEvidenceOrigin(sourcePriceEvidenceHistory, binding.sourcePriceEvidence.evidenceRef) });
      });
    });
    const assessment = Object.freeze({ verificationScope: "stored_snapshot_pending_execution_origins_only" as const,
      pendingAssessmentHash: pending.assessmentHash, executionBindingsHash: hashCanonicalPayload(executionBindings),
      executionCount: executionBindings.length, riskRecordsHash: hashCanonicalPayload(riskDecisionHistory.records),
      fillRecordsHash: hashCanonicalPayload(paperFillHistory.records), priceObservation,
      riskPolicyAndRuleAuthority: "not_verified" as const, openingReservationAuthority: "not_verified" as const,
      accountingAndResultingStateAuthority: "not_verified" as const, priceFreshnessAndTrust: "not_evaluated" as const,
      historicalDiskAvailability: "not_proven" as const, currentExecutionAuthority: "not_granted" as const,
      finalSizing: "not_performed" as const });
    return Object.freeze({ pending, executionBindings: Object.freeze(executionBindings), assessment,
      assessmentHash: hashCanonicalPayload(assessment) });
  });
}
