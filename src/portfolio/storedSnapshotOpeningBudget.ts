import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSnapshotOpeningCapacity } from "./storedSnapshotOpeningCapacity.js";
import { projectSnapshotOpeningBudget } from "./snapshotOpeningBudgetProjection.js";

/** Reservation-adjusted historical cash/band bounds, not trigger eligibility, sizing or a current allocation approval. */
export async function resolveStoredSnapshotOpeningBudget(
  input: Parameters<typeof resolveStoredSnapshotOpeningCapacity>[0],
  options: NonNullable<Parameters<typeof resolveStoredSnapshotOpeningCapacity>[1]> = {}
) {
  const occupancy = await resolveStoredSnapshotOpeningCapacity(input, options);
  const policy = occupancy.activePolicy.policy;
  const snapshot = occupancy.sources.pending.pending.snapshot;
  const { cash, budgets } = projectSnapshotOpeningBudget(snapshot, policy, occupancy);
  const assessment = Object.freeze({ verificationScope: "stored_snapshot_reserved_opening_budget_bounds_only" as const,
    portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash, asOf: snapshot.asOf, occupancyAssessmentHash: occupancy.assessmentHash,
    cashHash: hashCanonicalPayload(cash), budgetsHash: hashCanonicalPayload(budgets),
    budgetMeaning: "shared_cash_and_gross_reserved_max_band_upper_bound" as const,
    maxBandRounding: "canonical_decimal_floor_krw" as const,
    selectionTriggerAndSizing: "not_evaluated" as const, currentLedgerAndCasAuthority: "not_verified" as const,
    accountingAndResultingStateAuthority: "not_verified" as const, currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ occupancy, cash, budgets, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
