import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parseBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { candidateSizingInputPayloadSchema, resolveCandidateSizingInputRequestBinding } from "./candidateSizingInput.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = candidateSizingInputPayloadSchema.shape.symbol;
const amount = candidateSizingInputPayloadSchema.shape.exposureCapInputs.shape.cashAvailableKrw;
const ratio = z.number().finite().min(0).max(1).refine((value) => !Object.is(value, -0));
export const candidateAssignmentSizingOutputSchema = z.object({ minWeightRatio: ratio, targetWeightRatio: ratio,
  maxWeightRatio: ratio, maximumNotionalKrw: amount }).strict().refine((value) =>
  value.minWeightRatio <= value.targetWeightRatio && value.targetWeightRatio <= value.maxWeightRatio, "assignment range is unordered");
const payloadSchema = candidateSizingInputPayloadSchema.pick({ requestId: true, portfolioId: true, portfolioSnapshotId: true,
  portfolioSnapshotHash: true, policyHash: true, asOf: true, market: true, symbol: true, bucket: true, scoringModelVersion: true, selectionScore: true })
  .extend({ sizingInputRecordId: identifier, sizingInputHash: sha256HashSchema, sizingOutputHash: sha256HashSchema,
    eligibility: z.enum(["eligible", "watch", "blocked"]), reasonCodes: z.array(identifier).min(1).max(128),
    evidenceRefs: z.array(identifier).min(1).max(128), ...candidateAssignmentSizingOutputSchema.shape }).strict();
export const candidateAssignmentSchema = payloadSchema.extend({ assignmentId: identifier, assignmentHash: sha256HashSchema,
  createdAt: offsetQualifiedIsoDateTimeSchema }).strict();
export type CandidateAssignment = Readonly<z.infer<typeof candidateAssignmentSchema>>;

/** Output content only. The caller must separately establish eligibility, exact sizing and actual source authority. */
export function createCandidateAssignment(input: Omit<z.input<typeof payloadSchema>, "sizingOutputHash"> & { createdAt: string }): CandidateAssignment {
  const { createdAt, ...raw } = input;
  // Parsing before normalization prevents unknown fields from being silently discarded.
  const parsed = payloadSchema.omit({ sizingOutputHash: true }).parse(raw);
  const payload = { ...parsed, reasonCodes: canonicalRefs(parsed.reasonCodes), evidenceRefs: canonicalRefs(parsed.evidenceRefs),
    sizingOutputHash: hashCanonicalPayload(outputOf(parsed)) };
  return parseCandidateAssignment({ ...payload, createdAt, assignmentId: assignmentId(payload), assignmentHash: hashCanonicalPayload(payload) });
}

export function parseCandidateAssignment(value: unknown): CandidateAssignment {
  const record = candidateAssignmentSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) throw new Error("candidate assignment must already be canonical");
  const { assignmentId: id, assignmentHash, createdAt, ...payload } = record;
  if (!isDeepStrictEqual(record.reasonCodes, canonicalRefs(record.reasonCodes)) || !isDeepStrictEqual(record.evidenceRefs, canonicalRefs(record.evidenceRefs)) ||
    payload.sizingOutputHash !== hashCanonicalPayload(outputOf(record)) || id !== assignmentId(payload) || assignmentHash !== hashCanonicalPayload(payload)) {
    throw new Error("candidate assignment complete payload or sizing output hash mismatch");
  }
  if (Date.parse(createdAt) < Date.parse(record.asOf)) throw new Error("candidate assignment predates evaluation");
  return freeze(record);
}

/** Exact supplied request scope, not current request/capacity authorization. */
export function resolveCandidateAssignmentRequestBinding(input: { assignment: unknown; request: unknown }) {
  const assignment = parseCandidateAssignment(input.assignment), request = parseBucketSelectionRequest(input.request);
  for (const key of ["requestId", "portfolioId", "portfolioSnapshotId", "portfolioSnapshotHash", "policyHash", "bucket"] as const) {
    if (assignment[key] !== request[key]) throw new Error("candidate assignment request scope mismatch");
  }
  if (Date.parse(assignment.asOf) !== Date.parse(request.asOf) || Date.parse(assignment.createdAt) < Date.parse(request.createdAt)) {
    throw new Error("candidate assignment request chronology mismatch");
  }
  return Object.freeze({ assignment, request });
}

/** Rehashes all supplied inputs; does not independently derive eligibility, score, exposure caps or target range. */
export function resolveCandidateAssignmentSizingBinding(input: { assignment: unknown; sizingInput: unknown; request: unknown }) {
  const { assignment, request } = resolveCandidateAssignmentRequestBinding(input);
  const { sizingInput } = resolveCandidateSizingInputRequestBinding(input);
  if (assignment.sizingInputRecordId !== sizingInput.sizingInputRecordId || assignment.sizingInputHash !== sizingInput.sizingInputHash ||
    assignment.market !== sizingInput.market || assignment.symbol !== sizingInput.symbol || assignment.scoringModelVersion !== sizingInput.scoringModelVersion ||
    assignment.selectionScore !== sizingInput.selectionScore || Date.parse(assignment.createdAt) < Date.parse(sizingInput.createdAt)) {
    throw new Error("candidate assignment sizing input binding mismatch");
  }
  return Object.freeze({ assignment, sizingInput, request, verificationScope: "supplied_assignment_content_binding_only" as const,
    eligibilityAndExactSizing: "not_verified" as const, currentExecutionAuthority: "not_granted" as const });
}

function outputOf(value: z.input<typeof candidateAssignmentSizingOutputSchema>) {
  return candidateAssignmentSizingOutputSchema.parse({ minWeightRatio: value.minWeightRatio, targetWeightRatio: value.targetWeightRatio,
    maxWeightRatio: value.maxWeightRatio, maximumNotionalKrw: value.maximumNotionalKrw });
}
function assignmentId(value: { requestId: string; market: string; symbol: string }) {
  return hashDerivedId("candidate_assignment", hashCanonicalPayload({ requestId: value.requestId, market: value.market, symbol: value.symbol }));
}
function canonicalRefs(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error("candidate assignment has duplicate refs");
  return [...values].sort(compareText);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
