import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { investmentMandateObservationSchema } from "./investmentMandateFiles.js";
import { resolveCurrentInvestmentMandateAsOf, type InvestmentMandateHistorySnapshot } from "./investmentMandateState.js";
import { type validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";

export const riskDecisionMandateOriginSchema = z.object({
  mandateId: z.string().min(1).max(160), mandateHash: sha256HashSchema,
  mandateEventId: z.string().min(1).max(160), mandateEventHash: sha256HashSchema,
  observation: investmentMandateObservationSchema
}).strict();
export type RiskDecisionMandateOrigin = Readonly<z.infer<typeof riskDecisionMandateOriginSchema>>;

/** Validates the observed mandate, not assignment/reservation authenticity or execution authority. */
export function validateRiskDecisionMandateState(
  binding: ReturnType<typeof validateRiskDecisionPlanState>, history: InvestmentMandateHistorySnapshot
) {
  const { decision, action } = binding;
  if (action.lineageKind !== "mandate" || decision.riskRuleScope.scopeKind !== "bucket") {
    throw new Error("mandate-bound risk decision requires a mandate action and bucket scope");
  }
  const mandate = resolveCurrentInvestmentMandateAsOf({
    mandateId: action.mandateId, portfolioId: decision.portfolioId, policyHash: decision.policyHash,
    market: decision.market, symbol: decision.symbol, asOf: decision.decidedAt, knownAt: decision.decidedAt,
    records: history.records, events: history.events
  });
  if (mandate.record.bucket !== decision.riskRuleScope.bucket || mandate.currentEvent === undefined) {
    throw new Error("risk decision mandate bucket or current event mismatch");
  }
  if (decision.decision === "approved" && decision.side === "BUY") {
    if (mandate.status !== "active" ||
      (mandate.record.assignmentSource === "manual_policy" && mandate.record.manualAuthorizationScope === "classify_existing_reduce_only")) {
      throw new Error("risk BUY approval requires an active open-or-increase mandate");
    }
  }
  return mandate;
}

export function riskDecisionMandateIdentity(mandate: ReturnType<typeof validateRiskDecisionMandateState>) {
  return {
    mandateId: mandate.record.mandateId, mandateHash: mandate.record.mandateHash,
    mandateEventId: mandate.currentEvent!.mandateEventId, mandateEventHash: mandate.currentEvent!.mandateEventHash
  };
}
