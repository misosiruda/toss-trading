import { projectBucketOpeningCapacityStates } from "./bucketOpeningCapacityStateProjection.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSnapshotOpeningBudget } from "./storedSnapshotOpeningBudget.js";

/** Recomputed historical state payloads for all buckets; not a persisted current ledger or CAS/allocation authority. */
export async function resolveStoredBucketOpeningCapacityStates(
  input: Parameters<typeof resolveStoredSnapshotOpeningBudget>[0],
  options: NonNullable<Parameters<typeof resolveStoredSnapshotOpeningBudget>[1]> = {}
) {
  const budget = await resolveStoredSnapshotOpeningBudget(input, options);
  const policy = budget.occupancy.activePolicy.policy, snapshot = budget.occupancy.sources.pending.pending.snapshot;
  const projection = projectBucketOpeningCapacityStates(snapshot, policy, budget);
  const assessment = Object.freeze({ verificationScope: "stored_snapshot_capacity_state_payloads_only" as const,
    projectionHash: projection.projectionHash, budgetAssessmentHash: budget.assessmentHash,
    ledgerVersionMeaning: "active_policy_bucket_event_version_at_snapshot_cutoff" as const,
    reservationTotalsMeaning: "all_policy_remaining_reservations_at_snapshot_cutoff" as const,
    remainingBudgetMeaning: "shared_cash_and_max_band_upper_bound_not_selection_request_budget" as const,
    currentLedgerAndCasAuthority: "not_verified" as const, accountingAndResultingStateAuthority: "not_verified" as const,
    currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ budget, projection, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
