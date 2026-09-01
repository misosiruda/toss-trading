import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
import {
  type InvestmentMandateState,
  resolveInvestmentMandateState
} from "./investmentMandateState.js";
import {
  compareText,
  hashCanonicalPayload,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z.string().trim().min(1).max(160);
const positivePriceKrwSchema = z.number().finite().positive();
const legacyReasonSchema = z.enum([
  "missing_mandate",
  "missing_policy_lineage",
  "missing_opened_at"
]);

const assignedPositionStrategyStatePayloadSchema = z
  .object({
    stateKind: z.literal("assigned"),
    portfolioId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    mandateId: identifierSchema,
    mandateHash: sha256HashSchema,
    lastMandateEventId: identifierSchema,
    lastMandateEventHash: sha256HashSchema,
    policyHash: sha256HashSchema,
    openedAt: offsetQualifiedIsoDateTimeSchema,
    lastIncreasedAt: offsetQualifiedIsoDateTimeSchema.optional(),
    lastReducedAt: offsetQualifiedIsoDateTimeSchema.optional(),
    lastReviewedAt: offsetQualifiedIsoDateTimeSchema,
    nextReviewAt: offsetQualifiedIsoDateTimeSchema.optional(),
    lastReviewedTriggerRef: identifierSchema,
    peakPriceKrw: positivePriceKrwSchema,
    partialTakeProfitExecuted: z.boolean(),
    thesisStatus: z.enum(["intact", "watch", "invalidated", "unknown"])
  })
  .strict();

const unassignedLegacyPositionStrategyStatePayloadSchema = z
  .object({
    stateKind: z.literal("unassigned_legacy"),
    portfolioId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    observedPositionRef: identifierSchema,
    reasonCodes: z.array(legacyReasonSchema).min(1).max(3),
    detectedAt: offsetQualifiedIsoDateTimeSchema,
    status: z.literal("review_required")
  })
  .strict();

export const assignedPositionStrategyStateSchema =
  assignedPositionStrategyStatePayloadSchema.safeExtend({
    positionStrategyStateHash: sha256HashSchema
  });

export const unassignedLegacyPositionStrategyStateSchema =
  unassignedLegacyPositionStrategyStatePayloadSchema.safeExtend({
    positionStrategyStateHash: sha256HashSchema
  });

export const positionStrategyStateSchema = z.discriminatedUnion("stateKind", [
  assignedPositionStrategyStateSchema,
  unassignedLegacyPositionStrategyStateSchema
]);

export type AssignedPositionStrategyState = z.infer<
  typeof assignedPositionStrategyStateSchema
>;
export type UnassignedLegacyPositionStrategyState = z.infer<
  typeof unassignedLegacyPositionStrategyStateSchema
>;
export type PositionStrategyState = z.infer<typeof positionStrategyStateSchema>;

export type ResolvedPositionStrategyState =
  | {
      state: AssignedPositionStrategyState;
      mandate: InvestmentMandateState;
    }
  | {
      state: UnassignedLegacyPositionStrategyState;
    };

export function createAssignedPositionStrategyState(
  input: z.input<typeof assignedPositionStrategyStatePayloadSchema>
): AssignedPositionStrategyState {
  const payload = assignedPositionStrategyStatePayloadSchema.parse(input);
  assertAssignedChronology(payload);
  return deepFreeze(
    assignedPositionStrategyStateSchema.parse({
      ...payload,
      positionStrategyStateHash: hashCanonicalPayload(payload)
    })
  );
}

export function createUnassignedLegacyPositionStrategyState(
  input: z.input<typeof unassignedLegacyPositionStrategyStatePayloadSchema>
): UnassignedLegacyPositionStrategyState {
  const payload = unassignedLegacyPositionStrategyStatePayloadSchema.parse({
    ...input,
    reasonCodes: canonicalLegacyReasons(input.reasonCodes)
  });
  return deepFreeze(
    unassignedLegacyPositionStrategyStateSchema.parse({
      ...payload,
      positionStrategyStateHash: hashCanonicalPayload(payload)
    })
  );
}

export function parsePositionStrategyState(value: unknown): PositionStrategyState {
  const state = positionStrategyStateSchema.parse(value);
  assertAlreadyCanonical(value, state);
  const { positionStrategyStateHash, ...payload } = state;
  if (state.stateKind === "assigned") {
    assertAssignedChronology(state);
  } else {
    assertCanonicalLegacyReasons(state.reasonCodes);
  }
  const expectedHash = hashCanonicalPayload(payload);
  if (positionStrategyStateHash !== expectedHash) {
    throw new Error("position strategy state hash does not match its payload");
  }
  return deepFreeze(state);
}

/**
 * Resolves the exact current mandate head used by an assigned position state.
 * Legacy states deliberately carry no fabricated mandate or policy lineage.
 */
export function resolvePositionStrategyStateDependencies(input: {
  value: unknown;
  mandateRecords: readonly unknown[];
  mandateEvents: readonly unknown[];
}): ResolvedPositionStrategyState {
  const state = parsePositionStrategyState(input.value);
  if (state.stateKind === "unassigned_legacy") {
    return deepFreeze({ state });
  }
  const mandate = resolveInvestmentMandateState({
    mandateId: state.mandateId,
    records: input.mandateRecords,
    events: input.mandateEvents
  });
  const event = mandate.currentEvent;
  if (event === undefined) {
    throw new Error("assigned position requires an activated mandate");
  }
  if (
    state.mandateHash !== mandate.record.mandateHash ||
    state.lastMandateEventId !== event.mandateEventId ||
    state.lastMandateEventHash !== event.mandateEventHash ||
    state.portfolioId !== mandate.record.portfolioId ||
    state.market !== mandate.record.market ||
    state.symbol !== mandate.record.symbol ||
    state.policyHash !== mandate.record.policyHash
  ) {
    throw new Error("position strategy state does not match its mandate lineage");
  }
  assertCadenceBinding(state, mandate);
  return deepFreeze({ state, mandate });
}

function assertCadenceBinding(
  state: AssignedPositionStrategyState,
  mandate: InvestmentMandateState
): void {
  if (mandate.record.reviewCadence.mode === "scheduled") {
    if (
      state.nextReviewAt === undefined ||
      state.nextReviewAt !== mandate.record.reviewAfter
    ) {
      throw new Error(
        "scheduled position state must match the mandate reviewAfter"
      );
    }
    return;
  }
  if (state.nextReviewAt !== undefined) {
    throw new Error("every_tick position state must omit nextReviewAt");
  }
  try {
    sha256HashSchema.parse(state.lastReviewedTriggerRef);
  } catch (error) {
    throw new Error(
      "every_tick position state requires a market packet hash trigger",
      { cause: error }
    );
  }
}

function assertAssignedChronology(
  state: z.infer<typeof assignedPositionStrategyStatePayloadSchema>
): void {
  assertNotAfter(state.openedAt, state.lastReviewedAt, "position openedAt");
  if (state.lastIncreasedAt !== undefined) {
    assertNotAfter(
      state.openedAt,
      state.lastIncreasedAt,
      "position lastIncreasedAt"
    );
  }
  if (state.lastReducedAt !== undefined) {
    assertNotAfter(
      state.openedAt,
      state.lastReducedAt,
      "position lastReducedAt"
    );
  }
  if (state.nextReviewAt !== undefined) {
    assertNotAfter(
      state.lastReviewedAt,
      state.nextReviewAt,
      "position nextReviewAt"
    );
  }
}

function canonicalLegacyReasons(
  values: readonly z.infer<typeof legacyReasonSchema>[]
): readonly z.infer<typeof legacyReasonSchema>[] {
  const canonical = [...values].sort(compareText);
  assertCanonicalLegacyReasons(canonical);
  return canonical;
}

function assertCanonicalLegacyReasons(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) {
      throw new Error("legacy reason canonicalization failed");
    }
    const comparison = compareText(previous, current);
    if (comparison === 0) {
      throw new Error("legacy reasonCodes must not contain duplicates");
    }
    if (comparison > 0) {
      throw new Error("legacy reasonCodes must use canonical order");
    }
  }
}

function assertAlreadyCanonical(value: unknown, parsed: unknown): void {
  if (!isDeepStrictEqual(value, parsed)) {
    throw new Error("position strategy state must use canonical stored values");
  }
}

function assertNotAfter(left: string, right: string, label: string): void {
  if (Date.parse(left) > Date.parse(right)) {
    throw new Error(`${label} must not be after its boundary`);
  }
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
