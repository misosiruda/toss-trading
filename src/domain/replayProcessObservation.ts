import { types } from "node:util";
import { z } from "zod";
import { replayDurableAdmissionReferenceSchema, type ReplayDurableAdmissionReference } from "./replayAdmissionLineage.js";

export const REPLAY_PROCESS_OBSERVATION_FILE_NAME = "historical-replay-process-observation.json";
export const REPLAY_PROCESS_OBSERVATION_MAX_BYTES = 4_096;

const bindingDataSchema = replayDurableAdmissionReferenceSchema.pick({ identity: true, startedAt: true }).strict();
export const replayProcessObservationBindingSchema = processParser(bindingDataSchema);
export type ReplayProcessObservationBinding = z.infer<typeof bindingDataSchema>;

const scalarDataSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"),
    nodeVersion: z.string().max(12).regex(/^v(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})(?![\s\S])/),
    platform: z.enum(["aix", "android", "darwin", "freebsd", "linux", "openbsd", "sunos", "win32"]),
    architecture: z.enum(["arm", "arm64", "ia32", "loong64", "mips", "mipsel", "ppc64", "riscv64", "s390", "s390x", "x64"]),
    costModelVersion: z.literal("paper_cost_model.v5"), executionModelVersion: z.literal("execution_simulator.v4")
  }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.literal("unsupported_process_observation") }).strict()
]);
export const replayProcessScalarObservationSchema = processParser(scalarDataSchema);
export type ReplayProcessScalarObservation = z.infer<typeof scalarDataSchema>;
export interface ReplayProcessObservationEvidence {
  readonly binding: ReplayProcessObservationBinding;
  readonly process: ReplayProcessScalarObservation;
}

const recordDataSchema = replayDurableAdmissionReferenceSchema.extend({
  schemaVersion: z.literal("replay_child_process_observation.v1"), mode: z.literal("paper_only"),
  phase: z.literal("runner_process_observation"), process: scalarDataSchema,
  implementation: z.literal("unavailable"), sourceBuild: z.literal("unavailable"), dependencyLock: z.literal("unavailable"),
  loadedDependencies: z.literal("unavailable"), nodeArtifact: z.literal("unavailable"), runtimeConfiguration: z.literal("unavailable"),
  runtime: z.literal("unavailable"), dependencies: z.literal("unavailable"), result: z.literal("unavailable"),
  comparability: z.literal("unavailable"), completeRuntime: z.literal(false), completeConfiguration: z.literal(false), completeInput: z.literal(false)
}).strict().superRefine((value, context) => {
  const references = [value.initialObservation, value.sourceObservation, value.settingsObservation];
  const states = [value.initialObservation.initialPortfolio, value.sourceObservation.source, value.settingsObservation.settings];
  const hashes = references.map(reference => reference.observationHash);
  for (const state of states) if (state.status === "recorded") hashes.push(state.contentHash);
  if (hashes.some(value => value.length !== 71 || !/^sha256:[a-f0-9]{64}(?![\s\S])/.test(value))) {
    context.addIssue({ code: "custom", message: "Invalid process observation reference hash" });
  }
});
export const replayProcessObservationSchema = processParser(recordDataSchema);
export type ReplayProcessObservation = z.infer<typeof recordDataSchema>;

const producerInputSchema = z.object({ admission: replayDurableAdmissionReferenceSchema,
  evidence: z.object({ binding: bindingDataSchema, process: scalarDataSchema }).strict()
}).strict();

// A pure data producer. Only the actual runner's private context resolver supplies issued evidence,
// and only the owning reservation supplies a reference after successful B durability.
export function createReplayProcessObservation(input: {
  admission: ReplayDurableAdmissionReference; evidence: ReplayProcessObservationEvidence;
}): ReplayProcessObservation {
  try {
    if (!boundedProcessData(input)) throw Error();
    const { admission, evidence: { binding, process } } = producerInputSchema.parse(input);
    if (binding.identity.runId !== admission.identity.runId || binding.identity.batchId !== admission.identity.batchId ||
      binding.identity.runIndex !== admission.identity.runIndex || binding.startedAt !== admission.startedAt) throw Error();
    return replayProcessObservationSchema.parse({
      ...admission, schemaVersion: "replay_child_process_observation.v1", mode: "paper_only", phase: "runner_process_observation",
      process, implementation: "unavailable", sourceBuild: "unavailable", dependencyLock: "unavailable",
      loadedDependencies: "unavailable", nodeArtifact: "unavailable", runtimeConfiguration: "unavailable", runtime: "unavailable",
      dependencies: "unavailable", result: "unavailable", comparability: "unavailable", completeRuntime: false,
      completeConfiguration: false, completeInput: false
    });
  } catch { throw Error("process observation admission binding mismatch"); }
}

function boundedProcessData(value: unknown, depth = 0, budget = { remaining: 128 }): boolean {
  // Zod serializes an issues array and its objects even for invalid null-prototype inputs.
  if (depth === 0 && unsafeProcessJsonPrototypes()) return false;
  if (--budget.remaining < 0 || depth > 5) return false;
  if (typeof value === "string") return value.length <= 256;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 24) return false;
  return keys.every(key => {
    if (typeof key !== "string" || key.length > 64) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return descriptor.enumerable && Object.hasOwn(descriptor, "value") && boundedProcessData(descriptor.value, depth + 1, budget);
  });
}

function unsafeProcessJsonPrototypes(): boolean {
  // Compare the standard chain before inspecting descriptors. Never walk an unexpected or proxy prototype.
  if (Object.getPrototypeOf(Array.prototype) !== Object.prototype || Object.getPrototypeOf(Object.prototype) !== null) return true;
  return executableToJSON(Object.getOwnPropertyDescriptor(Array.prototype, "toJSON")) ||
    executableToJSON(Object.getOwnPropertyDescriptor(Object.prototype, "toJSON"));
}
function executableToJSON(descriptor: PropertyDescriptor | undefined): boolean {
  return descriptor !== undefined && (!Object.hasOwn(descriptor, "value") || typeof descriptor.value === "function");
}

// Preflight must happen outside Zod: constructing a ZodError can itself invoke inherited serialization hooks.
// These are data parsers only; none can issue the runner's private process context.
function processParser<T extends z.ZodType>(schema: T): {
  parse: (value: unknown) => z.infer<T>;
  safeParse: (value: unknown) => { success: true; data: z.infer<T> } | { success: false; error: Error };
} {
  const safeParse = (value: unknown): { success: true; data: z.infer<T> } | { success: false; error: Error } => {
    if (!boundedProcessData(value)) return { success: false, error: Error("Unsupported process observation shape") };
    const parsed = schema.safeParse(value);
    return parsed.success ? { success: true, data: parsed.data } : { success: false, error: Error("Invalid process observation data") };
  };
  return Object.freeze({ safeParse, parse: (value: unknown): z.infer<T> => {
    const parsed = safeParse(value);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } });
}
