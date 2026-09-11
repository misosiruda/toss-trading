import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parseBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { candidateAssignmentSchema, resolveCandidateAssignmentRequestBinding, type CandidateAssignment } from "./candidateAssignment.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
const identifier = candidateAssignmentSchema.shape.assignmentId;
const orderedSchema = candidateAssignmentSchema.pick({ assignmentId: true, assignmentHash: true, eligibility: true, selectionScore: true, market: true, symbol: true });
const selectedSchema = z.object({ assignmentId: identifier, assignmentHash: sha256HashSchema, selectedRank: count,
  reservedMaximumNotionalKrw: count.refine((value) => value > 0) }).strict();
const payloadSchema = z.object({ requestId: identifier, requestHash: sha256HashSchema, availableSlots: count.refine((value) => value > 0),
  requestAllocationBudgetKrw: count.refine((value) => value > 0), orderedAssignments: z.array(orderedSchema).max(100_000),
  selectedAssignments: z.array(selectedSchema).max(100_000), totalReservedMaximumNotionalKrw: count }).strict();
export const candidateAssignmentSetRecordSchema = payloadSchema.extend({ candidateAssignmentSetId: identifier,
  candidateAssignmentSetHash: sha256HashSchema, createdAt: offsetQualifiedIsoDateTimeSchema }).strict();
export type CandidateAssignmentSetRecord = Readonly<z.infer<typeof candidateAssignmentSetRecordSchema>>;

/** Deterministic request-local ordering and budget allocation over supplied assignments, not a current shared-ledger reservation. */
export function createCandidateAssignmentSetRecord(input: { request: unknown; assignments: readonly unknown[]; createdAt: string }): CandidateAssignmentSetRecord {
  const value = z.object({ request: z.unknown(), assignments: z.array(z.unknown()).max(100_000), createdAt: offsetQualifiedIsoDateTimeSchema }).strict().parse(input);
  const request = parseBucketSelectionRequest(value.request);
  const assignments = value.assignments.map((assignment) => resolveCandidateAssignmentRequestBinding({ assignment, request }).assignment).sort(compareAssignment);
  const orderedAssignments = assignments.map((assignment) => orderedSchema.parse(pickOrdered(assignment)));
  assertUnique(orderedAssignments);
  if (Date.parse(value.createdAt) < Date.parse(request.createdAt) || assignments.some((assignment) => Date.parse(value.createdAt) < Date.parse(assignment.createdAt))) {
    throw new Error("candidate assignment set predates its supplied source");
  }
  const budget = Math.min(request.gapKrw, request.maximumAdditionalExposureKrw);
  let remaining = BigInt(budget);
  const selectedAssignments = assignments.filter((assignment) => assignment.eligibility === "eligible").slice(0, request.availableSlots)
    .flatMap((assignment, selectedRank) => {
      const maximum = BigInt(assignment.maximumNotionalKrw), reserved = maximum < remaining ? maximum : remaining;
      remaining -= reserved;
      return reserved === 0n ? [] : [{ assignmentId: assignment.assignmentId, assignmentHash: assignment.assignmentHash, selectedRank,
        reservedMaximumNotionalKrw: Number(reserved) }];
    });
  const payload = { requestId: request.requestId, requestHash: request.requestHash, availableSlots: request.availableSlots,
    requestAllocationBudgetKrw: budget, orderedAssignments, selectedAssignments, totalReservedMaximumNotionalKrw: budget - Number(remaining) };
  const hash = hashCanonicalPayload(payload);
  return parseCandidateAssignmentSetRecord({ ...payload, createdAt: value.createdAt, candidateAssignmentSetHash: hash,
    candidateAssignmentSetId: hashDerivedId("candidate_assignment_set", hash) });
}

/** Structural/hash validation only; exact allocations and source completeness require the binding resolver and actual repositories. */
export function parseCandidateAssignmentSetRecord(value: unknown): CandidateAssignmentSetRecord {
  const record = candidateAssignmentSetRecordSchema.parse(value);
  if (!isDeepStrictEqual(record, value)) throw new Error("candidate assignment set must already be canonical");
  const { candidateAssignmentSetId, candidateAssignmentSetHash, createdAt: _createdAt, ...payload } = record;
  const hash = hashCanonicalPayload(payload);
  if (candidateAssignmentSetHash !== hash || candidateAssignmentSetId !== hashDerivedId("candidate_assignment_set", hash)) throw new Error("candidate assignment set hash mismatch");
  assertUnique(record.orderedAssignments);
  if (record.orderedAssignments.some((row) => row.assignmentId !== hashDerivedId("candidate_assignment",
    hashCanonicalPayload({ requestId: record.requestId, market: row.market, symbol: row.symbol })))) throw new Error("candidate assignment set candidate identity mismatch");
  if (!isDeepStrictEqual(record.orderedAssignments, [...record.orderedAssignments].sort(compareAssignment))) throw new Error("candidate assignment set order mismatch");
  const eligible = record.orderedAssignments.filter((row) => row.eligibility === "eligible").slice(0, record.availableSlots);
  let total = 0n, previousRank = -1;
  for (const selected of record.selectedAssignments) {
    const assignment = eligible[selected.selectedRank];
    if (!assignment || selected.selectedRank <= previousRank || assignment.assignmentId !== selected.assignmentId || assignment.assignmentHash !== selected.assignmentHash) {
      throw new Error("candidate assignment set selected identity or rank mismatch");
    }
    previousRank = selected.selectedRank; total += BigInt(selected.reservedMaximumNotionalKrw);
  }
  if (total !== BigInt(record.totalReservedMaximumNotionalKrw) || total > BigInt(record.requestAllocationBudgetKrw)) throw new Error("candidate assignment set budget mismatch");
  return freeze(record);
}

export function resolveCandidateAssignmentSetBinding(input: { set: unknown; request: unknown; assignments: readonly unknown[] }) {
  const set = parseCandidateAssignmentSetRecord(input.set);
  const expected = createCandidateAssignmentSetRecord({ request: input.request, assignments: input.assignments, createdAt: set.createdAt });
  if (!isDeepStrictEqual(set, expected)) throw new Error("candidate assignment set differs from complete supplied assignment allocation");
  return Object.freeze({ set, verificationScope: "supplied_assignment_set_allocation_only" as const,
    sourceCompleteness: "not_verified" as const, candidateEligibilityAndSizing: "not_verified" as const,
    sharedCapacityReservation: "not_performed" as const, currentExecutionAuthority: "not_granted" as const });
}

function pickOrdered(value: CandidateAssignment) {
  return { assignmentId: value.assignmentId, assignmentHash: value.assignmentHash, eligibility: value.eligibility,
    selectionScore: value.selectionScore, market: value.market, symbol: value.symbol };
}
function compareAssignment(left: z.infer<typeof orderedSchema>, right: z.infer<typeof orderedSchema>) {
  return Number(left.eligibility !== "eligible") - Number(right.eligibility !== "eligible") ||
    (left.selectionScore === right.selectionScore ? 0 : left.selectionScore > right.selectionScore ? -1 : 1) ||
    compareText(left.market, right.market) || compareText(left.symbol, right.symbol);
}
function assertUnique(values: z.infer<typeof orderedSchema>[]) {
  if (new Set(values.map((row) => row.assignmentId)).size !== values.length ||
    new Set(values.map((row) => JSON.stringify([row.market, row.symbol]))).size !== values.length) throw new Error("candidate assignment set duplicate candidate");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
