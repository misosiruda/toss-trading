import { z } from "zod";
import { parsePortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";

/** Necessary policy ceiling for the claimed assessment, not proof of current turnover state or execution authority. */
export function validateRiskDecisionTurnoverCapacity(value: { decision: unknown; policy: unknown }) {
  const input = z.object({ decision: z.unknown(), policy: z.unknown() }).strict().parse(value);
  const decision = parsePortfolioActionRiskDecision(input.decision);
  const policy = parseRuntimePortfolioPolicyRecord(input.policy);
  if (decision.portfolioId !== policy.portfolioId || decision.policyHash !== policy.policyHash) {
    throw new Error("risk turnover capacity scope does not match policy");
  }
  if (decision.riskRuleScope.scopeKind === "legacy_reduce_only") return null;
  const bucket = decision.riskRuleScope.bucket;
  const selected = policy.strategyBuckets.find((entry) => entry.bucket === bucket);
  if (selected === undefined || !selected.enabledMarkets.includes(decision.market) || decision.turnoverAssessment.scopeKind !== "bucket") {
    throw new Error("risk turnover capacity bucket or market mismatch");
  }
  const assessment = decision.turnoverAssessment;
  const denominator = assessment.turnoverWindowOpenPortfolioNetWorthKrw;
  const prior = assessment.priorBucketTurnoverNotionalKrw;
  const requested = assessment.requestedBucketTurnoverNotionalKrw;
  for (const amount of [denominator, prior, requested]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || Object.is(amount, -0)) {
      throw new Error("risk turnover capacity requires safe integer KRW inputs");
    }
  }
  const resulting = BigInt(prior) + BigInt(requested);
  if (resulting > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("risk turnover cumulative amount exceeds safe integer range");
  // Floor the exact canonical decimal policy ratio, without a floating-point allowance at the cap.
  const maximum = BigInt(denominator) * canonicalQuantityUnits(selected.maxTurnoverRatio) / canonicalQuantityUnits(1);
  const withinTurnoverLimit = resulting <= maximum;
  if (decision.decision === "approved" && !withinTurnoverLimit) throw new Error("risk approval exceeds policy turnover capacity");
  return Object.freeze({ bucket, maxTurnoverRatio: selected.maxTurnoverRatio,
    maximumCumulativeTurnoverNotionalKrw: Number(maximum), remainingTurnoverNotionalKrw: Number(resulting < maximum ? maximum - resulting : 0n),
    resultingCumulativeTurnoverNotionalKrw: Number(resulting), withinTurnoverLimit });
}
