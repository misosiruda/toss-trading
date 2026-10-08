import { types } from "node:util";
import { REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS as limits, replaySettingsSnapshotDataSchema } from "./replaySettingsSnapshotFields.js";
import { settingsShape, type SettingsShape } from "./replaySettingsSnapshotShape.js";

const rootShape = settingsShape(replaySettingsSnapshotDataSchema);
interface Budget { visitedValues: number }
// map: historicalPacketBuilder/workflow universe projections and masking; some: risk cooldown;
// includes: packetBuilder/exitPolicy; filter: historicalUniverseCoverage; iterator: array iteration.
// Array mapping also resolves constructor/@@species. Keep a fixed executable-hook inventory.
const arrayHooks: readonly PropertyKey[] = ["map", "some", "includes", "filter", Symbol.iterator, "constructor"];
const nativeArrayHooks = new Map(arrayHooks.map(key => [key, Object.getOwnPropertyDescriptor(Array.prototype, key)!.value]));
const nativeArraySpecies = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;

/** Structural only: an earlier credential or oversized string must never hide later executable settings. */
export function hasUninspectableReplaySettings(value: unknown): boolean {
  return visit(value, rootShape, { visitedValues: 0 }, true) || hasUninspectableWholesaleSettings(value);
}
function visit(value: unknown, shape: SettingsShape, budget: Budget, root = false): boolean {
  if (budget.visitedValues === limits.visitedValues) return true;
  budget.visitedValues += 1;
  // Wrong plain primitives retain the existing unsupported shape path; no coercion is performed.
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  // This also rejects object/function values in scalar fields, whose coercion could execute user code.
  if (!isInspectableReplaySettingsContainer(value, shape)) return true;
  if ((!root && hasSerializationHook(value)) || (shape.kind === "array" && hasCollectionOverride(value))) return true;
  if (shape.kind === "object") {
    for (const entry of shape.fields) {
      const key = entry[0]; const child = entry[1];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) { if (inheritedSelectedProperty(value, key)) return true; else continue; }
      if (!Object.hasOwn(descriptor, "value") || visit(descriptor.value, child, budget)) return true;
    }
  } else if (shape.kind === "array") {
    const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
    if (length > limits.arrayEntries) return true;
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) { if (inheritedSelectedProperty(value, key)) return true; else continue; }
      if (!Object.hasOwn(descriptor, "value") || visit(descriptor.value, shape.item, budget)) return true;
    }
  }
  return false;
}

/** Shared with credential inspection so opaque containers never gain a second traversal route. */
export function isInspectableReplaySettingsContainer(value: unknown, shape: SettingsShape): value is object {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (shape.kind === "object") return !Array.isArray(value) && (prototype === null ||
    (prototype === Object.prototype && Object.getPrototypeOf(Object.prototype) === null));
  return shape.kind === "array" && Array.isArray(value) && prototype === Array.prototype &&
    Object.getPrototypeOf(Array.prototype) === Object.prototype && Object.getPrototypeOf(Object.prototype) === null;
}
function inheritedSelectedProperty(value: object, key: string): boolean {
  // The container gate limits this walk to the two known native prototypes; no arbitrary/proxy chain is read.
  const prototype = Object.getPrototypeOf(value);
  return prototype !== null && (Object.getOwnPropertyDescriptor(prototype, key) !== undefined ||
    (prototype === Array.prototype && Object.getOwnPropertyDescriptor(Object.prototype, key) !== undefined));
}

function hasSerializationHook(value: object): boolean {
  // JSON.stringify calls only a callable resolved toJSON; own inert data shadows inherited hooks.
  const own = Object.getOwnPropertyDescriptor(value, "toJSON");
  if (own) return executableSerializationDescriptor(own);
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return false;
  const inherited = Object.getOwnPropertyDescriptor(prototype, "toJSON");
  if (inherited) return executableSerializationDescriptor(inherited);
  return prototype === Array.prototype && executableSerializationDescriptor(Object.getOwnPropertyDescriptor(Object.prototype, "toJSON"));
}
function executableSerializationDescriptor(descriptor: PropertyDescriptor | undefined): boolean {
  return descriptor !== undefined && (!Object.hasOwn(descriptor, "value") || typeof descriptor.value === "function");
}
function hasCollectionOverride(value: object): boolean {
  for (let index = 0; index < arrayHooks.length; index += 1) {
    const key = arrayHooks[index]!;
    if (Object.getOwnPropertyDescriptor(value, key)) return true;
    const inherited = Object.getOwnPropertyDescriptor(Array.prototype, key);
    if (!inherited || !Object.hasOwn(inherited, "value") || inherited.value !== nativeArrayHooks.get(key)) return true;
  }
  const species = Object.getOwnPropertyDescriptor(Array, Symbol.species);
  return !species || species.get !== nativeArraySpecies.get || species.set !== nativeArraySpecies.set ||
    Object.hasOwn(species, "value");
}


// Only these inputs survive field projection into research canonicalPlainObject/Object.entries.
export const REPLAY_SETTINGS_DEEP_CONSUMED_PATHS = [
  ["constraints"], ["allocationPolicy"], ["marketRegimeAllocationPolicy"],
  ["riskPolicy", "maxStrategyBucketExposureKrw"], ["riskPolicy", "maxStrategyBucketExposureRatio"],
  ["riskPolicy", "maxBucketTurnoverKrw"], ["riskPolicy", "maxBucketTurnoverRatio"],
  ["riskPolicy", "dynamicCashReservePolicy"], ["riskPolicy", "hedgePolicy"]
] as const;
export const REPLAY_SETTINGS_WHOLESALE_INSPECTION_LIMITS = Object.freeze({
  objectKeys: 100_000, descriptorReads: 500_000, visitedValues: 500_000, arrayEntries: 100_000, depth: 32
});
interface WholesaleBudget { descriptors: number; values: number; ancestors: Set<object> }
const wholesaleLimits = REPLAY_SETTINGS_WHOLESALE_INSPECTION_LIMITS;
/** Share one bounded structural budget across exact research-normalizer values; never scans string contents. */
export function createReplayResearchValueInspector(): (value: unknown) => boolean {
  const budget: WholesaleBudget = { descriptors: 0, values: 0, ancestors: new Set() };
  return value => wholeValueIsOpaque(value, budget, 1);
}
function hasUninspectableWholesaleSettings(value: unknown): boolean {
  if (!isInspectableReplaySettingsContainer(value, rootShape)) return false;
  const budget: WholesaleBudget = { descriptors: 0, values: 0, ancestors: new Set() };
  const risk = Object.getOwnPropertyDescriptor(value, "riskPolicy");
  // replayRiskPolicy spreads the root, but does not recursively consume unknown/excluded data values.
  if (risk && Object.hasOwn(risk, "value") && shallowSpreadHasAccessor(risk.value, budget)) return true;
  for (let index = 0; index < REPLAY_SETTINGS_DEEP_CONSUMED_PATHS.length; index += 1) {
    const path = REPLAY_SETTINGS_DEEP_CONSUMED_PATHS[index]!;
    let selected: unknown = value;
    for (let part = 0; part < path.length; part += 1) {
      if (selected === null || typeof selected !== "object" || types.isProxy(selected)) { selected = undefined; break; }
      const descriptor = Object.getOwnPropertyDescriptor(selected, path[part]!);
      selected = descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    }
    if (wholeValueIsOpaque(selected, budget, 1)) return true;
  }
  return false;
}
function shallowSpreadHasAccessor(value: unknown, budget: WholesaleBudget): boolean {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > wholesaleLimits.objectKeys) return true;
  for (let index = 0; index < keys.length; index += 1) {
    if (++budget.descriptors > wholesaleLimits.descriptorReads) return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]!)!;
    if (descriptor.enumerable && !Object.hasOwn(descriptor, "value")) return true;
  }
  return false;
}
function wholeValueIsOpaque(value: unknown, budget: WholesaleBudget, depth: number): boolean {
  if (++budget.values > wholesaleLimits.visitedValues) return true;
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  if (typeof value !== "object" || types.isProxy(value) || depth > wholesaleLimits.depth || budget.ancestors.has(value)) return true;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return true;
  if (Object.getPrototypeOf(Object.prototype) !== null || (array && Object.getPrototypeOf(Array.prototype) !== Object.prototype)) return true;
  if (hasSerializationHook(value) || (array && hasCollectionOverride(value))) return true;
  budget.ancestors.add(value);
  try {
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
      if (length > wholesaleLimits.arrayEntries) return true;
      for (let index = 0; index < length; index += 1) {
        if (++budget.descriptors > wholesaleLimits.descriptorReads) return true;
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) { if (inheritedSelectedProperty(value, key)) return true; else continue; }
        if (!Object.hasOwn(descriptor, "value") || wholeValueIsOpaque(descriptor.value, budget, depth + 1)) return true;
      }
    } else {
      // Native own-key enumeration allocates a key list; descriptor/value traversal is capped before inspection.
      const keys = Reflect.ownKeys(value);
      if (keys.length > wholesaleLimits.objectKeys) return true;
      for (let index = 0; index < keys.length; index += 1) {
        if (++budget.descriptors > wholesaleLimits.descriptorReads) return true;
        const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]!)!;
        if (!descriptor.enumerable) continue;
        if (!Object.hasOwn(descriptor, "value") || wholeValueIsOpaque(descriptor.value, budget, depth + 1)) return true;
      }
    }
    return false;
  } finally { budget.ancestors.delete(value); }
}
