import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  marketSchema,
  sha256HashSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
import {
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z.string().trim().min(1).max(160);
const nonNegativeQuantitySchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), "quantity must not be negative zero");
const positivePriceKrwSchema = z.number().finite().positive();

const eventBaseSchema = z
  .object({
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    market: marketSchema,
    symbol: identifierSchema,
    resultingQuantity: nonNegativeQuantitySchema,
    resultingPriceKrw: positivePriceKrwSchema,
    resultingPriceEvidenceRef: identifierSchema,
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const positionOpeningFillOriginSchema = z
  .object({
    originKind: z.literal("position_opening_fill"),
    fillId: identifierSchema,
    paperFillRecordId: identifierSchema,
    paperFillHash: sha256HashSchema
  })
  .strict();

const legacyVerifiedMarkOriginSchema = z
  .object({
    originKind: z.literal("legacy_verified_mark"),
    observedPositionRef: identifierSchema,
    markEvidenceRef: identifierSchema
  })
  .strict();

const initializedPayloadSchema = eventBaseSchema
  .safeExtend({
    eventType: z.literal("initialized"),
    initializationOrigin: z.discriminatedUnion("originKind", [
      positionOpeningFillOriginSchema,
      legacyVerifiedMarkOriginSchema
    ])
  })
  .strict();

const predecessorSchema = z
  .object({
    previousPositionMarkHeadEventId: identifierSchema,
    previousPositionMarkHeadEventHash: sha256HashSchema
  })
  .strict();

const valuationAppliedPayloadSchema = eventBaseSchema
  .safeExtend({
    eventType: z.literal("valuation_applied"),
    ...predecessorSchema.shape,
    bucketValuationMarkRecordId: identifierSchema,
    valuationMarkHash: sha256HashSchema,
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  })
  .strict();

const paperFillMutationOriginSchema = z
  .object({
    originKind: z.literal("paper_fill"),
    fillId: identifierSchema,
    paperFillRecordId: identifierSchema,
    paperFillHash: sha256HashSchema
  })
  .strict();

const verifiedMigrationOriginSchema = z
  .object({
    originKind: z.literal("verified_migration"),
    migrationRecordId: identifierSchema,
    migrationRecordHash: sha256HashSchema
  })
  .strict();

const positionMutationAppliedPayloadSchema = eventBaseSchema
  .safeExtend({
    eventType: z.literal("position_mutation_applied"),
    ...predecessorSchema.shape,
    mutationOrigin: z.discriminatedUnion("originKind", [
      paperFillMutationOriginSchema,
      verifiedMigrationOriginSchema
    ])
  })
  .strict();

const transferOriginSchema = z
  .object({
    migrationRecordId: identifierSchema,
    migrationRecordHash: sha256HashSchema,
    transferGroupId: identifierSchema
  })
  .strict();

const bucketTransferOutPayloadSchema = eventBaseSchema
  .safeExtend({
    eventType: z.literal("bucket_transfer_out"),
    ...predecessorSchema.shape,
    ...transferOriginSchema.shape
  })
  .strict();

const bucketTransferInPayloadSchema = eventBaseSchema
  .safeExtend({
    eventType: z.literal("bucket_transfer_in"),
    ...transferOriginSchema.shape
  })
  .strict();

export const bucketPositionMarkHeadEventPayloadSchema = z.discriminatedUnion(
  "eventType",
  [
    initializedPayloadSchema,
    valuationAppliedPayloadSchema,
    positionMutationAppliedPayloadSchema,
    bucketTransferOutPayloadSchema,
    bucketTransferInPayloadSchema
  ]
);

const initializedInputSchema = initializedPayloadSchema.safeExtend({
  createdAt: offsetQualifiedIsoDateTimeSchema
});
const valuationAppliedInputSchema = valuationAppliedPayloadSchema.safeExtend({
  createdAt: offsetQualifiedIsoDateTimeSchema
});
const positionMutationAppliedInputSchema =
  positionMutationAppliedPayloadSchema.safeExtend({
    createdAt: offsetQualifiedIsoDateTimeSchema
  });
const bucketTransferOutInputSchema = bucketTransferOutPayloadSchema.safeExtend({
  createdAt: offsetQualifiedIsoDateTimeSchema
});
const bucketTransferInInputSchema = bucketTransferInPayloadSchema.safeExtend({
  createdAt: offsetQualifiedIsoDateTimeSchema
});

const bucketPositionMarkHeadEventInputSchema = z.discriminatedUnion(
  "eventType",
  [
    initializedInputSchema,
    valuationAppliedInputSchema,
    positionMutationAppliedInputSchema,
    bucketTransferOutInputSchema,
    bucketTransferInInputSchema
  ]
);

export const bucketPositionMarkHeadEventSchema = z.discriminatedUnion(
  "eventType",
  [
    initializedInputSchema.safeExtend({
      positionMarkHeadEventId: identifierSchema,
      positionMarkHeadEventHash: sha256HashSchema
    }),
    valuationAppliedInputSchema.safeExtend({
      positionMarkHeadEventId: identifierSchema,
      positionMarkHeadEventHash: sha256HashSchema
    }),
    positionMutationAppliedInputSchema.safeExtend({
      positionMarkHeadEventId: identifierSchema,
      positionMarkHeadEventHash: sha256HashSchema
    }),
    bucketTransferOutInputSchema.safeExtend({
      positionMarkHeadEventId: identifierSchema,
      positionMarkHeadEventHash: sha256HashSchema
    }),
    bucketTransferInInputSchema.safeExtend({
      positionMarkHeadEventId: identifierSchema,
      positionMarkHeadEventHash: sha256HashSchema
    })
  ]
);

export type BucketPositionMarkHeadEvent = z.infer<
  typeof bucketPositionMarkHeadEventSchema
>;

const bucketPositionMarkHeadStateCoreSchema = z
  .object({
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    market: marketSchema,
    symbol: identifierSchema,
    quantity: nonNegativeQuantitySchema,
    currentPriceKrw: positivePriceKrwSchema,
    currentPriceEvidenceRef: identifierSchema,
    lastPositionMarkHeadEventId: identifierSchema,
    lastPositionMarkHeadEventHash: sha256HashSchema,
    lastValuationMarkRecordId: identifierSchema.optional(),
    lastValuationMarkHash: sha256HashSchema.optional(),
    lastPositionMutationRef: identifierSchema.optional(),
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const bucketPositionMarkHeadStatePayloadSchema =
  bucketPositionMarkHeadStateCoreSchema.safeExtend({
    positionMarkHeadId: identifierSchema
  });

export const bucketPositionMarkHeadStateSchema =
  bucketPositionMarkHeadStatePayloadSchema.safeExtend({
    positionMarkHeadHash: sha256HashSchema
  });

export type BucketPositionMarkHeadState = z.infer<
  typeof bucketPositionMarkHeadStateSchema
>;

export function createBucketPositionMarkHeadEvent(
  input: z.input<typeof bucketPositionMarkHeadEventInputSchema>
): BucketPositionMarkHeadEvent {
  const parsed = bucketPositionMarkHeadEventInputSchema.parse(input);
  const { createdAt, ...payload } = parsed;
  assertEventPayload(payload);
  assertCreatedAt(payload.asOf, createdAt);
  const positionMarkHeadEventHash = hashCanonicalPayload(payload);
  return deepFreeze(
    bucketPositionMarkHeadEventSchema.parse({
      ...payload,
      positionMarkHeadEventId: hashDerivedId(
        "bucket_position_mark_head_event",
        positionMarkHeadEventHash
      ),
      positionMarkHeadEventHash,
      createdAt
    })
  );
}

export function parseBucketPositionMarkHeadEvent(
  value: unknown
): BucketPositionMarkHeadEvent {
  const event = bucketPositionMarkHeadEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) {
    throw new Error("bucket position mark head event must already be canonical");
  }
  const {
    positionMarkHeadEventId,
    positionMarkHeadEventHash,
    createdAt,
    ...payload
  } = event;
  assertEventPayload(payload);
  assertCreatedAt(payload.asOf, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    positionMarkHeadEventHash !== expectedHash ||
    positionMarkHeadEventId !==
      hashDerivedId("bucket_position_mark_head_event", expectedHash)
  ) {
    throw new Error(
      "bucket position mark head event identity does not match its payload"
    );
  }
  return deepFreeze(event);
}

export function createBucketPositionMarkHeadState(
  input: z.input<typeof bucketPositionMarkHeadStateCoreSchema>
): BucketPositionMarkHeadState {
  const core = bucketPositionMarkHeadStateCoreSchema.parse(input);
  assertStateOrigins(core);
  const positionMarkHeadId = derivePositionMarkHeadId(core);
  const payload = bucketPositionMarkHeadStatePayloadSchema.parse({
    positionMarkHeadId,
    ...core
  });
  return deepFreeze(
    bucketPositionMarkHeadStateSchema.parse({
      ...payload,
      positionMarkHeadHash: hashCanonicalPayload(payload)
    })
  );
}

export function parseBucketPositionMarkHeadState(
  value: unknown
): BucketPositionMarkHeadState {
  const state = bucketPositionMarkHeadStateSchema.parse(value);
  if (!isDeepStrictEqual(value, state)) {
    throw new Error("bucket position mark head state must already be canonical");
  }
  const { positionMarkHeadHash, ...payload } = state;
  assertStateOrigins(payload);
  if (
    payload.positionMarkHeadId !== derivePositionMarkHeadId(payload) ||
    positionMarkHeadHash !== hashCanonicalPayload(payload)
  ) {
    throw new Error(
      "bucket position mark head state identity does not match its payload"
    );
  }
  return deepFreeze(state);
}

function assertEventPayload(
  event: z.infer<typeof bucketPositionMarkHeadEventPayloadSchema>
): void {
  if (
    (event.eventType === "initialized" ||
      event.eventType === "valuation_applied" ||
      event.eventType === "bucket_transfer_in") &&
    event.resultingQuantity === 0
  ) {
    throw new Error(`${event.eventType} requires a positive resulting quantity`);
  }
  if (
    event.eventType === "bucket_transfer_out" &&
    event.resultingQuantity !== 0
  ) {
    throw new Error("bucket transfer out must close the source mark head");
  }
  if (
    event.eventType === "initialized" &&
    event.initializationOrigin.originKind === "legacy_verified_mark" &&
    event.resultingPriceEvidenceRef !==
      event.initializationOrigin.markEvidenceRef
  ) {
    throw new Error(
      "legacy mark initialization must preserve its verified evidence"
    );
  }
}

function assertCreatedAt(asOf: string, createdAt: string): void {
  if (Date.parse(createdAt) < Date.parse(asOf)) {
    throw new Error("bucket position mark head event cannot be created before asOf");
  }
}

function assertStateOrigins(
  state: {
    lastValuationMarkRecordId?: string | undefined;
    lastValuationMarkHash?: string | undefined;
  }
): void {
  if (
    (state.lastValuationMarkRecordId === undefined) !==
    (state.lastValuationMarkHash === undefined)
  ) {
    throw new Error(
      "bucket position mark head state requires a complete valuation origin"
    );
  }
}

function derivePositionMarkHeadId(input: {
  portfolioId: string;
  bucket: string;
  market: string;
  symbol: string;
}): string {
  const scopeHash = hashCanonicalPayload({
    portfolioId: input.portfolioId,
    bucket: input.bucket,
    market: input.market,
    symbol: input.symbol
  });
  return hashDerivedId("bucket_position_mark_head", scopeHash);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
