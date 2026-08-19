import { createHash } from "node:crypto";

import {
  verifyLiveRiskAuthority,
  type FrozenLiveOrderIntent,
  type LiveRiskAuthority
} from "../risk/liveRiskAuthority.js";
import {
  reserveDryRunShadow,
  type DryRunShadowAuditEvent,
  type DryRunShadowRecord,
  type DryRunShadowState
} from "./dryRunShadowState.js";

declare const syntheticDryRunApprovalBrand: unique symbol;

export interface DryRunOrderRouterConfig {
  readonly BROKER_PROVIDER: "mock";
  readonly TRADING_ENABLED: false;
  readonly TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED: false;
  readonly TOSS_OPEN_API_DRY_RUN: true;
}

export interface SyntheticDryRunApprovalFixture {
  readonly [syntheticDryRunApprovalBrand]: true;
  toJSON(): never;
}

export interface CreateSyntheticDryRunApprovalFixtureInput {
  readonly scenarioId: string;
  readonly intent: FrozenLiveOrderIntent;
  readonly authority: LiveRiskAuthority;
}

export interface DryRunOrderRouterInput {
  readonly config: DryRunOrderRouterConfig;
  readonly scenarioId: string;
  readonly intent: FrozenLiveOrderIntent;
  readonly authority: LiveRiskAuthority;
  readonly approval: SyntheticDryRunApprovalFixture;
  readonly shadowState: DryRunShadowState;
}

export type DryRunOrderRouterOutcome =
  | "dry_run_validated"
  | "shadow_duplicate_rejected";

export interface DryRunOrderRouterAuditEvent {
  readonly event: DryRunOrderRouterOutcome;
  readonly scenarioRef: string;
  readonly syntheticIntentHash: string;
  readonly shadowKey: string;
  readonly riskAuthorityVerified: true;
  readonly syntheticApprovalConsumed: true;
  readonly simulationOnly: true;
  readonly externalEffect: "none";
}

export interface DryRunOrderRouterResult {
  readonly state: DryRunShadowState;
  readonly outcome: DryRunOrderRouterOutcome;
  readonly record: DryRunShadowRecord;
  readonly shadowAuditEvent: DryRunShadowAuditEvent;
  readonly auditEvent: DryRunOrderRouterAuditEvent;
}

interface SyntheticDryRunApprovalState {
  readonly scenarioBindingHash: string;
  readonly intent: FrozenLiveOrderIntent;
  readonly authority: LiveRiskAuthority;
  readonly evaluatedIntentHash: string;
}

const APPROVAL_BRANDS = new WeakSet<object>();
const ACTIVE_APPROVALS = new WeakSet<object>();
const APPROVAL_STATES = new WeakMap<object, SyntheticDryRunApprovalState>();
const SYNTHETIC_SCENARIO_ID_PATTERN =
  /^scenario_[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function createSyntheticDryRunApprovalFixture(
  input: CreateSyntheticDryRunApprovalFixtureInput
): SyntheticDryRunApprovalFixture {
  const root = materializeDataRecord(
    input,
    ["scenarioId", "intent", "authority"],
    ["scenarioId", "intent", "authority"]
  );
  const scenarioBindingHash = createScenarioBindingHash(root.scenarioId);
  const decision = verifyLiveRiskAuthority(root.authority, root.intent);
  const approval = Object.freeze({
    toJSON(): never {
      throw new Error("synthetic dry-run approval cannot be serialized");
    }
  }) as SyntheticDryRunApprovalFixture;
  APPROVAL_BRANDS.add(approval);
  ACTIVE_APPROVALS.add(approval);
  APPROVAL_STATES.set(
    approval,
    Object.freeze({
      scenarioBindingHash,
      intent: root.intent as FrozenLiveOrderIntent,
      authority: root.authority as LiveRiskAuthority,
      evaluatedIntentHash: decision.evaluatedIntentHash
    })
  );
  return approval;
}

export function routeDryRunOrder(
  input: DryRunOrderRouterInput
): DryRunOrderRouterResult {
  const root = materializeDataRecord(
    input,
    ["config", "scenarioId", "intent", "authority", "approval", "shadowState"],
    ["config", "scenarioId", "intent", "authority", "approval", "shadowState"]
  );
  parseSafeConfig(root.config);
  const scenarioBindingHash = createScenarioBindingHash(root.scenarioId);
  const approval = requireActiveApproval(root.approval);
  if (
    approval.intent !== root.intent ||
    approval.authority !== root.authority ||
    approval.scenarioBindingHash !== scenarioBindingHash
  ) {
    throw new Error(
      "synthetic dry-run approval does not match the exact authority, intent, and scenario"
    );
  }
  const decision = verifyLiveRiskAuthority(root.authority, root.intent);
  if (decision.evaluatedIntentHash !== approval.evaluatedIntentHash) {
    throw new Error("synthetic dry-run approval intent hash mismatch");
  }

  consumeApproval(root.approval);
  const shadow = reserveDryRunShadow(root.shadowState, {
    scenarioId: root.scenarioId as string,
    syntheticIntentHash: decision.evaluatedIntentHash
  });
  if (shadow.auditEvent === undefined) {
    throw new Error("dry-run router requires a shadow audit event");
  }
  const outcome: DryRunOrderRouterOutcome =
    shadow.outcome === "shadow_reserved"
      ? "dry_run_validated"
      : "shadow_duplicate_rejected";
  const auditEvent = Object.freeze({
    event: outcome,
    scenarioRef: shadow.record.scenarioId,
    syntheticIntentHash: shadow.record.syntheticIntentHash,
    shadowKey: shadow.record.shadowKey,
    riskAuthorityVerified: true as const,
    syntheticApprovalConsumed: true as const,
    simulationOnly: true as const,
    externalEffect: "none" as const
  });

  return Object.freeze({
    state: shadow.state,
    outcome,
    record: shadow.record,
    shadowAuditEvent: shadow.auditEvent,
    auditEvent
  });
}

function parseSafeConfig(value: unknown): DryRunOrderRouterConfig {
  const config = materializeDataRecord(
    value,
    [
      "BROKER_PROVIDER",
      "TRADING_ENABLED",
      "TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED",
      "TOSS_OPEN_API_DRY_RUN"
    ],
    [
      "BROKER_PROVIDER",
      "TRADING_ENABLED",
      "TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED",
      "TOSS_OPEN_API_DRY_RUN"
    ]
  );
  if (config.BROKER_PROVIDER !== "mock") {
    throw new Error("dry-run router requires exact BROKER_PROVIDER=mock");
  }
  if (config.TRADING_ENABLED !== false) {
    throw new Error("dry-run router requires exact TRADING_ENABLED=false");
  }
  if (config.TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED !== false) {
    throw new Error(
      "dry-run router requires exact TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED=false"
    );
  }
  if (config.TOSS_OPEN_API_DRY_RUN !== true) {
    throw new Error("dry-run router requires exact TOSS_OPEN_API_DRY_RUN=true");
  }
  return Object.freeze(config) as unknown as DryRunOrderRouterConfig;
}

function requireActiveApproval(value: unknown): SyntheticDryRunApprovalState {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.isFrozen(value) ||
    !APPROVAL_BRANDS.has(value) ||
    !ACTIVE_APPROVALS.has(value)
  ) {
    throw new Error(
      "synthetic dry-run approval must be an active fixture minted by the router"
    );
  }
  const state = APPROVAL_STATES.get(value);
  if (state === undefined || !Object.isFrozen(state)) {
    throw new Error("synthetic dry-run approval ownership is invalid");
  }
  return state;
}

function consumeApproval(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !ACTIVE_APPROVALS.delete(value)
  ) {
    throw new Error("synthetic dry-run approval is stale or already consumed");
  }
}

function createScenarioBindingHash(value: unknown): string {
  if (
    typeof value !== "string" ||
    !SYNTHETIC_SCENARIO_ID_PATTERN.test(value)
  ) {
    throw new Error(
      "dry-run router scenarioId must use the synthetic scenario_ namespace"
    );
  }
  return `sha256:${createHash("sha256")
    .update("toss-trading/synthetic-dry-run-approval-scenario/v1")
    .update(lengthPrefix(value))
    .digest("hex")}`;
}

function materializeDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("dry-run router input must be a plain data object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("dry-run router input must not use symbol keys");
  }
  const allowed = new Set(allowedKeys);
  if (keys.some((key) => !allowed.has(key as string))) {
    throw new Error("dry-run router input contains unknown fields");
  }
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("dry-run router input is missing required fields");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error("dry-run router input must use enumerable data fields");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function lengthPrefix(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}
