import { bindHeldSnapshotOpeningCapacity } from "./heldSnapshotOpeningCapacity.js";
import { projectSnapshotOpeningBudget } from "./snapshotOpeningBudgetProjection.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

/** Recomputes shared cash and max-band bounds from actual held reservation sources.
 * Supplied policy/portfolio contents do not establish activation, current state, accounting or allocation authority.
 * No I/O, new locks, writes or new leases. Pending BUY consumes its existing gross reservation exactly once.
 */
export function bindHeldSnapshotOpeningBudget(...args: Parameters<typeof bindHeldSnapshotOpeningCapacity>) {
  const occupancy = bindHeldSnapshotOpeningCapacity(...args);
  const snapshot = occupancy.pending.snapshot;
  const { cash, budgets } = projectSnapshotOpeningBudget(snapshot, occupancy.policy, occupancy);
  const assessment = Object.freeze({ verificationScope: "held_snapshot_reserved_opening_budget_supplied_policy_only" as const,
    portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash, asOf: snapshot.asOf, occupancyAssessmentHash: occupancy.assessmentHash,
    cashHash: hashCanonicalPayload(cash), budgetsHash: hashCanonicalPayload(budgets),
    budgetMeaning: "shared_cash_and_gross_reserved_max_band_upper_bound" as const,
    maxBandRounding: "canonical_decimal_floor_krw" as const, selectionTriggerAndSizing: "not_evaluated" as const,
    policyActivationAuthority: "not_verified" as const, actualPortfolioAndValuationAuthority: "not_verified" as const,
    currentLedgerAndCasAuthority: "not_verified" as const, accountingAndResultingStateAuthority: "not_verified" as const,
    historicalDiskAvailability: "not_proven" as const, currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ occupancy, cash, budgets, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
