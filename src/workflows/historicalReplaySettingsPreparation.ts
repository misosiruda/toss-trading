import { types } from "node:util";
import { createReplayResearchValueInspector, REPLAY_SETTINGS_WHOLESALE_INSPECTION_LIMITS as limits } from "../domain/replaySettingsOpaqueInspection.js";

// Exactly the extra data fields consumed by normalizeUniverseManifestForResearch, not runner snapshot fields.
const manifestFields = ["mode", "universeId", "snapshotDate", "description", "disclaimer"] as const;
const memberFields = ["sourceSymbol", "name", "assetType", "assetClass", "region", "riskTags", "strategyBucket",
  "sector", "segment", "required", "tags"] as const;

/** Preparation-only structural check. Labels remain outside snapshot content and credential inspection. */
export function hasUninspectableReplayResearchUniverse(options: object): boolean {
  const inspect = createReplayResearchValueInspector();
  let reads = 0;
  const unavailable = Symbol("unavailable descriptor");
  const read = (value: object, key: string): unknown => {
    if (++reads > limits.descriptorReads) return unavailable;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) return Object.hasOwn(descriptor, "value") ? descriptor.value : unavailable;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && (Object.getOwnPropertyDescriptor(prototype, key) ||
      (prototype === Array.prototype && Object.getOwnPropertyDescriptor(Object.prototype, key)))) return unavailable;
    return undefined;
  };
  if (!plainObject(options)) return true;
  const universe = read(options, "universeManifest");
  if (universe === unavailable) return true;
  if (universe === null || (typeof universe !== "object" && typeof universe !== "function")) return false;
  if (!plainObject(universe)) return true;
  for (let index = 0; index < manifestFields.length; index += 1) {
    const value = read(universe, manifestFields[index]!);
    if (value === unavailable || inspect(value)) return true;
  }
  const symbols = read(universe, "symbols");
  if (symbols === unavailable) return true;
  if (symbols === null || (typeof symbols !== "object" && typeof symbols !== "function")) return false;
  if (types.isProxy(symbols) || !Array.isArray(symbols) || Object.getPrototypeOf(symbols) !== Array.prototype) return true;
  const length = Object.getOwnPropertyDescriptor(symbols, "length")!.value as number;
  if (length > limits.arrayEntries) return true;
  for (let index = 0; index < length; index += 1) {
    const member = read(symbols, String(index));
    if (member === unavailable) return true;
    if (member === null || (typeof member !== "object" && typeof member !== "function")) continue;
    if (!plainObject(member)) return true;
    for (let field = 0; field < memberFields.length; field += 1) {
      const value = read(member, memberFields[field]!);
      if (value === unavailable || inspect(value)) return true;
    }
  }
  return false;
}
function plainObject(value: unknown): value is object {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || (prototype === Object.prototype && Object.getPrototypeOf(Object.prototype) === null);
}
