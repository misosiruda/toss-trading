import { createHash } from "node:crypto";

declare const dryRunShadowStateBrand: unique symbol;

export type DryRunShadowRecordStatus =
  | "shadow_reserved"
  | "shadow_completed"
  | "shadow_timeout_unknown"
  | "shadow_reconciled_no_external_effect";

export type DryRunShadowTransitionOutcome =
  | DryRunShadowRecordStatus
  | "shadow_duplicate_rejected";

export interface DryRunShadowState {
  readonly [dryRunShadowStateBrand]: true;
  toJSON(): never;
}

export interface DryRunShadowIdentity {
  readonly scenarioId: string;
  readonly syntheticIntentHash: string;
}

export interface DryRunShadowRecord extends DryRunShadowIdentity {
  readonly shadowKey: string;
  readonly status: DryRunShadowRecordStatus;
  readonly version: number;
  readonly stateHistory: readonly (
    | "shadow_created"
    | DryRunShadowRecordStatus
  )[];
}

export interface DryRunShadowTombstone extends DryRunShadowIdentity {
  readonly shadowKey: string;
  readonly permanent: true;
  readonly reservedAtSequence: number;
}

export interface DryRunShadowAuditEvent extends DryRunShadowIdentity {
  readonly sequence: number;
  readonly shadowKey: string;
  readonly event:
    | "shadow_reserved"
    | "shadow_completed"
    | "shadow_timeout_unknown"
    | "shadow_reconciled_no_external_effect"
    | "shadow_duplicate_rejected";
  readonly fromStatus: "shadow_created" | DryRunShadowRecordStatus;
  readonly toStatus: DryRunShadowRecordStatus;
  readonly simulationOnly: true;
  readonly externalEffect: "none";
}

export interface DryRunShadowSnapshot {
  readonly records: readonly DryRunShadowRecord[];
  readonly tombstones: readonly DryRunShadowTombstone[];
  readonly audit: readonly DryRunShadowAuditEvent[];
}

export interface DryRunShadowTransitionResult {
  readonly state: DryRunShadowState;
  readonly outcome: DryRunShadowTransitionOutcome;
  readonly record: DryRunShadowRecord;
  readonly auditEvent?: DryRunShadowAuditEvent | undefined;
}

interface OwnedDryRunShadowState {
  readonly snapshot: DryRunShadowSnapshot;
}

const STATE_BRANDS = new WeakSet<object>();
const ACTIVE_STATES = new WeakSet<object>();
const STATE_VALUES = new WeakMap<object, OwnedDryRunShadowState>();
const SYNTHETIC_SCENARIO_ID_PATTERN =
  /^scenario_[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function createDryRunShadowState(): DryRunShadowState {
  return mintState({ records: [], tombstones: [], audit: [] });
}

export function inspectDryRunShadowState(
  state: unknown
): DryRunShadowSnapshot {
  return requireOwnedState(state).snapshot;
}

export function reserveDryRunShadow(
  state: unknown,
  identity: DryRunShadowIdentity
): DryRunShadowTransitionResult {
  const owned = requireOwnedState(state);
  const normalizedIdentity = parseIdentity(identity);
  const existing = findRecord(owned.snapshot, normalizedIdentity);
  const tombstone = findTombstone(owned.snapshot, normalizedIdentity);
  if (existing !== undefined || tombstone !== undefined) {
    if (existing === undefined || tombstone === undefined) {
      throw new Error(
        "dry-run shadow state requires record and tombstone consistency"
      );
    }
    const auditEvent = freezeAuditEvent({
      ...normalizedIdentity,
      sequence: nextSequence(owned.snapshot),
      shadowKey: existing.shadowKey,
      event: "shadow_duplicate_rejected",
      fromStatus: existing.status,
      toStatus: existing.status,
      simulationOnly: true,
      externalEffect: "none"
    });
    const nextState = mintState({
      records: [...owned.snapshot.records],
      tombstones: [...owned.snapshot.tombstones],
      audit: [...owned.snapshot.audit, auditEvent]
    });
    consumeState(state);
    return Object.freeze({
      state: nextState,
      outcome: "shadow_duplicate_rejected",
      record: existing,
      auditEvent
    });
  }

  const sequence = nextSequence(owned.snapshot);
  const shadowKey = createShadowKey(normalizedIdentity);
  const record = freezeRecord({
    ...normalizedIdentity,
    shadowKey,
    status: "shadow_reserved",
    version: 1,
    stateHistory: ["shadow_created", "shadow_reserved"]
  });
  const tombstoneEntry = deepFreeze({
    ...normalizedIdentity,
    shadowKey,
    permanent: true as const,
    reservedAtSequence: sequence
  });
  const auditEvent = freezeAuditEvent({
    ...normalizedIdentity,
    sequence,
    shadowKey,
    event: "shadow_reserved",
    fromStatus: "shadow_created",
    toStatus: "shadow_reserved",
    simulationOnly: true,
    externalEffect: "none"
  });
  const nextState = mintState({
    records: [...owned.snapshot.records, record],
    tombstones: [...owned.snapshot.tombstones, tombstoneEntry],
    audit: [...owned.snapshot.audit, auditEvent]
  });
  consumeState(state);
  return Object.freeze({
    state: nextState,
    outcome: "shadow_reserved",
    record,
    auditEvent
  });
}

export function completeDryRunShadow(
  state: unknown,
  identity: DryRunShadowIdentity
): DryRunShadowTransitionResult {
  return transitionRecord(
    state,
    identity,
    "shadow_reserved",
    "shadow_completed"
  );
}

export function markDryRunShadowTimeoutUnknown(
  state: unknown,
  identity: DryRunShadowIdentity
): DryRunShadowTransitionResult {
  return transitionRecord(
    state,
    identity,
    "shadow_reserved",
    "shadow_timeout_unknown"
  );
}

export function reconcileDryRunShadowNoExternalEffect(
  state: unknown,
  identity: DryRunShadowIdentity
): DryRunShadowTransitionResult {
  return transitionRecord(
    state,
    identity,
    "shadow_timeout_unknown",
    "shadow_reconciled_no_external_effect"
  );
}

function transitionRecord(
  state: unknown,
  identity: DryRunShadowIdentity,
  expectedStatus: DryRunShadowRecordStatus,
  nextStatus: DryRunShadowRecordStatus
): DryRunShadowTransitionResult {
  const owned = requireOwnedState(state);
  const normalizedIdentity = parseIdentity(identity);
  const recordIndex = findRecordIndex(owned.snapshot, normalizedIdentity);
  if (recordIndex < 0) {
    throw new Error("dry-run shadow transition requires a reserved record");
  }
  const current = owned.snapshot.records[recordIndex]!;
  const tombstone = findTombstone(owned.snapshot, normalizedIdentity);
  if (tombstone === undefined || tombstone.shadowKey !== current.shadowKey) {
    throw new Error("dry-run shadow transition requires a permanent tombstone");
  }
  if (current.status !== expectedStatus) {
    throw new Error(
      `dry-run shadow transition requires ${expectedStatus}, got ${current.status}`
    );
  }

  const record = freezeRecord({
    ...current,
    status: nextStatus,
    version: current.version + 1,
    stateHistory: [...current.stateHistory, nextStatus]
  });
  const auditEvent = freezeAuditEvent({
    ...normalizedIdentity,
    sequence: nextSequence(owned.snapshot),
    shadowKey: current.shadowKey,
    event: nextStatus,
    fromStatus: current.status,
    toStatus: nextStatus,
    simulationOnly: true,
    externalEffect: "none"
  });
  const records = [...owned.snapshot.records];
  records[recordIndex] = record;
  const nextState = mintState({
    records,
    tombstones: [...owned.snapshot.tombstones],
    audit: [...owned.snapshot.audit, auditEvent]
  });
  consumeState(state);
  return Object.freeze({
    state: nextState,
    outcome: nextStatus,
    record,
    auditEvent
  });
}

function mintState(snapshot: DryRunShadowSnapshot): DryRunShadowState {
  assertSnapshotConsistency(snapshot);
  const frozenSnapshot = deepFreeze({
    records: [...snapshot.records],
    tombstones: [...snapshot.tombstones],
    audit: [...snapshot.audit]
  });
  const state = Object.freeze({
    toJSON(): never {
      throw new Error("dry-run shadow state cannot be serialized");
    }
  }) as DryRunShadowState;
  STATE_BRANDS.add(state);
  ACTIVE_STATES.add(state);
  STATE_VALUES.set(state, Object.freeze({ snapshot: frozenSnapshot }));
  return state;
}

function requireOwnedState(value: unknown): OwnedDryRunShadowState {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.isFrozen(value) ||
    !STATE_BRANDS.has(value) ||
    !ACTIVE_STATES.has(value)
  ) {
    throw new Error(
      "dry-run shadow state must be created by the isolated shadow module"
    );
  }
  const owned = STATE_VALUES.get(value);
  if (owned === undefined || !Object.isFrozen(owned.snapshot)) {
    throw new Error("dry-run shadow state ownership is invalid");
  }
  assertSnapshotConsistency(owned.snapshot);
  return owned;
}

function consumeState(value: unknown): void {
  if (typeof value !== "object" || value === null || !ACTIVE_STATES.delete(value)) {
    throw new Error("dry-run shadow state handle is stale or already consumed");
  }
}

function parseIdentity(value: unknown): DryRunShadowIdentity {
  const record = materializeDataRecord(
    value,
    ["scenarioId", "syntheticIntentHash"],
    ["scenarioId", "syntheticIntentHash"]
  );
  if (
    typeof record.scenarioId !== "string" ||
    !SYNTHETIC_SCENARIO_ID_PATTERN.test(record.scenarioId)
  ) {
    throw new Error(
      "dry-run shadow scenarioId must use the synthetic scenario_ namespace"
    );
  }
  if (
    typeof record.syntheticIntentHash !== "string" ||
    !SHA256_PATTERN.test(record.syntheticIntentHash)
  ) {
    throw new Error(
      "dry-run shadow syntheticIntentHash must be a canonical sha256 value"
    );
  }
  return Object.freeze({
    scenarioId: createScenarioRef(record.scenarioId),
    syntheticIntentHash: record.syntheticIntentHash
  });
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
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error("dry-run shadow input must use plain data objects");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("dry-run shadow input must not use symbol keys");
  }
  const allowed = new Set(allowedKeys);
  if (keys.some((key) => !allowed.has(key as string))) {
    throw new Error("dry-run shadow input contains unknown fields");
  }
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("dry-run shadow input is missing required fields");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error("dry-run shadow input must use enumerable data fields");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function createShadowKey(identity: DryRunShadowIdentity): string {
  const payload = `${lengthPrefix(identity.scenarioId)}${lengthPrefix(
    identity.syntheticIntentHash
  )}`;
  return `shadow:sha256:${createHash("sha256")
    .update("toss-trading/dry-run-shadow/v1")
    .update(payload)
    .digest("hex")}`;
}

function createScenarioRef(scenarioId: string): string {
  return `scenario:sha256:${createHash("sha256")
    .update("toss-trading/dry-run-shadow-scenario/v1")
    .update(lengthPrefix(scenarioId))
    .digest("hex")}`;
}

function lengthPrefix(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function findRecord(
  snapshot: DryRunShadowSnapshot,
  identity: DryRunShadowIdentity
): DryRunShadowRecord | undefined {
  return snapshot.records.find((record) => matchesIdentity(record, identity));
}

function findRecordIndex(
  snapshot: DryRunShadowSnapshot,
  identity: DryRunShadowIdentity
): number {
  return snapshot.records.findIndex((record) =>
    matchesIdentity(record, identity)
  );
}

function findTombstone(
  snapshot: DryRunShadowSnapshot,
  identity: DryRunShadowIdentity
): DryRunShadowTombstone | undefined {
  return snapshot.tombstones.find((entry) =>
    matchesIdentity(entry, identity)
  );
}

function matchesIdentity(
  value: DryRunShadowIdentity,
  identity: DryRunShadowIdentity
): boolean {
  return (
    value.scenarioId === identity.scenarioId &&
    value.syntheticIntentHash === identity.syntheticIntentHash
  );
}

function nextSequence(snapshot: DryRunShadowSnapshot): number {
  return snapshot.audit.length + 1;
}

function assertSnapshotConsistency(snapshot: DryRunShadowSnapshot): void {
  const records = new Map<string, string>();
  const tombstones = new Map<string, string>();
  for (const record of snapshot.records) {
    const key = identityIndexKey(record);
    if (records.has(key)) {
      throw new Error("dry-run shadow snapshot has duplicate records");
    }
    records.set(key, record.shadowKey);
  }
  for (const tombstone of snapshot.tombstones) {
    const key = identityIndexKey(tombstone);
    if (tombstones.has(key)) {
      throw new Error("dry-run shadow snapshot has duplicate tombstones");
    }
    tombstones.set(key, tombstone.shadowKey);
  }
  if (records.size !== tombstones.size) {
    throw new Error("dry-run shadow snapshot is inconsistent");
  }
  for (const [key, shadowKey] of records) {
    if (tombstones.get(key) !== shadowKey) {
      throw new Error("dry-run shadow snapshot is inconsistent");
    }
  }
}

function identityIndexKey(identity: DryRunShadowIdentity): string {
  return `${lengthPrefix(identity.scenarioId)}${lengthPrefix(
    identity.syntheticIntentHash
  )}`;
}

function freezeRecord(record: DryRunShadowRecord): DryRunShadowRecord {
  return deepFreeze({
    ...record,
    stateHistory: [...record.stateHistory]
  });
}

function freezeAuditEvent(
  event: DryRunShadowAuditEvent
): DryRunShadowAuditEvent {
  return Object.freeze({ ...event });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
