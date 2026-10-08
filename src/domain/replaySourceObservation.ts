import { z } from "zod";
import { replayInitialPortfolioIdentitySchema, replayInitialPortfolioObservationSchema } from "./replayInitialPortfolioObservation.js";
import { replaySourceSnapshotObservationSchema } from "./replaySourceSnapshot.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const initialState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), snapshotVersion: z.literal("replay_initial_portfolio_snapshot.v1"), contentHash: hash }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["unsupported_shape", "redacted", "limit"]) }).strict()
]);

export const replaySourceObservationSchema = z.object({
  schemaVersion: z.literal("replay_source_observation.v1"), mode: z.literal("paper_only"),
  phase: z.literal("runner_consumed_source"), identity: replayInitialPortfolioIdentitySchema,
  startedAt: z.iso.datetime(), reservationHash: hash,
  initialObservation: z.object({
    schemaVersion: z.literal("replay_initial_portfolio_observation.v1"), observationHash: hash,
    initialPortfolio: initialState
  }).strict(),
  source: replaySourceSnapshotObservationSchema,
  admission: z.literal("unavailable"), configuration: z.literal("unavailable"),
  acquisition: z.literal("unavailable"), sourceTrust: z.literal("unavailable"),
  sourceFileIdentity: z.literal("unavailable"), sourceReadCompleteness: z.literal("unavailable"),
  runtime: z.literal("unavailable"), dependencies: z.literal("unavailable"), result: z.literal("unavailable"),
  completeInput: z.literal(false), comparability: z.literal("unavailable")
}).strict();

export type ReplaySourceObservation = z.infer<typeof replaySourceObservationSchema>;
export type ReplayInitialPortfolioObservation = z.infer<typeof replayInitialPortfolioObservationSchema>;

/** Bind only the initial writer's actual record, not a later filesystem reconstruction. */
export function initialPortfolioObservationReference(record: ReplayInitialPortfolioObservation): ReplaySourceObservation["initialObservation"] {
  const initial = record.initialPortfolio;
  return {
    schemaVersion: record.schemaVersion, observationHash: createReplayResearchHash(record),
    initialPortfolio: initial.status === "recorded"
      ? { status: "recorded", snapshotVersion: initial.snapshotVersion, contentHash: initial.contentHash }
      : { status: "unavailable", reason: initial.reason }
  };
}
