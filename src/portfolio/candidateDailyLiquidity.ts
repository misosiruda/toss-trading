import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { parseMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

/** Daily-bar last-price notional proxy, not actual traded value or complete calendar coverage. */
export const CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION = "candidate_daily_bar_liquidity.v1";
const inputSchema = z.object({ modelVersion: z.literal(CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION),
  evidence: z.unknown(), maximumParticipationRatio: z.number().finite().min(0).max(1)
    .refine((value) => !Object.is(value, -0)) }).strict();
const UNIT = canonicalQuantityUnits(1);

/** Pure replay of supplied evidence. Storage/provider and policy authority belong to the caller's resolver. */
export function calculateCandidateDailyLiquidity(value: unknown) {
  const parsed = inputSchema.parse(value);
  if (!isDeepStrictEqual(parsed, value)) throw new Error("candidate liquidity input must already be canonical");
  const evidence = parseMarketTechnicalCandidateEvidenceRecord(parsed.evidence);
  if (evidence.calculationInput.interval !== "1d") throw new Error("candidate daily liquidity requires daily bars");
  const snapshots = evidence.calculationInput.snapshots;
  const total = snapshots.reduce((sum, bar) => sum + BigInt(bar.lastPriceKrw) * BigInt(bar.volume!), 0n);
  // Floor the daily proxy first, then floor its policy participation cap. Never round a cap upward.
  const average = total / BigInt(snapshots.length);
  const cap = average * canonicalQuantityUnits(parsed.maximumParticipationRatio) / UNIT;
  const input = Object.freeze({ ...parsed, evidence });
  const liquidityInput = Object.freeze({ averageDailyNotionalKrw: Number(average),
    maximumParticipationRatio: parsed.maximumParticipationRatio, maximumLiquidityNotionalKrw: Number(cap),
    evidenceRefs: Object.freeze([evidence.evidenceRef]) });
  const payload = Object.freeze({ input, inputHash: hashCanonicalPayload(input),
    verificationScope: "daily_bar_notional_proxy_only" as const,
    rounding: "floor_mean_then_floor_canonical_decimal_cap_krw" as const,
    observationCount: snapshots.length, liquidityInput });
  return Object.freeze({ ...payload, outputHash: hashCanonicalPayload(payload) });
}

/** Recompute the full output, including the underlying evidence; a rehashed wrong cap is still invalid. */
export function parseCandidateDailyLiquidity(value: unknown) {
  const record = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = calculateCandidateDailyLiquidity(record.input);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate daily liquidity complete payload or calculation replay mismatch");
  return expected;
}
