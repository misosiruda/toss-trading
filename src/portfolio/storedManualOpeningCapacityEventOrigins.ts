import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ManualAssignmentFileRepository, getDurableManualAssignmentObservation,
  type ManualAssignmentFileRepositoryOptions } from "./manualAssignmentFiles.js";
import { ManualOpeningCapacityReservationFileRepository, getDurableManualCapacityReservationObservation } from "./manualOpeningCapacityReservationFiles.js";
import { openingCapacityReservationEventPayloadSchema, resolveManualOpeningCapacityReservedEventBinding } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

/**
 * Binds every manual reserved root for one portfolio to actual reservation/authorization/snapshot sources.
 * Includes old policies and terminal reservations; selector and successor origins are separate gates.
 * Sequential historical observations do not authorize current capacity allocation or execution.
 */
export async function resolveStoredManualOpeningCapacityEventOrigins(value: z.input<typeof inputSchema>,
  options: ManualAssignmentFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("manual capacity origin input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const startedAt = Date.now();
  // Do not nest a manual lock around the reservation repository: it acquires manual -> snapshot -> reservation itself.
  const manual = await new ManualAssignmentFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) =>
    ({ events: history.events, observation: getDurableManualAssignmentObservation(history) }));
  const reservations = await new ManualOpeningCapacityReservationFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) =>
    ({ origins: history.origins, generationHash: history.generationHash, observedAt: getDurableManualCapacityReservationObservation(history) }));
  const manualById = new Map(manual.events.map((event) => [event.manualAssignmentEventId, event]));
  const reservationById = new Map(reservations.origins.map((origin) => [origin.record.manualCapacityReservationId, origin]));
  return new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const observedAt = getDurableOpeningCapacityEventObservedAt(history);
    if (Date.parse(manual.observation.observedAt) < startedAt ||
      Date.parse(reservations.observedAt) < Date.parse(manual.observation.observedAt) ||
      Date.parse(observedAt) < Date.parse(reservations.observedAt) || Date.now() < Date.parse(observedAt)) {
      throw new Error("manual capacity origin observation clock moved backwards");
    }
    const selected = history.events.filter((event) => event.portfolioId === input.portfolioId);
    const roots = selected.filter((event) => event.eventType === "reserved" && event.reservationSource.sourceKind === "manual");
    const bindings = roots.map((event) => {
      const reservationOrigin = reservationById.get(event.reservationId);
      if (!reservationOrigin) throw new Error("manual capacity event reservation source is missing");
      const manualEvent = manualById.get(reservationOrigin.record.manualAssignmentEventId);
      if (!manualEvent) throw new Error("manual capacity event authorization source is missing from observation");
      const binding = resolveManualOpeningCapacityReservedEventBinding({ event, reservation: reservationOrigin.record, manualAssignmentEvent: manualEvent });
      // Equal milliseconds cannot prove that the durable source preceded the event's claimed evaluation.
      if (Date.parse(reservationOrigin.committedAt) >= Date.parse(event.asOf)) {
        throw new Error("manual capacity event reservation source did not precede its evaluation");
      }
      return Object.freeze({ ...binding, reservationOrigin,
        eventOrigin: resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId) });
    });
    const unverifiedSelectorEventIds = Object.freeze(selected.filter((event) => event.eventType === "reserved" &&
      event.reservationSource.sourceKind === "selector").map((event) => event.capacityReservationEventId));
    const unverifiedSuccessorEventIds = Object.freeze(selected.filter((event) => event.eventType !== "reserved").map((event) => event.capacityReservationEventId));
    const assessment = Object.freeze({ verificationScope: "stored_manual_reserved_event_origins_only" as const,
      portfolioId: input.portfolioId, bindingsHash: hashCanonicalPayload(bindings), verifiedManualRootCount: bindings.length,
      manualObservation: manual.observation, reservationGenerationHash: reservations.generationHash,
      reservationObservedAt: reservations.observedAt, eventGenerationHash: history.generationHash, eventObservedAt: observedAt,
      unverifiedSelectorEventIds, unverifiedSuccessorEventIds,
      policyEvidenceAndSizingAuthority: "not_verified" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
      historicalDiskAvailability: "not_proven" as const, sourceBeforeCreationReceipt: "not_recorded" as const,
      currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
    return Object.freeze({ bindings: Object.freeze(bindings), assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}
