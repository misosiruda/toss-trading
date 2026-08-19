import { createHash } from "node:crypto";

import {
  LiveRiskEngine,
  type LiveOrderIntent,
  type LiveOrderPreviewRef,
  type LiveRiskDecision,
  type LiveRiskInput,
  type LiveRiskPolicy,
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

export function evaluateLiveRiskAuthority(
  input: EvaluateLiveRiskAuthorityInput
): LiveRiskAuthorityEvaluation {
  assertDataRecord(input, ["intent", "snapshot", "policy"], [
    "intent",
    "snapshot"
  ]);
  const intent = createFrozenLiveOrderIntent(input.intent);
  const engineInput: LiveRiskInput = {
    intent,
    snapshot: input.snapshot
  };
  if (Object.hasOwn(input, "policy")) {
    engineInput.policy = input.policy;
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
  assertDataRecord(
    value,
    [...INTENT_REQUIRED_KEYS, ...INTENT_OPTIONAL_KEYS],
    INTENT_REQUIRED_KEYS
  );
  assertNonEmptyString(value.orderIntentId, "orderIntentId");
  assertNonEmptyString(value.signalId, "signalId");
  assertNonEmptyString(value.idempotencyKey, "idempotencyKey");
  if (value.market !== "KR" && value.market !== "US") {
    throw new Error("live order intent market must be KR or US");
  }
  assertNonEmptyString(value.symbol, "symbol");
  if (value.side !== "BUY" && value.side !== "SELL") {
    throw new Error("live order intent side must be BUY or SELL");
  }
  if (value.orderType !== "LIMIT" && value.orderType !== "MARKET") {
    throw new Error("live order intent orderType must be LIMIT or MARKET");
  }
  assertPositiveFiniteNumber(value.quantity, "quantity");
  assertPositiveFiniteNumber(
    value.estimatedGrossAmountKrw,
    "estimatedGrossAmountKrw"
  );
  assertTimestamp(value.createdAt, "createdAt");
  assertTimestamp(value.expiresAt, "expiresAt");

  const intent: LiveOrderIntent = {
    orderIntentId: value.orderIntentId,
    signalId: value.signalId,
    idempotencyKey: value.idempotencyKey,
    market: value.market,
    symbol: value.symbol,
    side: value.side,
    orderType: value.orderType,
    quantity: value.quantity,
    estimatedGrossAmountKrw: value.estimatedGrossAmountKrw,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt
  };

  if (Object.hasOwn(value, "preview")) {
    intent.preview = clonePreview(value.preview);
  }
  if (Object.hasOwn(value, "approvals")) {
    intent.approvals = cloneApprovals(value.approvals);
  }

  return deepFreeze(intent) as FrozenLiveOrderIntent;
}

function clonePreview(value: unknown): LiveOrderPreviewRef | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertDataRecord(value, PREVIEW_REQUIRED_KEYS, PREVIEW_REQUIRED_KEYS);
  assertNonEmptyString(value.previewId, "preview.previewId");
  assertNonEmptyString(value.orderIntentId, "preview.orderIntentId");
  assertPositiveFiniteNumber(
    value.estimatedGrossAmountKrw,
    "preview.estimatedGrossAmountKrw"
  );
  assertTimestamp(value.expiresAt, "preview.expiresAt");
  return {
    previewId: value.previewId,
    orderIntentId: value.orderIntentId,
    estimatedGrossAmountKrw: value.estimatedGrossAmountKrw,
    expiresAt: value.expiresAt
  };
}

function cloneApprovals(
  value: unknown
): LiveOrderIntent["approvals"] {
  if (value === undefined) {
    return undefined;
  }
  assertDataRecord(value, APPROVAL_OPTIONAL_KEYS, []);
  const approvals: NonNullable<LiveOrderIntent["approvals"]> = {};
  if (Object.hasOwn(value, "marketOrderApproved")) {
    if (
      value.marketOrderApproved !== undefined &&
      typeof value.marketOrderApproved !== "boolean"
    ) {
      throw new Error(
        "live order intent approvals.marketOrderApproved must be boolean or undefined"
      );
    }
    approvals.marketOrderApproved = value.marketOrderApproved;
  }
  return approvals;
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

function assertDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): asserts value is Record<string, unknown> {
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
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error("live risk authority input must use enumerable data fields");
    }
  }
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

function assertTimestamp(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`live order intent ${field} must be a parseable timestamp`);
  }
}
