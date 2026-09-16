import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { getDurableSourcePriceEvidenceObservation, resolveVerifiedSourcePriceEvidenceOrigin,
  type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import type { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

type Progress = Awaited<ReturnType<typeof resolveStoredPendingPlanActionProgress>>;
const identity = (planId: string, actionId: string) => JSON.stringify([planId, actionId]);

/** Shared comparison only: callers own source acquisition and lock ordering. No reservation/fill/Risk authority. */
export function bindSnapshotPendingPlanProgress(snapshot: PortfolioSizingSnapshot, planReplay: Progress,
  priceHistory: VerifiedSourcePriceEvidenceHistory | null) {
  if (snapshot.portfolioId !== planReplay.projection.portfolioId || snapshot.asOf !== planReplay.projection.asOf) {
    throw new Error("snapshot pending plan projection scope mismatch");
  }
  if (priceHistory !== null) getDurableSourcePriceEvidenceObservation(priceHistory);
  const expected = new Map(planReplay.projection.pendingActions.map((item) => [identity(item.planId, item.action.actionId), item]));
  if (expected.size !== snapshot.pendingActionInputs.length) throw new Error("snapshot pending action set is incomplete or contains extra actions");
  const lastOrigins = new Map(planReplay.projection.planReplays.map((item) => [item.calculation.input.plan.planId, item.eventOrigins.at(-1)!]));
  const planById = new Map(planReplay.projection.planReplays.map((item) => [item.calculation.input.plan.planId, item.calculation.input.plan]));
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
  return Object.freeze(bindings);
}
