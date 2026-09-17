import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { assertDurableManualAssignmentSource, getDurableManualAssignmentObservation,
  type VerifiedManualAssignmentHistory } from "./manualAssignmentFiles.js";
import { assertDurableManualCapacityReservationSource, getDurableManualCapacityReservationObservation,
  type VerifiedManualCapacityReservationHistory } from "./manualOpeningCapacityReservationFiles.js";
import { assertDurableSelectorCapacityReservationSource, getDurableSelectorCapacityReservationObservation,
  type VerifiedSelectorCapacityReservationHistory } from "./selectorOpeningCapacityReservationFiles.js";
import { openingCapacityReservationEventPayloadSchema, resolveManualOpeningCapacityReservedEventBinding } from "./openingCapacityReservationEvent.js";
import { assertDurableOpeningCapacityEventSource, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin, type VerifiedOpeningCapacityEventHistory } from "./openingCapacityReservationEventFiles.js";
import { resolveSelectorOpeningCapacityReservedRecordBinding } from "./selectorOpeningCapacityReservation.js";

const querySchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

/** Binds every stored root, including old/terminal scopes. No allocation, mandate, consumption or execution authority.
 * Synchronous only: all actual source callbacks must remain active. The returned values are not leases.
 */
export function bindOpeningCapacityRootOrigins(value: z.input<typeof querySchema>, manual: VerifiedManualAssignmentHistory,
  manualReservations: VerifiedManualCapacityReservationHistory, selectorReservations: VerifiedSelectorCapacityReservationHistory,
  events: VerifiedOpeningCapacityEventHistory) {
  const input = querySchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("capacity root binding query must already be canonical");
  assertDurableManualAssignmentSource(manual, input.baseDir);
  assertDurableManualCapacityReservationSource(manualReservations, input.baseDir);
  assertDurableSelectorCapacityReservationSource(selectorReservations, input.baseDir);
  assertDurableOpeningCapacityEventSource(events, input.baseDir);
  const manualAt = getDurableManualAssignmentObservation(manual).observedAt;
  const manualReservationAt = getDurableManualCapacityReservationObservation(manualReservations);
  const selectorAt = getDurableSelectorCapacityReservationObservation(selectorReservations);
  const eventAt = getDurableOpeningCapacityEventObservedAt(events);
  if (Date.parse(manualReservationAt) < Date.parse(manualAt) ||
    Date.parse(eventAt) < Math.max(Date.parse(manualReservationAt), Date.parse(selectorAt)) || Date.now() < Date.parse(eventAt)) {
    throw new Error("capacity root binding observation clock moved backwards");
  }
  const manualById = new Map(manual.events.map((event) => [event.manualAssignmentEventId, event]));
  const manualByReservation = new Map(manualReservations.origins.map((origin) => [origin.record.manualCapacityReservationId, origin]));
  const selectorByReservation = new Map(selectorReservations.origins.map((origin) => [origin.record.selectorCapacityReservationId, origin]));
  return Object.freeze(events.events.filter((event) => event.portfolioId === input.portfolioId && event.eventType === "reserved").map((event) => {
    if (event.eventType !== "reserved") throw new Error("capacity root binding requires reserved event");
    const eventOrigin = resolveStoredOpeningCapacityEventOrigin(events, event.capacityReservationEventId);
    if (event.reservationSource.sourceKind === "manual") {
      const reservationOrigin = manualByReservation.get(event.reservationId);
      if (!reservationOrigin) throw new Error("manual capacity root issuance source is missing");
      const manualAssignmentEvent = manualById.get(reservationOrigin.record.manualAssignmentEventId);
      if (!manualAssignmentEvent) throw new Error("manual capacity root authorization source is missing");
      resolveManualOpeningCapacityReservedEventBinding({ event, reservation: reservationOrigin.record, manualAssignmentEvent });
      if (Date.parse(reservationOrigin.committedAt) >= Date.parse(event.asOf)) throw new Error("manual capacity root issuance must precede evaluation");
      return Object.freeze({ sourceKind: "manual" as const, event, eventOrigin, reservationOrigin, manualAssignmentEvent });
    }
    const reservationOrigin = selectorByReservation.get(event.reservationId);
    if (!reservationOrigin) throw new Error("selector capacity root issuance source is missing");
    resolveSelectorOpeningCapacityReservedRecordBinding({ event, reservation: reservationOrigin.record });
    if (Date.parse(reservationOrigin.committedAt) >= Date.parse(event.asOf)) throw new Error("selector capacity root issuance must precede evaluation");
    return Object.freeze({ sourceKind: "selector" as const, event, eventOrigin, reservationOrigin });
  }));
}
