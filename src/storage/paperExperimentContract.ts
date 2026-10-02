import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME,
  HISTORICAL_REPLAY_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_PACKETS_FILE_NAME,
  HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME,
  HISTORICAL_REPLAY_PROGRESS_FILE_NAME,
  HISTORICAL_REPLAY_REPORT_FILE_NAME,
  HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME,
  HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME,
  HISTORICAL_REPLAY_TRADES_FILE_NAME,
  PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN,
  PAPER_EXPERIMENT_INPUT_FILE_NAME
} from "./artifactPaths.js";

export const PAPER_EXPERIMENT_ARTIFACTS = Object.freeze({
  input: `input/${PAPER_EXPERIMENT_INPUT_FILE_NAME}`,
  source: `input/${HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME}`,
  manifest: `replay/${HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME}`,
  metadata: `replay/${HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME}`,
  progress: `replay/${HISTORICAL_REPLAY_PROGRESS_FILE_NAME}`,
  report: `replay/${HISTORICAL_REPLAY_REPORT_FILE_NAME}`,
  packets: `replay/${HISTORICAL_REPLAY_PACKETS_FILE_NAME}`,
  decisions: `replay/${HISTORICAL_REPLAY_DECISIONS_FILE_NAME}`,
  riskDecisions: `replay/${HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME}`,
  trades: `replay/${HISTORICAL_REPLAY_TRADES_FILE_NAME}`,
  timeline: `replay/${HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME}`
} as const);

export const paperExperimentRuntimeIdentitySchema = z.object({
  implementationRevision: z.string().regex(/^[a-f0-9]{40}$/),
  dependencyLockHash: sha256HashSchema,
  nodeVersion: z.string().regex(/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
}).strict();
export type PaperExperimentRuntimeIdentity = z.infer<typeof paperExperimentRuntimeIdentitySchema>;

export const paperExperimentInventoryEntrySchema = z.object({
  relativePath: z.enum(Object.values(PAPER_EXPERIMENT_ARTIFACTS)),
  contract: z.string().regex(/^[A-Za-z0-9_.]+$/).max(100),
  format: z.enum(["json", "jsonl"]),
  recordCount: z.number().int().nonnegative().max(10_000),
  digest: sha256HashSchema
}).strict();
export type PaperExperimentInventoryEntry = z.infer<typeof paperExperimentInventoryEntrySchema>;

const instant = z.iso.datetime({ precision: 3 });
const attemptId = z.string().regex(PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN);
export const paperExperimentStateSchema = z.object({
  schemaVersion: z.literal("paper_experiment_attempt.v1"),
  attemptId,
  runId: attemptId,
  parentAttemptId: attemptId.nullable(),
  inputHash: sha256HashSchema,
  runtimeIdentity: paperExperimentRuntimeIdentitySchema,
  status: z.enum(["preparing", "prepared", "running", "completed", "failed"]),
  createdAt: instant,
  startedAt: instant.nullable(),
  endedAt: instant.nullable(),
  terminationReason: z.enum(["completed", "preparation_failed", "execution_failed", "artifact_integrity_failed"]).nullable(),
  generation: z.number().int().nonnegative().max(4),
  artifactInventory: z.array(paperExperimentInventoryEntrySchema).length(Object.keys(PAPER_EXPERIMENT_ARTIFACTS).length).nullable()
}).strict().superRefine((state, ctx) => {
  const terminal = state.status === "completed" || state.status === "failed";
  if (state.attemptId !== state.runId || state.parentAttemptId === state.attemptId
    || (state.status === "completed") !== (state.artifactInventory !== null)
    || terminal !== (state.endedAt !== null) || terminal !== (state.terminationReason !== null)
    || (state.status === "completed" && (state.startedAt === null || state.terminationReason !== "completed"))
    || (state.status === "failed" && state.terminationReason === "completed")
    || (state.status === "running" && state.startedAt === null)
    || (["preparing", "prepared"].includes(state.status) && state.startedAt !== null)
    || (state.startedAt !== null && state.startedAt < state.createdAt)
    || (state.endedAt !== null && state.endedAt < (state.startedAt ?? state.createdAt))) {
    ctx.addIssue({ code: "custom", message: "Inconsistent experiment lifecycle" });
  }
});
export type PaperExperimentState = z.infer<typeof paperExperimentStateSchema>;
