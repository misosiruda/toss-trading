import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import { parseRebalancePlanRecord } from "./rebalancePlan.js";
import {
  createRebalancePlanExecutionAppliedEvent,
  parseRebalancePlanExecutionAppliedEvent,
  rebalancePlanExecutionAppliedEventSchema
} from "./rebalancePlanExecutionAppliedEvent.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine(
  (value) => value === value.trim() && !/[\uD800-\uDFFF]/u.test(value), "identifier must already be canonical"
);
const common = z.object({
  planId: identifier, planHash: sha256HashSchema, cycleId: identifier, portfolioId: identifier,
  portfolioVersion: identifier, portfolioSnapshotHash: sha256HashSchema,
  policyHash: sha256HashSchema, asOf: offsetQualifiedIsoDateTimeSchema
}).strict();
const successor = common.extend({ previousPlanEventId: identifier }).strict();
const reasons = z.array(identifier).min(1).max(128);
const preview = common.extend({ eventType: z.literal("previewed") }).strict();
const decision = successor.extend({ eventType: z.enum(["approved", "rejected"]), reasonCodes: reasons }).strict();
const stale = successor.extend({
  eventType: z.literal("stale"), observedCurrentPortfolioVersion: identifier,
  observedCurrentPortfolioSnapshotId: identifier, observedCurrentPortfolioSnapshotHash: sha256HashSchema,
  reasonCodes: reasons
}).strict();
const applied = successor.extend({
  eventType: z.literal("applied"), executionEventIds: z.array(identifier).min(1).max(100_000),
  resultingPortfolioVersion: identifier, resultingPortfolioSnapshotHash: sha256HashSchema
}).strict();
const execution = rebalancePlanExecutionAppliedEventSchema.omit({ planEventId: true, planEventHash: true });
const inputSchema = z.discriminatedUnion("eventType", [preview, decision, stale, execution, applied]);
const identity = { planEventId: identifier, planEventHash: sha256HashSchema };
export const rebalancePlanEventSchema = z.discriminatedUnion("eventType", [
  preview.extend(identity).strict(), decision.extend(identity).strict(), stale.extend(identity).strict(),
  rebalancePlanExecutionAppliedEventSchema, applied.extend(identity).strict()
]);
export type RebalancePlanEvent = z.infer<typeof rebalancePlanEventSchema>;

/** Pure event content. Neither event creation nor binding authorizes execution. */
export function createRebalancePlanEvent(input: z.input<typeof inputSchema>): RebalancePlanEvent {
  const parsed = inputSchema.parse(input);
  // Preserve the existing execution-event contract and hash byte-for-byte.
  if (parsed.eventType === "execution_applied") return createRebalancePlanExecutionAppliedEvent(parsed);
  const payload = "reasonCodes" in parsed ? { ...parsed, reasonCodes: [...parsed.reasonCodes].sort(compareText) } : parsed;
  assertLists(payload);
  const planEventHash = hashCanonicalPayload(payload);
  return deepFreeze(rebalancePlanEventSchema.parse({
    ...payload, planEventId: hashDerivedId("rebalance_plan_event", planEventHash), planEventHash
  }));
}

export function parseRebalancePlanEvent(value: unknown): RebalancePlanEvent {
  const event = rebalancePlanEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) throw new Error("rebalance plan event must already be canonical");
  if (event.eventType === "execution_applied") return parseRebalancePlanExecutionAppliedEvent(event);
  assertLists(event);
  const { planEventId, planEventHash, ...payload } = event;
  if (planEventHash !== hashCanonicalPayload(payload) || planEventId !== hashDerivedId("rebalance_plan_event", planEventHash)) {
    throw new Error("rebalance plan event identity does not match its payload");
  }
  return deepFreeze(event);
}

/** Content binding only: no repository origin, linear history or Risk replay. */
export function validateRebalancePlanEventRecordBinding(input: { plan: unknown; event: unknown }) {
  const parsed = z.object({ plan: z.unknown(), event: z.unknown() }).strict().parse(input);
  const binding = createRebalancePlanEventRecordBinding(parsed.plan);
  return Object.freeze({ plan: binding.plan, event: binding.parseEvent(parsed.event) });
}

/** Parses once and retains a frozen plan; callers cannot supply a trusted flag. */
export function createRebalancePlanEventRecordBinding(value: unknown) {
  const plan = parseRebalancePlanRecord(value);
  return Object.freeze({ plan, parseEvent: (event: unknown) => bindEvent(plan, event) });
}

function bindEvent(plan: ReturnType<typeof parseRebalancePlanRecord>, value: unknown): RebalancePlanEvent {
  const event = parseRebalancePlanEvent(value);
  for (const field of ["planId", "planHash", "cycleId", "portfolioId", "portfolioVersion", "portfolioSnapshotHash", "policyHash"] as const) {
    if (plan[field] !== event[field]) throw new Error(`rebalance plan event record ${field} mismatch`);
  }
  if (Date.parse(event.asOf) < Date.parse(plan.createdAt)) throw new Error("rebalance plan event cannot precede plan creation");
  if (event.eventType === "execution_applied" && plan.actions[event.actionSequence]?.actionId !== event.actionId) {
    throw new Error("rebalance plan execution event action identity or sequence mismatch");
  }
  return event;
}

function assertLists(payload: z.infer<typeof inputSchema>): void {
  if ("reasonCodes" in payload && (new Set(payload.reasonCodes).size !== payload.reasonCodes.length ||
    !isDeepStrictEqual(payload.reasonCodes, [...payload.reasonCodes].sort(compareText)))) {
    throw new Error("rebalance plan event reasons must be unique and canonical");
  }
  if (payload.eventType === "applied" && new Set(payload.executionEventIds).size !== payload.executionEventIds.length) {
    throw new Error("rebalance applied event execution IDs must be unique");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
