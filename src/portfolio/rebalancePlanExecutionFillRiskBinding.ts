import { parseRebalancePlanExecutionAppliedEvent } from "./rebalancePlanExecutionAppliedEvent.js";
import {
  resolveVerifiedPortfolioActionRiskDecisionOrigin,
  type VerifiedPortfolioActionRiskDecisionHistory
} from "./portfolioActionRiskDecisionFiles.js";
import {
  resolvePersistedPaperFillExecutionOrigin,
  type VerifiedPaperFillExecutionHistory
} from "./paperFillExecutionFiles.js";
import { resolvePaperFillExecutionOrigins } from "./paperFillExecutionOriginResolver.js";
import { resolveVerifiedSourcePriceEvidenceOrigin, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";

/**
 * Validates persisted fill/decision bindings only. This is not an execution
 * authorization: plan/action, rule-set replay, current state and transaction
 * validation must still precede any portfolio mutation.
 */
export function validateRebalancePlanExecutionFillRiskBinding(input: {
  event: unknown;
  riskDecisionHistory: VerifiedPortfolioActionRiskDecisionHistory;
  paperFillHistory: VerifiedPaperFillExecutionHistory;
  sourcePriceEvidenceHistory: VerifiedSourcePriceEvidenceHistory;
}) {
  const event = parseRebalancePlanExecutionAppliedEvent(input.event);
  const riskOrigin = resolveVerifiedPortfolioActionRiskDecisionOrigin(
    input.riskDecisionHistory,
    event.riskDecisionId
  );
  const riskDecision = riskOrigin.record;
  if (riskDecision.decision !== "approved") {
    throw new Error("execution fill risk binding requires an approved decision");
  }
  const fillOrigin = resolvePersistedPaperFillExecutionOrigin(
    input.paperFillHistory, event.paperFillRecordId
  );
  if (fillOrigin.riskOrigin === null ||
    fillOrigin.riskOrigin.riskDecisionId !== riskDecision.riskDecisionId ||
    fillOrigin.riskOrigin.riskDecisionHash !== riskDecision.riskDecisionHash ||
    fillOrigin.riskOrigin.commitHash !== riskOrigin.commitHash ||
    fillOrigin.riskOrigin.appendedAt !== riskOrigin.appendedAt) {
    throw new Error("execution fill risk binding requires the risk origin persisted with the fill");
  }
  const { record: paperFill, sourcePriceEvidence } = resolvePaperFillExecutionOrigins({
    value: fillOrigin.record,
    sourcePriceEvidenceHistory: input.sourcePriceEvidenceHistory
  });
  if (!riskDecision.riskEvidenceRefs.includes(sourcePriceEvidence.evidenceRef)) {
    throw new Error("execution fill risk binding source evidence mismatch");
  }
  const priceOrigin = resolveVerifiedSourcePriceEvidenceOrigin(
    input.sourcePriceEvidenceHistory, sourcePriceEvidence.evidenceRef
  );
  const identityMatches =
    event.paperFillHash === paperFill.paperFillHash &&
    event.fillId === paperFill.fillId &&
    event.portfolioId === paperFill.portfolioId &&
    event.planId === paperFill.rebalancePlanId &&
    event.actionId === paperFill.rebalanceActionId &&
    event.portfolioId === riskDecision.portfolioId &&
    event.planId === riskDecision.planId &&
    event.actionId === riskDecision.actionId &&
    event.policyHash === riskDecision.policyHash &&
    paperFill.market === riskDecision.market &&
    paperFill.symbol === riskDecision.symbol &&
    paperFill.side === riskDecision.side;
  if (!identityMatches) {
    throw new Error("execution fill risk binding identity or scope mismatch");
  }
  if (
    event.expectedPrePortfolioVersion !== riskDecision.expectedPortfolioVersion ||
    event.expectedPrePortfolioSnapshotHash !== riskDecision.expectedPortfolioSnapshotHash
  ) {
    throw new Error("execution fill risk binding expected pre-state mismatch");
  }
  if (
    event.requestedNotionalKrw !== paperFill.requestedNotionalKrw ||
    event.requestedQuantity !== paperFill.requestedQuantity ||
    event.requestedNotionalKrw !== riskDecision.requestedNotionalKrw ||
    event.requestedQuantity !== riskDecision.requestedQuantity ||
    event.filledNotionalKrw !== paperFill.filledNotionalKrw ||
    event.filledQuantity !== paperFill.quantity
  ) {
    throw new Error("execution fill risk binding amount mismatch");
  }
  if (
    event.cumulativeFilledNotionalKrw !==
      riskDecision.priorCumulativeFilledNotionalKrw + paperFill.filledNotionalKrw ||
    event.cumulativeFilledQuantity !==
      riskDecision.priorCumulativeFilledQuantity + paperFill.quantity
  ) {
    throw new Error("execution fill risk binding cumulative amount mismatch");
  }
  if (
    Date.parse(priceOrigin.appendedAt) >= Date.parse(riskDecision.decidedAt) ||
    Date.parse(riskOrigin.appendedAt) >= Date.parse(paperFill.asOf) ||
    Date.parse(riskDecision.decidedAt) > Date.parse(paperFill.asOf) ||
    Date.parse(paperFill.asOf) > Date.parse(event.asOf) ||
    Date.parse(paperFill.createdAt) > Date.parse(event.asOf) ||
    // Equal millisecond buckets do not prove that the record was durable first.
    Date.parse(fillOrigin.appendedAt) >= Date.parse(event.asOf)
  ) {
    throw new Error("execution fill risk binding availability cutoff mismatch");
  }
  if (paperFill.filledNotionalKrw > riskDecision.approvedMaximumFillNotionalKrw) {
    throw new Error("execution fill exceeds approved gross notional cap");
  }
  if (
    riskDecision.cashAssessment.side === "BUY" &&
    paperFill.netAmountKrw > riskDecision.cashAssessment.approvedMaximumNetCashDebitKrw
  ) {
    throw new Error("execution fill exceeds approved net cash debit cap");
  }
  if (
    riskDecision.cashAssessment.side === "SELL" &&
    paperFill.netAmountKrw < riskDecision.cashAssessment.expectedMinimumNetCashCreditKrw
  ) {
    throw new Error("execution fill falls below expected net cash credit floor");
  }
  return Object.freeze({ event, riskDecision, paperFill, sourcePriceEvidence });
}
