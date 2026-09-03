import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  hashCanonicalPayload,
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

const scheduledTriggerSchema = z
  .object({
    triggerKind: z.literal("scheduled"),
    scheduleBoundaryHash: sha256HashSchema,
    scheduleSlotId: identifierSchema,
    slotEndsAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const everyTickTriggerSchema = z
  .object({
    triggerKind: z.literal("every_tick"),
    packetHash: sha256HashSchema,
    packetAsOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const policyEventTriggerSchema = z
  .object({
    triggerKind: z.literal("policy_event"),
    eventType: z.enum(["regime_change", "thesis_evidence_change"]),
    policyTriggerEventId: identifierSchema,
    eventHash: sha256HashSchema,
    eventAsOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const riskBreachTriggerSchema = z
  .object({
    triggerKind: z.literal("risk_breach"),
    stateUpdateKind: z.enum([
      "market_mark",
      "fill",
      "fee",
      "cash_flow",
      "risk_state"
    ]),
    riskStateUpdateRecordId: identifierSchema,
    stateUpdateHash: sha256HashSchema,
    stateUpdateAsOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const portfolioCycleTriggerSchema = z.discriminatedUnion(
  "triggerKind",
  [
    scheduledTriggerSchema,
    everyTickTriggerSchema,
    policyEventTriggerSchema,
    riskBreachTriggerSchema
  ]
);

export type PortfolioCycleTrigger = z.infer<
  typeof portfolioCycleTriggerSchema
>;

export interface ResolvedPortfolioCycleTrigger {
  trigger: PortfolioCycleTrigger;
  triggerIdentity: string;
  triggerRef: string;
  evidenceCutoffAt: string;
  triggerPayloadHash: Sha256Hash;
}

export function parsePortfolioCycleTrigger(
  value: unknown
): PortfolioCycleTrigger {
  const trigger = portfolioCycleTriggerSchema.parse(value);
  if (!isDeepStrictEqual(value, trigger)) {
    throw new Error("portfolio cycle trigger must already be canonical");
  }
  return deepFreeze(trigger);
}

/** Derives the only permitted identity, reference, and cutoff for a trigger. */
export function resolvePortfolioCycleTrigger(
  value: unknown
): ResolvedPortfolioCycleTrigger {
  const trigger = parsePortfolioCycleTrigger(value);
  const derived = deriveTriggerIdentity(trigger);
  return deepFreeze({
    trigger,
    ...derived,
    triggerPayloadHash: hashCanonicalPayload(trigger)
  });
}

function deriveTriggerIdentity(trigger: PortfolioCycleTrigger): {
  triggerIdentity: string;
  triggerRef: string;
  evidenceCutoffAt: string;
} {
  switch (trigger.triggerKind) {
    case "scheduled":
      return {
        triggerIdentity: `scheduled:${trigger.scheduleBoundaryHash}`,
        triggerRef: trigger.scheduleSlotId,
        evidenceCutoffAt: trigger.slotEndsAt
      };
    case "every_tick":
      return {
        triggerIdentity: "every_tick",
        triggerRef: trigger.packetHash,
        evidenceCutoffAt: trigger.packetAsOf
      };
    case "policy_event":
      return {
        triggerIdentity: `event:${trigger.eventType}`,
        triggerRef: trigger.eventHash,
        evidenceCutoffAt: trigger.eventAsOf
      };
    case "risk_breach":
      return {
        triggerIdentity: `risk_breach:${trigger.stateUpdateKind}`,
        triggerRef: trigger.stateUpdateHash,
        evidenceCutoffAt: trigger.stateUpdateAsOf
      };
  }
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
