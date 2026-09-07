import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PortfolioSizingSnapshotFileRepository, resolveObservedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { InvestmentMandateFileRepository, resolveObservedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { resolvePortfolioActionRiskDecisionPlan } from "./portfolioActionRiskDecisionPlanResolver.js";
import { riskDecisionMandateIdentity, validateRiskDecisionMandateState } from "./portfolioActionRiskDecisionMandateContext.js";
import { riskDecisionSnapshotIdentity, validateRiskDecisionSnapshotState } from "./portfolioActionRiskDecisionSnapshotContext.js";

/** Replays stored pre-state inputs, not current execution authority or numeric rule results. */
export async function resolvePortfolioActionRiskDecisionSnapshot(input: { baseDir: string; riskDecisionId: string }) {
  const parsed = z.object({ baseDir: z.string().min(1), riskDecisionId: z.string().min(1) }).strict().parse(input);
  const plan = await resolvePortfolioActionRiskDecisionPlan(parsed);
  const receipt = plan.origin.snapshotOrigin;
  if (receipt === null) throw new Error("risk decision lacks snapshot-before-creation provenance; legacy record requires review");
  return new PortfolioSizingSnapshotFileRepository(parsed.baseDir).withDurableVerifiedHistory(async (history) => {
    const observed = resolveObservedPortfolioSizingSnapshotHistory(history, receipt.observation);
    const sizing = validateRiskDecisionSnapshotState(plan, observed);
    const { observation: _observation, ...identity } = receipt;
    if (!isDeepStrictEqual(identity, riskDecisionSnapshotIdentity(sizing))) throw new Error("risk decision snapshot origin does not match stored source");
    const mandateReceipt = plan.origin.mandateOrigin;
    const result = { ...plan, sizing, snapshotOrigin: receipt };
    if (plan.action.lineageKind === "unassigned_legacy_reduce_only") {
      if (mandateReceipt !== null) throw new Error("legacy snapshot risk decision cannot carry a mandate origin");
      return Object.freeze({ ...result, mandate: null });
    }
    if (mandateReceipt === null) throw new Error("snapshot risk decision lacks mandate origin");
    return new InvestmentMandateFileRepository(parsed.baseDir).withDurableVerifiedHistory(async (mandates) => {
      const mandate = validateRiskDecisionMandateState(plan, resolveObservedInvestmentMandateHistory(mandates, mandateReceipt.observation));
      const { observation: _time, ...mandateIdentity } = mandateReceipt;
      if (!isDeepStrictEqual(mandateIdentity, riskDecisionMandateIdentity(mandate))) throw new Error("risk decision mandate origin does not match stored source");
      return Object.freeze({ ...result, mandate });
    });
  });
}
