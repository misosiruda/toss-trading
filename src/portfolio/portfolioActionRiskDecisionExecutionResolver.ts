import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { subtractCanonicalQuantities } from "./canonicalQuantity.js";
import { assertRiskExecutionDecisionBinding, verifyRiskExecutionLiquidity } from "./portfolioActionRiskDecisionExecutionContext.js";
import { resolvePortfolioActionRiskDecisionPrice } from "./portfolioActionRiskDecisionPriceResolver.js";
import { portfolioExecutionRuleParametersSchema } from "./portfolioPolicyExecutionPreview.js";
import { riskRuleParameterRefFor } from "./runtimePolicyContracts.js";

/** Replays the stored fixed execution inputs; not current Risk permission or all-rule evaluation. */
export async function resolvePortfolioActionRiskDecisionExecution(input: { baseDir: string; riskDecisionId: string },
  options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
  const parsed = z.object({ baseDir: z.string().min(1), riskDecisionId: z.string().min(1) }).strict().parse(input);
  const resolved = await resolvePortfolioActionRiskDecisionPrice(parsed, { ...options });
  const origin = resolved.origin.executionOrigin;
  if (origin === null) throw new Error("risk decision lacks frozen execution inputs; legacy record requires review");
  assertRiskExecutionDecisionBinding(resolved.decision, origin);
  const rule = resolved.applicableRules.find(({ rule }) => rule.ruleId === "paper_execution" && rule.ruleVersion === "v1");
  if (rule === undefined || !isDeepStrictEqual(riskRuleParameterRefFor(rule.parameter), origin.executionParameterRef)) {
    throw new Error("risk execution parameter origin differs from selected policy");
  }
  const settings = portfolioExecutionRuleParametersSchema.parse(rule.parameter.parameters).markets[resolved.decision.market];
  const price = origin.preview.input.sourcePriceEvidence;
  if (settings === undefined || !isDeepStrictEqual(settings.executionPolicy, origin.preview.input.executionPolicy) ||
    settings.maximumPriceAgeSeconds !== origin.maximumPriceAgeSeconds || !settings.allowedPriceSourceContractIds.includes(price.sourceContractId) ||
    !isDeepStrictEqual(price, resolved.sourcePrice.record)) throw new Error("risk execution model or price does not match its original policy source");
  const target = resolved.action.executionTarget;
  const remainingQuantity = target.targetKind === "fractional_buy_notional" ? null
    : subtractCanonicalQuantities(target.targetQuantity, resolved.progress.cumulativeFilledQuantity);
  const remainingNotional = target.targetKind === "fractional_buy_notional"
    ? target.targetNotionalKrw - resolved.progress.cumulativeFilledNotionalKrw : Math.round(remainingQuantity! * price.priceKrw);
  if (origin.preview.input.quantityOverride !== remainingQuantity || origin.preview.input.requestedNotionalKrw !== remainingNotional ||
    origin.preview.input.executionPolicy.allowFractionalShares !== (target.targetKind !== "whole_share_quantity")) {
    throw new Error("risk execution input differs from remaining plan target");
  }
  await verifyRiskExecutionLiquidity(parsed.baseDir, origin);
  return Object.freeze({ ...resolved, executionOrigin: origin });
}
