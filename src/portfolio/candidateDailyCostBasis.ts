import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { parseCandidateDailyLiquidity } from "./candidateDailyLiquidity.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

/** Participation in the selected daily-bar proxy, not realized fill participation or final sizing. */
export const CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION = "candidate_daily_liquidity_cost_basis.v1";
const inputSchema = z.object({ modelVersion: z.literal(CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION),
  liquidity: z.unknown(), referenceNotionalKrw: z.number().finite().nonnegative().refine(Number.isSafeInteger)
    .refine((value) => !Object.is(value, -0)) }).strict();
const UNIT = canonicalQuantityUnits(1);

/** Replays supplied daily liquidity and bounds the declared notional; does not choose the notional. */
export function calculateCandidateDailyCostBasis(value: unknown) {
  const parsed = inputSchema.parse(value);
  if (!isDeepStrictEqual(parsed, value)) throw new Error("candidate daily cost basis input must already be canonical");
  const liquidity = parseCandidateDailyLiquidity(parsed.liquidity);
  const { averageDailyNotionalKrw, maximumLiquidityNotionalKrw, evidenceRefs } = liquidity.liquidityInput;
  if (parsed.referenceNotionalKrw > maximumLiquidityNotionalKrw) throw new Error("candidate reference notional exceeds daily liquidity cap");
  const participationRate = conservativeParticipation(parsed.referenceNotionalKrw, averageDailyNotionalKrw);
  const input = Object.freeze({ ...parsed, liquidity });
  const costBasis = Object.freeze({ referenceNotionalKrw: parsed.referenceNotionalKrw, participationRate, evidenceRefs });
  const payload = Object.freeze({ input, inputHash: hashCanonicalPayload(input),
    verificationScope: "daily_liquidity_cost_basis_only" as const,
    rounding: "nearest_number_then_next_up_if_canonical_decimal_below_ratio" as const, costBasis });
  return Object.freeze({ ...payload, outputHash: hashCanonicalPayload(payload) });
}

export function parseCandidateDailyCostBasis(value: unknown) {
  const record = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = calculateCandidateDailyCostBasis(record.input);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate daily cost basis complete payload or calculation replay mismatch");
  return expected;
}

function conservativeParticipation(notional: number, dailyNotional: number): number {
  if (notional === 0) return 0; // Includes a zero-liquidity, zero-reference diagnostic; no positive notional is allowed.
  if (dailyNotional <= 0) throw new Error("positive candidate notional requires positive daily liquidity");
  const numerator = BigInt(notional) * UNIT, denominator = BigInt(dailyNotional);
  let ratio = notional / dailyNotional;
  if (canonicalQuantityUnits(ratio) * denominator < numerator) {
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, ratio);
    bits.setBigUint64(0, bits.getBigUint64(0) + 1n);
    ratio = bits.getFloat64(0);
  }
  if (ratio > 1 || canonicalQuantityUnits(ratio) * denominator < numerator) {
    throw new Error("candidate daily participation cannot be represented conservatively");
  }
  return ratio;
}
