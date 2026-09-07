import { isDeepStrictEqual } from "node:util";
import { InvestmentMandateFileRepository, resolveObservedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { resolvePortfolioActionRiskDecisionPlan } from "./portfolioActionRiskDecisionPlanResolver.js";
import { riskDecisionMandateIdentity, validateRiskDecisionMandateState } from "./portfolioActionRiskDecisionMandateContext.js";

/** Explains the exact mandate generation known at creation; not a current execution permit. */
export async function resolvePortfolioActionRiskDecisionMandate(input: { baseDir: string; riskDecisionId: string }) {
  // Preserve the source directory across asynchronous policy/plan reads.
  const { baseDir } = input;
  const plan = await resolvePortfolioActionRiskDecisionPlan(input);
  const receipt = plan.origin.mandateOrigin;
  if (receipt === null) throw new Error("risk decision lacks mandate-before-creation provenance; legacy record requires review");
  return new InvestmentMandateFileRepository(baseDir).withDurableVerifiedHistory(async (history) => {
    const observed = resolveObservedInvestmentMandateHistory(history, receipt.observation);
    const mandate = validateRiskDecisionMandateState(plan, observed);
    const { observation: _observation, ...identity } = receipt;
    if (!isDeepStrictEqual(identity, riskDecisionMandateIdentity(mandate))) {
      throw new Error("risk decision mandate origin does not match stored sources");
    }
    return Object.freeze({ ...plan, mandate, mandateOrigin: receipt });
  });
}
