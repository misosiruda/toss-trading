import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { buildVersionedPaperFill } from "../paper/versionedExecutionModel.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { paperFillExecutionPolicySchema } from "./paperFillExecution.js";
import { parseSourcePriceEvidenceRecord, sourcePriceEvidenceRecordSchema } from "./sourcePriceEvidence.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const nonNegative = z.number().finite().nonnegative().refine((value) => !Object.is(value, -0), "negative zero is not canonical");
const quantity = nonNegative.positive().max(Number.MAX_SAFE_INTEGER);
export const portfolioActionExecutionPreviewInputSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  requestedNotionalKrw: nonNegative.int().positive().max(Number.MAX_SAFE_INTEGER),
  quantityOverride: quantity.nullable(),
  sourcePriceEvidence: sourcePriceEvidenceRecordSchema,
  executionPolicy: paperFillExecutionPolicySchema,
  volume: nonNegative.max(Number.MAX_SAFE_INTEGER).nullable(),
  averageVolume: nonNegative.max(Number.MAX_SAFE_INTEGER).nullable(),
  liquidityStale: z.boolean(),
  asOf: offsetQualifiedIsoDateTimeSchema
}).strict();

/** Pure model replay before Risk or fill persistence. Neither source provenance nor execution authority. */
export function createPortfolioActionExecutionPreview(value: z.input<typeof portfolioActionExecutionPreviewInputSchema>) {
  const input = portfolioActionExecutionPreviewInputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("execution preview input must already be canonical");
  const price = parseSourcePriceEvidenceRecord(input.sourcePriceEvidence);
  if (Date.parse(price.observedAt) > Date.parse(input.asOf) || Date.parse(price.createdAt) > Date.parse(input.asOf)) {
    throw new Error("execution preview price postdates evaluation cutoff");
  }
  if (input.quantityOverride !== null && !input.executionPolicy.allowFractionalShares && !Number.isSafeInteger(input.quantityOverride)) {
    throw new Error("whole-share execution preview cannot accept a fractional quantity override");
  }
  const targetNotionalKrw = input.requestedNotionalKrw / input.executionPolicy.fillRatio;
  if (!Number.isFinite(targetNotionalKrw)) throw new Error("execution preview target is not representable");
  // requestedNotional is the post-fillRatio request, matching persisted fill replay.
  const fill = buildVersionedPaperFill({ action: input.side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL",
    targetNotionalKrw, sourcePriceKrw: price.priceKrw, policy: input.executionPolicy,
    ...(input.quantityOverride === null ? {} : { quantityOverride: input.quantityOverride }),
    ...(input.volume === null ? {} : { volume: input.volume }),
    ...(input.averageVolume === null ? {} : { averageVolume: input.averageVolume }), liquidityStale: input.liquidityStale }, input.executionPolicy.modelVersion);
  if (fill.requestedNotionalKrw !== input.requestedNotionalKrw) throw new Error("execution preview request notional differs from quantity input");
  if (!Number.isSafeInteger(fill.fillPriceKrw) || fill.fillPriceKrw <= 0) throw new Error("execution preview fill price is not a positive safe integer");
  const requestedQuantity = input.quantityOverride ?? input.requestedNotionalKrw / (input.side === "BUY" ? fill.fillPriceKrw : price.priceKrw);
  const requestedUnits = canonicalQuantityUnits(requestedQuantity);
  if (requestedUnits === 0n || canonicalQuantityUnits(fill.quantity) > requestedUnits) throw new Error("execution preview quantity exceeds its request");
  if (!input.executionPolicy.allowFractionalShares && !Number.isSafeInteger(fill.quantity)) {
    throw new Error("whole-share execution preview cannot produce a fractional fill");
  }
  const costBreakdown = { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw,
    spreadCostKrw: fill.spreadCostKrw, impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw };
  if (![fill.grossAmountKrw, fill.filledNotionalKrw, fill.netAmountKrw, ...Object.values(costBreakdown)]
    .every((amount) => Number.isSafeInteger(amount) && amount >= 0 && !Object.is(amount, -0))) {
    throw new Error("execution preview amounts exceed safe integer range");
  }
  if (fill.participationRate !== undefined && (!Number.isFinite(fill.participationRate) || fill.participationRate < 0 || fill.participationRate > 1)) {
    throw new Error("execution preview participation is outside the supported range");
  }
  if (fill.fillStatus !== "rejected" && (fill.quantity <= 0 || fill.grossAmountKrw <= 0 ||
    (input.liquidityStale && input.executionPolicy.rejectStaleLiquidity))) {
    throw new Error("execution preview cannot accept a zero or stale modeled fill");
  }
  const payload = { schemaVersion: "portfolio_action_execution_preview.v1" as const, input,
    executionInputHash: hashCanonicalPayload(input), requestedQuantity,
    execution: { fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity, filledNotionalKrw: fill.filledNotionalKrw,
      grossAmountKrw: fill.grossAmountKrw, netAmountKrw: fill.netAmountKrw, participationRate: fill.participationRate ?? null,
      fillStatus: fill.fillStatus, liquidityStatus: fill.liquidityStatus, liquidityRejectReason: fill.liquidityRejectReason ?? null, costBreakdown } };
  const executionPreviewHash = hashCanonicalPayload(payload);
  return deepFreeze({ ...payload, executionPreviewHash, executionPreviewId: hashDerivedId("portfolio_execution_preview", executionPreviewHash) });
}

export type PortfolioActionExecutionPreview = ReturnType<typeof createPortfolioActionExecutionPreview>;

/** Rebuild every quantity, cost and hash instead of accepting self-consistent stored totals. */
export function parsePortfolioActionExecutionPreview(value: unknown): PortfolioActionExecutionPreview {
  if (value === null || typeof value !== "object" || !("input" in value)) throw new Error("execution preview must contain its complete input");
  const replayed = createPortfolioActionExecutionPreview(portfolioActionExecutionPreviewInputSchema.parse(value.input));
  if (!isDeepStrictEqual(value, replayed)) throw new Error("execution preview differs from deterministic replay");
  return replayed;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
