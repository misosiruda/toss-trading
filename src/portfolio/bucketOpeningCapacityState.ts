import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";

const identifier = z.string().min(1).max(160).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const timestamp = offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString());
const core = z.object({ portfolioId: identifier, policyHash: sha256HashSchema, bucket: strategyBucketSchema,
  currentPortfolioSnapshotId: identifier, currentPortfolioSnapshotHash: sha256HashSchema, capacityLedgerVersion: count,
  activePositionCount: count, pendingReservationCount: count, mandateBoundUnusedSlotCount: count, availableSlots: count,
  reservedOpeningNotionalKrw: count, remainingOpeningBudgetKrw: count, lastReservationRecordId: identifier.optional(), asOf: timestamp }).strict();
export const bucketOpeningCapacityStatePayloadSchema = core.extend({ capacityStateId: identifier }).strict();
export const bucketOpeningCapacityStateSchema = bucketOpeningCapacityStatePayloadSchema.extend({ capacityStateHash: sha256HashSchema }).strict();
export type BucketOpeningCapacityState = Readonly<z.infer<typeof bucketOpeningCapacityStateSchema>>;

/** Mutable-state contract only; neither creation nor a valid hash grants current ledger or allocation authority. */
export function createBucketOpeningCapacityState(value: z.input<typeof core>): BucketOpeningCapacityState {
  const parsed = core.parse(value);
  if (!isDeepStrictEqual(value, parsed)) throw new Error("opening capacity state payload must already be canonical");
  assertCounts(parsed);
  const payload = { ...parsed, capacityStateId: stateId(parsed) };
  return Object.freeze(bucketOpeningCapacityStateSchema.parse({ ...payload, capacityStateHash: hashCanonicalPayload(payload) }));
}

/** Rehash everything except the self hash, including the stable ID, snapshot/version and optional origin. */
export function parseBucketOpeningCapacityState(value: unknown): BucketOpeningCapacityState {
  const state = bucketOpeningCapacityStateSchema.parse(value);
  if (!isDeepStrictEqual(value, state)) throw new Error("opening capacity state must already be canonical");
  assertCounts(state);
  const { capacityStateHash, ...payload } = state;
  if (state.capacityStateId !== stateId(state) || capacityStateHash !== hashCanonicalPayload(payload)) {
    throw new Error("opening capacity state identity does not match its complete payload");
  }
  return Object.freeze(state);
}

/** Policy-payload binding only. Current activation, holdings/reservation/budget replay and CAS are separate gates. */
export function resolveBucketOpeningCapacityStatePolicy(value: { state: unknown; policy: unknown }) {
  const parsed = z.object({ state: z.unknown(), policy: z.unknown() }).strict().parse(value);
  const state = parseBucketOpeningCapacityState(parsed.state), policy = parseRuntimePortfolioPolicyRecord(parsed.policy);
  const limit = policy.strategyBuckets.find((item) => item.bucket === state.bucket)!.openingCapacityPolicy;
  if (state.portfolioId !== policy.portfolioId || state.policyHash !== policy.policyHash || Date.parse(policy.createdAt) > Date.parse(state.asOf)) {
    throw new Error("opening capacity state policy scope or chronology mismatch");
  }
  if (!limit) throw new Error("opening capacity state requires an explicit policy limit");
  const occupied = state.activePositionCount + state.pendingReservationCount + state.mandateBoundUnusedSlotCount;
  if (state.availableSlots !== Math.max(0, limit.maximumPositionCount - occupied)) {
    throw new Error("opening capacity state available slots differ from policy and occupancy counts");
  }
  return Object.freeze({ state, policy, maximumPositionCount: limit.maximumPositionCount,
    verificationScope: "policy_bound_capacity_state_payload_only" as const,
    currentPolicyAndSnapshotAuthority: "not_verified" as const, occupancyAndBudgetReplay: "not_performed" as const,
    currentLedgerAndCasAuthority: "not_verified" as const, currentExecutionAuthority: "not_granted" as const });
}

function stateId(scope: Pick<BucketOpeningCapacityState, "portfolioId" | "bucket">): string {
  // Stable across policy/snapshot/version changes, as with the other current-state projections.
  return hashDerivedId("bucket_opening_capacity_state", hashCanonicalPayload({ portfolioId: scope.portfolioId, bucket: scope.bucket }));
}

function assertCounts(state: z.infer<typeof core>): void {
  if (Object.hasOwn(state, "lastReservationRecordId") && state.lastReservationRecordId === undefined) {
    throw new Error("opening capacity state optional origin must be absent rather than undefined");
  }
  const reservedSlots = BigInt(state.pendingReservationCount) + BigInt(state.mandateBoundUnusedSlotCount);
  const total = BigInt(state.activePositionCount) + reservedSlots + BigInt(state.availableSlots);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("opening capacity state slot aggregate is unsafe");
  if (BigInt(state.reservedOpeningNotionalKrw) + BigInt(state.remainingOpeningBudgetKrw) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("opening capacity state notional aggregate is unsafe");
  }
  // Each occupied opening reservation retains at least one integer KRW; increases may reserve cash without a new slot.
  if (reservedSlots > BigInt(state.reservedOpeningNotionalKrw)) throw new Error("opening capacity state slots lack positive reserved notional");
}
