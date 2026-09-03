import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
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

const evidenceRefsSchema = z.array(identifierSchema).min(1).max(128);
const thesisStatusSchema = z.enum([
  "intact",
  "watch",
  "invalidated",
  "unknown"
]);

const basePayloadShape = {
  portfolioId: identifierSchema,
  policyHash: sha256HashSchema,
  evidenceRefs: evidenceRefsSchema,
  asOf: offsetQualifiedIsoDateTimeSchema
};

const regimeChangePayloadSchema = z
  .object({
    ...basePayloadShape,
    eventType: z.literal("regime_change"),
    market: marketSchema,
    previousRegime: identifierSchema,
    currentRegime: identifierSchema
  })
  .strict();

const thesisEvidenceChangePayloadSchema = z
  .object({
    ...basePayloadShape,
    eventType: z.literal("thesis_evidence_change"),
    mandateId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    previousThesisStatus: thesisStatusSchema,
    currentThesisStatus: thesisStatusSchema
  })
  .strict();

const portfolioPolicyTriggerEventPayloadSchema = z.discriminatedUnion(
  "eventType",
  [regimeChangePayloadSchema, thesisEvidenceChangePayloadSchema]
);

const recordIdentityShape = {
  policyTriggerEventId: identifierSchema,
  eventHash: sha256HashSchema,
  createdAt: offsetQualifiedIsoDateTimeSchema
};

export const portfolioPolicyTriggerEventSchema = z.discriminatedUnion(
  "eventType",
  [
    regimeChangePayloadSchema.extend(recordIdentityShape).strict(),
    thesisEvidenceChangePayloadSchema.extend(recordIdentityShape).strict()
  ]
);

export type PortfolioPolicyTriggerEvent = z.infer<
  typeof portfolioPolicyTriggerEventSchema
>;
export type CreatePortfolioPolicyTriggerEventInput = z.input<
  typeof portfolioPolicyTriggerEventPayloadSchema
> & { createdAt: string };

export function createPortfolioPolicyTriggerEvent(
  input: CreatePortfolioPolicyTriggerEventInput
): PortfolioPolicyTriggerEvent {
  const { createdAt, ...rawPayload } = input;
  const payload = portfolioPolicyTriggerEventPayloadSchema.parse({
    ...rawPayload,
    evidenceRefs: canonicalEvidenceRefs(rawPayload.evidenceRefs)
  });
  assertEventSemantics(payload, createdAt);
  const eventHash = hashCanonicalPayload(payload);
  return deepFreeze(
    portfolioPolicyTriggerEventSchema.parse({
      policyTriggerEventId: hashDerivedId(
        "portfolio_policy_trigger_event",
        eventHash
      ),
      eventHash,
      ...payload,
      createdAt
    })
  );
}

export function parsePortfolioPolicyTriggerEvent(
  value: unknown
): PortfolioPolicyTriggerEvent {
  const event = portfolioPolicyTriggerEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) {
    throw new Error("portfolio policy trigger event must already be canonical");
  }
  const {
    policyTriggerEventId,
    eventHash,
    createdAt,
    ...payload
  } = event;
  assertEventSemantics(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    eventHash !== expectedHash ||
    policyTriggerEventId !==
      hashDerivedId("portfolio_policy_trigger_event", expectedHash)
  ) {
    throw new Error("portfolio policy trigger event identity does not match payload");
  }
  return deepFreeze(event);
}

function assertEventSemantics(
  payload: z.infer<typeof portfolioPolicyTriggerEventPayloadSchema>,
  createdAt: string
): void {
  offsetQualifiedIsoDateTimeSchema.parse(createdAt);
  assertCanonicalEvidenceRefs(payload.evidenceRefs);
  if (Date.parse(payload.asOf) > Date.parse(createdAt)) {
    throw new Error("portfolio policy trigger event cannot be created before asOf");
  }
  if (
    payload.eventType === "regime_change" &&
    payload.previousRegime === payload.currentRegime
  ) {
    throw new Error("regime change event requires distinct regime values");
  }
  if (
    payload.eventType === "thesis_evidence_change" &&
    payload.previousThesisStatus === payload.currentThesisStatus
  ) {
    throw new Error("thesis evidence event requires distinct thesis statuses");
  }
}

function canonicalEvidenceRefs(values: readonly string[]): string[] {
  const parsed = evidenceRefsSchema.parse(values);
  const canonical = [...parsed].sort(compareText);
  assertNoDuplicateEvidenceRefs(canonical);
  return canonical;
}

function assertCanonicalEvidenceRefs(values: readonly string[]): void {
  const canonical = [...values].sort(compareText);
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error("policy trigger evidenceRefs must use canonical order");
  }
  assertNoDuplicateEvidenceRefs(values);
}

function assertNoDuplicateEvidenceRefs(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error("policy trigger evidenceRefs must not contain duplicates");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
