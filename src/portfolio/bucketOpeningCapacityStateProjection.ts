import { createBucketOpeningCapacityState, resolveBucketOpeningCapacityStatePolicy } from "./bucketOpeningCapacityState.js";
import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import type { RuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import type { projectSnapshotOpeningBudget } from "./snapshotOpeningBudgetProjection.js";
import type { projectSnapshotOpeningOccupancy } from "./snapshotOpeningCapacityProjection.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

/** Internal payload assembly only; callers authenticate the snapshot/policy/occupancy/budget before use. */
export function projectBucketOpeningCapacityStates(snapshot: PortfolioSizingSnapshot, policy: RuntimePortfolioPolicyRecord,
  budget: ReturnType<typeof projectSnapshotOpeningBudget> & Readonly<{ occupancy: ReturnType<typeof projectSnapshotOpeningOccupancy> }>) {
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
  return projection;
}
