import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { portfolioSizingSnapshotObservationSchema } from "./portfolioSizingSnapshotFiles.js";
import { type PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { type validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";

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
  return resolved;
}

export function riskDecisionSnapshotIdentity(resolved: ReturnType<typeof validateRiskDecisionSnapshotState>) {
  const { snapshot } = resolved;
  return { portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    exposureSnapshotHash: snapshot.exposureSnapshotHash };
}
