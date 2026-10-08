import { types } from "node:util";
import { maskSensitiveText } from "../security/masking.js";
import { containsReplaySourceCredential } from "../security/replaySourceText.js";
import { REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS, replaySettingsSnapshotDataSchema } from "./replaySettingsSnapshotFields.js";
import { settingsShape, type SettingsShape } from "./replaySettingsSnapshotShape.js";
import { hasUninspectableReplaySettings, isInspectableReplaySettingsContainer, REPLAY_SETTINGS_WHOLESALE_INSPECTION_LIMITS as wholesaleLimits, REPLAY_SETTINGS_DEEP_CONSUMED_PATHS } from "./replaySettingsOpaqueInspection.js";

export { REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS } from "./replaySettingsSnapshotFields.js";
type Decision = "redacted" | "inspection_unavailable" | undefined;
interface Inspection {
  visitedValues: number;
  stringUnits: number;
  incomplete: boolean;
  exhausted: boolean;
  redacted: boolean;
}
const limits = REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS;
const rootShape = settingsShape(replaySettingsSnapshotDataSchema);

/**
 * Inspect only readable own data at known consumed fields, before shape/recording limits can short-circuit.
 * Selected opacity makes inspection incomplete. Only proven wholesale unknown fields join the scan; explicit exclusions stay outside it.
 * Accessors, proxies, inherited values, nonplain containers and scalar objects are never evaluated.
 */
export function inspectReplaySettingsCredentials(value: unknown): Decision {
  const state: Inspection = { visitedValues: 0, stringUnits: 0, incomplete: hasUninspectableReplaySettings(value), exhausted: false, redacted: false };
  if (isInspectableReplaySettingsContainer(value, rootShape)) {
    visit(value, rootShape, state);
    inspectConsumedUnknownFields(value, state);

  }
  return state.redacted ? "redacted" : state.incomplete ? "inspection_unavailable" : undefined;
}
function visit(value: unknown, shape: SettingsShape, state: Inspection): void {
  if (state.redacted || state.exhausted) return;
  if (state.visitedValues === limits.visitedValues) {
    state.incomplete = true; state.exhausted = true; return;
  }
  state.visitedValues += 1;
  // Inspect strings even when a selected field has the wrong scalar/container type or descriptor visibility.
  if (typeof value === "string") { inspectString(value, state); return; }
  if (!isInspectableReplaySettingsContainer(value, shape)) return;
  if (shape.kind === "object") {
    for (const entry of shape.fields) {
      const key = entry[0]; const child = entry[1];
      if (state.redacted || state.exhausted) return;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, "value")) visit(descriptor.value, child, state);
    }
  } else if (shape.kind === "array" && Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
    if (length > limits.arrayEntries) state.incomplete = true;
    // Array length is an intrinsic data property. Sparse arrays never cause an unbounded index walk.
    const end = Math.min(length, limits.arrayEntries);
    for (let index = 0; index < end; index += 1) {
      if (state.redacted || state.exhausted) return;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor && Object.hasOwn(descriptor, "value")) visit(descriptor.value, shape.item, state);
    }
  }
}
function inspectString(value: string, state: Inspection): void {
  if (value.length > limits.perStringUnits) { state.incomplete = true; return; }
  if (value.length > limits.totalStringUnits - state.stringUnits) {
    state.incomplete = true; state.exhausted = true; return;
  }
  state.stringUnits += value.length;
  // Neither masking nor decoding ever receives an unbounded leaf or resets the cumulative budget.
  state.redacted = maskSensitiveText(value) !== value || containsReplaySourceCredential(value);
}

// A separate bounded traversal discovers unknown output/diagnostic data without recharging known selected leaves.
// Its string inspections share the selected pass's cumulative text budget across every consumed sibling.
interface ConsumedBudget { descriptors: number; values: number; ancestors: Set<object> }
function inspectConsumedUnknownFields(value: object, state: Inspection): void {
  const budget: ConsumedBudget = { descriptors: 0, values: 0, ancestors: new Set() };
  for (let index = 0; index < REPLAY_SETTINGS_DEEP_CONSUMED_PATHS.length; index += 1) {
    if (state.redacted || state.exhausted) return;
    const path = REPLAY_SETTINGS_DEEP_CONSUMED_PATHS[index]!;
    let selected: unknown = value; let shape: SettingsShape | undefined = rootShape;
    for (let part = 0; part < path.length; part += 1) {
      if (selected === null || typeof selected !== "object" || types.isProxy(selected)) { selected = undefined; break; }
      const key = path[part]!;
      const descriptor = Object.getOwnPropertyDescriptor(selected, key);
      selected = descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
      shape = shape?.kind === "object" ? shape.fields.get(key) : undefined;
    }
    inspectConsumedValue(selected, shape, state, budget, 1);
  }
}
function inspectConsumedValue(value: unknown, shape: SettingsShape | undefined, state: Inspection, budget: ConsumedBudget, depth: number): void {
  if (state.redacted || state.exhausted) return;
  if (shape && shape.kind !== "object" && shape.kind !== "array") return;
  if (++budget.values > wholesaleLimits.visitedValues) { state.incomplete = true; state.exhausted = true; return; }
  if (typeof value === "string") { if (!shape) inspectString(value, state); return; }
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  if (typeof value !== "object" || types.isProxy(value) || depth > wholesaleLimits.depth || budget.ancestors.has(value)) { state.incomplete = true; return; }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) { state.incomplete = true; return; }
  if (shape?.kind === "array" && shape.item.kind !== "array" && shape.item.kind !== "object") return;
  budget.ancestors.add(value);
  try {
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
      if (length > limits.arrayEntries) state.incomplete = true;
      for (let index = 0; index < Math.min(length, limits.arrayEntries); index += 1) {
        if (state.redacted || state.exhausted || consumedDescriptorExhausted(budget, state)) return;
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor && Object.hasOwn(descriptor, "value")) inspectConsumedValue(descriptor.value, shape?.kind === "array" ? shape.item : undefined, state, budget, depth + 1);
      }
    } else {
      const keys = Reflect.ownKeys(value);
      if (keys.length > wholesaleLimits.objectKeys) { state.incomplete = true; return; }
      for (let index = 0; index < keys.length; index += 1) {
        if (state.redacted || state.exhausted || consumedDescriptorExhausted(budget, state)) return;
        const key = keys[index]!;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== "string" || !descriptor.enumerable) continue;
        const child = shape?.kind === "object" ? shape.fields.get(key) : undefined;
        if (!child) inspectConsumedKey(key, state, budget);
        if (Object.hasOwn(descriptor, "value")) inspectConsumedValue(descriptor.value, child, state, budget, depth + 1);
      }
    }
  } finally { budget.ancestors.delete(value); }
}
function inspectConsumedKey(key: string, state: Inspection, budget: ConsumedBudget): void {
  if (++budget.values > wholesaleLimits.visitedValues) { state.incomplete = true; state.exhausted = true; return; }
  // A fixed separator detects api_key: value without cloning/coercing/stringifying that value.
  // Framing must fit the existing per-leaf detector budget, including the separator itself.
  if (key.length >= limits.perStringUnits) { inspectString(key, state); state.incomplete = true; return; }
  inspectString(`${key}=`, state);
}
function consumedDescriptorExhausted(budget: ConsumedBudget, state: Inspection): boolean {
  if (++budget.descriptors <= wholesaleLimits.descriptorReads) return false;
  state.incomplete = true; state.exhausted = true; return true;
}
