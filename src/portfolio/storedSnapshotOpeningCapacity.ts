import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveActiveRuntimePortfolioPolicyAsOf } from "./runtimePortfolioPolicyActivation.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { resolveStoredSnapshotPendingReservationOrigins } from "./storedSnapshotPendingReservationOrigins.js";
import { projectSnapshotOpeningOccupancy } from "./snapshotOpeningCapacityProjection.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();
const reservationKey = (event: OpeningCapacityReservationEvent) =>
  JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
const instrumentKey = (value: { market: string; symbol: string }) => JSON.stringify([value.market, value.symbol]);
const policyGeneration = (value: Awaited<ReturnType<typeof readStoredRuntimePortfolioPolicyActivationSnapshot>>) =>
  hashCanonicalPayload({ dependencies: value.dependencies.records, policies: value.policies, events: value.events });

/** Stored historical occupancy, not the current ledger/CAS, accounting authority or permission to allocate. */
export async function resolveStoredSnapshotOpeningCapacity(value: z.input<typeof inputSchema>,
  options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("snapshot opening capacity query must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const policies = await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir, lockOptions);
  const policyGenerationHash = policyGeneration(policies);
  const sources = await resolveStoredSnapshotPendingReservationOrigins({ baseDir, portfolioSnapshotId: input.portfolioSnapshotId }, lockOptions);
  const snapshot = sources.pending.pending.snapshot;
  const activePolicy = resolveActiveRuntimePortfolioPolicyAsOf({ portfolioId: snapshot.portfolioId, asOf: snapshot.asOf,
    events: policies.events, policies: policies.policies, dependencies: policies.dependencies.repository });
  if (activePolicy.policy.policyHash !== snapshot.policyHash) throw new Error("snapshot opening capacity active policy mismatch");
  if (activePolicy.policy.strategyBuckets.some((bucket) => bucket.openingCapacityPolicy === undefined)) {
    throw new Error("snapshot opening capacity requires explicit policy limits for every bucket");
  }
  const roots = new Map(sources.manual.fills.mandates.manualRoots.bindings.map((binding) => [reservationKey(binding.event), {
    instrument: instrumentKey(binding.manualAssignmentEvent),
    slotOrdinal: binding.reservation.reservationKind === "new_position" ? binding.reservation.reservedSlotOrdinal : null
  }]));
  for (const binding of sources.selector.fills.mandates.issuedRoots) roots.set(reservationKey(binding.root), {
    instrument: instrumentKey(binding.reservationOrigin.record), slotOrdinal: binding.reservationOrigin.record.reservedSlotOrdinal
  });
  const pendingByReservation = new Map<string, bigint>();
  for (const binding of sources.bindings) {
    const key = reservationKey(binding.reservation.root);
    pendingByReservation.set(key, (pendingByReservation.get(key) ?? 0n) + BigInt(binding.pending.remainingNotionalKrw));
  }
  // Policy and event generations must match the actual observations above; do not splice a newer ledger into old sources.
  if (policyGeneration(await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir, lockOptions)) !== policyGenerationHash) {
    throw new Error("snapshot opening capacity policy generation changed");
  }
  const result = await new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const observedAt = getDurableOpeningCapacityEventObservedAt(history);
    if (history.generationHash !== sources.assessment.eventGenerationHash) throw new Error("snapshot opening capacity event generation changed");
    if (Date.parse(observedAt) < Date.parse(sources.assessment.eventObservedAt) || Date.now() < Date.parse(observedAt)) {
      throw new Error("snapshot opening capacity observation clock moved backwards");
    }
    const cutoff = Date.parse(snapshot.asOf), selectedEvents: OpeningCapacityReservationEvent[] = [];
    const unverified = new Set(sources.assessment.unverifiedCapacityEventIds);
    for (const event of history.events) {
      if (event.portfolioId !== snapshot.portfolioId) continue;
      const origin = resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId);
      if (Date.parse(origin.committedAt) === cutoff) throw new Error("snapshot opening capacity commit is ambiguous at cutoff");
      if (Date.parse(origin.committedAt) >= cutoff || Date.parse(event.asOf) > cutoff || Date.parse(event.createdAt) > cutoff) continue;
      if (unverified.has(event.capacityReservationEventId) && !(event.eventType === "reserved" && roots.has(reservationKey(event)))) {
        throw new Error("snapshot opening capacity event lacks a verified source");
      }
      selectedEvents.push(event);
    }
    const { capacities, totalReservedOpeningNotionalKrw } = projectSnapshotOpeningOccupancy(snapshot, activePolicy.policy,
      roots, selectedEvents, pendingByReservation);
    const assessment = Object.freeze({ verificationScope: "stored_snapshot_opening_occupancy_only" as const,
      portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash, policyHash: snapshot.policyHash,
      asOf: snapshot.asOf, policyGenerationHash, sourceAssessmentHash: sources.assessmentHash,
      eventGenerationHash: history.generationHash, observedAt, capacitiesHash: hashCanonicalPayload(capacities),
      accountingAndResultingStateAuthority: "not_verified" as const, currentLedgerAndCasAuthority: "not_verified" as const,
      historicalDiskAvailability: "not_proven" as const, currentExecutionAuthority: "not_granted" as const });
    return Object.freeze({ activePolicy, sources, capacities, totalReservedOpeningNotionalKrw,
      assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
  // Cover policy changes at either side of the final event observation without nesting policy locks inside the event lease.
  if (policyGeneration(await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir, lockOptions)) !== policyGenerationHash) {
    throw new Error("snapshot opening capacity policy generation changed after event observation");
  }
  if (Date.now() < Date.parse(result.assessment.observedAt)) throw new Error("snapshot opening capacity observation clock moved backwards");
  return result;
}
