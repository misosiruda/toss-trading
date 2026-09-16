import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { getDurablePortfolioSizingSnapshotObservation, PortfolioSizingSnapshotFileRepository,
  type PortfolioSizingSnapshotFileRepositoryOptions } from "./portfolioSizingSnapshotFiles.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { getDurableSourcePriceEvidenceObservation,
  SourcePriceEvidenceFileRepository, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { bindSnapshotPendingPlanProgress } from "./snapshotPendingPlanBinding.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();

/** Exact pending membership and gross amount binding; opening reservations and genuine fills remain separate gates. */
export async function resolveStoredSnapshotPendingActions(value: z.input<typeof inputSchema>,
  options: PortfolioSizingSnapshotFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("snapshot pending input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  // Release each source lock before reading another repository; these are historical observations, not a multi-file lease.
  const { snapshot, snapshotObservation } = await new PortfolioSizingSnapshotFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const matches = history.snapshots.filter((item) => item.portfolioSnapshotId === input.portfolioSnapshotId);
    if (matches.length !== 1) throw new Error("snapshot pending source does not resolve exactly once");
    const snapshot = resolvePortfolioSizingSnapshot(matches[0]).snapshot;
    const snapshotObservation = getDurablePortfolioSizingSnapshotObservation(history);
    if (Date.parse(snapshot.asOf) > Date.parse(snapshotObservation.observedAt)) throw new Error("snapshot pending source is in the future");
    return { snapshot, snapshotObservation };
  });
  const planReplay = await resolveStoredPendingPlanActionProgress({ baseDir, portfolioId: snapshot.portfolioId, asOf: snapshot.asOf }, lockOptions);
  if (Date.parse(planReplay.assessment.observedAt) < Date.parse(snapshotObservation.observedAt)) {
    throw new Error("snapshot pending source observation clock moved backwards");
  }
  const needsPrice = planReplay.projection.pendingActions.some((item) => item.action.executionTarget.targetKind !== "fractional_buy_notional");
  const validate = (priceHistory: VerifiedSourcePriceEvidenceHistory | null) => {
    const priceObservation = priceHistory === null ? null : getDurableSourcePriceEvidenceObservation(priceHistory);
    if (priceObservation !== null && Date.parse(priceObservation.observedAt) < Date.parse(planReplay.assessment.observedAt)) {
      throw new Error("snapshot pending price observation clock moved backwards");
    }
    return Object.freeze({ bindings: bindSnapshotPendingPlanProgress(snapshot, planReplay, priceHistory), priceObservation });
  };
  const priceBinding = needsPrice
    ? await new SourcePriceEvidenceFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => validate(history))
    : validate(null);
  const assessment = Object.freeze({ verificationScope: "stored_snapshot_pending_plan_and_gross_amount_only" as const,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash, snapshotObservation, planAssessmentHash: planReplay.assessmentHash,
    priceObservation: priceBinding.priceObservation, bindingsHash: hashCanonicalPayload(priceBinding.bindings),
    pendingBuyExposureKrw: snapshot.exposureSnapshot.pendingBuyExposureKrw,
    pendingSellExposureKrw: snapshot.exposureSnapshot.pendingSellExposureKrw,
    openingReservationAuthority: "not_verified" as const, fillAndRiskOriginAuthority: "not_verified" as const,
    priceFreshnessAndTrust: "not_evaluated" as const, historicalDiskAvailability: "not_proven" as const,
    currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
  return Object.freeze({ snapshot, planReplay, ...priceBinding, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
