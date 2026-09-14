import { createBucketOpeningCapacityState, resolveBucketOpeningCapacityStatePolicy } from "./bucketOpeningCapacityState.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSnapshotOpeningBudget } from "./storedSnapshotOpeningBudget.js";

/** Recomputed historical state payloads for all buckets; not a persisted current ledger or CAS/allocation authority. */
export async function resolveStoredBucketOpeningCapacityStates(
  input: Parameters<typeof resolveStoredSnapshotOpeningBudget>[0],
  options: NonNullable<Parameters<typeof resolveStoredSnapshotOpeningBudget>[1]> = {}
) {
  const budget = await resolveStoredSnapshotOpeningBudget(input, options);
  const policy = budget.occupancy.activePolicy.policy, snapshot = budget.occupancy.sources.pending.pending.snapshot;
  const asOf = new Date(snapshot.asOf).toISOString();
  const states = Object.freeze(budget.occupancy.capacities.map((capacity) => {
    const bound = budget.budgets.find((item) => item.bucket === capacity.bucket)!;
    const state = createBucketOpeningCapacityState({ portfolioId: snapshot.portfolioId, policyHash: policy.policyHash,
      bucket: capacity.bucket, currentPortfolioSnapshotId: snapshot.portfolioSnapshotId,
      currentPortfolioSnapshotHash: snapshot.portfolioSnapshotHash, capacityLedgerVersion: capacity.capacityLedgerVersion,
      activePositionCount: capacity.activePositionCount, pendingReservationCount: capacity.pendingReservationCount,
      mandateBoundUnusedSlotCount: capacity.mandateBoundUnusedSlotCount, availableSlots: capacity.availableSlots,
      reservedOpeningNotionalKrw: capacity.reservedOpeningNotionalKrw, remainingOpeningBudgetKrw: bound.maximumAdditionalNetCashDebitKrw,
      ...(capacity.lastReservationRecordId === undefined ? {} : { lastReservationRecordId: capacity.lastReservationRecordId }), asOf });
    return resolveBucketOpeningCapacityStatePolicy({ state, policy }).state;
  }));
  // One payload covers every bucket sharing the same cash and sources. Per-bucket bounds are not independent allocations.
  // Observation time stays in assessment, not in the stable payload identity used by a future persisted projection.
  const payload = Object.freeze({ portfolioId: snapshot.portfolioId, policyHash: policy.policyHash,
    portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash, asOf, states });
  const projection = Object.freeze({ ...payload, projectionHash: hashCanonicalPayload(payload) });
  const assessment = Object.freeze({ verificationScope: "stored_snapshot_capacity_state_payloads_only" as const,
    projectionHash: projection.projectionHash, budgetAssessmentHash: budget.assessmentHash,
    ledgerVersionMeaning: "active_policy_bucket_event_version_at_snapshot_cutoff" as const,
    reservationTotalsMeaning: "all_policy_remaining_reservations_at_snapshot_cutoff" as const,
    remainingBudgetMeaning: "shared_cash_and_max_band_upper_bound_not_selection_request_budget" as const,
    currentLedgerAndCasAuthority: "not_verified" as const, accountingAndResultingStateAuthority: "not_verified" as const,
    currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ budget, projection, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
