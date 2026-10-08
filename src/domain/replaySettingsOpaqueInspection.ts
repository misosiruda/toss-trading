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
  return visit(value, rootShape, { visitedValues: 0 }, true);
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
