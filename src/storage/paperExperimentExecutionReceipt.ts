import { z } from "zod";
import { PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN } from "./artifactPaths.js";

import { auditEventSchema, replayResearchManifestSchema, sha256HashSchema } from "../domain/schemas.js";
import { bindVirtualDecisionHash } from "../paper/decisionHash.js";
import type { HistoricalReplayResult } from "../replay/historicalReplayRunner.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

export const PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH = "replay/paper-experiment-execution.json";
const count = z.number().int().nonnegative().max(100);
export const paperExperimentExecutionReceiptSchema = z.object({
  schemaVersion: z.literal("paper_experiment_execution.v1"),
  runId: z.string().regex(PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN), inputHash: sha256HashSchema,
  expectedManifest: replayResearchManifestSchema,
  artifactDigests: z.object({ manifest: sha256HashSchema, report: sha256HashSchema, packets: sha256HashSchema,
    decisions: sha256HashSchema, riskDecisions: sha256HashSchema, trades: sha256HashSchema }).strict(),
  auditEvents: z.array(auditEventSchema.extend({ eventId: z.string().min(1).max(200), eventType: z.string().min(1).max(100),
    actor: z.string().min(1).max(100), summary: z.string().min(1).max(4000), maskedRefs: z.array(z.string().max(200)).max(20) })).max(5000),
  warnings: z.array(z.string().max(4000)).max(5000),
  samplingDecisions: z.array(z.object({ simulatedAt: z.iso.datetime(), packetId: z.string().min(1).max(200),
    shouldEvaluate: z.boolean(), reason: z.enum(["POLICY_ALLOWED", "STEP_INTERVAL_SKIPPED", "CANDIDATES_UNCHANGED",
      "FREQUENCY_WINDOW_ALREADY_EVALUATED", "DECISION_CALL_BUDGET_EXHAUSTED"]),
    decisionCallsUsed: count, candidateFingerprint: z.string().min(1).max(32_000) }).strict()).max(100)
}).strict();
export type PaperExperimentExecutionReceipt = z.infer<typeof paperExperimentExecutionReceiptSchema>;

/** Classification of retained backend events, never inferred from a missing decision. */
export function paperExperimentExecutionFacts(receipt: Pick<PaperExperimentExecutionReceipt, "auditEvents">) {
  const eventCount = (type: string) => receipt.auditEvents.filter((event) => event.eventType === type).length;
  return { providerFailureCount: eventCount("HISTORICAL_AI_DECISION_FAILED"),
    noCandidateTickCount: eventCount("HISTORICAL_PACKET_SKIPPED"),
    decisionRejectedEventCount: eventCount("HISTORICAL_DECISION_REJECTED") };
}

/** Preserve existing runner facts verbatim; no report/financial formulas live here. */
export function createPaperExperimentExecutionReceipt(input: {
  runId: string; inputHash: string; expectedManifest: PaperExperimentExecutionReceipt["expectedManifest"];
  report: unknown; result: HistoricalReplayResult;
}): PaperExperimentExecutionReceipt {
  return paperExperimentExecutionReceiptSchema.parse({ schemaVersion: "paper_experiment_execution.v1",
    runId: input.runId, inputHash: input.inputHash, expectedManifest: input.expectedManifest,
    artifactDigests: { manifest: createReplayResearchHash(input.expectedManifest), report: createReplayResearchHash(input.report),
      packets: createReplayResearchHash(input.result.packets), decisions: createReplayResearchHash(input.result.decisions.map(bindVirtualDecisionHash)),
      riskDecisions: createReplayResearchHash(input.result.riskDecisions), trades: createReplayResearchHash(input.result.trades) },
    auditEvents: input.result.auditEvents, warnings: input.result.warnings, samplingDecisions: input.result.samplingDecisions });
}
