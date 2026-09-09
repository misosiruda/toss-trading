import { z } from "zod";
import { type StrategyBucket } from "../domain/schemas.js";
import { openingCapacityReservationEventPayloadSchema, parseOpeningCapacityReservationEvent,
  type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const inputSchema = openingCapacityReservationEventPayloadSchema.options[0]
  .pick({ portfolioId: true, policyHash: true, bucket: true })
  .extend({ events: z.array(z.unknown()).max(100_000) }).strict();
type ReservedEvent = Extract<OpeningCapacityReservationEvent, { eventType: "reserved" }>;
type Chain = {
  reservedEvent: ReservedEvent;
  head: OpeningCapacityReservationEvent;
  mandate: Readonly<{ mandateId: string; mandateHash: string }> | null;
  resultingPositionRef: string | null;
  consumedNotionalKrw: number;
  releasedNotionalKrw: number;
};

/**
 * Structural replay of one supplied bucket/policy ledger from version zero.
 * A valid prefix is not a current ledger, authentic origin, available slot/budget
 * or permission to reserve/execute. Source resolution and atomic persistence are separate gates.
 */
export function replayOpeningCapacityReservationEvents(input: {
  portfolioId: string; policyHash: string; bucket: StrategyBucket; events: readonly unknown[];
}) {
  const parsed = inputSchema.parse(input);
  const events = parsed.events.map(parseOpeningCapacityReservationEvent);
  const chains = new Map<string, Chain>();
  const eventIds = new Set<string>();
  const mandateIds = new Set<string>();
  const fillIds = new Set<string>();
  const paperFillIds = new Set<string>();
  const selectorAssignmentIds = new Set<string>();
  let remaining = 0n;
  let previous: OpeningCapacityReservationEvent | undefined;
  for (const [index, event] of events.entries()) {
    if (event.portfolioId !== parsed.portfolioId || event.policyHash !== parsed.policyHash || event.bucket !== parsed.bucket) {
      throw new Error("opening capacity replay scope mismatch");
    }
    // Ledger versions are global within this bucket/policy, not consecutive per reservation.
    if (event.capacityLedgerVersion !== index + 1) throw new Error("opening capacity replay ledger version gap or reuse");
    if (eventIds.has(event.capacityReservationEventId)) throw new Error("opening capacity replay duplicate event");
    eventIds.add(event.capacityReservationEventId);
    if (previous && (Date.parse(event.asOf) < Date.parse(previous.asOf) || Date.parse(event.createdAt) < Date.parse(previous.createdAt))) {
      throw new Error("opening capacity replay time moved backwards");
    }
    const chain = chains.get(event.reservationId);
    if (event.eventType === "reserved") {
      if (chain) throw new Error("opening capacity replay reservation identity reused");
      if (event.reservationSource.sourceKind === "selector") {
        const assignmentId = event.reservationSource.candidateAssignmentId;
        if (selectorAssignmentIds.has(assignmentId)) throw new Error("opening capacity replay selector assignment reused");
        selectorAssignmentIds.add(assignmentId);
      }
      chains.set(event.reservationId, { reservedEvent: event, head: event, mandate: null,
        resultingPositionRef: null, consumedNotionalKrw: 0, releasedNotionalKrw: 0 });
      remaining += BigInt(event.remainingReservedNotionalKrw);
    } else {
      if (!chain || event.previousCapacityReservationEventId !== chain.head.capacityReservationEventId ||
        event.reservationHash !== chain.reservedEvent.reservationHash) {
        throw new Error("opening capacity replay missing source, wrong predecessor or reservation hash");
      }
      const head = chain.head;
      if (head.eventType === "released" || head.remainingReservedNotionalKrw === 0) {
        throw new Error("opening capacity replay transition after terminal reservation");
      }
      if (event.eventType === "bound_to_mandate") {
        if (head.eventType !== "reserved" || chain.mandate || mandateIds.has(event.mandateId)) {
          throw new Error("opening capacity replay duplicate or invalid mandate binding");
        }
        if (event.remainingReservedNotionalKrw !== head.remainingReservedNotionalKrw || event.occupiesNewPositionSlot !== head.occupiesNewPositionSlot) {
          throw new Error("opening capacity replay binding must preserve reserved notional and slot");
        }
        chain.mandate = Object.freeze({ mandateId: event.mandateId, mandateHash: event.mandateHash });
        mandateIds.add(event.mandateId);
      } else if (event.eventType === "released") {
        const origin = event.releaseOrigin;
        if (chain.mandate === null ? origin.originKind !== "request_cancelled"
          : origin.originKind !== "mandate_terminal" || origin.mandateId !== chain.mandate.mandateId || origin.mandateHash !== chain.mandate.mandateHash) {
          throw new Error("opening capacity replay release origin differs from binding lifecycle");
        }
        chain.releasedNotionalKrw = head.remainingReservedNotionalKrw;
      } else {
        if (!chain.mandate || event.mandateId !== chain.mandate.mandateId || event.mandateHash !== chain.mandate.mandateHash) {
          throw new Error("opening capacity replay fill does not match the bound mandate");
        }
        if (event.remainingReservedNotionalKrw >= head.remainingReservedNotionalKrw) {
          throw new Error("opening capacity replay fill must reduce remaining notional");
        }
        if (head.occupiesNewPositionSlot && event.eventType !== "consumed_by_position") {
          throw new Error("opening capacity replay first new-position fill must consume its slot");
        }
        if (fillIds.has(event.fillId) || paperFillIds.has(event.paperFillRecordId)) {
          throw new Error("opening capacity replay reuses a fill identity");
        }
        fillIds.add(event.fillId);
        paperFillIds.add(event.paperFillRecordId);
        if (event.eventType === "consumed_by_position") {
          if (chain.resultingPositionRef !== null && chain.resultingPositionRef !== event.resultingPositionRef) {
            throw new Error("opening capacity replay changes the consumed position identity");
          }
          chain.resultingPositionRef = event.resultingPositionRef;
        }
        chain.consumedNotionalKrw += head.remainingReservedNotionalKrw - event.remainingReservedNotionalKrw;
      }
      remaining += BigInt(event.remainingReservedNotionalKrw) - BigInt(head.remainingReservedNotionalKrw);
      chain.head = event;
    }
    if (remaining < 0n || remaining > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("opening capacity replay aggregate notional is unsafe");
    previous = event;
  }
  const reservations = [...chains.values()].sort((left, right) =>
    left.reservedEvent.reservationId < right.reservedEvent.reservationId ? -1 : left.reservedEvent.reservationId > right.reservedEvent.reservationId ? 1 : 0);
  return Object.freeze({ portfolioId: parsed.portfolioId, policyHash: parsed.policyHash, bucket: parsed.bucket,
    capacityLedgerVersion: events.length, historyHash: hashCanonicalPayload({ portfolioId: parsed.portfolioId,
      policyHash: parsed.policyHash, bucket: parsed.bucket, events }),
    remainingReservedNotionalKrw: Number(remaining),
    pendingNewPositionSlotCount: reservations.filter(({ head }) => head.eventType === "reserved" && head.occupiesNewPositionSlot).length,
    boundUnusedNewPositionSlotCount: reservations.filter(({ head }) => head.eventType === "bound_to_mandate" && head.occupiesNewPositionSlot).length,
    reservations: Object.freeze(reservations.map((chain) => Object.freeze(chain))), events: Object.freeze(events) });
}
