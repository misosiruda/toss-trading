import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { z } from "zod";
import { CandidateAssignmentFileRepository, getDurableCandidateAssignmentObservation } from "./candidateAssignmentFiles.js";
import { getDurableCandidateSizingInputObservation } from "./candidateSizingInputFiles.js";
import { getDurableBucketSelectionRequestObservation } from "./bucketSelectionRequestFiles.js";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation,
  type InvestmentMandateFileRepositoryOptions } from "./investmentMandateFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveSelectorMandateAssignmentBinding } from "./selectorMandateAssignmentBinding.js";

const inputSchema = z.object({ baseDir: z.string().min(1), mandateId: z.string().min(1).max(160).trim() }).strict();

/** Read actual immutable sources, not current mandate activation, source-before-creation receipt or capacity authority. */
export async function resolveStoredSelectorMandateAssignmentBinding(value: z.input<typeof inputSchema>,
  options: InvestmentMandateFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("stored selector mandate query must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  // Release the mandate lock before acquiring request -> snapshot -> sizing -> assignment locks.
  const source = await new InvestmentMandateFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const mandate = history.records.find((record) => record.mandateId === input.mandateId);
    if (!mandate || mandate.assignmentSource !== "deterministic_selector") throw new Error("stored selector mandate source is missing or not selector");
    return Object.freeze({ mandate, observation: getDurableInvestmentMandateObservation(history) });
  });
  return new CandidateAssignmentFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history, inputs, requests) => {
    const observedAt = getDurableCandidateAssignmentObservation(history);
    if (Date.parse(observedAt) < Date.parse(source.observation.observedAt) || Date.now() < Date.parse(observedAt)) {
      throw new Error("stored selector mandate source observation clock moved backwards");
    }
    const setOrigin = history.origins.find((origin) => origin.kind === "set" && origin.record.candidateAssignmentSetId === source.mandate.candidateAssignmentSetId);
    if (!setOrigin || setOrigin.kind !== "set") throw new Error("stored selector mandate assignment set source is missing");
    const assignmentOrigins = history.origins.filter((origin) => origin.kind === "assignment" && origin.record.requestId === setOrigin.record.requestId);
    const assignments = assignmentOrigins.map((origin) => {
      if (origin.kind !== "assignment") throw new Error("unexpected assignment source kind");
      return origin.record;
    });
    const assignment = assignments.find((record) => record.assignmentId === source.mandate.candidateAssignmentId);
    const request = requests.requests.find((record) => record.requestId === setOrigin.record.requestId);
    const sizingOrigin = inputs.origins.find((origin) => origin.record.sizingInputRecordId === assignment?.sizingInputRecordId);
    if (!request || !assignment || !sizingOrigin) throw new Error("stored selector mandate request assignment or sizing source is missing");
    if (Date.parse(setOrigin.committedAt) > Date.parse(source.mandate.createdAt)) throw new Error("stored selector mandate predates assignment set commit");
    const binding = resolveSelectorMandateAssignmentBinding({ mandate: source.mandate, request,
      sizingInput: sizingOrigin.record, set: setOrigin.record, assignments });
    const assessment = Object.freeze({ verificationScope: "stored_selector_mandate_assignment_sources_only" as const,
      bindingAssessmentHash: binding.assessmentHash, mandateObservation: source.observation,
      assignmentGenerationHash: history.generationHash, assignmentObservedAt: observedAt,
      requestObservation: getDurableBucketSelectionRequestObservation(requests),
      sizingGenerationHash: inputs.generationHash, sizingObservedAt: getDurableCandidateSizingInputObservation(inputs),
      sourceBeforeCreationReceipt: "not_recorded" as const, mandateActivationAuthority: "not_verified" as const,
      candidateEligibilityAndSizing: "not_verified" as const, capacityReservationAuthority: "not_verified" as const,
      currentExecutionAuthority: "not_granted" as const });
    return Object.freeze({ binding, setOrigin, assignmentOrigins: Object.freeze(assignmentOrigins), sizingOrigin,
      assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}
