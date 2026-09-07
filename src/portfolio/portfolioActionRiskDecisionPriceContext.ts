import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parsePortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { sourcePriceEvidenceObservationSchema, resolveVerifiedSourcePriceEvidenceOrigin, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";

export const riskDecisionPriceOriginSchema = z.object({
  evidenceRef: z.string().min(1).max(240), evidenceHash: sha256HashSchema,
  observation: sourcePriceEvidenceObservationSchema
}).strict();
export type RiskDecisionPriceOrigin = Readonly<z.infer<typeof riskDecisionPriceOriginSchema>>;

/** Resolves price input provenance, not freshness policy, complete cost bounds or execution authority. */
export function validateRiskDecisionPriceState(value: unknown, history: VerifiedSourcePriceEvidenceHistory, evidenceRef: string) {
  const decision = parsePortfolioActionRiskDecision(value);
  const origin = resolveVerifiedSourcePriceEvidenceOrigin(history, evidenceRef);
  const price = origin.record;
  const cutoff = Date.parse(decision.decidedAt);
  if (!decision.riskEvidenceRefs.includes(price.evidenceRef) || price.market !== decision.market || price.symbol !== decision.symbol ||
    Date.parse(price.observedAt) > cutoff || Date.parse(price.createdAt) > cutoff || Date.parse(origin.appendedAt) > cutoff) {
    throw new Error("risk decision price source scope or availability mismatch");
  }
  return origin;
}

export function riskDecisionPriceIdentity(origin: ReturnType<typeof validateRiskDecisionPriceState>) {
  return { evidenceRef: origin.record.evidenceRef, evidenceHash: origin.record.evidenceHash };
}
