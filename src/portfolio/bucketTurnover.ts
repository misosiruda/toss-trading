import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((value) => value === value.trim() && !/[\uD800-\uDFFF]/u.test(value));
const amount = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const statePayloadSchema = z.object({
  turnoverStateId: identifier, portfolioId: identifier, bucket: strategyBucketSchema,
  lastAppliedPolicyHash: sha256HashSchema,
  windowStartedAt: offsetQualifiedIsoDateTimeSchema, windowEndsAt: offsetQualifiedIsoDateTimeSchema,
  windowOpenPortfolioNetWorthKrw: amount.positive(), cumulativeAbsoluteFilledNotionalKrw: amount,
  turnoverRatio: z.number().finite().nonnegative().refine((value) => !Object.is(value, -0)),
  lastTurnoverEventId: identifier.optional(), asOf: offsetQualifiedIsoDateTimeSchema
}).strict();
export const bucketTurnoverStateSchema = statePayloadSchema.extend({ turnoverStateHash: sha256HashSchema }).strict();
export type BucketTurnoverState = z.infer<typeof bucketTurnoverStateSchema>;

const eventPayloadSchema = z.object({
  previousTurnoverEventId: identifier.optional(), turnoverStateId: identifier,
  portfolioId: identifier, bucket: strategyBucketSchema, policyHash: sha256HashSchema,
  rebalancePlanId: identifier, rebalanceActionId: identifier, fillId: identifier,
  absoluteFilledNotionalKrw: amount.positive(), resultingCumulativeAbsoluteFilledNotionalKrw: amount.positive(),
  asOf: offsetQualifiedIsoDateTimeSchema
}).strict();
const eventInputSchema = eventPayloadSchema.extend({ createdAt: offsetQualifiedIsoDateTimeSchema }).strict();
export const bucketTurnoverEventSchema = eventInputSchema.extend({ turnoverEventId: identifier, turnoverEventHash: sha256HashSchema }).strict();
export type BucketTurnoverEvent = z.infer<typeof bucketTurnoverEventSchema>;

/** Pure empty-window contract. Snapshot denominator and active policy provenance require source resolution. */
export function createInitialBucketTurnoverState(value: {
  portfolioId: string; bucket: z.infer<typeof strategyBucketSchema>; policyHash: string;
  asOf: string; durationSeconds: number; windowOpenPortfolioNetWorthKrw: number;
}): BucketTurnoverState {
  const input = z.object({ portfolioId: identifier, bucket: strategyBucketSchema, policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema, durationSeconds: amount.positive(), windowOpenPortfolioNetWorthKrw: amount.positive() }).strict().parse(value);
  const timestamp = BigInt(Date.parse(input.asOf));
  const duration = BigInt(input.durationSeconds) * 1000n;
  const remainder = ((timestamp % duration) + duration) % duration;
  const start = timestamp - remainder;
  const end = start + duration;
  const windowStartedAt = new Date(Number(start)).toISOString();
  const windowEndsAt = new Date(Number(end)).toISOString();
  const identity = { portfolioId: input.portfolioId, bucket: input.bucket, windowStartedAt, windowEndsAt };
  return createState({ ...identity, turnoverStateId: windowStateId(identity), lastAppliedPolicyHash: input.policyHash,
    windowOpenPortfolioNetWorthKrw: input.windowOpenPortfolioNetWorthKrw, cumulativeAbsoluteFilledNotionalKrw: 0,
    turnoverRatio: 0, asOf: windowStartedAt });
}

export function parseBucketTurnoverState(value: unknown): BucketTurnoverState {
  const parsed = bucketTurnoverStateSchema.parse(value);
  const { turnoverStateHash, ...payload } = parsed;
  const expected = createState(payload);
  if (!isDeepStrictEqual(value, expected) || turnoverStateHash !== expected.turnoverStateHash) {
    throw new Error("bucket turnover state differs from its canonical payload");
  }
  return expected;
}

/** Full payload hash excludes only event ID/hash and createdAt. No fill authenticity is implied. */
export function createBucketTurnoverEvent(value: z.input<typeof eventInputSchema>): BucketTurnoverEvent {
  const { createdAt, ...payload } = eventInputSchema.parse(value);
  assertCanonicalTime(payload.asOf);
  assertCanonicalTime(createdAt);
  if (("previousTurnoverEventId" in payload && payload.previousTurnoverEventId === undefined) ||
    Date.parse(createdAt) < Date.parse(payload.asOf) || payload.resultingCumulativeAbsoluteFilledNotionalKrw < payload.absoluteFilledNotionalKrw) {
    throw new Error("bucket turnover event has invalid predecessor, chronology or cumulative amount");
  }
  const turnoverEventHash = hashCanonicalPayload(payload);
  return Object.freeze({ ...payload, turnoverEventHash, turnoverEventId: hashDerivedId("bucket_turnover_event", turnoverEventHash), createdAt });
}

export function parseBucketTurnoverEvent(value: unknown): BucketTurnoverEvent {
  const parsed = bucketTurnoverEventSchema.parse(value);
  const { turnoverEventId: _id, turnoverEventHash: _hash, ...input } = parsed;
  const expected = createBucketTurnoverEvent(input);
  if (!isDeepStrictEqual(value, expected)) throw new Error("bucket turnover event differs from its canonical payload");
  return expected;
}

/** Complete single-window fold, not source authentication, latest state authority or a persistence transaction. */
export function replayBucketTurnoverEvents(input: { initialState: unknown; events: readonly unknown[] }): BucketTurnoverState {
  const parsed = z.object({ initialState: z.unknown(), events: z.array(z.unknown()) }).strict().parse(input);
  let state = parseBucketTurnoverState(parsed.initialState);
  if (state.lastTurnoverEventId !== undefined || state.cumulativeAbsoluteFilledNotionalKrw !== 0 || state.asOf !== state.windowStartedAt) {
    throw new Error("bucket turnover replay requires the empty window root");
  }
  const events = new Set<string>();
  const fills = new Set<string>();
  for (const raw of parsed.events) {
    const event = parseBucketTurnoverEvent(raw);
    if (events.has(event.turnoverEventId) || fills.has(event.fillId)) throw new Error("bucket turnover history contains a duplicate event or fill");
    if (event.turnoverStateId !== state.turnoverStateId || event.portfolioId !== state.portfolioId || event.bucket !== state.bucket ||
      event.previousTurnoverEventId !== state.lastTurnoverEventId) throw new Error("bucket turnover event scope or predecessor mismatch");
    const asOf = Date.parse(event.asOf);
    if (asOf < Date.parse(state.asOf) || asOf >= Date.parse(state.windowEndsAt)) throw new Error("bucket turnover event is outside its monotonic window");
    const cumulative = BigInt(state.cumulativeAbsoluteFilledNotionalKrw) + BigInt(event.absoluteFilledNotionalKrw);
    if (cumulative > BigInt(Number.MAX_SAFE_INTEGER) || Number(cumulative) !== event.resultingCumulativeAbsoluteFilledNotionalKrw) {
      throw new Error("bucket turnover cumulative amount differs from replay");
    }
    const { turnoverStateHash: _hash, ...payload } = state;
    state = createState({ ...payload, lastAppliedPolicyHash: event.policyHash,
      cumulativeAbsoluteFilledNotionalKrw: Number(cumulative), turnoverRatio: Number(cumulative) / state.windowOpenPortfolioNetWorthKrw,
      lastTurnoverEventId: event.turnoverEventId, asOf: event.asOf });
    events.add(event.turnoverEventId);
    fills.add(event.fillId);
  }
  return state;
}

/** Validates a stored projection by replaying its entire window, not merely by rehashing it. */
export function resolveBucketTurnoverState(input: { initialState: unknown; events: readonly unknown[]; state: unknown }): BucketTurnoverState {
  const parsed = z.object({ initialState: z.unknown(), events: z.array(z.unknown()), state: z.unknown() }).strict().parse(input);
  const replayed = replayBucketTurnoverEvents({ initialState: parsed.initialState, events: parsed.events });
  if (!isDeepStrictEqual(parseBucketTurnoverState(parsed.state), replayed)) throw new Error("bucket turnover snapshot differs from complete event replay");
  return replayed;
}

function createState(value: z.input<typeof statePayloadSchema>): BucketTurnoverState {
  const payload = statePayloadSchema.parse(value);
  for (const time of [payload.windowStartedAt, payload.windowEndsAt, payload.asOf]) assertCanonicalTime(time);
  const start = BigInt(Date.parse(payload.windowStartedAt));
  const end = BigInt(Date.parse(payload.windowEndsAt));
  const duration = end - start;
  if (duration <= 0n || duration % 1000n !== 0n || start % duration !== 0n ||
    Date.parse(payload.asOf) < Number(start) || Date.parse(payload.asOf) >= Number(end) ||
    payload.turnoverStateId !== windowStateId(payload)) throw new Error("bucket turnover state has invalid fixed UTC window identity");
  if (("lastTurnoverEventId" in payload && payload.lastTurnoverEventId === undefined) ||
    (payload.lastTurnoverEventId === undefined) !== (payload.cumulativeAbsoluteFilledNotionalKrw === 0) ||
    payload.turnoverRatio !== payload.cumulativeAbsoluteFilledNotionalKrw / payload.windowOpenPortfolioNetWorthKrw) {
    throw new Error("bucket turnover state cumulative amount, ratio or last event is inconsistent");
  }
  return Object.freeze({ ...payload, turnoverStateHash: hashCanonicalPayload(payload) });
}

function windowStateId(input: { portfolioId: string; bucket: string; windowStartedAt: string; windowEndsAt: string }): string {
  return hashDerivedId("bucket_turnover_state", hashCanonicalPayload({ portfolioId: input.portfolioId, bucket: input.bucket,
    windowStartedAt: input.windowStartedAt, windowEndsAt: input.windowEndsAt }));
}

function assertCanonicalTime(value: string): void {
  if (new Date(value).toISOString() !== value) throw new Error("bucket turnover timestamps must use canonical UTC milliseconds");
}
