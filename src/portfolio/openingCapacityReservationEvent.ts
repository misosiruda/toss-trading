import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { resolveManualOpeningCapacityReservationBinding } from "./manualOpeningCapacityReservation.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(160).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const positiveAmount = count.refine((value) => value > 0);
const timestamp = offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString());
const source = z.discriminatedUnion("sourceKind", [
  z.object({ sourceKind: z.literal("manual"), manualCapacityReservationId: identifier,
    manualCapacityReservationHash: sha256HashSchema }).strict(),
  z.object({ sourceKind: z.literal("selector"), candidateAssignmentSetId: identifier,
    candidateAssignmentSetHash: sha256HashSchema, candidateAssignmentId: identifier, reservedSlotOrdinal: count }).strict()
]);
const releaseOrigin = z.discriminatedUnion("originKind", [
  z.object({ originKind: z.literal("request_cancelled"), requestOrManualEventId: identifier }).strict(),
  z.object({ originKind: z.literal("mandate_terminal"), mandateId: identifier, mandateHash: sha256HashSchema,
    mandateEventId: identifier, mandateEventHash: sha256HashSchema }).strict()
]);
const base = z.object({ reservationId: identifier, reservationHash: sha256HashSchema,
  portfolioId: identifier, policyHash: sha256HashSchema, bucket: strategyBucketSchema,
  remainingReservedNotionalKrw: count, occupiesNewPositionSlot: z.boolean(),
  capacityLedgerVersion: count, asOf: timestamp }).strict();
const predecessor = { previousCapacityReservationEventId: identifier };
const mandate = { mandateId: identifier, mandateHash: sha256HashSchema };
const fill = { fillId: identifier, paperFillRecordId: identifier, paperFillHash: sha256HashSchema };
const reserved = base.extend({ eventType: z.literal("reserved"), reservationSource: source,
  remainingReservedNotionalKrw: positiveAmount }).strict();
const bound = base.extend({ eventType: z.literal("bound_to_mandate"), ...predecessor, ...mandate,
  remainingReservedNotionalKrw: positiveAmount }).strict();
const partial = base.extend({ eventType: z.literal("partially_consumed"), ...predecessor, ...mandate, ...fill,
  remainingReservedNotionalKrw: positiveAmount, occupiesNewPositionSlot: z.literal(false) }).strict();
const consumed = base.extend({ eventType: z.literal("consumed_by_position"), ...predecessor, ...mandate, ...fill,
  resultingPositionRef: identifier, occupiesNewPositionSlot: z.literal(false) }).strict();
const released = base.extend({ eventType: z.literal("released"), ...predecessor, releaseOrigin,
  releaseReasonCode: identifier, remainingReservedNotionalKrw: z.literal(0), occupiesNewPositionSlot: z.literal(false) }).strict();
export const openingCapacityReservationEventPayloadSchema = z.discriminatedUnion("eventType", [reserved, bound, partial, consumed, released]);
const identity = { capacityReservationEventId: identifier, capacityReservationEventHash: sha256HashSchema, createdAt: timestamp };
export const openingCapacityReservationEventSchema = z.discriminatedUnion("eventType", [
  reserved.extend(identity).strict(), bound.extend(identity).strict(), partial.extend(identity).strict(),
  consumed.extend(identity).strict(), released.extend(identity).strict()
]);
export type OpeningCapacityReservationEvent = Readonly<z.infer<typeof openingCapacityReservationEventSchema>>;

/** Complete immutable event contract, not source authentication, chain replay or capacity authority. */
export function createOpeningCapacityReservationEvent(
  input: z.input<typeof openingCapacityReservationEventPayloadSchema> & { createdAt: string }
): OpeningCapacityReservationEvent {
  const { createdAt, ...value } = input;
  const payload = openingCapacityReservationEventPayloadSchema.parse(value);
  if (!isDeepStrictEqual(value, payload)) throw new Error("opening capacity event payload must already be canonical");
  const hash = hashCanonicalPayload(payload);
  return parseOpeningCapacityReservationEvent({ ...payload, createdAt,
    capacityReservationEventHash: hash, capacityReservationEventId: hashDerivedId("opening_capacity_event", hash) });
}

/** Rehash every strict variant field; createdAt is excluded from identity but still validated. */
export function parseOpeningCapacityReservationEvent(value: unknown): OpeningCapacityReservationEvent {
  const event = openingCapacityReservationEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) throw new Error("opening capacity event must already be canonical");
  const { capacityReservationEventId, capacityReservationEventHash, createdAt, ...payload } = event;
  const hash = hashCanonicalPayload(payload);
  if (capacityReservationEventHash !== hash || capacityReservationEventId !== hashDerivedId("opening_capacity_event", hash)) {
    throw new Error("opening capacity event identity does not match its complete payload");
  }
  if (Date.parse(createdAt) < Date.parse(event.asOf) || Object.is(event.remainingReservedNotionalKrw, -0)) {
    throw new Error("opening capacity event has invalid chronology or remaining notional");
  }
  if (event.eventType === "reserved") {
    if (event.reservationSource.sourceKind === "manual") {
      if (event.reservationId !== event.reservationSource.manualCapacityReservationId ||
        event.reservationHash !== event.reservationSource.manualCapacityReservationHash) {
        throw new Error("manual capacity event must preserve its reservation identity");
      }
    } else if (!event.occupiesNewPositionSlot) {
      throw new Error("selector capacity reservation must occupy its allocated new-position slot");
    }
    Object.freeze(event.reservationSource);
  } else if (event.eventType === "released") Object.freeze(event.releaseOrigin);
  return Object.freeze(event);
}

/** Resolve actual supplied manual payloads, without asserting durable origin or current ledger authorization. */
export function resolveManualOpeningCapacityReservedEventBinding(input: {
  event: unknown; reservation: unknown; manualAssignmentEvent: unknown;
}) {
  const event = parseOpeningCapacityReservationEvent(input.event);
  const binding = resolveManualOpeningCapacityReservationBinding(input);
  const reservation = binding.reservation;
  if (event.eventType !== "reserved" || event.reservationSource.sourceKind !== "manual" ||
    event.reservationId !== reservation.manualCapacityReservationId || event.reservationHash !== reservation.manualCapacityReservationHash ||
    event.portfolioId !== reservation.portfolioId || event.policyHash !== reservation.policyHash || event.bucket !== reservation.bucket ||
    event.capacityLedgerVersion !== reservation.capacityLedgerVersion || event.remainingReservedNotionalKrw !== reservation.reservedMaximumNotionalKrw ||
    event.occupiesNewPositionSlot !== (reservation.reservationKind === "new_position") || Date.parse(event.asOf) < Date.parse(reservation.createdAt)) {
    throw new Error("manual capacity event does not match its reservation source");
  }
  return Object.freeze({ event, reservation, manualAssignmentEvent: binding.event });
}
