import { isDeepStrictEqual } from "node:util";
import { resolvePersistedPaperFillExecutionOrigin, type VerifiedPaperFillExecutionHistory } from "./paperFillExecutionFiles.js";
import { resolveVerifiedPortfolioActionRiskDecisionOrigin, type VerifiedPortfolioActionRiskDecisionHistory } from "./portfolioActionRiskDecisionFiles.js";
import { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { resolveVerifiedSourcePriceEvidenceOrigin, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import type { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

/** Shared persisted execution comparison only; acquisition, lease lifetime and authority belong to the caller. */
export function bindSnapshotPendingExecutionOrigins(
  planReplay: Awaited<ReturnType<typeof resolveStoredPendingPlanActionProgress>>,
  riskDecisionHistory: VerifiedPortfolioActionRiskDecisionHistory,
  paperFillHistory: VerifiedPaperFillExecutionHistory,
  sourcePriceEvidenceHistory: VerifiedSourcePriceEvidenceHistory
) {
  const usedFills = new Set<string>(), usedRisk = new Set<string>();
  const executionBindings = planReplay.projection.planReplays.flatMap((planReplay) => {
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
  return Object.freeze(executionBindings);
}
