import { types } from "node:util";
import { z } from "zod";
import { PAPER_SIMULATION_ID_PATTERN } from "./paperSimulationObservation.js";
import { replayDurableSettingsReferenceSchema } from "./replaySettingsObservation.js";

export const REPLAY_ADMISSION_LINEAGE_FILE_NAME = "historical-replay-admission-lineage.json";
export const REPLAY_ADMISSION_LINEAGE_MAX_BYTES = 8_192;
export const PAPER_SIMULATION_CHILD_MAPPING_VERSION = "paper_simulation_child_mapping.v1";
const hash = z.string().length(71).regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().regex(PAPER_SIMULATION_ID_PATTERN);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value => {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
});
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const replayAdmissionPlannedWindowSchema = z.object({
  seed: z.string().min(1).max(140), rangeStart: instant, rangeEnd: instant,
  windowMonths: z.number().int().min(1).max(12), timezoneOffsetMinutes: z.literal(540),
  candidateCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  selectedCandidateIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  selectedMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  localStartDate: localDate, localEndDate: localDate, startAt: instant, endAt: instant
}).strict().refine(value => value.selectedCandidateIndex < value.candidateCount);
export const paperSimulationAdmissionReceiptSchema = z.object({
  receiptVersion: z.literal("paper_simulation_admission_receipt.v1"),
  simulationRunId: id, batchId: id, acceptedAt: instant,
  canonicalVersion: z.literal("paper_simulation_canonical_request.v1"), canonicalRequestHash: hash,
  inputVersion: z.literal("paper_simulation_input_provenance.v1"), inputProvenanceHash: hash
}).strict().refine(value => value.simulationRunId === value.batchId);
const lineage = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), receipt: paperSimulationAdmissionReceiptSchema,
    mappingVersion: z.literal(PAPER_SIMULATION_CHILD_MAPPING_VERSION), effectiveRunCount: z.number().int().min(1).max(20),
    windowMode: z.enum(["random_month", "fixed_range"]), normalizedBatchSeed: z.string().min(1).max(120),
    plannedWindow: replayAdmissionPlannedWindowSchema, expectedSettingsHash: hash,
    initialCapitalRelation: z.enum(["generated_matches_admission", "stored_portfolio_precedence"])
  }).strict(),
  z.object({ status: z.literal("unavailable"),
    reason: z.enum(["unsupported_derivation", "settings_unavailable", "initial_unavailable"]) }).strict()
]);
const reference = replayDurableSettingsReferenceSchema.shape;
const record = z.object({
  schemaVersion: z.literal("replay_admission_lineage.v1"), mode: z.literal("paper_only"), phase: z.literal("child_admission_binding"),
  identity: reference.identity.extend({ batchId: id, runIndex: z.number().int().min(0).max(19) }).strict(),
  startedAt: instant, reservationHash: hash,
  initialObservation: reference.initialObservation, sourceObservation: reference.sourceObservation,
  settingsObservation: reference.settingsObservation, lineage,
  clock: z.literal("unavailable"), sampler: z.literal("unavailable"), provider: z.literal("unavailable"),
  acquisition: z.literal("unavailable"), sourceTrust: z.literal("unavailable"), sourceFileIdentity: z.literal("unavailable"),
  sourceReadCompleteness: z.literal("unavailable"), runtime: z.literal("unavailable"), dependencies: z.literal("unavailable"),
  result: z.literal("unavailable"), completeConfiguration: z.literal(false), completeInput: z.literal(false), comparability: z.literal("unavailable")
}).strict().superRefine((value, context) => {
  const hashes = [value.initialObservation.observationHash, value.sourceObservation.observationHash,
    value.settingsObservation.observationHash];
  for (const state of [value.initialObservation.initialPortfolio, value.sourceObservation.source, value.settingsObservation.settings]) {
    if (state.status === "recorded") hashes.push(state.contentHash);
  }
  if (hashes.some(value => !hash.safeParse(value).success)) {
    context.addIssue({ code: "custom", message: "Invalid admission lineage reference hash" });
  }
  const bound = value.lineage;
  if (bound.status !== "recorded") return;
  const settings = value.settingsObservation.settings;
  if (bound.receipt.batchId !== value.identity.batchId || value.identity.runIndex >= bound.effectiveRunCount ||
    value.startedAt !== new Date(Date.parse(bound.receipt.acceptedAt) + value.identity.runIndex).toISOString() ||
    bound.normalizedBatchSeed !== bound.normalizedBatchSeed.trim() ||
    bound.plannedWindow.seed !== `${bound.normalizedBatchSeed}:${value.identity.runIndex}` ||
    (bound.windowMode === "fixed_range" && (bound.plannedWindow.candidateCount !== 1 || bound.plannedWindow.selectedCandidateIndex !== 0)) ||
    settings.status !== "recorded" || settings.contentHash !== bound.expectedSettingsHash ||
    value.initialObservation.initialPortfolio.status !== "recorded") {
    context.addIssue({ code: "custom", message: "Admission lineage binding mismatch" });
  }
});
// This parser validates data only. It cannot issue an admission or certify writer ownership.
export const replayAdmissionLineageSchema = z.unknown().superRefine((value, context) => {
  if (!boundedLineageData(value)) context.addIssue({ code: "custom", message: "Unsupported admission lineage shape" });
}).pipe(record);
export type ReplayAdmissionLineage = z.infer<typeof replayAdmissionLineageSchema>;

function boundedLineageData(value: unknown, depth = 0, budget = { remaining: 128 }): boolean {
  if (--budget.remaining < 0 || depth > 5) return false;
  if (typeof value === "string") return value.length <= 256;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 24) return false;
  return keys.every(key => {
    if (typeof key !== "string" || key.length > 64) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return descriptor.enumerable && Object.hasOwn(descriptor, "value") && boundedLineageData(descriptor.value, depth + 1, budget);
  });
}
