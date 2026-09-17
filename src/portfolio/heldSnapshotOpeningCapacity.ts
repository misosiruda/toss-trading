import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { bindHeldSnapshotPendingReservationOrigins } from "./heldSnapshotPendingReservationBinding.js";
import type { OpeningCapacityConsumptionSources } from "./openingCapacityConsumptionBinding.js";
import type { OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { getDurableOpeningCapacityEventObservedAt, resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { projectSnapshotOpeningOccupancy } from "./snapshotOpeningCapacityProjection.js";

const querySchema = z.object({ baseDir: z.string().min(1), snapshot: portfolioSizingSnapshotSchema, policy: z.unknown() }).strict();

/** Actual held reservation/pending occupancy under independently rehashed supplied policy contents.
 * Does not authenticate policy activation, the actual portfolio, valuation trust, accounting, ledger CAS or allocation authority.
 * No I/O, locks, writes or new leases. Publisher integration is separate.
 */
export function bindHeldSnapshotOpeningCapacity(value: z.input<typeof querySchema>, sources: OpeningCapacityConsumptionSources) {
  const input = querySchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("held opening capacity input must already be canonical");
  const policy = parseRuntimePortfolioPolicyRecord(input.policy);
  if (policy.portfolioId !== input.snapshot.portfolioId || policy.policyHash !== input.snapshot.policyHash ||
    Date.parse(policy.createdAt) > Date.parse(input.snapshot.asOf)) throw new Error("held opening capacity supplied policy scope or chronology mismatch");
  const pending = bindHeldSnapshotPendingReservationOrigins({ baseDir: input.baseDir, snapshot: input.snapshot }, sources);
  const snapshot = pending.snapshot;
  const roots = new Map(pending.terminal.consumption.mandates.roots.map((binding) => {
    const source = binding.reservationOrigin.record;
    return [reservationKey(binding.event), { instrument: JSON.stringify([source.market, source.symbol]),
      slotOrdinal: binding.sourceKind === "selector" ? binding.reservationOrigin.record.reservedSlotOrdinal
        : binding.reservationOrigin.record.reservationKind === "new_position" ? binding.reservationOrigin.record.reservedSlotOrdinal : null }];
  }));
  const totals = new Map<string, bigint>();
  for (const binding of pending.bindings) {
    const key = reservationKey(binding.reservation.root.event);
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(binding.pending.remainingNotionalKrw));
  }
  const cutoff = Date.parse(snapshot.asOf), events: OpeningCapacityReservationEvent[] = [];
  for (const event of sources.events.events) {
    if (event.portfolioId !== snapshot.portfolioId) continue;
    const origin = resolveStoredOpeningCapacityEventOrigin(sources.events, event.capacityReservationEventId);
    if (Date.parse(origin.committedAt) === cutoff) throw new Error("held opening capacity commit is ambiguous at cutoff");
    if (Date.parse(origin.committedAt) < cutoff && Date.parse(event.asOf) <= cutoff && Date.parse(event.createdAt) <= cutoff) events.push(event);
  }
  const projection = projectSnapshotOpeningOccupancy(snapshot, policy, roots, events, totals);
  const assessment = Object.freeze({ verificationScope: "held_snapshot_opening_occupancy_supplied_policy_only" as const,
    portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash, policyHash: policy.policyHash,
    asOf: snapshot.asOf, eventGenerationHash: sources.events.generationHash, observedAt: getDurableOpeningCapacityEventObservedAt(sources.events),
    capacitiesHash: hashCanonicalPayload(projection.capacities), policyActivationAuthority: "not_verified" as const,
    actualPortfolioAndValuationAuthority: "not_verified" as const, accountingAndResultingStateAuthority: "not_verified" as const,
    currentLedgerAndCasAuthority: "not_verified" as const, historicalDiskAvailability: "not_proven" as const,
    currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ policy, pending, ...projection, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}

function reservationKey(event: OpeningCapacityReservationEvent) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
