import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { parseCandidateAssignment, resolveCandidateAssignmentSizingBinding } from "./candidateAssignment.js";
import { resolveCandidateAssignmentSetBinding } from "./candidateAssignmentSet.js";
import { parseInvestmentMandateRecord } from "./investmentMandate.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const inputSchema = z.object({ mandate: z.unknown(), request: z.unknown(), sizingInput: z.unknown(),
  set: z.unknown(), assignments: z.array(z.unknown()).max(100_000) }).strict();

/** Supplied source binding only. Actual eligibility/sizing replay and current shared capacity remain separate gates. */
export function resolveSelectorMandateAssignmentBinding(value: unknown) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector mandate binding input must already be canonical");
  return createSelectorMandateAssignmentBindingResolver({ request: input.request, set: input.set, assignments: input.assignments })(
    { mandate: input.mandate, sizingInput: input.sizingInput });
}

/** Validate one complete set once; the returned resolver captures only parsed immutable sources and private indexes. */
export function createSelectorMandateAssignmentBindingResolver(value: { request: unknown; set: unknown; assignments: readonly unknown[] }) {
  const input = inputSchema.omit({ mandate: true, sizingInput: true }).parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector mandate binding sources must already be canonical");
  const request = parseBucketSelectionRequest(input.request);
  const { set } = resolveCandidateAssignmentSetBinding({ ...input, request });
  const assignments = new Map(input.assignments.map(parseCandidateAssignment).map((item) => [item.assignmentId, item]));
  const selections = new Map(set.selectedAssignments.map((item) => [item.assignmentId, item]));
  return Object.freeze((value: { mandate: unknown; sizingInput: unknown }) => {
    const input = inputSchema.pick({ mandate: true, sizingInput: true }).parse(value);
    if (!isDeepStrictEqual(input, value)) throw new Error("selector mandate binding target must already be canonical");
    const mandate = parseInvestmentMandateRecord(input.mandate);
    if (mandate.assignmentSource !== "deterministic_selector") throw new Error("selector assignment binding requires a selector mandate");
    const selected = selections.get(mandate.candidateAssignmentId);
    const assignment = assignments.get(mandate.candidateAssignmentId);
    if (!selected || !assignment || assignment.eligibility !== "eligible" || selected.assignmentHash !== assignment.assignmentHash ||
      set.candidateAssignmentSetId !== mandate.candidateAssignmentSetId || set.candidateAssignmentSetHash !== mandate.candidateAssignmentSetHash ||
      selected.selectedRank !== mandate.selectedRank || set.requestId !== mandate.selectionRequestId) {
      throw new Error("selector mandate is not the exact selected assignment and rank");
    }
    const binding = resolveCandidateAssignmentSizingBinding({ assignment, request, sizingInput: input.sizingInput });
    if (binding.sizingInput.executionCostInput.side !== "BUY") throw new Error("selector opening mandate requires BUY sizing input");
    for (const key of ["portfolioId", "policyHash", "bucket", "market", "symbol", "scoringModelVersion", "selectionScore",
      "minWeightRatio", "targetWeightRatio", "maxWeightRatio"] as const) {
      if (mandate[key] !== assignment[key]) throw new Error(`selector mandate assignment ${key} mismatch`);
    }
    if (!isDeepStrictEqual(mandate.reasonCodes, assignment.reasonCodes) || !isDeepStrictEqual(mandate.evidenceRefs, assignment.evidenceRefs)) {
      throw new Error("selector mandate assignment reason or evidence references mismatch");
    }
    const maximumOpeningNotionalKrw = Math.min(assignment.maximumNotionalKrw, selected.reservedMaximumNotionalKrw);
    if (mandate.maximumOpeningNotionalKrw !== maximumOpeningNotionalKrw || mandate.reservedMaximumNotionalKrw !== maximumOpeningNotionalKrw) {
      throw new Error("selector mandate opening amount differs from selected request allocation");
    }
    if (Date.parse(mandate.asOf) < Date.parse(binding.request.asOf) ||
      Date.parse(mandate.evidenceAsOf) !== Date.parse(assignment.asOf) || Date.parse(mandate.createdAt) < Date.parse(set.createdAt)) {
      throw new Error("selector mandate assignment chronology mismatch");
    }
    const assessment = Object.freeze({ verificationScope: "supplied_selector_mandate_assignment_binding_only" as const,
      mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, candidateAssignmentSetHash: set.candidateAssignmentSetHash,
      assignmentHash: assignment.assignmentHash, sizingInputHash: binding.sizingInput.sizingInputHash,
      selectedRank: selected.selectedRank, maximumOpeningNotionalKrw,
      sourceCompleteness: "not_verified" as const, candidateEligibilityAndSizing: "not_verified" as const,
      capacityReservationAuthority: "not_verified" as const, currentExecutionAuthority: "not_granted" as const });
    return Object.freeze({ mandate, set, assignment, request: binding.request, sizingInput: binding.sizingInput,
      assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}
