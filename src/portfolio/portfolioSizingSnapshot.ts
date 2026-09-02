import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  sha256HashSchema,
  virtualPortfolioSchema,
  type VirtualPortfolio,
  type VirtualPosition
} from "../domain/schemas.js";
import {
  portfolioExposureSnapshotSchema,
  parseVerifiedPortfolioExposureSnapshot,
  type PortfolioExposureSnapshot
} from "./portfolioExposureSnapshot.js";
import {
  canonicalizePendingPortfolioActionInputs,
  canonicalizePortfolioValuationInputs,
  parseCanonicalPendingPortfolioActionInputs,
  parseCanonicalPortfolioValuationInputs,
  pendingActionExposureTotals,
  pendingPortfolioActionInputSchema,
  portfolioValuationInputSchema,
  type PendingPortfolioActionInput,
  type PortfolioValuationInput
} from "./portfolioSizingInputs.js";
import {
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const canonicalIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => value === value.trim(),
    "identifier must already be canonical"
  );

const portfolioSizingSnapshotPayloadSchema = z
  .object({
    portfolioId: canonicalIdentifierSchema,
    portfolioVersion: canonicalIdentifierSchema,
    policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema,
    virtualPortfolio: virtualPortfolioSchema,
    valuationInputs: z.array(portfolioValuationInputSchema).max(10_000),
    pendingActionInputs: z.array(pendingPortfolioActionInputSchema).max(10_000),
    exposureSnapshot: portfolioExposureSnapshotSchema,
    exposureSnapshotHash: sha256HashSchema
  })
  .strict();

export const portfolioSizingSnapshotSchema = z
  .object({
    portfolioSnapshotId: canonicalIdentifierSchema,
    ...portfolioSizingSnapshotPayloadSchema.shape,
    portfolioSnapshotHash: sha256HashSchema
  })
  .strict();

export type PortfolioSizingSnapshot = z.infer<
  typeof portfolioSizingSnapshotSchema
>;

export interface CreatePortfolioSizingSnapshotInput {
  portfolioId: string;
  portfolioVersion: string;
  policyHash: string;
  asOf: string;
  virtualPortfolio: unknown;
  valuationInputs: readonly unknown[];
  pendingActionInputs: readonly unknown[];
  exposureSnapshot: unknown;
  exposureSnapshotHash: string;
}

export function createPortfolioSizingSnapshot(
  input: CreatePortfolioSizingSnapshotInput
): PortfolioSizingSnapshot {
  const virtualPortfolio = canonicalizeVirtualPortfolio(input.virtualPortfolio);
  const valuationInputs = canonicalizePortfolioValuationInputs(
    input.valuationInputs
  );
  const pendingActionInputs = canonicalizePendingPortfolioActionInputs(
    input.pendingActionInputs
  );
  const verifiedExposure = parseVerifiedPortfolioExposureSnapshot({
    exposureSnapshot: input.exposureSnapshot,
    exposureSnapshotHash: input.exposureSnapshotHash
  });
  const payload = portfolioSizingSnapshotPayloadSchema.parse({
    portfolioId: input.portfolioId,
    portfolioVersion: input.portfolioVersion,
    policyHash: input.policyHash,
    asOf: input.asOf,
    virtualPortfolio,
    valuationInputs,
    pendingActionInputs,
    ...verifiedExposure
  });
  assertSnapshotBindings(payload);
  const portfolioSnapshotHash = hashCanonicalPayload(payload);
  return deepFreeze(
    portfolioSizingSnapshotSchema.parse({
      portfolioSnapshotId: hashDerivedId(
        "portfolio_sizing_snapshot",
        portfolioSnapshotHash
      ),
      ...payload,
      portfolioSnapshotHash
    })
  );
}

export function parsePortfolioSizingSnapshot(
  value: unknown
): PortfolioSizingSnapshot {
  const snapshot = portfolioSizingSnapshotSchema.parse(value);
  if (!isDeepStrictEqual(value, snapshot)) {
    throw new Error("portfolio sizing snapshot must already be canonical");
  }
  parseCanonicalVirtualPortfolio(snapshot.virtualPortfolio);
  parseCanonicalPortfolioValuationInputs(snapshot.valuationInputs);
  parseCanonicalPendingPortfolioActionInputs(snapshot.pendingActionInputs);
  parseVerifiedPortfolioExposureSnapshot({
    exposureSnapshot: snapshot.exposureSnapshot,
    exposureSnapshotHash: snapshot.exposureSnapshotHash
  });
  const { portfolioSnapshotId, portfolioSnapshotHash, ...payload } = snapshot;
  assertSnapshotBindings(payload);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    portfolioSnapshotHash !== expectedHash ||
    portfolioSnapshotId !==
      hashDerivedId("portfolio_sizing_snapshot", expectedHash)
  ) {
    throw new Error("portfolio sizing snapshot identity does not match payload");
  }
  return deepFreeze(snapshot);
}

function canonicalizeVirtualPortfolio(value: unknown): VirtualPortfolio {
  const portfolio = virtualPortfolioSchema.parse(value);
  if (!isDeepStrictEqual(value, portfolio)) {
    throw new Error("virtual portfolio must not require schema normalization");
  }
  assertNotNegativeZero(portfolio.cashKrw, "portfolio cash");
  const positions = portfolio.positions
    .map(canonicalizePosition)
    .sort(comparePosition);
  assertUniquePositionIdentities(positions);
  return deepFreeze({ ...portfolio, positions });
}

function parseCanonicalVirtualPortfolio(value: unknown): VirtualPortfolio {
  const portfolio = canonicalizeVirtualPortfolio(value);
  if (!isDeepStrictEqual(value, portfolio)) {
    throw new Error("virtual portfolio positions must already be canonical");
  }
  return portfolio;
}

function canonicalizePosition(position: VirtualPosition): VirtualPosition {
  assertWellFormedText(position.symbol, "position symbol");
  assertNotNegativeZero(position.quantity, "position quantity");
  assertNotNegativeZero(position.averagePriceKrw, "position average price");
  assertOptionalNotNegativeZero(position.marketPriceKrw, "position market price");
  assertOptionalNotNegativeZero(position.marketValueKrw, "position market value");
  assertOptionalNotNegativeZero(
    position.unrealizedPnlKrw,
    "position unrealized PnL"
  );
  const riskTags = canonicalOptionalText(position.riskTags, "position risk tags");
  const priceSourceRefs = canonicalOptionalText(
    position.priceSourceRefs,
    "position price source refs"
  );
  return {
    ...position,
    ...(riskTags === undefined ? {} : { riskTags }),
    ...(priceSourceRefs === undefined ? {} : { priceSourceRefs })
  };
}

function canonicalOptionalText<Value extends string>(
  values: readonly Value[] | undefined,
  label: string
): Value[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  const canonical = [...values].sort(compareText);
  for (let index = 0; index < canonical.length; index += 1) {
    const value = canonical[index]!;
    assertWellFormedText(value, label);
    if (index > 0 && value === canonical[index - 1]) {
      throw new Error(`${label} contain a duplicate value`);
    }
  }
  return canonical;
}

function comparePosition(left: VirtualPosition, right: VirtualPosition): number {
  return (
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol) ||
    compareText(left.strategyBucket ?? "", right.strategyBucket ?? "") ||
    compareText(hashCanonicalPayload(left), hashCanonicalPayload(right))
  );
}

function assertUniquePositionIdentities(
  positions: readonly VirtualPosition[]
): void {
  const identities = new Set<string>();
  for (const position of positions) {
    const identity = `${position.market}\u0000${position.symbol}\u0000${position.strategyBucket ?? ""}`;
    if (identities.has(identity)) {
      throw new Error("virtual portfolio contains a duplicate position identity");
    }
    identities.add(identity);
  }
}

function assertSnapshotBindings(
  payload: z.infer<typeof portfolioSizingSnapshotPayloadSchema>
): void {
  if (payload.virtualPortfolio.portfolioId !== payload.portfolioId) {
    throw new Error("virtual portfolio does not match snapshot portfolio scope");
  }
  assertNotAfter(
    payload.virtualPortfolio.updatedAt,
    payload.asOf,
    "portfolio",
    "snapshot asOf"
  );
  for (const position of payload.virtualPortfolio.positions) {
    assertNotAfter(
      position.updatedAt,
      payload.virtualPortfolio.updatedAt,
      "position",
      "portfolio updatedAt"
    );
    if (position.priceUpdatedAt !== undefined) {
      assertNotAfter(
        position.priceUpdatedAt,
        position.updatedAt,
        "position price",
        "position updatedAt"
      );
    }
    if (position.priceStaleAfter !== undefined) {
      offsetQualifiedIsoDateTimeSchema.parse(position.priceStaleAfter);
      if (
        position.priceUpdatedAt !== undefined &&
        Date.parse(position.priceStaleAfter) < Date.parse(position.priceUpdatedAt)
      ) {
        throw new Error("position price stale boundary precedes price update");
      }
    }
  }
  for (const valuation of payload.valuationInputs) {
    assertNotAfter(
      valuation.evidenceAsOf,
      payload.asOf,
      "valuation evidence",
      "snapshot asOf"
    );
  }
  for (const action of payload.pendingActionInputs) {
    assertNotAfter(
      action.asOf,
      payload.asOf,
      "pending action",
      "snapshot asOf"
    );
  }
  if (payload.exposureSnapshot.cashKrw !== payload.virtualPortfolio.cashKrw) {
    throw new Error("exposure cash does not match virtual portfolio cash");
  }
  const totals = pendingActionExposureTotals(payload.pendingActionInputs);
  if (
    payload.exposureSnapshot.pendingBuyExposureKrw !==
      totals.pendingBuyExposureKrw ||
    payload.exposureSnapshot.pendingSellExposureKrw !==
      totals.pendingSellExposureKrw
  ) {
    throw new Error("pending action exposure totals do not match snapshot");
  }
}

function assertNotAfter(
  value: string,
  boundary: string,
  label: string,
  boundaryLabel: string
): void {
  offsetQualifiedIsoDateTimeSchema.parse(value);
  if (Date.parse(value) > Date.parse(boundary)) {
    throw new Error(`${label} cannot be after ${boundaryLabel}`);
  }
}

function assertWellFormedText(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode >= 0xd800 && charCode <= 0xdbff) {
      const nextCharCode = value.charCodeAt(index + 1);
      if (nextCharCode >= 0xdc00 && nextCharCode <= 0xdfff) {
        index += 1;
        continue;
      }
      throw new Error(`${label} must use well-formed Unicode`);
    }
    if (charCode >= 0xdc00 && charCode <= 0xdfff) {
      throw new Error(`${label} must use well-formed Unicode`);
    }
  }
}

function assertOptionalNotNegativeZero(
  value: number | undefined,
  label: string
): void {
  if (value !== undefined) {
    assertNotNegativeZero(value, label);
  }
}

function assertNotNegativeZero(value: number, label: string): void {
  if (Object.is(value, -0)) {
    throw new Error(`${label} must not be negative zero`);
  }
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

export type {
  PendingPortfolioActionInput,
  PortfolioExposureSnapshot,
  PortfolioValuationInput
};
