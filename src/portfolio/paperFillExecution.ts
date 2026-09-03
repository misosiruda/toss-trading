import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
import {
  buildPaperFill,
  type PaperExecutionPolicy
} from "../paper/executionModel.js";
import {
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) => value === value.trim(),
    "identifier must already be canonical"
  );
const nonNegativeNumberSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const positiveNumberSchema = z
  .number()
  .finite()
  .positive()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const ratioSchema = nonNegativeNumberSchema.max(1);
const nullablePositiveSchema = positiveNumberSchema.nullable();
const nullableNonNegativeSchema = nonNegativeNumberSchema.nullable();

const sourcePriceEvidenceSchema = z
  .object({
    sourceContractId: identifierSchema,
    evidenceRef: identifierSchema,
    evidenceHash: sha256HashSchema,
    market: marketSchema,
    symbol: identifierSchema,
    priceField: z.literal("last_price"),
    observedAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const executionPolicySchema = z
  .object({
    modelVersion: identifierSchema,
    fillPriceRule: z.literal("current_candidate_last_price"),
    slippageBps: nonNegativeNumberSchema,
    feeBps: nonNegativeNumberSchema,
    taxBps: nonNegativeNumberSchema,
    halfSpreadBps: nonNegativeNumberSchema,
    fillRatio: positiveNumberSchema.max(1),
    allowFractionalShares: z.boolean(),
    maxVolumeParticipationRate: ratioSchema,
    minLiquidityFillRatio: ratioSchema,
    rejectStaleLiquidity: z.boolean(),
    marketImpactBpsPerParticipationRate: nonNegativeNumberSchema
  })
  .strict();

const costBreakdownSchema = z
  .object({
    feeKrw: nonNegativeNumberSchema,
    taxKrw: nonNegativeNumberSchema,
    slippageKrw: nonNegativeNumberSchema,
    spreadCostKrw: nonNegativeNumberSchema,
    impactCostKrw: nonNegativeNumberSchema,
    totalCostKrw: nonNegativeNumberSchema
  })
  .strict();

const paperFillExecutionPayloadSchema = z
  .object({
    portfolioId: identifierSchema,
    rebalancePlanId: identifierSchema,
    rebalanceActionId: identifierSchema,
    fillId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    side: z.enum(["BUY", "SELL"]),
    requestedNotionalKrw: positiveNumberSchema,
    requestedQuantity: positiveNumberSchema,
    quantityOverride: nullablePositiveSchema,
    sourcePriceKrw: positiveNumberSchema,
    sourcePriceEvidence: sourcePriceEvidenceSchema,
    averagePriceKrw: nullablePositiveSchema,
    fillPriceKrw: positiveNumberSchema,
    quantity: positiveNumberSchema,
    filledNotionalKrw: positiveNumberSchema,
    grossAmountKrw: positiveNumberSchema,
    netAmountKrw: nonNegativeNumberSchema,
    participationRate: ratioSchema.nullable(),
    volume: nullableNonNegativeSchema,
    averageVolume: nullableNonNegativeSchema,
    liquidityStale: z.boolean(),
    fillStatus: z.enum(["filled", "partial"]),
    liquidityStatus: z.enum(["not_modeled", "sufficient", "partial"]),
    liquidityRejectReason: z.null(),
    fractionalShares: z.boolean(),
    executionPolicy: executionPolicySchema,
    costBreakdown: costBreakdownSchema,
    evidenceRefs: z.array(identifierSchema).min(1).max(128),
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const paperFillExecutionInputSchema = paperFillExecutionPayloadSchema.safeExtend({
  createdAt: offsetQualifiedIsoDateTimeSchema
});

export const paperFillExecutionRecordSchema =
  paperFillExecutionPayloadSchema.safeExtend({
    paperFillRecordId: identifierSchema,
    paperFillHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  });

export type PaperFillExecutionRecord = z.infer<
  typeof paperFillExecutionRecordSchema
>;

export function createPaperFillExecutionRecord(
  input: z.input<typeof paperFillExecutionInputSchema>
): PaperFillExecutionRecord {
  const parsed = paperFillExecutionInputSchema.parse(
    canonicalizeEvidenceRefs(input)
  );
  const { createdAt, ...payload } = parsed;
  assertPaperFillExecutionPayload(payload, createdAt);
  const paperFillHash = hashCanonicalPayload(payload);
  return deepFreeze(
    paperFillExecutionRecordSchema.parse({
      ...payload,
      paperFillRecordId: hashDerivedId("paper_fill_execution", paperFillHash),
      paperFillHash,
      createdAt
    })
  );
}

export function parsePaperFillExecutionRecord(
  value: unknown
): PaperFillExecutionRecord {
  const record = paperFillExecutionRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) {
    throw new Error("paper fill execution record must already be canonical");
  }
  const { paperFillRecordId, paperFillHash, createdAt, ...payload } = record;
  assertPaperFillExecutionPayload(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    paperFillHash !== expectedHash ||
    paperFillRecordId !== hashDerivedId("paper_fill_execution", expectedHash)
  ) {
    throw new Error("paper fill execution identity does not match its payload");
  }
  return deepFreeze(record);
}

function assertPaperFillExecutionPayload(
  payload: z.infer<typeof paperFillExecutionPayloadSchema>,
  createdAt: string
): void {
  assertEvidence(payload);
  if (Date.parse(createdAt) < Date.parse(payload.asOf)) {
    throw new Error("paper fill execution cannot be created before asOf");
  }
  if (Date.parse(payload.sourcePriceEvidence.observedAt) > Date.parse(payload.asOf)) {
    throw new Error("paper fill source price cannot be observed after fill asOf");
  }
  if (
    payload.sourcePriceEvidence.market !== payload.market ||
    payload.sourcePriceEvidence.symbol !== payload.symbol
  ) {
    throw new Error("paper fill source price scope mismatch");
  }
  const expectedRequestedQuantity =
    payload.quantityOverride ??
    payload.requestedNotionalKrw /
      (payload.side === "BUY" ? payload.fillPriceKrw : payload.sourcePriceKrw);
  if (payload.requestedQuantity !== expectedRequestedQuantity) {
    throw new Error("paper fill requested quantity does not match execution input");
  }

  const policy: PaperExecutionPolicy = {
    fillPriceRule: payload.executionPolicy.fillPriceRule,
    slippageBps: payload.executionPolicy.slippageBps,
    feeBps: payload.executionPolicy.feeBps,
    taxBps: payload.executionPolicy.taxBps,
    halfSpreadBps: payload.executionPolicy.halfSpreadBps,
    fillRatio: payload.executionPolicy.fillRatio,
    allowFractionalShares: payload.executionPolicy.allowFractionalShares,
    maxVolumeParticipationRate:
      payload.executionPolicy.maxVolumeParticipationRate,
    minLiquidityFillRatio: payload.executionPolicy.minLiquidityFillRatio,
    rejectStaleLiquidity: payload.executionPolicy.rejectStaleLiquidity,
    marketImpactBpsPerParticipationRate:
      payload.executionPolicy.marketImpactBpsPerParticipationRate
  };
  const replay = buildPaperFill({
    action: payload.side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL",
    targetNotionalKrw:
      payload.requestedNotionalKrw / payload.executionPolicy.fillRatio,
    sourcePriceKrw: payload.sourcePriceKrw,
    ...(payload.averagePriceKrw === null
      ? {}
      : { averagePriceKrw: payload.averagePriceKrw }),
    ...(payload.quantityOverride === null
      ? {}
      : { quantityOverride: payload.quantityOverride }),
    ...(payload.volume === null ? {} : { volume: payload.volume }),
    ...(payload.averageVolume === null
      ? {}
      : { averageVolume: payload.averageVolume }),
    liquidityStale: payload.liquidityStale,
    policy
  });
  const replayProjection = {
    requestedNotionalKrw: replay.requestedNotionalKrw,
    sourcePriceKrw: replay.sourcePriceKrw,
    fillPriceKrw: replay.fillPriceKrw,
    quantity: replay.quantity,
    filledNotionalKrw: replay.filledNotionalKrw,
    grossAmountKrw: replay.grossAmountKrw,
    netAmountKrw: replay.netAmountKrw,
    participationRate: replay.participationRate ?? null,
    volume: replay.volume ?? null,
    averageVolume: replay.averageVolume ?? null,
    fillStatus: replay.fillStatus,
    liquidityStatus: replay.liquidityStatus,
    liquidityRejectReason: replay.liquidityRejectReason ?? null,
    fractionalShares: replay.fractionalShares,
    costBreakdown: {
      feeKrw: replay.feeKrw,
      taxKrw: replay.taxKrw,
      slippageKrw: replay.slippageKrw,
      spreadCostKrw: replay.spreadCostKrw,
      impactCostKrw: replay.impactCostKrw,
      totalCostKrw: replay.totalCostKrw
    }
  };
  const storedProjection = {
    requestedNotionalKrw: payload.requestedNotionalKrw,
    sourcePriceKrw: payload.sourcePriceKrw,
    fillPriceKrw: payload.fillPriceKrw,
    quantity: payload.quantity,
    filledNotionalKrw: payload.filledNotionalKrw,
    grossAmountKrw: payload.grossAmountKrw,
    netAmountKrw: payload.netAmountKrw,
    participationRate: payload.participationRate,
    volume: payload.volume,
    averageVolume: payload.averageVolume,
    fillStatus: payload.fillStatus,
    liquidityStatus: payload.liquidityStatus,
    liquidityRejectReason: payload.liquidityRejectReason,
    fractionalShares: payload.fractionalShares,
    costBreakdown: payload.costBreakdown
  };
  if (!isDeepStrictEqual(storedProjection, replayProjection)) {
    throw new Error("paper fill execution output does not match deterministic replay");
  }
}

function assertEvidence(
  payload: z.infer<typeof paperFillExecutionPayloadSchema>
): void {
  const canonical = [...payload.evidenceRefs].sort(compareText);
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1] === canonical[index]) {
      throw new Error("paper fill evidence refs must not contain duplicates");
    }
  }
  if (!isDeepStrictEqual(payload.evidenceRefs, canonical)) {
    throw new Error("paper fill evidence refs must use canonical order");
  }
  if (!payload.evidenceRefs.includes(payload.sourcePriceEvidence.evidenceRef)) {
    throw new Error("paper fill evidence refs must include source price evidence");
  }
}

function canonicalizeEvidenceRefs(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.evidenceRefs)) {
    return value;
  }
  const evidenceRefs = z.array(identifierSchema).parse(candidate.evidenceRefs);
  return { ...candidate, evidenceRefs: [...evidenceRefs].sort(compareText) };
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
