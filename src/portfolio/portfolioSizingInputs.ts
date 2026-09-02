import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  marketSchema,
  sha256HashSchema
} from "../domain/schemas.js";
import {
  compareText,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const canonicalIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => value === value.trim(),
    "identifier must already be canonical"
  )
  .refine(
    (value) => !containsLoneSurrogate(value),
    "identifier must use well-formed Unicode"
  );
const positiveAmountSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "amount must be a safe integer");
const positiveNumberSchema = z.number().finite().positive();

const markPriceValuationInputSchema = z
  .object({
    kind: z.literal("mark_price"),
    market: marketSchema,
    symbol: canonicalIdentifierSchema,
    priceKrw: positiveNumberSchema,
    evidenceRef: canonicalIdentifierSchema,
    evidenceAsOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const fxRateValuationInputSchema = z
  .object({
    kind: z.literal("fx_rate"),
    baseCurrency: canonicalIdentifierSchema,
    quoteCurrency: z.literal("KRW"),
    rate: positiveNumberSchema,
    evidenceRef: canonicalIdentifierSchema,
    evidenceAsOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const portfolioValuationInputSchema = z.discriminatedUnion("kind", [
  markPriceValuationInputSchema,
  fxRateValuationInputSchema
]);

const pendingActionBaseSchema = z
  .object({
    planId: canonicalIdentifierSchema,
    planHash: sha256HashSchema,
    planEventId: canonicalIdentifierSchema,
    planEventHash: sha256HashSchema,
    actionId: canonicalIdentifierSchema,
    actionExecutionTargetHash: sha256HashSchema,
    market: marketSchema,
    symbol: canonicalIdentifierSchema,
    remainingNotionalKrw: positiveAmountSchema,
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const pendingBuyActionInputSchema = pendingActionBaseSchema
  .safeExtend({
    side: z.literal("BUY"),
    openingCapacityReservationId: canonicalIdentifierSchema,
    openingCapacityReservationHash: sha256HashSchema
  })
  .strict();

const pendingSellActionInputSchema = pendingActionBaseSchema
  .safeExtend({
    side: z.literal("SELL"),
    remainingQuantity: positiveNumberSchema,
    priceEvidenceRef: canonicalIdentifierSchema
  })
  .strict();

export const pendingPortfolioActionInputSchema = z.discriminatedUnion("side", [
  pendingBuyActionInputSchema,
  pendingSellActionInputSchema
]);

export type PortfolioValuationInput = z.infer<
  typeof portfolioValuationInputSchema
>;
export type PendingPortfolioActionInput = z.infer<
  typeof pendingPortfolioActionInputSchema
>;

export function canonicalizePortfolioValuationInputs(
  value: readonly unknown[]
): readonly PortfolioValuationInput[] {
  const inputs = z
    .array(portfolioValuationInputSchema)
    .max(10_000)
    .parse(value)
    .sort(compareValuationInput);
  assertUniqueValuationInputs(inputs);
  return deepFreeze(inputs);
}

export function parseCanonicalPortfolioValuationInputs(
  value: unknown
): readonly PortfolioValuationInput[] {
  const inputs = z
    .array(portfolioValuationInputSchema)
    .max(10_000)
    .parse(value);
  const canonical = [...inputs].sort(compareValuationInput);
  if (!isDeepStrictEqual(value, inputs) || !isDeepStrictEqual(inputs, canonical)) {
    throw new Error("portfolio valuation inputs must already be canonical");
  }
  assertUniqueValuationInputs(inputs);
  return deepFreeze(inputs);
}

export function canonicalizePendingPortfolioActionInputs(
  value: readonly unknown[]
): readonly PendingPortfolioActionInput[] {
  const inputs = z
    .array(pendingPortfolioActionInputSchema)
    .max(10_000)
    .parse(value)
    .sort(comparePendingActionInput);
  assertUniquePendingActionInputs(inputs);
  return deepFreeze(inputs);
}

export function parseCanonicalPendingPortfolioActionInputs(
  value: unknown
): readonly PendingPortfolioActionInput[] {
  const inputs = z
    .array(pendingPortfolioActionInputSchema)
    .max(10_000)
    .parse(value);
  const canonical = [...inputs].sort(comparePendingActionInput);
  if (!isDeepStrictEqual(value, inputs) || !isDeepStrictEqual(inputs, canonical)) {
    throw new Error("pending portfolio action inputs must already be canonical");
  }
  assertUniquePendingActionInputs(inputs);
  return deepFreeze(inputs);
}

export function pendingActionExposureTotals(inputs: readonly PendingPortfolioActionInput[]): {
  pendingBuyExposureKrw: number;
  pendingSellExposureKrw: number;
} {
  const canonical = parseCanonicalPendingPortfolioActionInputs(inputs);
  let pendingBuyExposureKrw = 0;
  let pendingSellExposureKrw = 0;
  for (const input of canonical) {
    if (input.side === "BUY") {
      pendingBuyExposureKrw = safeAdd(
        pendingBuyExposureKrw,
        input.remainingNotionalKrw
      );
    } else {
      pendingSellExposureKrw = safeAdd(
        pendingSellExposureKrw,
        input.remainingNotionalKrw
      );
    }
  }
  return deepFreeze({ pendingBuyExposureKrw, pendingSellExposureKrw });
}

function compareValuationInput(
  left: PortfolioValuationInput,
  right: PortfolioValuationInput
): number {
  if (left.kind !== right.kind) {
    return left.kind === "mark_price" ? -1 : 1;
  }
  if (left.kind === "mark_price" && right.kind === "mark_price") {
    return (
      compareText(left.market, right.market) ||
      compareText(left.symbol, right.symbol)
    );
  }
  if (left.kind === "fx_rate" && right.kind === "fx_rate") {
    return (
      compareText(left.baseCurrency, right.baseCurrency) ||
      compareText(left.quoteCurrency, right.quoteCurrency)
    );
  }
  return 0;
}

function assertUniqueValuationInputs(
  inputs: readonly PortfolioValuationInput[]
): void {
  const identities = new Set<string>();
  for (const input of inputs) {
    const identity =
      input.kind === "mark_price"
        ? `mark\u0000${input.market}\u0000${input.symbol}`
        : `fx\u0000${input.baseCurrency}\u0000${input.quoteCurrency}`;
    if (identities.has(identity)) {
      throw new Error("portfolio valuation inputs contain a duplicate identity");
    }
    identities.add(identity);
  }
}

function comparePendingActionInput(
  left: PendingPortfolioActionInput,
  right: PendingPortfolioActionInput
): number {
  return (
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol) ||
    compareText(left.side, right.side) ||
    compareText(left.planId, right.planId) ||
    compareText(left.actionId, right.actionId)
  );
}

function assertUniquePendingActionInputs(
  inputs: readonly PendingPortfolioActionInput[]
): void {
  const planActions = new Set<string>();
  for (const input of inputs) {
    const planAction = `${input.planId}\u0000${input.actionId}`;
    if (planActions.has(planAction)) {
      throw new Error("pending portfolio actions contain a duplicate plan action");
    }
    planActions.add(planAction);
  }
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("pending portfolio action exposure total is not a safe integer");
  }
  return total;
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode >= 0xd800 && charCode <= 0xdbff) {
      const nextCharCode = value.charCodeAt(index + 1);
      if (nextCharCode >= 0xdc00 && nextCharCode <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (charCode >= 0xdc00 && charCode <= 0xdfff) {
      return true;
    }
  }
  return false;
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
