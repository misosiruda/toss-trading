import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import {
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
  )
  .refine(
    (value) => !containsLoneSurrogate(value),
    "identifier must use well-formed Unicode"
  );

const basePayloadShape = {
  portfolioId: identifierSchema,
  policyHash: sha256HashSchema,
  asOf: offsetQualifiedIsoDateTimeSchema
};

const marketMarkPayloadSchema = z
  .object({
    ...basePayloadShape,
    stateUpdateKind: z.literal("market_mark"),
    portfolioSnapshotId: identifierSchema,
    portfolioSnapshotHash: sha256HashSchema
  })
  .strict();

const bucketAccountingScopeSchema = z
  .object({
    scopeKind: z.literal("bucket"),
    fillAccountingGroupId: identifierSchema
  })
  .strict();

const legacyAccountingScopeSchema = z
  .object({
    scopeKind: z.literal("legacy_portfolio"),
    legacyAccountingRecordId: identifierSchema,
    legacyAccountingHash: sha256HashSchema
  })
  .strict();

const fillPayloadSchema = z
  .object({
    ...basePayloadShape,
    stateUpdateKind: z.literal("fill"),
    rebalancePlanId: identifierSchema,
    rebalanceActionId: identifierSchema,
    planExecutionEventId: identifierSchema,
    fillId: identifierSchema,
    paperFillRecordId: identifierSchema,
    paperFillHash: sha256HashSchema,
    accountingScope: z.discriminatedUnion("scopeKind", [
      bucketAccountingScopeSchema,
      legacyAccountingScopeSchema
    ])
  })
  .strict();

const feePayloadSchema = createEquityEventPayloadSchema("fee");
const cashFlowPayloadSchema = createEquityEventPayloadSchema("cash_flow");

const riskStatePayloadSchema = z
  .object({
    ...basePayloadShape,
    stateUpdateKind: z.literal("risk_state"),
    riskStateEpochId: identifierSchema,
    bucket: strategyBucketSchema,
    lastBucketEquityEventId: identifierSchema,
    riskStateHash: sha256HashSchema
  })
  .strict();

const portfolioRiskStateUpdatePayloadSchema = z.discriminatedUnion(
  "stateUpdateKind",
  [
    marketMarkPayloadSchema,
    fillPayloadSchema,
    feePayloadSchema,
    cashFlowPayloadSchema,
    riskStatePayloadSchema
  ]
);

const recordIdentityShape = {
  riskStateUpdateRecordId: identifierSchema,
  stateUpdateHash: sha256HashSchema,
  createdAt: offsetQualifiedIsoDateTimeSchema
};

export const portfolioRiskStateUpdateRecordSchema = z.discriminatedUnion(
  "stateUpdateKind",
  [
    marketMarkPayloadSchema.extend(recordIdentityShape).strict(),
    fillPayloadSchema.extend(recordIdentityShape).strict(),
    feePayloadSchema.extend(recordIdentityShape).strict(),
    cashFlowPayloadSchema.extend(recordIdentityShape).strict(),
    riskStatePayloadSchema.extend(recordIdentityShape).strict()
  ]
);

export type PortfolioRiskStateUpdateRecord = z.infer<
  typeof portfolioRiskStateUpdateRecordSchema
>;
export type CreatePortfolioRiskStateUpdateInput = z.input<
  typeof portfolioRiskStateUpdatePayloadSchema
> & { createdAt: string };

export function createPortfolioRiskStateUpdateRecord(
  input: CreatePortfolioRiskStateUpdateInput
): PortfolioRiskStateUpdateRecord {
  const { createdAt, ...rawPayload } = input;
  const payload = portfolioRiskStateUpdatePayloadSchema.parse(rawPayload);
  assertUpdateSemantics(payload, createdAt);
  const stateUpdateHash = hashCanonicalPayload(payload);
  return deepFreeze(
    portfolioRiskStateUpdateRecordSchema.parse({
      riskStateUpdateRecordId: updateRecordId(
        payload.stateUpdateKind,
        stateUpdateHash
      ),
      stateUpdateHash,
      ...payload,
      createdAt
    })
  );
}

export function parsePortfolioRiskStateUpdateRecord(
  value: unknown
): PortfolioRiskStateUpdateRecord {
  const record = portfolioRiskStateUpdateRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) {
    throw new Error("portfolio risk state update must already be canonical");
  }
  const {
    riskStateUpdateRecordId,
    stateUpdateHash,
    createdAt,
    ...payload
  } = record;
  assertUpdateSemantics(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    stateUpdateHash !== expectedHash ||
    riskStateUpdateRecordId !==
      updateRecordId(payload.stateUpdateKind, expectedHash)
  ) {
    throw new Error("portfolio risk state update identity does not match payload");
  }
  return deepFreeze(record);
}

function createEquityEventPayloadSchema<Kind extends "fee" | "cash_flow">(
  stateUpdateKind: Kind
) {
  return z
    .object({
      ...basePayloadShape,
      stateUpdateKind: z.literal(stateUpdateKind),
      bucketEquityEventId: identifierSchema,
      rebalancePlanId: identifierSchema,
      rebalanceActionId: identifierSchema,
      fillId: identifierSchema
    })
    .strict();
}

function assertUpdateSemantics(
  payload: z.infer<typeof portfolioRiskStateUpdatePayloadSchema>,
  createdAt: string
): void {
  offsetQualifiedIsoDateTimeSchema.parse(createdAt);
  if (Date.parse(payload.asOf) > Date.parse(createdAt)) {
    throw new Error("portfolio risk state update cannot be created before asOf");
  }
}

function updateRecordId(
  kind: PortfolioRiskStateUpdateRecord["stateUpdateKind"],
  hash: PortfolioRiskStateUpdateRecord["stateUpdateHash"]
): string {
  return hashDerivedId(`portfolio_risk_state_update_${kind}`, hash);
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
