import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import type { RuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import type { projectSnapshotOpeningOccupancy } from "./snapshotOpeningCapacityProjection.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";

/** Internal arithmetic only. Caller authenticates policy, snapshot and actual reservation occupancy first.
 * Per-bucket bounds share one cash pool; they are not independent allocation approvals.
 */
export function projectSnapshotOpeningBudget(snapshot: PortfolioSizingSnapshot, policy: RuntimePortfolioPolicyRecord,
  occupancy: ReturnType<typeof projectSnapshotOpeningOccupancy>) {
  const { cashKrw, virtualNetWorthKrw, pendingBuyExposureKrw } = snapshot.exposureSnapshot;
  const requiredCashReserveKrw = Math.max(policy.cashPolicy.minimumCashReserveKrw,
    Math.round(virtualNetWorthKrw * policy.cashPolicy.targetCashRatio));
  const reservedOpeningNotionalKrw = occupancy.totalReservedOpeningNotionalKrw;
  for (const amount of [cashKrw, virtualNetWorthKrw, requiredCashReserveKrw, reservedOpeningNotionalKrw]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || Object.is(amount, -0)) throw new Error("snapshot opening budget requires safe KRW amounts");
  }
  const coveredPending = occupancy.capacities.reduce((sum, capacity) => sum + BigInt(capacity.pendingBuyNotionalKrw), 0n);
  if (coveredPending !== BigInt(pendingBuyExposureKrw) || coveredPending > BigInt(reservedOpeningNotionalKrw)) {
    throw new Error("snapshot opening budget pending BUY is not covered exactly by reservations");
  }
  // Pending BUY is already inside the reservation gross amount; unused reservations also consume cash.
  // Never anticipate pending SELL proceeds or release cash based on a caller-supplied reservation ID.
  const maximumAdditionalNetCashDebitKrw = remaining(cashKrw, requiredCashReserveKrw, reservedOpeningNotionalKrw);
  const cash = Object.freeze({ cashKrw, virtualNetWorthKrw, requiredCashReserveKrw, pendingBuyExposureKrw,
    reservedOpeningNotionalKrw, unsubmittedReservedNotionalKrw: reservedOpeningNotionalKrw - pendingBuyExposureKrw,
    maximumAdditionalNetCashDebitKrw,
    overcommitted: BigInt(requiredCashReserveKrw) + BigInt(reservedOpeningNotionalKrw) > BigInt(cashKrw) });
  const budgets = Object.freeze(occupancy.capacities.map((capacity) => {
    const bucketPolicy = policy.strategyBuckets.find((item) => item.bucket === capacity.bucket)!;
    const positionExposureKrw = snapshot.exposureSnapshot.bucketExposureKrw[capacity.bucket];
    // Match the exact canonical-decimal hard cap used by candidatePositionExposureBounds; never round a maximum upward.
    const maximumExposureKrw = Number(BigInt(virtualNetWorthKrw) * canonicalQuantityUnits(bucketPolicy.maxWeightRatio) / canonicalQuantityUnits(1));
    if (!Number.isSafeInteger(maximumExposureKrw) || maximumExposureKrw < 0) throw new Error("snapshot opening budget band is unsafe");
    // Reserving gross cash against the band is a conservative bound, not a prediction of resulting marked exposure.
    const remainingMaxBandNotionalKrw = remaining(maximumExposureKrw, positionExposureKrw, capacity.reservedOpeningNotionalKrw);
    return Object.freeze({ bucket: capacity.bucket, positionExposureKrw, maximumExposureKrw,
      reservedOpeningNotionalKrw: capacity.reservedOpeningNotionalKrw, remainingMaxBandNotionalKrw,
      maximumAdditionalNetCashDebitKrw: Math.min(maximumAdditionalNetCashDebitKrw, remainingMaxBandNotionalKrw),
      availableSlots: capacity.availableSlots,
      overcommitted: BigInt(positionExposureKrw) + BigInt(capacity.reservedOpeningNotionalKrw) > BigInt(maximumExposureKrw) });
  }));
  return Object.freeze({ cash, budgets });
}

function remaining(total: number, committed: number, reserved: number): number {
  // Saturate separately instead of forming a potentially unsafe committed + reserved Number sum.
  return Math.max(0, Math.max(0, total - committed) - reserved);
}
