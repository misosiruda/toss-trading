import { parsePortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";

/**
 * Necessary BUY cash bound from stored inputs, not a complete Risk evaluation or
 * reservation authority. Pending gross debits are never released by caller IDs;
 * their cost bounds and reservation origins still require execution-time replay.
 */
export function validateRiskDecisionCashCapacity(input: {
  decision: unknown;
  snapshot: unknown;
  policy: unknown;
}) {
  const decision = parsePortfolioActionRiskDecision(input.decision);
  const { snapshot } = resolvePortfolioSizingSnapshot(input.snapshot);
  const policy = parseRuntimePortfolioPolicyRecord(input.policy);
  if (decision.portfolioId !== policy.portfolioId || snapshot.portfolioId !== policy.portfolioId ||
    decision.policyHash !== policy.policyHash || snapshot.policyHash !== policy.policyHash ||
    decision.expectedPortfolioVersion !== snapshot.portfolioVersion ||
    decision.expectedPortfolioSnapshotHash !== snapshot.portfolioSnapshotHash) {
    throw new Error("risk cash capacity scope does not match policy and snapshot");
  }
  if (decision.cashAssessment.side === "SELL") return null;
  const { cashKrw, virtualNetWorthKrw, pendingBuyExposureKrw } = snapshot.exposureSnapshot;
  // Match PortfolioGapAnalyzer's integer-KRW reserve convention.
  const requiredCashReserveKrw = Math.max(policy.cashPolicy.minimumCashReserveKrw,
    Math.round(virtualNetWorthKrw * policy.cashPolicy.targetCashRatio));
  for (const amount of [cashKrw, requiredCashReserveKrw, pendingBuyExposureKrw]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || Object.is(amount, -0)) {
      throw new Error("risk cash capacity requires nonnegative safe integer KRW inputs");
    }
  }
  // Saturate each subtraction; never add reserves and overflow safe integer KRW.
  const maximumNetCashDebitKrw = Math.max(0, Math.max(0, cashKrw - requiredCashReserveKrw) - pendingBuyExposureKrw);
  if (decision.decision === "approved") {
    const cash = decision.cashAssessment;
    if (![cash.worstCaseNetCashDebitKrw, cash.approvedMaximumNetCashDebitKrw]
      .every((amount) => Number.isSafeInteger(amount) && amount >= 0 && !Object.is(amount, -0))) {
      throw new Error("risk BUY approval requires safe integer net cash amounts");
    }
    if (cash.worstCaseNetCashDebitKrw > maximumNetCashDebitKrw ||
      cash.approvedMaximumNetCashDebitKrw > maximumNetCashDebitKrw) {
      throw new Error("risk BUY approval exceeds snapshot cash capacity");
    }
  }
  return Object.freeze({
    cashKrw, requiredCashReserveKrw, pendingBuyExposureKrw, maximumNetCashDebitKrw
  });
}
