import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { marketSchema, sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { parseInvestmentMandateRecord, parseManualAssignmentEvent } from "./investmentMandate.js";
import { resolveManualMandateAssignmentBinding } from "./manualAssignmentResolver.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(160).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const amount = count.refine((value) => value > 0);
const timestamp = offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString());
const base = z.object({
  manualAssignmentEventId: identifier, manualAssignmentEventHash: sha256HashSchema,
  portfolioId: identifier, policyHash: sha256HashSchema, bucket: strategyBucketSchema,
  market: marketSchema, symbol: identifier,
  currentPortfolioSnapshotId: identifier, currentPortfolioSnapshotHash: sha256HashSchema,
  capacityLedgerVersion: count, reservedMaximumNotionalKrw: amount,
  resultingReservedNotionalKrw: amount, authorizationRef: identifier
}).strict();
const newPosition = base.extend({ reservationKind: z.literal("new_position"), reservedSlotOrdinal: count }).strict();
const increaseExisting = base.extend({ reservationKind: z.literal("increase_existing"), existingPositionRef: identifier }).strict();
export const manualOpeningCapacityReservationPayloadSchema = z.discriminatedUnion("reservationKind", [newPosition, increaseExisting]);
const identity = { manualCapacityReservationId: identifier, manualCapacityReservationHash: sha256HashSchema, createdAt: timestamp };
export const manualOpeningCapacityReservationRecordSchema = z.discriminatedUnion("reservationKind", [
  newPosition.extend(identity).strict(), increaseExisting.extend(identity).strict()
]);
export type ManualOpeningCapacityReservationRecord = Readonly<z.infer<typeof manualOpeningCapacityReservationRecordSchema>>;

/** Pure immutable contract only. The shared capacity ledger must authorize allocation and persist atomically. */
export function createManualOpeningCapacityReservationRecord(
  input: z.input<typeof manualOpeningCapacityReservationPayloadSchema> & { createdAt: string }
): ManualOpeningCapacityReservationRecord {
  const { createdAt, ...value } = input;
  const payload = manualOpeningCapacityReservationPayloadSchema.parse(value);
  if (!isDeepStrictEqual(value, payload)) throw new Error("manual capacity reservation payload must already be canonical");
  assertAmounts(payload);
  const hash = hashCanonicalPayload(payload);
  return Object.freeze(manualOpeningCapacityReservationRecordSchema.parse({ ...payload,
    manualCapacityReservationId: hashDerivedId("manual_capacity_reservation", hash),
    manualCapacityReservationHash: hash, createdAt }));
}

/** Independently rehash the complete variant; no field is inferred from a mandate or caller ID. */
export function parseManualOpeningCapacityReservationRecord(value: unknown): ManualOpeningCapacityReservationRecord {
  const record = manualOpeningCapacityReservationRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) throw new Error("manual capacity reservation record must already be canonical");
  const { manualCapacityReservationId, manualCapacityReservationHash, createdAt: _createdAt, ...payload } = record;
  assertAmounts(payload);
  const hash = hashCanonicalPayload(payload);
  if (manualCapacityReservationHash !== hash || manualCapacityReservationId !== hashDerivedId("manual_capacity_reservation", hash)) {
    throw new Error("manual capacity reservation identity does not match its complete payload");
  }
  return Object.freeze(record);
}

/** Source-payload binding, not active-policy/evidence/sizing verification or current capacity authority. */
export function resolveManualOpeningCapacityReservationBinding(input: { reservation: unknown; manualAssignmentEvent: unknown }) {
  const reservation = parseManualOpeningCapacityReservationRecord(input.reservation);
  const event = parseManualAssignmentEvent(input.manualAssignmentEvent);
  if (event.authorizationScope !== "open_or_increase") throw new Error("classification authorization cannot reserve opening capacity");
  if (reservation.manualAssignmentEventId !== event.manualAssignmentEventId || reservation.manualAssignmentEventHash !== event.manualAssignmentEventHash ||
    reservation.portfolioId !== event.portfolioId || reservation.policyHash !== event.policyHash || reservation.bucket !== event.bucket ||
    reservation.market !== event.market || reservation.symbol !== event.symbol || reservation.authorizationRef !== event.authorizationRef ||
    reservation.reservedMaximumNotionalKrw > event.maximumNotionalKrw || Date.parse(reservation.createdAt) < Date.parse(event.createdAt)) {
    throw new Error("manual capacity reservation does not match its authorization source");
  }
  // The current transaction snapshot can differ from the event's older sizing snapshot.
  // Its actual origin, gap and ledger version must be resolved by the capacity coordinator.
  return Object.freeze({ reservation, event });
}

/** Checks the complete reservation lineage carried by a manual opening mandate. No reservation is consumed here. */
export function resolveManualOpeningCapacityMandateBinding(input: {
  reservation: unknown; manualAssignmentEvent: unknown; mandate: unknown
}) {
  const { reservation, event } = resolveManualOpeningCapacityReservationBinding(input);
  const mandate = parseInvestmentMandateRecord(input.mandate);
  const assignment = resolveManualMandateAssignmentBinding({ mandate, manualAssignmentEvent: event }).mandate;
  if (assignment.manualAuthorizationScope !== "open_or_increase") throw new Error("opening reservation requires a manual opening mandate");
  const lineage = assignment.capacityReservation;
  const expected = { manualCapacityReservationId: reservation.manualCapacityReservationId,
    manualCapacityReservationHash: reservation.manualCapacityReservationHash,
    reservedMaximumNotionalKrw: reservation.reservedMaximumNotionalKrw,
    ...(reservation.reservationKind === "new_position"
      ? { reservationKind: reservation.reservationKind, reservedSlotOrdinal: reservation.reservedSlotOrdinal }
      : { reservationKind: reservation.reservationKind, existingPositionRef: reservation.existingPositionRef }) };
  if (!isDeepStrictEqual(lineage, expected) || Date.parse(assignment.createdAt) < Date.parse(reservation.createdAt)) {
    throw new Error("manual mandate does not preserve its complete reservation lineage");
  }
  return Object.freeze({ reservation, event, mandate: assignment });
}

function assertAmounts(payload: z.infer<typeof manualOpeningCapacityReservationPayloadSchema>): void {
  if (payload.resultingReservedNotionalKrw < payload.reservedMaximumNotionalKrw) {
    throw new Error("aggregate reserved notional cannot be below this reservation");
  }
}
