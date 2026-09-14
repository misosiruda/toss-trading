import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { marketSchema, sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { parseBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { parseCandidateAssignment, resolveCandidateAssignmentSizingBinding } from "./candidateAssignment.js";
import { resolveCandidateAssignmentSetBinding } from "./candidateAssignmentSet.js";
import { parseOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { parsePortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { resolveSelectorMandateAssignmentBinding } from "./selectorMandateAssignmentBinding.js";

const identifier = z.string().min(1).max(160).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const positive = count.refine((value) => value > 0);
const timestamp = offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString());
export const selectorOpeningCapacityReservationPayloadSchema = z.object({
  selectionRequestId: identifier, selectionRequestHash: sha256HashSchema,
  candidateAssignmentSetId: identifier, candidateAssignmentSetHash: sha256HashSchema,
  candidateAssignmentId: identifier, candidateAssignmentHash: sha256HashSchema, selectedRank: positive,
  portfolioId: identifier, policyHash: sha256HashSchema, bucket: strategyBucketSchema, market: marketSchema, symbol: identifier,
  currentPortfolioSnapshotId: identifier, currentPortfolioSnapshotHash: sha256HashSchema,
  capacityLedgerVersion: positive, reservedSlotOrdinal: count,
  reservedMaximumNotionalKrw: positive, resultingReservedNotionalKrw: positive
}).strict();
export const selectorOpeningCapacityReservationRecordSchema = selectorOpeningCapacityReservationPayloadSchema.extend({
  selectorCapacityReservationId: identifier, selectorCapacityReservationHash: sha256HashSchema, createdAt: timestamp
}).strict();
export type SelectorOpeningCapacityReservationRecord = Readonly<z.infer<typeof selectorOpeningCapacityReservationRecordSchema>>;

/** Immutable issuance payload only; the shared allocator must still authorize and atomically persist it. */
export function createSelectorOpeningCapacityReservationRecord(
  input: z.input<typeof selectorOpeningCapacityReservationPayloadSchema> & { createdAt: string }
): SelectorOpeningCapacityReservationRecord {
  const { createdAt, ...raw } = input;
  const payload = selectorOpeningCapacityReservationPayloadSchema.parse(raw);
  if (!isDeepStrictEqual(payload, raw)) throw new Error("selector capacity reservation payload must already be canonical");
  const hash = hashCanonicalPayload(payload);
  return parseSelectorOpeningCapacityReservationRecord({ ...payload, createdAt, selectorCapacityReservationHash: hash,
    selectorCapacityReservationId: hashDerivedId("selector_capacity_reservation", hash) });
}

/** Rehash every payload field; identity and validated createdAt are excluded, never inferred. */
export function parseSelectorOpeningCapacityReservationRecord(value: unknown): SelectorOpeningCapacityReservationRecord {
  const record = selectorOpeningCapacityReservationRecordSchema.parse(value);
  if (!isDeepStrictEqual(record, value)) throw new Error("selector capacity reservation record must already be canonical");
  const { selectorCapacityReservationId, selectorCapacityReservationHash, createdAt: _createdAt, ...payload } = record;
  const hash = hashCanonicalPayload(payload);
  if (selectorCapacityReservationHash !== hash || selectorCapacityReservationId !== hashDerivedId("selector_capacity_reservation", hash)) {
    throw new Error("selector capacity reservation identity does not match its complete payload");
  }
  if (record.resultingReservedNotionalKrw < record.reservedMaximumNotionalKrw) {
    throw new Error("aggregate reserved notional cannot be below this selector reservation");
  }
  return Object.freeze(record);
}

const bindingSchema = z.object({ reservation: z.unknown(), request: z.unknown(), set: z.unknown(),
  assignments: z.array(z.unknown()).max(100_000), sizingInput: z.unknown(), currentSnapshot: z.unknown() }).strict();

/** Exact supplied allocation and snapshot binding, not stored source completeness or current capacity authority. */
export function resolveSelectorOpeningCapacityReservationBinding(value: z.input<typeof bindingSchema>) {
  const input = bindingSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector capacity reservation binding must already be canonical");
  const reservation = parseSelectorOpeningCapacityReservationRecord(input.reservation);
  const request = parseBucketSelectionRequest(input.request);
  const { set } = resolveCandidateAssignmentSetBinding({ request, set: input.set, assignments: input.assignments });
  const assignments = input.assignments.map(parseCandidateAssignment);
  const assignment = assignments.find((item) => item.assignmentId === reservation.candidateAssignmentId);
  const selected = set.selectedAssignments.find((item) => item.assignmentId === reservation.candidateAssignmentId);
  if (!assignment || !selected || reservation.selectionRequestId !== request.requestId || reservation.selectionRequestHash !== request.requestHash ||
    reservation.candidateAssignmentSetId !== set.candidateAssignmentSetId || reservation.candidateAssignmentSetHash !== set.candidateAssignmentSetHash ||
    reservation.candidateAssignmentHash !== assignment.assignmentHash || reservation.selectedRank !== selected.selectedRank ||
    reservation.reservedMaximumNotionalKrw !== selected.reservedMaximumNotionalKrw) {
    throw new Error("selector capacity reservation differs from exact selected allocation");
  }
  for (const key of ["portfolioId", "policyHash", "bucket", "market", "symbol"] as const) {
    if (reservation[key] !== assignment[key]) throw new Error(`selector capacity reservation ${key} mismatch`);
  }
  const { sizingInput } = resolveCandidateAssignmentSizingBinding({ assignment, request, sizingInput: input.sizingInput });
  if (sizingInput.executionCostInput.side !== "BUY") throw new Error("selector capacity reservation requires BUY sizing input");
  const currentSnapshot = parsePortfolioSizingSnapshot(input.currentSnapshot);
  if (reservation.currentPortfolioSnapshotId !== currentSnapshot.portfolioSnapshotId ||
    reservation.currentPortfolioSnapshotHash !== currentSnapshot.portfolioSnapshotHash ||
    reservation.portfolioId !== currentSnapshot.portfolioId || reservation.policyHash !== currentSnapshot.policyHash) {
    throw new Error("selector capacity reservation current snapshot binding mismatch");
  }
  if (Date.parse(reservation.createdAt) < Date.parse(set.createdAt) || Date.parse(reservation.createdAt) < Date.parse(currentSnapshot.asOf) ||
    Date.parse(currentSnapshot.asOf) < Date.parse(request.asOf)) throw new Error("selector capacity reservation source chronology mismatch");
  const assessment = Object.freeze({ verificationScope: "supplied_selector_capacity_reservation_binding_only" as const,
    reservationHash: reservation.selectorCapacityReservationHash, requestHash: request.requestHash,
    candidateAssignmentSetHash: set.candidateAssignmentSetHash, assignmentHash: assignment.assignmentHash,
    sizingInputHash: sizingInput.sizingInputHash, currentPortfolioSnapshotHash: currentSnapshot.portfolioSnapshotHash,
    sourceCompleteness: "not_verified" as const, candidateEligibilityAndSizing: "not_verified" as const,
    currentSnapshotAuthority: "not_verified" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
    currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ reservation, request, set, assignment, sizingInput, currentSnapshot,
    assessment, assessmentHash: hashCanonicalPayload(assessment) });
}

/** Preserve the issuance identity and global slot on the existing root event, without allocating capacity. */
export function resolveSelectorOpeningCapacityReservedEventBinding(value: z.input<typeof bindingSchema> & { event: unknown }) {
  const input = bindingSchema.extend({ event: z.unknown() }).parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector capacity event binding must already be canonical");
  const { event: raw, ...sources } = input;
  const binding = resolveSelectorOpeningCapacityReservationBinding(sources);
  const { event } = resolveSelectorOpeningCapacityReservedRecordBinding({ event: raw, reservation: binding.reservation });
  return Object.freeze({ ...binding, event });
}

/** Exact record/event comparison only. Callers must separately authenticate the issuance's stored sources. */
export function resolveSelectorOpeningCapacityReservedRecordBinding(value: { event: unknown; reservation: unknown }) {
  const input = z.object({ event: z.unknown(), reservation: z.unknown() }).strict().parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector capacity record binding must already be canonical");
  const reservation = parseSelectorOpeningCapacityReservationRecord(input.reservation);
  const event = parseOpeningCapacityReservationEvent(input.event);
  if (event.eventType !== "reserved" || event.reservationSource.sourceKind !== "selector" ||
    event.reservationId !== reservation.selectorCapacityReservationId || event.reservationHash !== reservation.selectorCapacityReservationHash ||
    event.portfolioId !== reservation.portfolioId || event.policyHash !== reservation.policyHash || event.bucket !== reservation.bucket ||
    event.capacityLedgerVersion !== reservation.capacityLedgerVersion || event.remainingReservedNotionalKrw !== reservation.reservedMaximumNotionalKrw ||
    event.reservationSource.candidateAssignmentSetId !== reservation.candidateAssignmentSetId ||
    event.reservationSource.candidateAssignmentSetHash !== reservation.candidateAssignmentSetHash ||
    event.reservationSource.candidateAssignmentId !== reservation.candidateAssignmentId ||
    event.reservationSource.reservedSlotOrdinal !== reservation.reservedSlotOrdinal || Date.parse(event.asOf) < Date.parse(reservation.createdAt)) {
    throw new Error("selector capacity event does not preserve its complete issuance lineage");
  }
  return Object.freeze({ reservation, event });
}

/** Bind the full selector mandate allocation to issuance, retaining selected rank separately from global slot. */
export function resolveSelectorOpeningCapacityMandateBinding(value: z.input<typeof bindingSchema> & { mandate: unknown }) {
  const input = bindingSchema.extend({ mandate: z.unknown() }).parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector capacity mandate binding must already be canonical");
  const { mandate: raw, ...sources } = input;
  const binding = resolveSelectorOpeningCapacityReservationBinding(sources), reservation = binding.reservation;
  const { mandate } = resolveSelectorMandateAssignmentBinding({ mandate: raw, request: binding.request, set: binding.set,
    assignments: sources.assignments, sizingInput: binding.sizingInput });
  if (mandate.openingCapacityReservationId !== reservation.selectorCapacityReservationId ||
    mandate.openingCapacityReservationHash !== reservation.selectorCapacityReservationHash ||
    mandate.reservedSlotOrdinal !== reservation.reservedSlotOrdinal || Date.parse(mandate.createdAt) < Date.parse(reservation.createdAt)) {
    throw new Error("selector mandate does not preserve its complete issuance lineage");
  }
  return Object.freeze({ ...binding, mandate });
}
