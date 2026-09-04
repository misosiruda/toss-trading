import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((value) => value === value.trim() && !/[\uD800-\uDFFF]/u.test(value), "identifier must already be canonical");
const money = z.number().int().positive().safe();
const nonNegativeMoney = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0), "negative zero is not canonical");
const positiveNumber = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);

export const rebalanceExecutionTargetSchema = z.discriminatedUnion("targetKind", [
  z.object({ targetKind: z.literal("fractional_buy_notional"), targetNotionalKrw: money }).strict(),
  z.object({
    targetKind: z.literal("fractional_sell_quantity"), targetQuantity: positiveNumber,
    referencePriceKrw: positiveNumber, markedTargetNotionalKrw: money, priceEvidenceRef: identifier
  }).strict(),
  z.object({
    targetKind: z.literal("whole_share_quantity"), targetQuantity: money,
    referencePriceKrw: positiveNumber, plannedNotionalKrw: money,
    residualNotionalKrw: nonNegativeMoney, priceEvidenceRef: identifier
  }).strict()
]);

const actionBase = z.object({
  actionId: identifier, actionSequence: nonNegativeMoney, market: marketSchema, symbol: identifier,
  executionTarget: rebalanceExecutionTargetSchema, maximumNotionalKrw: money,
  reasonCodes: z.array(identifier).min(1).max(128)
}).strict();
export const rebalanceActionSchema = z.discriminatedUnion("lineageKind", [
  actionBase.extend({ lineageKind: z.literal("mandate"), side: z.enum(["BUY", "SELL"]), mandateId: identifier }).strict(),
  actionBase.extend({
    lineageKind: z.literal("unassigned_legacy_reduce_only"), side: z.literal("SELL"),
    observedPositionRef: identifier, legacyStateDetectedAt: offsetQualifiedIsoDateTimeSchema
  }).strict()
]);
const predecessorSchema = z.object({
  predecessorKind: z.enum(["applied", "stale"]),
  predecessorPlanId: identifier, predecessorPlanHash: sha256HashSchema,
  predecessorPlanEventId: identifier, predecessorPlanEventHash: sha256HashSchema
}).strict();
const inputSchema = z.object({
  cycleId: identifier, portfolioId: identifier, portfolioVersion: identifier,
  portfolioSnapshotHash: sha256HashSchema, policyHash: sha256HashSchema,
  evidenceCutoffAt: offsetQualifiedIsoDateTimeSchema, triggerRef: identifier,
  phase: z.enum(["sell", "buy"]), predecessor: predecessorSchema.optional(),
  actions: z.array(rebalanceActionSchema).min(1).max(10_000), createdAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export const rebalancePlanRecordSchema = inputSchema.extend({ planId: identifier, planHash: sha256HashSchema }).strict();
export type RebalancePlanRecord = z.infer<typeof rebalancePlanRecordSchema>;
export type RebalanceAction = z.infer<typeof rebalanceActionSchema>;
export type RebalanceExecutionTarget = z.infer<typeof rebalanceExecutionTargetSchema>;

/** Immutable plan content only; source resolution, persistence and execution are separate. */
export function createRebalancePlanRecord(input: z.input<typeof inputSchema>): RebalancePlanRecord {
  const parsed = inputSchema.parse(input);
  const { predecessor, ...required } = parsed;
  const canonical = { ...required, ...(predecessor === undefined ? {} : { predecessor }),
    actions: parsed.actions.map((action) => ({ ...action, reasonCodes: [...action.reasonCodes].sort(compareText) })) };
  assertPlan(canonical);
  const { createdAt: _createdAt, ...payload } = canonical;
  const planHash = hashCanonicalPayload(payload);
  return deepFreeze(rebalancePlanRecordSchema.parse({ ...canonical, planId: hashDerivedId("rebalance_plan", planHash), planHash }));
}

export function parseRebalancePlanRecord(value: unknown): RebalancePlanRecord {
  const record = rebalancePlanRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record) || ("predecessor" in record && record.predecessor === undefined)) throw new Error("rebalance plan must already be canonical");
  assertPlan(record);
  const { planId, planHash, createdAt: _createdAt, ...payload } = record;
  if (planHash !== hashCanonicalPayload(payload) || planId !== hashDerivedId("rebalance_plan", planHash)) {
    throw new Error("rebalance plan identity does not match its payload");
  }
  if (record.predecessor?.predecessorPlanId === planId) throw new Error("rebalance plan cannot precede itself");
  return deepFreeze(record);
}

export function hashRebalanceExecutionTarget(value: unknown): string {
  const target = rebalanceExecutionTargetSchema.parse(value);
  if (!isDeepStrictEqual(value, target)) throw new Error("rebalance execution target must already be canonical");
  assertTarget(target);
  return hashCanonicalPayload(target);
}

function assertPlan(plan: z.infer<typeof inputSchema>): void {
  if (Date.parse(plan.evidenceCutoffAt) > Date.parse(plan.createdAt)) throw new Error("rebalance plan cutoff cannot follow creation");
  if (plan.predecessor?.predecessorKind === "applied" && plan.phase !== "buy") throw new Error("applied predecessor requires a follow-up buy plan");
  const ids = new Set<string>();
  for (const [index, action] of plan.actions.entries()) {
    if (action.actionSequence !== index || ids.has(action.actionId)) throw new Error("rebalance action order must be contiguous with unique IDs");
    ids.add(action.actionId);
    if (action.side !== (plan.phase === "buy" ? "BUY" : "SELL")) throw new Error("rebalance plan must contain only its phase side");
    if (new Set(action.reasonCodes).size !== action.reasonCodes.length ||
      !isDeepStrictEqual(action.reasonCodes, [...action.reasonCodes].sort(compareText))) throw new Error("rebalance action reasons must be unique and canonical");
    const target = action.executionTarget;
    if ((target.targetKind === "fractional_buy_notional" && action.side !== "BUY") ||
      (target.targetKind === "fractional_sell_quantity" && action.side !== "SELL")) throw new Error("rebalance execution target side mismatch");
    assertTarget(target);
    const targetNotional = target.targetKind === "fractional_buy_notional" ? target.targetNotionalKrw
      : target.targetKind === "fractional_sell_quantity" ? target.markedTargetNotionalKrw : target.plannedNotionalKrw;
    if (targetNotional > action.maximumNotionalKrw) throw new Error("rebalance execution target exceeds action notional cap");
    if (action.lineageKind === "unassigned_legacy_reduce_only" && Date.parse(action.legacyStateDetectedAt) > Date.parse(plan.evidenceCutoffAt)) {
      throw new Error("legacy position detection cannot follow plan cutoff");
    }
  }
}

function assertTarget(target: RebalanceExecutionTarget): void {
  if (target.targetKind === "fractional_buy_notional") return;
  // Match paper execution's integer-KRW gross amount convention.
  const marked = Math.round(target.targetQuantity * target.referencePriceKrw);
  if (!Number.isSafeInteger(marked) || marked <= 0 || marked !==
    (target.targetKind === "fractional_sell_quantity" ? target.markedTargetNotionalKrw : target.plannedNotionalKrw)) {
    throw new Error("rebalance target notional does not match rounded quantity and reference price");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
