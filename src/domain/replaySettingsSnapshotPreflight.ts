import { types } from "node:util";
import { inspectReplaySettingsCredentials } from "./replaySettingsCredentialInspection.js";
import { maskSensitiveText } from "../security/masking.js";
import { containsReplaySourceCredential } from "../security/replaySourceText.js";
import { REPLAY_SETTINGS_SNAPSHOT_LIMITS as limits, replaySettingsSnapshotDataSchema, type ReplaySettingsSnapshot } from "./replaySettingsSnapshotFields.js";
import { settingsShape, type SettingsShape } from "./replaySettingsSnapshotShape.js";

export type ReplaySettingsSnapshotUnavailableReason = "unsupported_shape" | "redacted" | "limit" | "inspection_unavailable";
type Reason = ReplaySettingsSnapshotUnavailableReason | undefined;
type ObjectShape = Extract<SettingsShape, { kind: "object" }>;
const rootShape = settingsShape(replaySettingsSnapshotDataSchema) as ObjectShape;
interface Context { bytes: number; project: boolean; ancestors: Set<object> }

/** Inspect descriptors and bounded leaves only; no whole input clone, JSON, or hash before this gate. */
export function preflightReplaySettingsSnapshot(value: unknown, project: boolean): Reason {
  const securityDecision = inspectReplaySettingsCredentials(value);
  if (securityDecision) return securityDecision;
  return visit(value, rootShape, { bytes: 0, project, ancestors: new Set() }, true);
}
function addBytes(context: Context, bytes: number): Reason {
  context.bytes += bytes;
  return context.bytes > limits.jsonBytes ? "limit" : undefined;
}
function visit(value: unknown, shape: SettingsShape, context: Context, root = false): Reason {
  if (shape.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) return "unsupported_shape";
  } else if (shape.kind === "boolean") {
    if (typeof value !== "boolean") return "unsupported_shape";
  } else if (shape.kind === "string") {
    const reason = stringValue(value, shape);
    if (reason) return reason;
  } else {
    if (value === null || typeof value !== "object" || types.isProxy(value) || context.ancestors.has(value)) return "unsupported_shape";
    context.ancestors.add(value);
    const reason = shape.kind === "array" ? visitArray(value, shape, context) : visitObject(value, shape, context, root);
    context.ancestors.delete(value);
    return reason;
  }
  return addBytes(context, Buffer.byteLength(JSON.stringify(value), "utf8"));
}
function visitObject(value: object, shape: ObjectShape, context: Context, root: boolean): Reason {
  if (!plainSettingsObject(value)) return "unsupported_shape";
  // Runner options contain opaque callbacks and state. Do not enumerate or read them.
  if (!(root && context.project)) {
    const keys = Reflect.ownKeys(value);
    const excluded = context.project ? shape.excluded : new Set<string>();
    if (keys.length > shape.fields.size + excluded.size) return "unsupported_shape";
    for (const key of keys) {
      if (typeof key !== "string" || (!shape.fields.has(key) && !excluded.has(key)) || !dataProperty(value, key)) return "unsupported_shape";
    }
  }
  let reason = addBytes(context, 2);
  if (reason) return reason;
  let count = 0;
  for (const [key, child] of shape.fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) { if (!child.optional) return "unsupported_shape"; else continue; }
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return "unsupported_shape";
    reason = addBytes(context, Buffer.byteLength(JSON.stringify(key), "utf8") + 1 + (count++ ? 1 : 0));
    if (reason) return reason;
    reason = visit(descriptor.value, child, context);
    if (reason) return reason;
  }
  return undefined;
}
function visitArray(value: object, shape: Extract<SettingsShape, { kind: "array" }>, context: Context): Reason {
  if (!Array.isArray(value)) return "unsupported_shape";
  const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
  if (length > shape.maxLength) return "limit";
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== length + 1) return "unsupported_shape";
  let reason = addBytes(context, 2);
  if (reason) return reason;
  for (let index = 0; index < length; index += 1) {
    const descriptor = dataProperty(value, String(index));
    if (!descriptor) return "unsupported_shape";
    if (index && (reason = addBytes(context, 1))) return reason;
    reason = visit(descriptor.value, shape.item, context);
    if (reason) return reason;
  }
  return undefined;
}
function stringValue(value: unknown, shape: Extract<SettingsShape, { kind: "string" }>): Reason {
  if (typeof value !== "string") return "unsupported_shape";
  if (value.length > shape.maxUnits) return "limit";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "unsupported_shape";
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return "unsupported_shape";
  }
  if (maskSensitiveText(value) !== value || containsReplaySourceCredential(value)) return "redacted";
  return shape.values && !shape.values.includes(value) ? "unsupported_shape" : undefined;
}
export function plainSettingsObject(value: unknown): value is object {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function dataProperty(value: object, key: string): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, "value") ? descriptor : undefined;
}

/** Only call after the synchronous gate succeeds; descriptors cannot execute user code between passes. */
export function cloneReplaySettingsProjection(value: unknown): ReplaySettingsSnapshot {
  return copy(value, rootShape) as ReplaySettingsSnapshot;
}
function copy(value: unknown, shape: SettingsShape): unknown {
  if (shape.kind === "array") {
    const array = value as unknown[];
    return array.map(item => copy(item, shape.item));
  }
  if (shape.kind !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of shape.fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) result[key] = copy(descriptor.value, child);
  }
  return result;
}
export function freezeReplaySettingsSnapshot<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freezeReplaySettingsSnapshot(nested);
    Object.freeze(value);
  }
  return value;
}
