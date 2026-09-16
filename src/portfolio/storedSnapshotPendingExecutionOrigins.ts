import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PaperFillExecutionFileRepository } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { type PortfolioSizingSnapshotFileRepositoryOptions } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { getDurableSourcePriceEvidenceObservation, SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { bindSnapshotPendingExecutionOrigins } from "./snapshotPendingExecutionBinding.js";
import { resolveStoredSnapshotPendingActions } from "./storedSnapshotPendingActions.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();

/** Historical pending reconciliation, including the actual fill/Risk sources behind every included plan prefix. */
export async function resolveStoredSnapshotPendingExecutionOrigins(value: z.input<typeof inputSchema>,
  options: PortfolioSizingSnapshotFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("snapshot pending execution input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const pending = await resolveStoredSnapshotPendingActions({ baseDir, portfolioSnapshotId: input.portfolioSnapshotId }, lockOptions);
  // Separate historical reads, not a current-generation lease or atomic execution transaction.
  const riskDecisionHistory = await new PortfolioActionRiskDecisionFileRepository(baseDir, lockOptions).readVerifiedHistory();
  const paperFillHistory = await new PaperFillExecutionFileRepository(baseDir, lockOptions).readVerifiedHistory();
  return new SourcePriceEvidenceFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (sourcePriceEvidenceHistory) => {
    const priceObservation = getDurableSourcePriceEvidenceObservation(sourcePriceEvidenceHistory);
    const priorObservation = pending.priceObservation?.observedAt ?? pending.planReplay.assessment.observedAt;
    if (Date.parse(priceObservation.observedAt) < Date.parse(priorObservation)) throw new Error("pending execution source observation clock moved backwards");
    const executionBindings = bindSnapshotPendingExecutionOrigins(pending.planReplay, riskDecisionHistory, paperFillHistory, sourcePriceEvidenceHistory);
    const assessment = Object.freeze({ verificationScope: "stored_snapshot_pending_execution_origins_only" as const,
      pendingAssessmentHash: pending.assessmentHash, executionBindingsHash: hashCanonicalPayload(executionBindings),
      executionCount: executionBindings.length, riskRecordsHash: hashCanonicalPayload(riskDecisionHistory.records),
      fillRecordsHash: hashCanonicalPayload(paperFillHistory.records), priceObservation,
      riskPolicyAndRuleAuthority: "not_verified" as const, openingReservationAuthority: "not_verified" as const,
      accountingAndResultingStateAuthority: "not_verified" as const, priceFreshnessAndTrust: "not_evaluated" as const,
      historicalDiskAvailability: "not_proven" as const, currentExecutionAuthority: "not_granted" as const,
      finalSizing: "not_performed" as const });
    return Object.freeze({ pending, executionBindings: Object.freeze(executionBindings), assessment,
      assessmentHash: hashCanonicalPayload(assessment) });
  });
}
