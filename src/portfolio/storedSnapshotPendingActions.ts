import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { getDurablePortfolioSizingSnapshotObservation, PortfolioSizingSnapshotFileRepository,
  type PortfolioSizingSnapshotFileRepositoryOptions } from "./portfolioSizingSnapshotFiles.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { getDurableSourcePriceEvidenceObservation, resolveVerifiedSourcePriceEvidenceOrigin,
  SourcePriceEvidenceFileRepository, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();
const identity = (planId: string, actionId: string) => JSON.stringify([planId, actionId]);

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
  const expected = new Map(planReplay.projection.pendingActions.map((item) => [identity(item.planId, item.action.actionId), item]));
  if (expected.size !== snapshot.pendingActionInputs.length) throw new Error("snapshot pending action set is incomplete or contains extra actions");
  const lastOrigins = new Map(planReplay.projection.planReplays.map((item) => [item.calculation.input.plan.planId, item.eventOrigins.at(-1)!]));
  const planById = new Map(planReplay.projection.planReplays.map((item) => [item.calculation.input.plan.planId, item.calculation.input.plan]));
  const needsPrice = planReplay.projection.pendingActions.some((item) => item.action.executionTarget.targetKind !== "fractional_buy_notional");
  const validate = (priceHistory: VerifiedSourcePriceEvidenceHistory | null) => {
    const priceObservation = priceHistory === null ? null : getDurableSourcePriceEvidenceObservation(priceHistory);
    if (priceObservation !== null && Date.parse(priceObservation.observedAt) < Date.parse(planReplay.assessment.observedAt)) {
      throw new Error("snapshot pending price observation clock moved backwards");
    }
    const bindings = snapshot.pendingActionInputs.map((pending) => {
      const remaining = expected.get(identity(pending.planId, pending.actionId));
      if (remaining === undefined) throw new Error("snapshot pending action does not resolve to an unfinished plan action");
      for (const field of ["planHash", "planEventId", "planEventHash", "actionExecutionTargetHash"] as const) {
        if (pending[field] !== remaining[field]) throw new Error(`snapshot pending ${field} mismatch`);
      }
      for (const field of ["market", "symbol", "side"] as const) {
        if (pending[field] !== remaining.action[field]) throw new Error(`snapshot pending ${field} mismatch`);
      }
      if (Date.parse(lastOrigins.get(pending.planId)!.appendedAt) >= Date.parse(pending.asOf)) {
        throw new Error("snapshot pending input predates its stored plan event");
      }
      const target = remaining.action.executionTarget;
      let priceOrigin = null;
      let expectedNotionalKrw = remaining.remainingTargetNotionalKrw;
      if (target.targetKind !== "fractional_buy_notional") {
        if (priceHistory === null || remaining.remainingQuantity === null) throw new Error("snapshot pending quantity valuation source is missing");
        const priceRef = pending.side === "SELL" ? pending.priceEvidenceRef : target.priceEvidenceRef;
        priceOrigin = resolveVerifiedSourcePriceEvidenceOrigin(priceHistory, priceRef);
        const price = priceOrigin.record;
        if (price.market !== pending.market || price.symbol !== pending.symbol ||
          Date.parse(price.observedAt) > Date.parse(pending.asOf) || Date.parse(priceOrigin.appendedAt) >= Date.parse(pending.asOf)) {
          throw new Error("snapshot pending price scope or availability mismatch");
        }
        if (pending.side === "BUY" && (price.priceKrw !== target.referencePriceKrw ||
          Date.parse(priceOrigin.appendedAt) >= Date.parse(planById.get(pending.planId)!.evidenceCutoffAt))) {
          throw new Error("snapshot pending BUY target reference price or plan cutoff differs from source");
        }
        // Match the existing integer-KRW plan/preview valuation convention, not remaining cap or realized fill prices.
        expectedNotionalKrw = Math.round(remaining.remainingQuantity * price.priceKrw);
      }
      if (pending.side === "SELL" && pending.remainingQuantity !== remaining.remainingQuantity) {
        throw new Error("snapshot pending remaining quantity mismatch");
      }
      if (expectedNotionalKrw === null || !Number.isSafeInteger(expectedNotionalKrw) || expectedNotionalKrw <= 0 ||
        pending.remainingNotionalKrw !== expectedNotionalKrw) throw new Error("snapshot pending remaining gross notional mismatch");
      return Object.freeze({ pending, remaining, priceOrigin, expectedNotionalKrw });
    });
    return Object.freeze({ bindings: Object.freeze(bindings), priceObservation });
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
