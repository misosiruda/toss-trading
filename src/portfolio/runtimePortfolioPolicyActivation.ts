import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";
import {
  ImmutablePolicyDependencyRepository,
  resolveStrategyBucketRuntimePolicyDependencyIdentities
} from "./runtimePolicyDependencyResolver.js";
import {
  parseRuntimePortfolioPolicyRecord,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";

const identifierSchema = z.string().trim().min(1).max(160);
const versionSchema = z.string().trim().min(1).max(80);
const positiveIntegerSchema = z.number().int().positive();
const offsetQualifiedIsoDateTimeSchema = isoDateTimeSchema.refine(
  (value) => /(Z|[+-]\d{2}:\d{2})$/.test(value),
  "date-time must include a UTC or numeric timezone offset"
);

const activatedPayloadSchema = z
  .object({
    eventType: z.literal("activated"),
    mode: z.literal("paper_only"),
    portfolioId: identifierSchema,
    activationSequence: positiveIntegerSchema,
    policyRecordId: identifierSchema,
    policyId: identifierSchema,
    policyVersion: versionSchema,
    policyHash: sha256HashSchema,
    policyLineageHash: sha256HashSchema,
    supersedesActivationId: identifierSchema.optional(),
    effectiveFrom: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const retiredPayloadSchema = z
  .object({
    eventType: z.literal("retired"),
    mode: z.literal("paper_only"),
    portfolioId: identifierSchema,
    activationSequence: positiveIntegerSchema,
    retiredActivationId: identifierSchema,
    reasonCode: identifierSchema,
    effectiveFrom: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const portfolioPolicyActivatedEventSchema = activatedPayloadSchema
  .safeExtend({
    activationId: identifierSchema,
    activationEventHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const portfolioPolicyRetiredEventSchema = retiredPayloadSchema
  .safeExtend({
    retirementEventId: identifierSchema,
    activationEventHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const portfolioPolicyActivationEventSchema = z.discriminatedUnion(
  "eventType",
  [portfolioPolicyActivatedEventSchema, portfolioPolicyRetiredEventSchema]
);

export type PortfolioPolicyActivatedEvent = z.infer<
  typeof portfolioPolicyActivatedEventSchema
>;
export type PortfolioPolicyRetiredEvent = z.infer<
  typeof portfolioPolicyRetiredEventSchema
>;
export type PortfolioPolicyActivationEvent = z.infer<
  typeof portfolioPolicyActivationEventSchema
>;

export interface CreatePortfolioPolicyActivatedEventInput {
  policy: unknown;
  activationSequence: number;
  supersedesActivationId?: string;
  createdAt: string;
}

export interface CreatePortfolioPolicyRetiredEventInput {
  portfolioId: string;
  activationSequence: number;
  retiredActivationId: string;
  reasonCode: string;
  createdAt: string;
}

export interface ActiveRuntimePortfolioPolicy {
  activation: PortfolioPolicyActivatedEvent;
  policy: RuntimePortfolioPolicyRecord;
}

export function createPortfolioPolicyActivatedEvent(
  input: CreatePortfolioPolicyActivatedEventInput
): PortfolioPolicyActivatedEvent {
  const policy = parseRuntimePortfolioPolicyRecord(input.policy);
  const createdAt = offsetQualifiedIsoDateTimeSchema.parse(input.createdAt);
  const payload = activatedPayloadSchema.parse({
    eventType: "activated",
    mode: "paper_only",
    portfolioId: policy.portfolioId,
    activationSequence: input.activationSequence,
    policyRecordId: policy.runtimePolicyRecordId,
    policyId: policy.policyId,
    policyVersion: policy.version,
    policyHash: policy.policyHash,
    policyLineageHash: policy.lineageHash,
    ...(input.supersedesActivationId === undefined
      ? {}
      : { supersedesActivationId: input.supersedesActivationId }),
    effectiveFrom: createdAt
  });
  const activationEventHash = hashCanonicalPayload(payload);
  return deepFreeze({
    ...payload,
    activationId: hashDerivedId(
      "portfolio_policy_activation",
      activationEventHash
    ),
    activationEventHash,
    createdAt
  });
}

export function createPortfolioPolicyRetiredEvent(
  input: CreatePortfolioPolicyRetiredEventInput
): PortfolioPolicyRetiredEvent {
  const createdAt = offsetQualifiedIsoDateTimeSchema.parse(input.createdAt);
  const payload = retiredPayloadSchema.parse({
    eventType: "retired",
    mode: "paper_only",
    portfolioId: input.portfolioId,
    activationSequence: input.activationSequence,
    retiredActivationId: input.retiredActivationId,
    reasonCode: input.reasonCode,
    effectiveFrom: createdAt
  });
  const activationEventHash = hashCanonicalPayload(payload);
  return deepFreeze({
    ...payload,
    retirementEventId: hashDerivedId(
      "portfolio_policy_retirement",
      activationEventHash
    ),
    activationEventHash,
    createdAt
  });
}

export function parsePortfolioPolicyActivationEvent(
  value: unknown
): PortfolioPolicyActivationEvent {
  const event = portfolioPolicyActivationEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) {
    throw new Error("portfolio policy activation event must already be canonical");
  }
  const verified =
    event.eventType === "activated"
      ? verifyActivatedEvent(event)
      : verifyRetiredEvent(event);
  if (verified.effectiveFrom !== verified.createdAt) {
    throw new Error(
      "portfolio policy activation effectiveFrom must equal createdAt"
    );
  }
  return deepFreeze(verified);
}

export function resolveActiveRuntimePortfolioPolicyAsOf(input: {
  portfolioId: string;
  asOf: string;
  events: readonly unknown[];
  policies: readonly unknown[];
  dependencies: ImmutablePolicyDependencyRepository;
}): ActiveRuntimePortfolioPolicy {
  const portfolioId = identifierSchema.parse(input.portfolioId);
  const asOfTime = chronologyTimestamp(input.asOf);
  const policiesById = exactPolicyMap(input.policies);
  const events = input.events.map(parsePortfolioPolicyActivationEvent);
  assertUniqueEventIds(events);
  const activeAtAsOf = validateAndFoldPortfolioEvents(
    events.filter(
      (event) =>
        event.portfolioId === portfolioId &&
        chronologyTimestamp(event.effectiveFrom) <= asOfTime
    ),
    policiesById,
    input.dependencies
  );

  if (activeAtAsOf === undefined) {
    throw new Error("active runtime portfolio policy is required");
  }
  return deepFreeze(activeAtAsOf);
}

function verifyActivatedEvent(
  event: PortfolioPolicyActivatedEvent
): PortfolioPolicyActivatedEvent {
  const {
    activationId,
    activationEventHash,
    createdAt,
    ...payload
  } = event;
  const expectedHash = hashCanonicalPayload(payload);
  if (activationEventHash !== expectedHash) {
    throw new Error("portfolio policy activation event hash mismatch");
  }
  if (
    activationId !==
    hashDerivedId("portfolio_policy_activation", expectedHash)
  ) {
    throw new Error("portfolio policy activation ID mismatch");
  }
  chronologyTimestamp(createdAt);
  return event;
}

function verifyRetiredEvent(
  event: PortfolioPolicyRetiredEvent
): PortfolioPolicyRetiredEvent {
  const {
    retirementEventId,
    activationEventHash,
    createdAt,
    ...payload
  } = event;
  const expectedHash = hashCanonicalPayload(payload);
  if (activationEventHash !== expectedHash) {
    throw new Error("portfolio policy retirement event hash mismatch");
  }
  if (
    retirementEventId !==
    hashDerivedId("portfolio_policy_retirement", expectedHash)
  ) {
    throw new Error("portfolio policy retirement ID mismatch");
  }
  chronologyTimestamp(createdAt);
  return event;
}

function exactPolicyMap(
  values: readonly unknown[]
): ReadonlyMap<string, RuntimePortfolioPolicyRecord> {
  const policies = new Map<string, RuntimePortfolioPolicyRecord>();
  for (const value of values) {
    const policy = parseRuntimePortfolioPolicyRecord(value);
    if (policies.has(policy.runtimePolicyRecordId)) {
      throw new Error("duplicate runtime portfolio policy record ID");
    }
    policies.set(policy.runtimePolicyRecordId, policy);
  }
  return policies;
}

function assertUniqueEventIds(
  events: readonly PortfolioPolicyActivationEvent[]
): void {
  const seen = new Set<string>();
  for (const event of events) {
    const eventId =
      event.eventType === "activated"
        ? event.activationId
        : event.retirementEventId;
    if (seen.has(eventId)) {
      throw new Error("portfolio policy activation event ID must be unique");
    }
    seen.add(eventId);
  }
}

function validateAndFoldPortfolioEvents(
  events: readonly PortfolioPolicyActivationEvent[],
  policiesById: ReadonlyMap<string, RuntimePortfolioPolicyRecord>,
  dependencies: ImmutablePolicyDependencyRepository
): ActiveRuntimePortfolioPolicy | undefined {
  const ordered = [...events].sort(
    (left, right) => left.activationSequence - right.activationSequence
  );
  let expectedSequence = 1;
  let previousEffectiveTime: number | undefined;
  let current: ActiveRuntimePortfolioPolicy | undefined;

  for (const event of ordered) {
    if (event.activationSequence !== expectedSequence) {
      throw new Error(
        "portfolio policy activation sequence must be contiguous from one"
      );
    }
    expectedSequence += 1;
    const effectiveTime = chronologyTimestamp(event.effectiveFrom);
    if (
      previousEffectiveTime !== undefined &&
      effectiveTime < previousEffectiveTime
    ) {
      throw new Error("portfolio policy activation sequence cannot be backdated");
    }
    previousEffectiveTime = effectiveTime;

    if (event.eventType === "activated") {
      const policy = resolveActivatedPolicy(event, policiesById, dependencies);
      if (current === undefined) {
        if (event.supersedesActivationId !== undefined) {
          throw new Error(
            "first or post-retirement activation cannot supersede another activation"
          );
        }
      } else if (event.supersedesActivationId !== current.activation.activationId) {
        throw new Error(
          "replacement activation must supersede the current activation"
        );
      }
      current = deepFreeze({ activation: event, policy });
    } else {
      if (
        current === undefined ||
        event.retiredActivationId !== current.activation.activationId
      ) {
        throw new Error("retirement must target the current activation");
      }
      current = undefined;
    }

  }
  return current;
}

function resolveActivatedPolicy(
  event: PortfolioPolicyActivatedEvent,
  policiesById: ReadonlyMap<string, RuntimePortfolioPolicyRecord>,
  dependencies: ImmutablePolicyDependencyRepository
): RuntimePortfolioPolicyRecord {
  const policy = policiesById.get(event.policyRecordId);
  if (policy === undefined) {
    throw new Error("activated runtime portfolio policy record does not resolve");
  }
  if (
    policy.portfolioId !== event.portfolioId ||
    policy.policyId !== event.policyId ||
    policy.version !== event.policyVersion ||
    policy.policyHash !== event.policyHash ||
    policy.lineageHash !== event.policyLineageHash
  ) {
    throw new Error("activated runtime portfolio policy identity mismatch");
  }
  if (chronologyTimestamp(policy.createdAt) > chronologyTimestamp(event.createdAt)) {
    throw new Error("runtime portfolio policy cannot postdate its activation");
  }
  const dependencyRecords = policy.strategyBuckets.flatMap((bucket) => {
    const resolved = resolveStrategyBucketRuntimePolicyDependencyIdentities(
      bucket,
      dependencies
    );
    return [
      resolved.selectionPolicy,
      resolved.riskRuleSet,
      ...resolved.riskRules.map(({ parameter }) => parameter),
      resolved.drawdownSemantics,
      ...resolved.scheduleBoundaries.flatMap(({ boundary, calendar }) => [
        boundary,
        calendar
      ])
    ];
  });
  const legacyRisk = dependencies.resolveRiskRuleSetDependencies(
    policy.legacyReduceOnlyPolicy.riskRuleSetRef
  );
  dependencyRecords.push(
    legacyRisk.riskRuleSet,
    ...legacyRisk.riskRules.map(({ parameter }) => parameter)
  );
  const policyCreatedAt = chronologyTimestamp(policy.createdAt);
  if (
    dependencyRecords.some(
      (record) => chronologyTimestamp(record.createdAt) > policyCreatedAt
    )
  ) {
    throw new Error("runtime policy dependency cannot postdate the policy");
  }
  return policy;
}

function chronologyTimestamp(value: string): number {
  const parsed = offsetQualifiedIsoDateTimeSchema.parse(value);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp)) {
    throw new Error("chronology timestamp must be an ISO-compatible date-time");
  }
  return timestamp;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
