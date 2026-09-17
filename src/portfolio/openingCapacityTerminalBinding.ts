import { isDeepStrictEqual } from "node:util";
import { bindOpeningCapacityConsumptionOrigins, type OpeningCapacityConsumptionSources } from "./openingCapacityConsumptionBinding.js";
import { resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";

/** Actual held-source retirement binding, including prior gross consumption. No I/O, locks or new authority.
 * Request cancellations remain explicitly unverified; returned values are not source leases or permission to release capacity.
 * Retirement storage availability before release cannot be proven without a historical receipt.
 */
export function bindOpeningCapacityTerminalOrigins(input: Parameters<typeof bindOpeningCapacityConsumptionOrigins>[0],
  sources: OpeningCapacityConsumptionSources) {
  // Authenticate the strict query and every actual source even when no retirement release exists.
  const consumption = bindOpeningCapacityConsumptionOrigins(input, sources);
  const byReservation = new Map(consumption.mandates.bindings.map((binding) => [scope(binding.event), binding]));
  const byMandate = new Map(sources.mandates.states.map((state) => [state.record.mandateId, state]));
  const byEvent = new Map(sources.mandates.events.map((event) => [event.mandateEventId, event]));
  const releases = sources.events.events.filter((event) => event.portfolioId === input.portfolioId && event.eventType === "released");
  const unverifiedReleaseEventIds: string[] = [];
  const bindings = releases.flatMap((event) => {
    if (event.eventType !== "released") throw new Error("capacity terminal binding requires a release event");
    if (event.releaseOrigin.originKind === "request_cancelled") {
      unverifiedReleaseEventIds.push(event.capacityReservationEventId);
      return [];
    }
    const mandateBinding = byReservation.get(scope(event)), source = event.releaseOrigin;
    const terminal = byEvent.get(source.mandateEventId), state = byMandate.get(source.mandateId);
    if (!mandateBinding || !terminal || !state || terminal.eventType !== "retired" || state.status !== "retired" ||
      terminal.mandateEventHash !== source.mandateEventHash || terminal.mandateId !== source.mandateId || terminal.mandateHash !== source.mandateHash ||
      state.currentEvent?.mandateEventId !== terminal.mandateEventId || !isDeepStrictEqual(state.record, mandateBinding.mandate)) {
      throw new Error("capacity release lacks its actual retired mandate event");
    }
    const predecessorOrigin = resolveStoredOpeningCapacityEventOrigin(sources.events, event.previousCapacityReservationEventId);
    if (Date.parse(terminal.asOf) > Date.parse(event.asOf) || Date.parse(terminal.createdAt) > Date.parse(event.asOf) ||
      Date.parse(predecessorOrigin.committedAt) >= Date.parse(event.asOf)) {
      throw new Error("capacity release source chronology mismatch");
    }
    return [Object.freeze({ event, mandateBinding, terminalEvent: terminal,
      releasedNotionalKrw: predecessorOrigin.event.remainingReservedNotionalKrw, predecessorOrigin,
      eventOrigin: resolveStoredOpeningCapacityEventOrigin(sources.events, event.capacityReservationEventId) })];
  });
  return Object.freeze({ consumption, bindings: Object.freeze(bindings), unverifiedReleaseEventIds: Object.freeze(unverifiedReleaseEventIds) });
}

function scope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
