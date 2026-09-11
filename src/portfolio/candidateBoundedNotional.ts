import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION } from "./candidateNotionalSizingPolicy.js";
import { resolveCandidateSizingInputRequestBinding } from "./candidateSizingInput.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { hashCanonicalPayload, parseBucketSelectionPolicyRecord, selectionPolicyRefFor } from "./runtimePolicyContracts.js";

const inputSchema = z.object({ policy: z.unknown(), selectionPolicy: z.unknown(), request: z.unknown(), sizingInput: z.unknown() }).strict();
const UNIT = canonicalQuantityUnits(1);

/** Policy-bound initial BUY notional arithmetic. Supplied caps are not current shared-capacity authority. */
export function calculateCandidateBoundedNotional(value: unknown) {
  const raw = inputSchema.parse(value);
  const policy = parseRuntimePortfolioPolicyRecord(raw.policy), selectionPolicy = parseBucketSelectionPolicyRecord(raw.selectionPolicy);
  const { request, sizingInput } = resolveCandidateSizingInputRequestBinding(raw);
  const input = freeze({ policy, selectionPolicy, request, sizingInput });
  if (!isDeepStrictEqual(input, value)) throw new Error("candidate bounded notional input must already be canonical");
  const bucket = policy.strategyBuckets.find((item) => item.bucket === request.bucket);
  const model = selectionPolicy.notionalSizingPolicy;
  if (!bucket || selectionPolicy.bucket !== request.bucket || !isDeepStrictEqual(bucket.selectionPolicyRef, selectionPolicyRefFor(selectionPolicy)) ||
    policy.policyHash !== request.policyHash || policy.portfolioId !== request.portfolioId || !bucket.enabledMarkets.includes(sizingInput.market) ||
    Date.parse(selectionPolicy.createdAt) > Date.parse(policy.createdAt) || Date.parse(policy.createdAt) > Date.parse(request.asOf)) {
    throw new Error("candidate bounded notional policy scope or chronology mismatch");
  }
  if (model?.modelVersion !== CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION || sizingInput.sizingAlgorithmVersion !== model.modelVersion ||
    sizingInput.scoringModelVersion !== selectionPolicy.scoringModelVersion) throw new Error("candidate bounded notional requires exact policy-selected model versions");
  if (sizingInput.executionCostInput.side !== "BUY" || sizingInput.selectionScore < 0 || sizingInput.selectionScore > 1) {
    throw new Error("candidate bounded notional requires BUY and a normalized score");
  }
  // Preserve canonical decimal interpolation exactly, including subnormal multipliers; floor only at the explicit KRW boundaries.
  const score = canonicalQuantityUnits(sizingInput.selectionScore);
  const minimum = canonicalQuantityUnits(model.minimumScoreMultiplier), maximum = canonicalQuantityUnits(model.maximumScoreMultiplier);
  const multiplierNumerator = minimum * UNIT + (maximum - minimum) * score;
  const multiplierDenominator = UNIT * UNIT;
  const baseNotionalKrw = Number(BigInt(request.gapKrw) / BigInt(request.availableSlots));
  const uncapped = BigInt(baseNotionalKrw) * multiplierNumerator / multiplierDenominator;
  const caps = freeze({ ...sizingInput.exposureCapInputs, liquidityKrw: sizingInput.liquidityInput.maximumLiquidityNotionalKrw,
    requestGapKrw: request.gapKrw, requestAdditionalExposureKrw: request.maximumAdditionalExposureKrw });
  const capped = Object.values(caps).reduce((remaining, cap) => BigInt(cap) < remaining ? BigInt(cap) : remaining, uncapped);
  const minimumMet = capped >= BigInt(model.minimumOrderNotionalKrw);
  const initialMaximumNotionalKrw = minimumMet ? Number(capped) : 0;
  const payload = freeze({ input, inputHash: hashCanonicalPayload(input), modelVersion: model.modelVersion,
    baseNotionalKrw, scoreMultiplier: { numerator: multiplierNumerator.toString(), denominator: multiplierDenominator.toString() },
    uncappedNotionalKrw: uncapped.toString(), caps, cappedNotionalKrw: Number(capped), minimumOrderNotionalKrw: model.minimumOrderNotionalKrw,
    initialMaximumNotionalKrw, reasonCodes: [capped === 0n ? "zero_notional" : minimumMet ? "initial_notional_available" : "below_minimum_order_notional"],
    verificationScope: "policy_bound_initial_notional_arithmetic_only" as const,
    rounding: "floor_base_then_exact_decimal_multiplier_then_floor_krw" as const,
    declaredCapAuthority: "not_verified" as const, costBenefitAndWeightBand: "not_evaluated" as const,
    sharedCapacityReservation: "not_performed" as const, currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
  return freeze({ ...payload, calculationHash: hashCanonicalPayload(payload) });
}
export function parseCandidateBoundedNotional(value: unknown) {
  const { input } = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = calculateCandidateBoundedNotional(input);
  if (!isDeepStrictEqual(expected, value)) throw new Error("candidate bounded notional complete replay mismatch");
  return expected;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
