import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { subtractCanonicalQuantities } from "./canonicalQuantity.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { resolveCurrentInvestmentMandateAsOf } from "./investmentMandateState.js";
import { createPortfolioPacketExecutionPreview } from "./portfolioPacketExecutionPreview.js";
import { readStoredRiskDecisionPlanContext } from "./portfolioActionRiskDecisionPlanContext.js";
import { hashRebalanceExecutionTarget } from "./rebalancePlan.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((value) => value === value.trim());
export const portfolioPlanExecutionPreviewInputSchema = z.object({
  baseDir: z.string().min(1), planId: identifier, expectedPlanEventHash: sha256HashSchema,
  priceEvidenceRef: identifier, liquidityPacketHash: sha256HashSchema
}).strict();

/**
 * Derives the next request from stored plan progress. This is a read-only observation,
 * not a reservation, proof of current portfolio state, Risk approval or atomic execution.
 */
export async function createPortfolioPlanExecutionPreview(value: z.input<typeof portfolioPlanExecutionPreviewInputSchema>) {
  const input = portfolioPlanExecutionPreviewInputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("plan execution preview input must already be canonical");
  const context = await readStoredRiskDecisionPlanContext({ baseDir: input.baseDir, planId: input.planId });
  const { state } = context;
  if (state.lastEvent.planEventHash !== input.expectedPlanEventHash) throw new Error("plan execution preview predecessor drift");
  if (state.status !== "approved" && state.status !== "execution_applied") throw new Error("plan execution preview requires an approved unfinished plan");
  const progress = state.actions.find((action) => !action.complete);
  if (progress === undefined) throw new Error("plan execution preview has no remaining action");
  const action = state.plan.actions[progress.actionSequence]!;
  const target = action.executionTarget;
  const remainingNotionalCapKrw = action.maximumNotionalKrw - progress.cumulativeFilledNotionalKrw;
  const price = await new SourcePriceEvidenceFileRepository(input.baseDir).resolveByRef(input.priceEvidenceRef);
  if (price.market !== action.market || price.symbol !== action.symbol) throw new Error("plan execution preview price scope mismatch");
  const quantityOverride = target.targetKind === "fractional_buy_notional" ? null
    : subtractCanonicalQuantities(target.targetQuantity, progress.cumulativeFilledQuantity);
  const requestedNotionalKrw = target.targetKind === "fractional_buy_notional"
    ? target.targetNotionalKrw - progress.cumulativeFilledNotionalKrw : Math.round(quantityOverride! * price.priceKrw);
  if (!Number.isSafeInteger(requestedNotionalKrw) || requestedNotionalKrw <= 0 || requestedNotionalKrw > remainingNotionalCapKrw) {
    throw new Error("plan execution preview remaining request exceeds notional cap or supported range");
  }
  const mandates = new InvestmentMandateFileRepository(input.baseDir);
  const mandateHistory = action.lineageKind === "mandate" ? await mandates.readSnapshot() : null;
  const readAt = new Date().toISOString();
  const resolveMandate = (asOf: string) => {
    if (action.lineageKind !== "mandate" || mandateHistory === null) return null;
    const resolved = resolveCurrentInvestmentMandateAsOf({ mandateId: action.mandateId, portfolioId: state.plan.portfolioId,
      policyHash: state.plan.policyHash, market: action.market, symbol: action.symbol, asOf, knownAt: asOf,
      records: mandateHistory.records, events: mandateHistory.events });
    if (action.side === "BUY" && (resolved.status !== "active" ||
      (resolved.record.assignmentSource === "manual_policy" && resolved.record.manualAuthorizationScope === "classify_existing_reduce_only"))) {
      throw new Error("plan BUY preview requires an active open-or-increase mandate");
    }
    return resolved;
  };
  const mandate = resolveMandate(readAt);
  const scope = mandate === null ? { scopeKind: "legacy_reduce_only" as const }
    : { scopeKind: "bucket" as const, bucket: mandate.record.bucket };
  const packetPreview = await createPortfolioPacketExecutionPreview({ baseDir: input.baseDir, portfolioId: state.plan.portfolioId,
    expectedPolicyHash: state.plan.policyHash, scope, market: action.market, symbol: action.symbol, side: action.side,
    requestedNotionalKrw, quantityOverride, priceEvidenceRef: input.priceEvidenceRef, liquidityPacketHash: input.liquidityPacketHash });
  const preview = packetPreview.policyPreview.preview;
  if (Date.parse(preview.input.asOf) < Date.parse(readAt) || Date.parse(readAt) < Date.parse(context.origin.observedAt)) {
    throw new Error("plan execution preview clock moved backwards");
  }
  if (preview.input.sourcePriceEvidence.evidenceHash !== price.evidenceHash) throw new Error("plan execution preview source price changed");
  if (preview.input.executionPolicy.allowFractionalShares !== (target.targetKind !== "whole_share_quantity")) {
    throw new Error("plan execution target and policy share mode differ");
  }
  if (preview.execution.grossAmountKrw > remainingNotionalCapKrw) throw new Error("plan execution preview modeled amount exceeds remaining cap");
  if (!isDeepStrictEqual(resolveMandate(preview.input.asOf), mandate)) throw new Error("plan execution preview mandate changed at cutoff");
  // Sequential re-reads detect drift during composition, but never claim a multi-file lease.
  if (mandateHistory !== null && !isDeepStrictEqual(await mandates.readSnapshot(), mandateHistory)) {
    throw new Error("plan execution preview mandate history changed during calculation");
  }
  const finalContext = await readStoredRiskDecisionPlanContext({ baseDir: input.baseDir, planId: input.planId });
  if (finalContext.origin.predecessorCommitHash !== context.origin.predecessorCommitHash ||
    finalContext.origin.planCommitHash !== context.origin.planCommitHash ||
    Date.parse(finalContext.origin.observedAt) < Date.parse(preview.input.asOf)) {
    throw new Error("plan execution preview state changed during calculation");
  }
  const planContext = {
    origin: context.origin, verifiedAt: finalContext.origin.observedAt,
    portfolioVersion: state.executionPortfolioVersion, portfolioSnapshotHash: state.executionPortfolioSnapshotHash,
    actionId: action.actionId, actionSequence: action.actionSequence, executionTargetHash: hashRebalanceExecutionTarget(target),
    priorCumulativeFilledNotionalKrw: progress.cumulativeFilledNotionalKrw,
    priorCumulativeFilledQuantity: progress.cumulativeFilledQuantity, remainingNotionalCapKrw,
    mandate: mandate === null ? null : { mandateId: mandate.record.mandateId, mandateHash: mandate.record.mandateHash,
      mandateEventId: mandate.currentEvent!.mandateEventId, mandateEventHash: mandate.currentEvent!.mandateEventHash,
      historyHash: hashCanonicalPayload(mandateHistory), readAt }
  };
  return deepFreeze({ packetPreview, planContext, observationHash: hashCanonicalPayload({ packetPreview, planContext }) });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
