import { types } from "node:util";
import { maskSensitiveText } from "../security/masking.js";
import { containsReplaySourceCredential } from "../security/replaySourceText.js";
import { replaySettingsSnapshotDataSchema } from "./replaySettingsSnapshotFields.js";
import { settingsShape, type SettingsShape } from "./replaySettingsSnapshotShape.js";

// Separate security work budgets, not extensions of the frozen snapshot's recording support.
export const REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS = Object.freeze({
  perStringUnits: 4_096, totalStringUnits: 16_777_216, visitedValues: 500_000, arrayEntries: 100_000
});
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
 * Unknown fields, opaque inputs, excluded labels, accessors and proxies are never executed or traversed.
 * A clear result covers only those readable selected values; it does not certify getter/proxy outputs.
 */
export function inspectReplaySettingsCredentials(value: unknown): Decision {
  const state: Inspection = { visitedValues: 0, stringUnits: 0, incomplete: false, exhausted: false, redacted: false };
  if (readableObject(value)) visit(value, rootShape, state);
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
  if (!readableObject(value)) return;
  if (shape.kind === "object") {
    for (const [key, child] of shape.fields) {
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
function readableObject(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function") && !types.isProxy(value);
}
