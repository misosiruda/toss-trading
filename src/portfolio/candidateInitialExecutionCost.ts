import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseCandidateBoundedNotional } from "./candidateBoundedNotional.js";
import { calculateCandidateDailyCostBasis, CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION } from "./candidateDailyCostBasis.js";
import { parseCandidateDailyLiquidity, CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION } from "./candidateDailyLiquidity.js";
import { calculateCandidateExecutionCost, CANDIDATE_EXECUTION_COST_MODEL_VERSION, replayCandidateSizingExecutionCost } from "./candidateExecutionCost.js";
import { resolveMarketTechnicalCandidateSizingFeatures } from "./marketTechnicalCandidateEvidence.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const inputSchema = z.object({ boundedNotional: z.unknown(), dailyLiquidity: z.unknown() }).strict();

/** Reprice the initial amount, not the earlier declared cost basis. No fill or cost/benefit approval. */
export function calculateCandidateInitialExecutionCost(value: unknown) {
  const raw = inputSchema.parse(value);
  const boundedNotional = parseCandidateBoundedNotional(raw.boundedNotional);
  const dailyLiquidity = parseCandidateDailyLiquidity(raw.dailyLiquidity);
  const input = Object.freeze({ boundedNotional, dailyLiquidity });
  if (!isDeepStrictEqual(input, value)) throw new Error("candidate initial cost input must already be canonical");
  const { sizingInput, selectionPolicy } = boundedNotional.input;
  if (selectionPolicy.costEstimationModelVersion !== CANDIDATE_EXECUTION_COST_MODEL_VERSION ||
    selectionPolicy.costBasisModelVersion !== CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION ||
    selectionPolicy.liquidityEstimationModelVersion !== CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION) {
    throw new Error("candidate initial cost requires exact policy-selected models");
  }
  resolveMarketTechnicalCandidateSizingFeatures({ sizingInput, evidence: dailyLiquidity.input.evidence });
  if (!isDeepStrictEqual(sizingInput.liquidityInput, dailyLiquidity.liquidityInput) ||
    dailyLiquidity.input.maximumParticipationRatio !== sizingInput.executionCostInput.maxVolumeParticipationRate) {
    throw new Error("candidate initial cost liquidity input or participation cap mismatch");
  }
  const priorCost = replayCandidateSizingExecutionCost(sizingInput).calculation;
  const priorBasis = calculateCandidateDailyCostBasis({ modelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
    liquidity: dailyLiquidity, referenceNotionalKrw: priorCost.input.referenceNotionalKrw });
  if (!isDeepStrictEqual(priorBasis.costBasis, { referenceNotionalKrw: priorCost.input.referenceNotionalKrw,
    participationRate: priorCost.input.participationRate, evidenceRefs: priorCost.input.evidenceRefs })) {
    throw new Error("candidate initial cost prior basis differs from liquidity replay");
  }
  const costBasis = calculateCandidateDailyCostBasis({ modelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
    liquidity: dailyLiquidity, referenceNotionalKrw: boundedNotional.initialMaximumNotionalKrw });
  const cost = calculateCandidateExecutionCost({ ...priorCost.input, ...costBasis.costBasis });
  const requiredCash = BigInt(cost.input.referenceNotionalKrw) + BigInt(cost.estimatedCostKrw);
  const payload = Object.freeze({ input, inputHash: hashCanonicalPayload(input),
    modelVersion: "candidate_initial_notional_cost.v1" as const, priorCostOutputHash: priorCost.outputHash,
    costBasis, cost, requiredCashKrw: requiredCash.toString(),
    fitsDeclaredCash: requiredCash <= BigInt(sizingInput.exposureCapInputs.cashAvailableKrw),
    verificationScope: "initial_notional_cost_repricing_only" as const,
    declaredCashAuthority: "not_verified" as const, costBenefitThreshold: "not_evaluated" as const,
    amountAdjustment: "not_performed" as const, currentExecutionAuthority: "not_granted" as const,
    finalSizing: "not_performed" as const });
  return Object.freeze({ ...payload, calculationHash: hashCanonicalPayload(payload) });
}

export function parseCandidateInitialExecutionCost(value: unknown) {
  const { input } = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = calculateCandidateInitialExecutionCost(input);
  if (!isDeepStrictEqual(expected, value)) throw new Error("candidate initial cost complete replay mismatch");
  return expected;
}
