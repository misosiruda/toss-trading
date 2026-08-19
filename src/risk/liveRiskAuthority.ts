import { createHash } from "node:crypto";

import {
  LiveRiskEngine,
  type LiveOpenOrder,
  type LiveOrderIntent,
  type LiveOrderPreviewRef,
  type LiveRiskDecision,
  type LiveRiskInput,
  type LiveRiskPolicy,
  type LiveRiskPosition,
  type LiveRiskSnapshot
} from "./liveRiskEngine.js";
import {
  normalizeLiveRiskSymbol,
  type LiveRiskRejectCode
} from "./liveRiskPolicy.js";

declare const liveRiskAuthorityBrand: unique symbol;

export const LIVE_ORDER_INTENT_HASH_SCHEMA_VERSION = 1;
export const LIVE_ORDER_INTENT_HASH_ALGORITHM = "sha256";

const LIVE_ORDER_INTENT_HASH_DOMAIN =
  "toss-trading/live-order-intent-authority/v1";

export type FrozenLiveOrderIntent = Readonly<
  Omit<LiveOrderIntent, "preview" | "approvals">
> & {
  readonly preview?: Readonly<LiveOrderPreviewRef> | undefined;
  readonly approvals?:
    | Readonly<{
        marketOrderApproved?: boolean | undefined;
      }>
    | undefined;
};

export type LiveRiskAuthorityDecision = Readonly<
  Omit<LiveRiskDecision, "rejectCodes" | "checkedRules">
> & {
  readonly rejectCodes: readonly LiveRiskRejectCode[];
  readonly checkedRules: readonly string[];
  readonly evaluatedIntentHash: string;
};

export interface LiveRiskAuthority {
  readonly [liveRiskAuthorityBrand]: true;
  toJSON(): never;
}

export interface LiveRiskAuthorityEvaluation {
  readonly intent: FrozenLiveOrderIntent;
  readonly authority: LiveRiskAuthority;
  readonly decision: LiveRiskAuthorityDecision;
}

export interface EvaluateLiveRiskAuthorityInput {
  intent: unknown;
  snapshot: LiveRiskSnapshot;
  policy?: Partial<LiveRiskPolicy> | undefined;
}

interface LiveRiskAuthorityState {
  readonly intent: FrozenLiveOrderIntent;
  readonly decision: LiveRiskAuthorityDecision;
}

type CanonicalScalar = string | number | boolean | undefined;

const AUTHORITY_STATES = new WeakMap<object, LiveRiskAuthorityState>();
const AUTHORITY_BRANDS = new WeakSet<object>();
const INTENT_REQUIRED_KEYS = [
  "orderIntentId",
  "signalId",
  "idempotencyKey",
  "market",
  "symbol",
  "side",
  "orderType",
  "quantity",
  "estimatedGrossAmountKrw",
  "createdAt",
  "expiresAt"
] as const;
const INTENT_OPTIONAL_KEYS = ["preview", "approvals"] as const;
const PREVIEW_REQUIRED_KEYS = [
  "previewId",
  "orderIntentId",
  "estimatedGrossAmountKrw",
  "expiresAt"
] as const;
const APPROVAL_OPTIONAL_KEYS = ["marketOrderApproved"] as const;
const SNAPSHOT_REQUIRED_KEYS = [
  "riskSnapshotRef",
  "capturedAt",
  "dailyLossKrw",
  "positions",
  "openOrders",
  "marketSessions"
] as const;
const POSITION_REQUIRED_KEYS = [
  "market",
  "symbol",
  "quantity",
  "averagePriceKrw"
] as const;
const POSITION_OPTIONAL_KEYS = ["marketValueKrw"] as const;
const OPEN_ORDER_REQUIRED_KEYS = [
  "orderIntentId",
  "idempotencyKey",
  "market",
  "symbol",
  "side"
] as const;
const OPEN_ORDER_OPTIONAL_KEYS = [
  "signalId",
  "estimatedGrossAmountKrw",
  "quantity"
] as const;
const POLICY_OPTIONAL_KEYS = [
  "killSwitch",
  "maxOrderAmountKrw",
  "maxDailyLossKrw",
  "maxSymbolExposureKrw",
  "maxMarketExposureKrw",
  "maxTotalExposureKrw",
  "maxSnapshotAgeMs",
  "allowedSymbols",
  "allowedMarkets",
  "requireMarketOpen",
  "maxOpenOrders",
  "marketOrderPolicy",
  "requirePreview",
  "cooldownEntries",
  "now"
] as const;
const COOLDOWN_REQUIRED_KEYS = ["symbol", "activeUntil"] as const;
const COOLDOWN_OPTIONAL_KEYS = ["market", "side", "reason"] as const;

export function evaluateLiveRiskAuthority(
  input: EvaluateLiveRiskAuthorityInput
): LiveRiskAuthorityEvaluation {
  const root = materializeDataRecord(
    input,
    ["intent", "snapshot", "policy"],
    ["intent", "snapshot"]
  );
  const intent = createFrozenLiveOrderIntent(root.intent);
  const snapshot = createFrozenLiveRiskSnapshot(root.snapshot);
  const engineInput: LiveRiskInput = {
    intent,
    snapshot
  };
  if (Object.hasOwn(root, "policy")) {
    engineInput.policy = createFrozenLiveRiskPolicyInput(root.policy);
  }

  const evaluatedIntentHash = createLiveOrderIntentHash(intent);
  const decision = freezeAuthorityDecision(
    new LiveRiskEngine().evaluate(engineInput),
    evaluatedIntentHash
  );
  const authority = createOpaqueAuthority();
  AUTHORITY_BRANDS.add(authority);
  AUTHORITY_STATES.set(authority, Object.freeze({ intent, decision }));

  return Object.freeze({ intent, authority, decision });
}

export function inspectLiveRiskAuthority(
  authority: unknown
): LiveRiskAuthorityDecision {
  return requireOwnedAuthority(authority).decision;
}

export function verifyLiveRiskAuthority(
  authority: unknown,
  intent: unknown
): LiveRiskAuthorityDecision {
  const state = requireOwnedAuthority(authority);
  if (intent !== state.intent) {
    throw new Error(
      "live risk authority requires the exact evaluated intent snapshot"
    );
  }
  if (!isDeepFrozenIntent(intent)) {
    throw new Error("live risk authority intent snapshot must remain deep-frozen");
  }
  const evaluatedIntentHash = createLiveOrderIntentHash(state.intent);
  if (evaluatedIntentHash !== state.decision.evaluatedIntentHash) {
    throw new Error("live risk authority intent hash mismatch");
  }
  if (!state.decision.approved) {
    throw new Error("live risk authority decision is not approved");
  }
  return state.decision;
}

function createFrozenLiveOrderIntent(value: unknown): FrozenLiveOrderIntent {
  const record = materializeDataRecord(
    value,
    [...INTENT_REQUIRED_KEYS, ...INTENT_OPTIONAL_KEYS],
    INTENT_REQUIRED_KEYS
  );
  assertNonEmptyString(record.orderIntentId, "orderIntentId");
  assertNonEmptyString(record.signalId, "signalId");
  assertNonEmptyString(record.idempotencyKey, "idempotencyKey");
  if (record.market !== "KR" && record.market !== "US") {
    throw new Error("live order intent market must be KR or US");
  }
  assertNonEmptyString(record.symbol, "symbol");
  if (record.side !== "BUY" && record.side !== "SELL") {
    throw new Error("live order intent side must be BUY or SELL");
  }
  if (record.orderType !== "LIMIT" && record.orderType !== "MARKET") {
    throw new Error("live order intent orderType must be LIMIT or MARKET");
  }
  assertPositiveFiniteNumber(record.quantity, "quantity");
  assertPositiveFiniteNumber(
    record.estimatedGrossAmountKrw,
    "estimatedGrossAmountKrw"
  );
  assertTimestamp(record.createdAt, "createdAt");
  assertTimestamp(record.expiresAt, "expiresAt");

  const intent: LiveOrderIntent = {
    orderIntentId: record.orderIntentId,
    signalId: record.signalId,
    idempotencyKey: record.idempotencyKey,
    market: record.market,
    symbol: record.symbol,
    side: record.side,
    orderType: record.orderType,
    quantity: record.quantity,
    estimatedGrossAmountKrw: record.estimatedGrossAmountKrw,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt
  };

  if (Object.hasOwn(record, "preview")) {
    intent.preview = clonePreview(record.preview);
  }
  if (Object.hasOwn(record, "approvals")) {
    intent.approvals = cloneApprovals(record.approvals);
  }

  return deepFreeze(intent) as FrozenLiveOrderIntent;
}

function clonePreview(value: unknown): LiveOrderPreviewRef | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = materializeDataRecord(
    value,
    PREVIEW_REQUIRED_KEYS,
    PREVIEW_REQUIRED_KEYS
  );
  assertNonEmptyString(record.previewId, "preview.previewId");
  assertNonEmptyString(record.orderIntentId, "preview.orderIntentId");
  assertPositiveFiniteNumber(
    record.estimatedGrossAmountKrw,
    "preview.estimatedGrossAmountKrw"
  );
  assertTimestamp(record.expiresAt, "preview.expiresAt");
  return {
    previewId: record.previewId,
    orderIntentId: record.orderIntentId,
    estimatedGrossAmountKrw: record.estimatedGrossAmountKrw,
    expiresAt: record.expiresAt
  };
}

function cloneApprovals(
  value: unknown
): LiveOrderIntent["approvals"] {
  if (value === undefined) {
    return undefined;
  }
  const record = materializeDataRecord(value, APPROVAL_OPTIONAL_KEYS, []);
  const approvals: NonNullable<LiveOrderIntent["approvals"]> = {};
  if (Object.hasOwn(record, "marketOrderApproved")) {
    if (
      record.marketOrderApproved !== undefined &&
      typeof record.marketOrderApproved !== "boolean"
    ) {
      throw new Error(
        "live order intent approvals.marketOrderApproved must be boolean or undefined"
      );
    }
    approvals.marketOrderApproved = record.marketOrderApproved;
  }
  return approvals;
}

function createFrozenLiveRiskSnapshot(value: unknown): LiveRiskSnapshot {
  const record = materializeDataRecord(
    value,
    SNAPSHOT_REQUIRED_KEYS,
    SNAPSHOT_REQUIRED_KEYS
  );
  assertNonEmptyString(record.riskSnapshotRef, "snapshot.riskSnapshotRef");
  assertTimestamp(record.capturedAt, "snapshot.capturedAt");
  assertNonNegativeFiniteNumber(
    record.dailyLossKrw,
    "snapshot.dailyLossKrw"
  );
  const positions = materializeDataArray(
    record.positions,
    "snapshot.positions"
  ).map(cloneRiskPosition);
  const openOrders = materializeDataArray(
    record.openOrders,
    "snapshot.openOrders"
  ).map(cloneOpenOrder);
  const marketSessions = cloneMarketSessions(record.marketSessions);

  return deepFreeze({
    riskSnapshotRef: record.riskSnapshotRef,
    capturedAt: record.capturedAt,
    dailyLossKrw: record.dailyLossKrw,
    positions,
    openOrders,
    marketSessions
  });
}

function cloneRiskPosition(value: unknown): LiveRiskPosition {
  const record = materializeDataRecord(
    value,
    [...POSITION_REQUIRED_KEYS, ...POSITION_OPTIONAL_KEYS],
    POSITION_REQUIRED_KEYS
  );
  assertMarket(record.market, "snapshot.positions.market");
  assertNonEmptyString(record.symbol, "snapshot.positions.symbol");
  assertNonNegativeFiniteNumber(
    record.quantity,
    "snapshot.positions.quantity"
  );
  assertNonNegativeFiniteNumber(
    record.averagePriceKrw,
    "snapshot.positions.averagePriceKrw"
  );
  const position: LiveRiskPosition = {
    market: record.market,
    symbol: record.symbol,
    quantity: record.quantity,
    averagePriceKrw: record.averagePriceKrw
  };
  if (Object.hasOwn(record, "marketValueKrw")) {
    if (record.marketValueKrw !== undefined) {
      assertNonNegativeFiniteNumber(
        record.marketValueKrw,
        "snapshot.positions.marketValueKrw"
      );
    }
    position.marketValueKrw = record.marketValueKrw;
  }
  return position;
}

function cloneOpenOrder(value: unknown): LiveOpenOrder {
  const record = materializeDataRecord(
    value,
    [...OPEN_ORDER_REQUIRED_KEYS, ...OPEN_ORDER_OPTIONAL_KEYS],
    OPEN_ORDER_REQUIRED_KEYS
  );
  assertNonEmptyString(record.orderIntentId, "snapshot.openOrders.orderIntentId");
  assertNonEmptyString(record.idempotencyKey, "snapshot.openOrders.idempotencyKey");
  assertMarket(record.market, "snapshot.openOrders.market");
  assertNonEmptyString(record.symbol, "snapshot.openOrders.symbol");
  assertOrderSide(record.side, "snapshot.openOrders.side");
  if (record.signalId !== undefined) {
    assertNonEmptyString(record.signalId, "snapshot.openOrders.signalId");
  }
  if (record.estimatedGrossAmountKrw !== undefined) {
    assertPositiveFiniteNumber(
      record.estimatedGrossAmountKrw,
      "snapshot.openOrders.estimatedGrossAmountKrw"
    );
  }
  if (record.quantity !== undefined) {
    assertPositiveFiniteNumber(
      record.quantity,
      "snapshot.openOrders.quantity"
    );
  }
  if (
    (record.side === "BUY" && record.estimatedGrossAmountKrw === undefined) ||
    (record.side === "SELL" && record.quantity === undefined)
  ) {
    throw new Error(
      "live risk snapshot open order requires side-specific amount or quantity"
    );
  }

  const openOrder: LiveOpenOrder = {
    orderIntentId: record.orderIntentId,
    idempotencyKey: record.idempotencyKey,
    market: record.market,
    symbol: record.symbol,
    side: record.side
  };
  if (Object.hasOwn(record, "signalId")) {
    openOrder.signalId = record.signalId;
  }
  if (Object.hasOwn(record, "estimatedGrossAmountKrw")) {
    openOrder.estimatedGrossAmountKrw = record.estimatedGrossAmountKrw;
  }
  if (Object.hasOwn(record, "quantity")) {
    openOrder.quantity = record.quantity;
  }
  return openOrder;
}

function cloneMarketSessions(
  value: unknown
): LiveRiskSnapshot["marketSessions"] {
  const record = materializeDataRecord(value, ["KR", "US"], []);
  const sessions: LiveRiskSnapshot["marketSessions"] = {};
  for (const market of ["KR", "US"] as const) {
    if (!Object.hasOwn(record, market)) {
      continue;
    }
    const status = record[market];
    if (status !== "open" && status !== "closed") {
      throw new Error(
        "live risk snapshot market session must be open or closed"
      );
    }
    sessions[market] = status;
  }
  return sessions;
}

function createFrozenLiveRiskPolicyInput(
  value: unknown
): Partial<LiveRiskPolicy> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = materializeDataRecord(value, POLICY_OPTIONAL_KEYS, []);
  const policy: Partial<LiveRiskPolicy> = {};

  for (const key of [
    "killSwitch",
    "requireMarketOpen",
    "requirePreview"
  ] as const) {
    if (!Object.hasOwn(record, key)) {
      continue;
    }
    const fieldValue = record[key];
    if (fieldValue !== undefined && typeof fieldValue !== "boolean") {
      throw new Error(`live risk policy ${key} must be boolean or undefined`);
    }
    if (fieldValue !== undefined) {
      policy[key] = fieldValue;
    }
  }

  for (const key of [
    "maxOrderAmountKrw",
    "maxDailyLossKrw",
    "maxSymbolExposureKrw",
    "maxMarketExposureKrw",
    "maxTotalExposureKrw",
    "maxSnapshotAgeMs"
  ] as const) {
    if (!Object.hasOwn(record, key)) {
      continue;
    }
    const fieldValue = record[key];
    if (fieldValue !== undefined) {
      assertNonNegativeFiniteNumber(fieldValue, `policy.${key}`);
      policy[key] = fieldValue;
    }
  }

  if (Object.hasOwn(record, "maxOpenOrders")) {
    const maxOpenOrders = record.maxOpenOrders;
    if (
      maxOpenOrders !== undefined &&
      (!Number.isInteger(maxOpenOrders) ||
        typeof maxOpenOrders !== "number" ||
        maxOpenOrders < 0)
    ) {
      throw new Error(
        "live risk policy maxOpenOrders must be a non-negative integer"
      );
    }
    if (maxOpenOrders !== undefined) {
      policy.maxOpenOrders = maxOpenOrders;
    }
  }

  if (Object.hasOwn(record, "marketOrderPolicy")) {
    const marketOrderPolicy = record.marketOrderPolicy;
    if (
      marketOrderPolicy !== undefined &&
      marketOrderPolicy !== "disabled" &&
      marketOrderPolicy !== "requires_approval" &&
      marketOrderPolicy !== "allowed"
    ) {
      throw new Error("live risk policy marketOrderPolicy is invalid");
    }
    if (marketOrderPolicy !== undefined) {
      policy.marketOrderPolicy = marketOrderPolicy;
    }
  }

  if (
    Object.hasOwn(record, "allowedSymbols") &&
    record.allowedSymbols !== undefined
  ) {
    const allowedSymbols = materializeDataArray(
      record.allowedSymbols,
      "policy.allowedSymbols"
    );
    for (const symbol of allowedSymbols) {
      assertNonEmptyString(symbol, "policy.allowedSymbols entry");
    }
    policy.allowedSymbols = allowedSymbols as string[];
  }

  if (
    Object.hasOwn(record, "allowedMarkets") &&
    record.allowedMarkets !== undefined
  ) {
    const allowedMarkets = materializeDataArray(
      record.allowedMarkets,
      "policy.allowedMarkets"
    );
    for (const market of allowedMarkets) {
      assertMarket(market, "policy.allowedMarkets entry");
    }
    policy.allowedMarkets = allowedMarkets as Array<"KR" | "US">;
  }

  if (
    Object.hasOwn(record, "cooldownEntries") &&
    record.cooldownEntries !== undefined
  ) {
    const cooldownEntries = materializeDataArray(
      record.cooldownEntries,
      "policy.cooldownEntries"
    ).map(cloneCooldownEntry);
    policy.cooldownEntries = cooldownEntries;
  }

  if (Object.hasOwn(record, "now")) {
    if (record.now !== undefined) {
      const time = readNativeDateTime(record.now);
      policy.now = new Date(time);
    }
  }

  return deepFreeze(policy);
}

function cloneCooldownEntry(
  value: unknown
): NonNullable<LiveRiskPolicy["cooldownEntries"]>[number] {
  const record = materializeDataRecord(
    value,
    [...COOLDOWN_REQUIRED_KEYS, ...COOLDOWN_OPTIONAL_KEYS],
    COOLDOWN_REQUIRED_KEYS
  );
  assertNonEmptyString(record.symbol, "policy.cooldownEntries.symbol");
  assertTimestamp(record.activeUntil, "policy.cooldownEntries.activeUntil");
  if (record.market !== undefined) {
    assertMarket(record.market, "policy.cooldownEntries.market");
  }
  if (record.side !== undefined) {
    assertOrderSide(record.side, "policy.cooldownEntries.side");
  }
  if (record.reason !== undefined && typeof record.reason !== "string") {
    throw new Error(
      "live risk policy cooldownEntries.reason must be string or undefined"
    );
  }
  const entry: NonNullable<LiveRiskPolicy["cooldownEntries"]>[number] = {
    symbol: record.symbol,
    activeUntil: record.activeUntil
  };
  if (Object.hasOwn(record, "market")) {
    entry.market = record.market;
  }
  if (Object.hasOwn(record, "side")) {
    entry.side = record.side;
  }
  if (Object.hasOwn(record, "reason")) {
    entry.reason = record.reason;
  }
  return entry;
}

function createLiveOrderIntentHash(intent: FrozenLiveOrderIntent): string {
  const fields: Array<readonly [string, CanonicalScalar]> = [
    ["schemaVersion", LIVE_ORDER_INTENT_HASH_SCHEMA_VERSION],
    ["orderIntentId", intent.orderIntentId],
    ["signalId", intent.signalId],
    ["idempotencyKey", intent.idempotencyKey],
    ["market", intent.market],
    ["symbol.raw", intent.symbol],
    ["symbol.normalized", normalizeLiveRiskSymbol(intent.symbol)],
    ["side", intent.side],
    ["orderType", intent.orderType],
    ["quantity", intent.quantity],
    ["estimatedGrossAmountKrw", intent.estimatedGrossAmountKrw],
    ["createdAt", intent.createdAt],
    ["expiresAt", intent.expiresAt],
    ["preview.present", Object.hasOwn(intent, "preview")],
    ["preview.valuePresent", intent.preview !== undefined],
    ["preview.previewId", intent.preview?.previewId],
    ["preview.orderIntentId", intent.preview?.orderIntentId],
    [
      "preview.estimatedGrossAmountKrw",
      intent.preview?.estimatedGrossAmountKrw
    ],
    ["preview.expiresAt", intent.preview?.expiresAt],
    ["approvals.present", Object.hasOwn(intent, "approvals")],
    ["approvals.valuePresent", intent.approvals !== undefined],
    [
      "approvals.marketOrderApproved.present",
      intent.approvals !== undefined &&
        Object.hasOwn(intent.approvals, "marketOrderApproved")
    ],
    [
      "approvals.marketOrderApproved",
      intent.approvals?.marketOrderApproved
    ]
  ];
  const canonicalPayload = fields
    .map(([name, value]) => encodeField(name, value))
    .join("");
  const digest = createHash(LIVE_ORDER_INTENT_HASH_ALGORITHM)
    .update(lengthPrefix(LIVE_ORDER_INTENT_HASH_DOMAIN))
    .update(canonicalPayload)
    .digest("hex");
  return `${LIVE_ORDER_INTENT_HASH_ALGORITHM}:${digest}`;
}

function encodeField(name: string, value: CanonicalScalar): string {
  const [type, encodedValue] = encodeScalar(value);
  return `${lengthPrefix(name)}${lengthPrefix(type)}${lengthPrefix(encodedValue)}`;
}

function encodeScalar(value: CanonicalScalar): readonly [string, string] {
  if (value === undefined) {
    return ["undefined", ""];
  }
  if (typeof value === "string") {
    return ["string", value];
  }
  if (typeof value === "boolean") {
    return ["boolean", value ? "true" : "false"];
  }
  return ["number", Object.is(value, -0) ? "-0" : value.toString()];
}

function lengthPrefix(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function freezeAuthorityDecision(
  decision: LiveRiskDecision,
  evaluatedIntentHash: string
): LiveRiskAuthorityDecision {
  return Object.freeze({
    ...decision,
    rejectCodes: Object.freeze([...decision.rejectCodes]),
    checkedRules: Object.freeze([...decision.checkedRules]),
    evaluatedIntentHash
  });
}

function createOpaqueAuthority(): LiveRiskAuthority {
  return Object.freeze({
    toJSON(): never {
      throw new Error("live risk authority cannot be serialized");
    }
  }) as LiveRiskAuthority;
}

function requireOwnedAuthority(value: unknown): LiveRiskAuthorityState {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.isFrozen(value)
  ) {
    throw new Error("live risk authority must be an owned frozen authority");
  }
  if (!AUTHORITY_BRANDS.has(value)) {
    throw new Error("live risk authority must be minted by the risk engine");
  }
  const state = AUTHORITY_STATES.get(value);
  if (state === undefined) {
    throw new Error("live risk authority must be minted by the risk engine");
  }
  if (
    !Object.isFrozen(state) ||
    !Object.isFrozen(state.decision) ||
    !Object.isFrozen(state.decision.rejectCodes) ||
    !Object.isFrozen(state.decision.checkedRules)
  ) {
    throw new Error("live risk authority state must remain frozen");
  }
  return state;
}

function isDeepFrozenIntent(value: unknown): value is FrozenLiveOrderIntent {
  if (typeof value !== "object" || value === null || !Object.isFrozen(value)) {
    return false;
  }
  for (const child of Object.values(value)) {
    if (
      typeof child === "object" &&
      child !== null &&
      !Object.isFrozen(child)
    ) {
      return false;
    }
  }
  return true;
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
    throw new Error("live risk authority input must use plain data objects");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new Error("live risk authority input must not use symbol keys");
  }
  const allowed = new Set(allowedKeys);
  if (ownKeys.some((key) => !allowed.has(key as string))) {
    throw new Error("live risk authority input contains unknown fields");
  }
  if (requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("live risk authority input is missing required fields");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error("live risk authority input must use enumerable data fields");
    }
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return snapshot;
}

function materializeDataArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`live risk authority ${field} must be a plain array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    throw new Error(`live risk authority ${field} has invalid length`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== length + 1 ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))
    )
  ) {
    throw new Error(
      `live risk authority ${field} must be dense and contain no extra fields`
    );
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error(
        `live risk authority ${field} must use enumerable data entries`
      );
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function assertNonEmptyString(
  value: unknown,
  field: string
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`live order intent ${field} must be a non-empty string`);
  }
}

function assertPositiveFiniteNumber(
  value: unknown,
  field: string
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`live order intent ${field} must be positive and finite`);
  }
}

function assertNonNegativeFiniteNumber(
  value: unknown,
  field: string
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `live risk authority ${field} must be non-negative and finite`
    );
  }
}

function assertMarket(
  value: unknown,
  field: string
): asserts value is "KR" | "US" {
  if (value !== "KR" && value !== "US") {
    throw new Error(`live risk authority ${field} must be KR or US`);
  }
}

function assertOrderSide(
  value: unknown,
  field: string
): asserts value is "BUY" | "SELL" {
  if (value !== "BUY" && value !== "SELL") {
    throw new Error(`live risk authority ${field} must be BUY or SELL`);
  }
}

function readNativeDateTime(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Date.prototype
  ) {
    throw new Error("live risk policy now must be a native Date");
  }
  const time = Date.prototype.getTime.call(value);
  if (!Number.isFinite(time)) {
    throw new Error("live risk policy now must be a valid Date");
  }
  return time;
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`live order intent ${field} must be a parseable timestamp`);
  }
}
