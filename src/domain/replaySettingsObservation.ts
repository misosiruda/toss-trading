import { z } from "zod";
import { replayInitialPortfolioIdentitySchema } from "./replayInitialPortfolioObservation.js";
import { initialPortfolioObservationReference, type ReplayInitialPortfolioObservation, type ReplaySourceObservation } from "./replaySourceObservation.js";
import { replaySettingsSnapshotObservationSchema } from "./replaySettingsSnapshot.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const initialState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), snapshotVersion: z.literal("replay_initial_portfolio_snapshot.v1"), contentHash: hash }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["unsupported_shape", "redacted", "limit"]) }).strict()
]);
const initialReference = z.object({ schemaVersion: z.literal("replay_initial_portfolio_observation.v1"),
  observationHash: hash, initialPortfolio: initialState }).strict();
const sourceState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), snapshotVersion: z.literal("replay_source_snapshot.v1"), contentHash: hash }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["unsupported_shape", "redacted", "limit", "retention_unavailable"]) }).strict()
]);
const sourceReference = z.object({ schemaVersion: z.literal("replay_source_observation.v1"),
  observationHash: hash, source: sourceState }).strict();

// The reservation keeps this small receipt, never the source payload or a later filesystem reconstruction.
export const replayDurableSourceReferenceSchema = z.object({
  identity: replayInitialPortfolioIdentitySchema, startedAt: z.iso.datetime(), reservationHash: hash,
  initialObservation: initialReference, sourceObservation: sourceReference
}).strict();
export type ReplayDurableSourceReference = z.infer<typeof replayDurableSourceReferenceSchema>;

export function durableSourceObservationReference(record: ReplaySourceObservation): ReplayDurableSourceReference {
  const source = record.source;
  const reference = replayDurableSourceReferenceSchema.parse({
    identity: record.identity, startedAt: record.startedAt, reservationHash: record.reservationHash,
    initialObservation: record.initialObservation,
    sourceObservation: { schemaVersion: record.schemaVersion, observationHash: createReplayResearchHash(record),
      source: source.status === "recorded"
        ? { status: source.status, snapshotVersion: source.snapshotVersion, contentHash: source.contentHash }
        : { status: source.status, reason: source.reason } }
  });
  Object.freeze(reference.identity);
  Object.freeze(reference.initialObservation.initialPortfolio);
  Object.freeze(reference.initialObservation);
  Object.freeze(reference.sourceObservation.source);
  Object.freeze(reference.sourceObservation);
  return Object.freeze(reference);
}

export const replaySettingsObservationSchema = z.object({
  schemaVersion: z.literal("replay_settings_observation.v1"), mode: z.literal("paper_only"),
  phase: z.literal("runner_supplied_settings"), identity: replayInitialPortfolioIdentitySchema,
  startedAt: z.iso.datetime(), reservationHash: hash,
  initialObservation: initialReference, sourceObservation: sourceReference,
  settings: replaySettingsSnapshotObservationSchema,
  admission: z.literal("unavailable"), clock: z.literal("unavailable"), sampler: z.literal("unavailable"),
  provider: z.literal("unavailable"), acquisition: z.literal("unavailable"), sourceTrust: z.literal("unavailable"),
  sourceFileIdentity: z.literal("unavailable"), sourceReadCompleteness: z.literal("unavailable"),
  runtime: z.literal("unavailable"), dependencies: z.literal("unavailable"), result: z.literal("unavailable"),
  completeConfiguration: z.literal(false), completeInput: z.literal(false), comparability: z.literal("unavailable")
}).strict();
export type ReplaySettingsObservation = z.infer<typeof replaySettingsObservationSchema>;

const settingsState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), snapshotVersion: z.literal("replay_settings_snapshot.v1"), contentHash: hash }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["unsupported_shape", "redacted", "limit", "inspection_unavailable"]) }).strict()
]);
// B retains only the actual durable A reference, never its potentially large snapshot.
export const replayDurableSettingsReferenceSchema = replayDurableSourceReferenceSchema.extend({
  settingsObservation: z.object({ schemaVersion: z.literal("replay_settings_observation.v1"),
    observationHash: hash, settings: settingsState }).strict()
}).strict();
export type ReplayDurableSettingsReference = z.infer<typeof replayDurableSettingsReferenceSchema>;

export function durableSettingsObservationReference(record: ReplaySettingsObservation): ReplayDurableSettingsReference {
  const settings = record.settings;
  const reference = replayDurableSettingsReferenceSchema.parse({
    identity: record.identity, startedAt: record.startedAt, reservationHash: record.reservationHash,
    initialObservation: record.initialObservation, sourceObservation: record.sourceObservation,
    settingsObservation: { schemaVersion: record.schemaVersion, observationHash: createReplayResearchHash(record),
      settings: settings.status === "recorded"
        ? { status: settings.status, snapshotVersion: settings.snapshotVersion, contentHash: settings.contentHash }
        : { status: settings.status, reason: settings.reason } }
  });
  Object.freeze(reference.identity);
  Object.freeze(reference.initialObservation.initialPortfolio);
  Object.freeze(reference.initialObservation);
  Object.freeze(reference.sourceObservation.source);
  Object.freeze(reference.sourceObservation);
  Object.freeze(reference.settingsObservation.settings);
  Object.freeze(reference.settingsObservation);
  return Object.freeze(reference);
}

export function assertSettingsSourceBinding(initial: ReplayInitialPortfolioObservation, source: ReplayDurableSourceReference): void {
  if (initial.identity.runId !== source.identity.runId || initial.identity.batchId !== source.identity.batchId ||
    initial.identity.runIndex !== source.identity.runIndex || initial.startedAt !== source.startedAt ||
    initial.reservationHash !== source.reservationHash ||
    createReplayResearchHash(initialPortfolioObservationReference(initial)) !== createReplayResearchHash(source.initialObservation)) {
    throw Error("settings observation source binding mismatch");
  }
  if (source.sourceObservation.source.status === "unavailable" && source.sourceObservation.source.reason === "redacted") {
    throw Error("settings observation source redacted");
  }
}
