import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { portfolioSizingSnapshotObservationSchema } from "./portfolioSizingSnapshotFiles.js";
import { type PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { type validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";

export const riskDecisionSnapshotOriginSchema = z.object({
  portfolioSnapshotId: z.string().min(1).max(160), portfolioSnapshotHash: sha256HashSchema,
  exposureSnapshotHash: sha256HashSchema, observation: portfolioSizingSnapshotObservationSchema
}).strict();
export type RiskDecisionSnapshotOrigin = Readonly<z.infer<typeof riskDecisionSnapshotOriginSchema>>;

/** Replays the exact plan pre-state; numeric Risk rules and current execution authority are separate. */
export function validateRiskDecisionSnapshotState(
  binding: ReturnType<typeof validateRiskDecisionPlanState>, snapshots: readonly PortfolioSizingSnapshot[]
) {
  const { decision } = binding;
  const matches = snapshots.filter((snapshot) => snapshot.portfolioSnapshotHash === decision.expectedPortfolioSnapshotHash);
  if (matches.length !== 1) throw new Error("risk decision snapshot source does not resolve exactly once");
  const resolved = resolvePortfolioSizingSnapshot(matches[0]);
  const { snapshot } = resolved;
  if (snapshot.portfolioId !== decision.portfolioId || snapshot.policyHash !== decision.policyHash ||
    snapshot.portfolioVersion !== decision.expectedPortfolioVersion || Date.parse(snapshot.asOf) > Date.parse(decision.decidedAt)) {
    throw new Error("risk decision snapshot scope or as-of mismatch");
  }
  if (decision.decision === "approved" && decision.side === "BUY" && snapshot.exposureSnapshot.unassignedExposureKrw !== undefined) {
    throw new Error("risk BUY approval requires a portfolio without unassigned exposure");
  }
  if (decision.decision === "approved" && decision.side === "SELL") {
    const bucket = decision.riskRuleScope.scopeKind === "bucket" ? decision.riskRuleScope.bucket : undefined;
    // Snapshot parsing enforces one lot per market/symbol/bucket. Never borrow
    // another bucket's shares or assign legacy holdings to an active mandate.
    const position = snapshot.virtualPortfolio.positions.find((lot) =>
      lot.market === decision.market && lot.symbol === decision.symbol && lot.strategyBucket === bucket);
    if (canonicalQuantityUnits(decision.requestedQuantity) > canonicalQuantityUnits(position?.quantity ?? 0)) {
      throw new Error("risk SELL approval exceeds owned snapshot quantity");
    }
    // This is a physical holdings bound, not pending SELL reservation authority.
    // The current resulting snapshot already includes prior fills; do not subtract them twice.
  }
  return resolved;
}

export function riskDecisionSnapshotIdentity(resolved: ReturnType<typeof validateRiskDecisionSnapshotState>) {
  const { snapshot } = resolved;
  return { portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    exposureSnapshotHash: snapshot.exposureSnapshotHash };
}
