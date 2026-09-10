import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { strategyBucketSchema } from "../domain/schemas.js";
import { CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION, parseCandidatePacketClassification } from "./candidatePacketClassification.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { hashCanonicalPayload, parseBucketSelectionPolicyRecord, selectionPolicyRefFor } from "./runtimePolicyContracts.js";

export const CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION = "candidate_position_exposure_bounds.v1";
const inputSchema = z.object({ modelVersion: z.literal(CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION),
  policy: z.unknown(), selectionPolicy: z.unknown(), snapshot: z.unknown(), classification: z.unknown(), bucket: strategyBucketSchema }).strict();
const UNIT = canonicalQuantityUnits(1);

/** Position-only upper bounds. Pending buys, opening reservations and final allocation need separate verification. */
export function calculateCandidatePositionExposureBounds(value: unknown) {
  const parsed = inputSchema.parse(value);
  const policy = parseRuntimePortfolioPolicyRecord(parsed.policy);
  const selectionPolicy = parseBucketSelectionPolicyRecord(parsed.selectionPolicy);
  const { snapshot } = resolvePortfolioSizingSnapshot(parsed.snapshot);
  const classification = parseCandidatePacketClassification(parsed.classification);
  const input = Object.freeze({ ...parsed, policy, selectionPolicy, snapshot, classification });
  if (!isDeepStrictEqual(input, value)) throw new Error("candidate exposure bounds input must already be canonical");
  const bucketPolicy = policy.strategyBuckets.find((item) => item.bucket === parsed.bucket)!;
  const selected = selectionPolicy.exposureLimitPolicy;
  if (selectionPolicy.bucket !== parsed.bucket || !isDeepStrictEqual(bucketPolicy.selectionPolicyRef, selectionPolicyRefFor(selectionPolicy)) ||
    selected?.modelVersion !== CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION ||
    selectionPolicy.classificationModelVersion !== CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION) {
    throw new Error("candidate exposure bounds require exact policy-selected models and parameters");
  }
  const { market, symbol, packet } = classification.input;
  if (!bucketPolicy.enabledMarkets.includes(market) || snapshot.policyHash !== policy.policyHash ||
    snapshot.portfolioId !== policy.portfolioId || packet.virtualPortfolio.portfolioId !== policy.portfolioId ||
    Date.parse(selectionPolicy.createdAt) > Date.parse(policy.createdAt) || Date.parse(policy.createdAt) > Date.parse(snapshot.asOf) ||
    Date.parse(classification.generatedAt) > Date.parse(snapshot.asOf) || Date.parse(classification.expiresAt) <= Date.parse(snapshot.asOf) ||
    Date.parse(classification.staleAfter) <= Date.parse(snapshot.asOf)) {
    throw new Error("candidate exposure bounds scope or chronology mismatch");
  }
  const exposure = snapshot.exposureSnapshot, keys = classification.exposureKeys;
  const amount = (ratio: number, currentExposureKrw: number) => {
    // Floor the exact canonical decimal ratio product; never round a maximum upward.
    const limitKrw = Number(BigInt(exposure.virtualNetWorthKrw) * canonicalQuantityUnits(ratio) / UNIT);
    return Object.freeze({ limitKrw, currentExposureKrw, remainingKrw: Math.max(0, limitKrw - currentExposureKrw) });
  };
  const dimensions = Object.freeze({
    bucket: amount(bucketPolicy.maxWeightRatio, exposure.bucketExposureKrw[parsed.bucket]),
    symbol: amount(policy.exposurePolicy.maxSymbolExposureRatio,
      exposure.symbolExposureKrw.find((item) => item.market === market && item.symbol === symbol)?.exposureKrw ?? 0),
    sector: amount(selected.maximumSectorExposureRatio, exposure.sectorExposureKrw[keys.sector] ?? 0),
    country: amount(policy.exposurePolicy.maxCountryExposureRatio, exposure.countryExposureKrw[keys.country] ?? 0),
    currency: amount(policy.exposurePolicy.maxCurrencyExposureRatio, exposure.currencyExposureKrw[keys.currency] ?? 0)
  });
  const positionUpperBounds = Object.freeze({ bucketRemainingKrw: dimensions.bucket.remainingKrw,
    symbolRemainingKrw: dimensions.symbol.remainingKrw, sectorRemainingKrw: dimensions.sector.remainingKrw,
    countryRemainingKrw: dimensions.country.remainingKrw, currencyRemainingKrw: dimensions.currency.remainingKrw });
  const payload = Object.freeze({ input, inputHash: hashCanonicalPayload(input), dimensions, positionUpperBounds,
    verificationScope: "position_exposure_upper_bounds_only" as const,
    sectorLimitMeaning: "selection_policy_ceiling_on_portfolio_wide_sector" as const,
    rounding: "canonical_decimal_floor_krw" as const,
    pendingBuyExposureKrw: exposure.pendingBuyExposureKrw, pendingSellExposureKrw: exposure.pendingSellExposureKrw,
    pendingAndReservationAuthority: "not_verified" as const, finalSizing: "not_performed" as const });
  return Object.freeze({ ...payload, calculationHash: hashCanonicalPayload(payload) });
}

export function parseCandidatePositionExposureBounds(value: unknown) {
  const record = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = calculateCandidatePositionExposureBounds(record.input);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate exposure bounds complete payload replay mismatch");
  return expected;
}
