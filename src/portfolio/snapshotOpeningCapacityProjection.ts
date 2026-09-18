import type { OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import type { RuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import type { StrategyBucket } from "./runtimePolicyContracts.js";

/** Arithmetic only, never source authentication or allocation authority. Both repository-backed callers must
 * authenticate/rehash sources, validate pending coverage and select the actual cutoff prefix before calling.
 * Internal source indexes are consumed synchronously and are not retained in the immutable result.
 */
export function projectSnapshotOpeningOccupancy(snapshot: PortfolioSizingSnapshot, policy: RuntimePortfolioPolicyRecord,
  roots: ReadonlyMap<string, Readonly<{ instrument: string; slotOrdinal: number | null }>>,
  events: readonly OpeningCapacityReservationEvent[], pendingByReservation: ReadonlyMap<string, bigint>) {
  if (policy.portfolioId !== snapshot.portfolioId || policy.policyHash !== snapshot.policyHash) throw new Error("snapshot opening capacity policy scope mismatch");
  if (policy.strategyBuckets.some((bucket) => bucket.openingCapacityPolicy === undefined)) {
    throw new Error("snapshot opening capacity requires explicit policy limits for every bucket");
  }
  const positions = new Map<string, StrategyBucket>();
  for (const position of snapshot.virtualPortfolio.positions) {
    if (!position.strategyBucket) throw new Error("snapshot opening capacity contains unassigned holdings");
    const key = JSON.stringify([position.market, position.symbol]);
    if (positions.has(key)) throw new Error("snapshot opening capacity repeats a held instrument across buckets");
    positions.set(key, position.strategyBucket);
  }
  const heads = new Map<string, OpeningCapacityReservationEvent>();
  const policyVersions = new Map<StrategyBucket, number>(), policyLastReservations = new Map<StrategyBucket, string>();
  for (const event of events) {
    if (event.portfolioId !== snapshot.portfolioId) throw new Error("snapshot opening capacity event portfolio mismatch");
    heads.set(reservationKey(event), event);
    if (event.policyHash === policy.policyHash) {
      policyVersions.set(event.bucket, event.capacityLedgerVersion);
      if (event.eventType === "reserved") policyLastReservations.set(event.bucket, event.reservationId);
    }
  }
  const buckets = policy.strategyBuckets.map((item) => ({ bucket: item.bucket,
    capacityLedgerVersion: policyVersions.get(item.bucket) ?? 0,
    ...(policyLastReservations.has(item.bucket) ? { lastReservationRecordId: policyLastReservations.get(item.bucket)! } : {}),
    maximumPositionCount: item.openingCapacityPolicy!.maximumPositionCount,
    activePositionCount: [...positions.values()].filter((bucket) => bucket === item.bucket).length,
    pendingReservationCount: 0, mandateBoundUnusedSlotCount: 0, reserved: 0n, pending: 0n }));
  const slots = new Set<string>(), reservedInstruments = new Set<string>();
  for (const [key, head] of heads) {
    const root = roots.get(key);
    if (!root) throw new Error("snapshot opening capacity root is missing from actual sources");
    const bucket = buckets.find((item) => item.bucket === head.bucket);
    if (!bucket) throw new Error("snapshot opening capacity event bucket is absent from policy");
    bucket.reserved += BigInt(head.remainingReservedNotionalKrw);
    bucket.pending += pendingByReservation.get(key) ?? 0n;
    if (!head.occupiesNewPositionSlot) continue;
    const slot = JSON.stringify([head.policyHash, head.bucket, root.slotOrdinal]);
    if (root.slotOrdinal === null || slots.has(slot)) throw new Error("snapshot opening capacity repeats an occupied slot ordinal");
    slots.add(slot);
    if (positions.has(root.instrument) || reservedInstruments.has(root.instrument)) throw new Error("snapshot opening capacity repeats a new-position instrument");
    reservedInstruments.add(root.instrument);
    // A pending order uses its reservation, not a second slot or a second gross reserve.
    if (head.eventType === "reserved" || pendingByReservation.has(key)) bucket.pendingReservationCount += 1;
    else bucket.mandateBoundUnusedSlotCount += 1;
  }
  const capacities = Object.freeze(buckets.map(({ reserved, pending, ...bucket }) => {
    if (reserved > BigInt(Number.MAX_SAFE_INTEGER) || pending > reserved) throw new Error("snapshot opening capacity reserved totals are unsafe");
    return Object.freeze({ ...bucket, availableSlots: Math.max(0, bucket.maximumPositionCount - bucket.activePositionCount -
      bucket.pendingReservationCount - bucket.mandateBoundUnusedSlotCount), reservedOpeningNotionalKrw: Number(reserved),
      pendingBuyNotionalKrw: Number(pending), unsubmittedReservedNotionalKrw: Number(reserved - pending) });
  }));
  const totalReserved = capacities.reduce((sum, bucket) => sum + BigInt(bucket.reservedOpeningNotionalKrw), 0n);
  if (totalReserved > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("snapshot opening capacity portfolio reserved total is unsafe");
  return Object.freeze({ capacities, totalReservedOpeningNotionalKrw: Number(totalReserved) });
}

function reservationKey(event: OpeningCapacityReservationEvent) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
