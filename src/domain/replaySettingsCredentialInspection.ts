import { maskSensitiveText } from "../security/masking.js";
import { containsReplaySourceCredential } from "../security/replaySourceText.js";
import { REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS, replaySettingsSnapshotDataSchema } from "./replaySettingsSnapshotFields.js";
import { settingsShape, type SettingsShape } from "./replaySettingsSnapshotShape.js";
import { hasUninspectableReplaySettings, isInspectableReplaySettingsContainer } from "./replaySettingsOpaqueInspection.js";

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
 * Selected opacity makes inspection incomplete. Unknown fields and explicit exclusions stay outside the scan.
 * Accessors, proxies, inherited values, nonplain containers and scalar objects are never evaluated.
 */
export function inspectReplaySettingsCredentials(value: unknown): Decision {
  const state: Inspection = { visitedValues: 0, stringUnits: 0, incomplete: hasUninspectableReplaySettings(value), exhausted: false, redacted: false };
  if (isInspectableReplaySettingsContainer(value, rootShape)) visit(value, rootShape, state);
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
