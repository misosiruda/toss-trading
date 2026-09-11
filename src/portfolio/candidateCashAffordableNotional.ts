import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { calculateCandidateDailyCostBasis, CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION } from "./candidateDailyCostBasis.js";
import { calculateCandidateExecutionCost } from "./candidateExecutionCost.js";
import { parseCandidateInitialExecutionCost } from "./candidateInitialExecutionCost.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const inputSchema = z.object({ costRepricing: z.unknown() }).strict();

/** Maximum integer initial notional including its own cost, within a declared cash upper bound. */
export function calculateCandidateCashAffordableNotional(value: unknown) {
  const raw = inputSchema.parse(value);
  const costRepricing = parseCandidateInitialExecutionCost(raw.costRepricing);
  const input = Object.freeze({ costRepricing });
  if (!isDeepStrictEqual(input, value)) throw new Error("candidate cash sizing input must already be canonical");
  const initial = costRepricing.input.boundedNotional;
  const cashBudgetKrw = initial.input.sizingInput.exposureCapInputs.cashAvailableKrw;
  const ceiling = BigInt(initial.initialMaximumNotionalKrw), budget = BigInt(cashBudgetKrw);
  const evaluate = (notional: bigint) => {
    const costBasis = calculateCandidateDailyCostBasis({ modelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
      liquidity: costRepricing.input.dailyLiquidity, referenceNotionalKrw: Number(notional) });
    const cost = calculateCandidateExecutionCost({ ...costRepricing.cost.input, ...costBasis.costBasis });
    return Object.freeze({ costBasis, cost, requiredCashKrw: (notional + BigInt(cost.estimatedCostKrw)).toString() });
  };
  // The selected v1 estimator has nonnegative rates and monotone participation/ceilings.
  // Search integer KRW, not floating point ratios. An upper midpoint guarantees progress.
  let low = 0n, high = ceiling, searchIterations = 0;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (BigInt(evaluate(middle).requiredCashKrw) <= budget) low = middle;
    else high = middle - 1n;
    searchIterations++;
  }
  const minimum = BigInt(initial.minimumOrderNotionalKrw);
  const maximumNotionalKrw = low >= minimum ? Number(low) : 0;
  const pricing = evaluate(BigInt(maximumNotionalKrw));
  const nextRequiredCashKrw = low < ceiling ? evaluate(low + 1n).requiredCashKrw : null;
  const payload = Object.freeze({ input, inputHash: hashCanonicalPayload(input),
    modelVersion: "candidate_cash_affordable_notional.v1" as const,
    initialMaximumNotionalKrw: Number(ceiling), cashBudgetKrw, minimumOrderNotionalKrw: Number(minimum),
    affordableBeforeMinimumKrw: Number(low), maximumNotionalKrw, searchIterations, pricing, nextRequiredCashKrw,
    reasonCode: ceiling === 0n ? "initial_notional_zero" : low < minimum ? "cash_budget_below_minimum_notional"
      : low < ceiling ? "cash_adjusted" : "initial_notional_affordable",
    verificationScope: "declared_cash_initial_notional_search_only" as const,
    cashCapacityAuthority: "not_verified" as const, costBenefitAndWeightBand: "not_evaluated" as const,
    sharedCapacityReservation: "not_performed" as const, currentExecutionAuthority: "not_granted" as const,
    finalSizing: "not_performed" as const });
  return Object.freeze({ ...payload, calculationHash: hashCanonicalPayload(payload) });
}

export function parseCandidateCashAffordableNotional(value: unknown) {
  const { input } = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = calculateCandidateCashAffordableNotional(input);
  if (!isDeepStrictEqual(expected, value)) throw new Error("candidate cash sizing complete replay mismatch");
  return expected;
}
