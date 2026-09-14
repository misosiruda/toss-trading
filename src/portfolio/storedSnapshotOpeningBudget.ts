import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSnapshotOpeningCapacity } from "./storedSnapshotOpeningCapacity.js";

/** Reservation-adjusted historical cash/band bounds, not trigger eligibility, sizing or a current allocation approval. */
export async function resolveStoredSnapshotOpeningBudget(
  input: Parameters<typeof resolveStoredSnapshotOpeningCapacity>[0],
  options: NonNullable<Parameters<typeof resolveStoredSnapshotOpeningCapacity>[1]> = {}
) {
  const occupancy = await resolveStoredSnapshotOpeningCapacity(input, options);
  const policy = occupancy.activePolicy.policy;
  const snapshot = occupancy.sources.pending.pending.snapshot;
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
    const maximumExposureKrw = Math.round(virtualNetWorthKrw * bucketPolicy.maxWeightRatio);
    if (!Number.isSafeInteger(maximumExposureKrw) || maximumExposureKrw < 0) throw new Error("snapshot opening budget band is unsafe");
    // Reserving gross cash against the band is a conservative bound, not a prediction of resulting marked exposure.
    const remainingMaxBandNotionalKrw = remaining(maximumExposureKrw, positionExposureKrw, capacity.reservedOpeningNotionalKrw);
    return Object.freeze({ bucket: capacity.bucket, positionExposureKrw, maximumExposureKrw,
      reservedOpeningNotionalKrw: capacity.reservedOpeningNotionalKrw, remainingMaxBandNotionalKrw,
      maximumAdditionalNetCashDebitKrw: Math.min(maximumAdditionalNetCashDebitKrw, remainingMaxBandNotionalKrw),
      availableSlots: capacity.availableSlots,
      overcommitted: BigInt(positionExposureKrw) + BigInt(capacity.reservedOpeningNotionalKrw) > BigInt(maximumExposureKrw) });
  }));
  const assessment = Object.freeze({ verificationScope: "stored_snapshot_reserved_opening_budget_bounds_only" as const,
    portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash, asOf: snapshot.asOf, occupancyAssessmentHash: occupancy.assessmentHash,
    cashHash: hashCanonicalPayload(cash), budgetsHash: hashCanonicalPayload(budgets),
    budgetMeaning: "shared_cash_and_gross_reserved_max_band_upper_bound" as const,
    selectionTriggerAndSizing: "not_evaluated" as const, currentLedgerAndCasAuthority: "not_verified" as const,
    accountingAndResultingStateAuthority: "not_verified" as const, currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ occupancy, cash, budgets, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}

function remaining(total: number, committed: number, reserved: number): number {
  // Saturate separately instead of forming a potentially unsafe committed + reserved Number sum.
  return Math.max(0, Math.max(0, total - committed) - reserved);
}
