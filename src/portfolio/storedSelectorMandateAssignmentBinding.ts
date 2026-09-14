import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { z } from "zod";
import { CandidateAssignmentFileRepository, getDurableCandidateAssignmentObservation,
  type VerifiedCandidateAssignmentOrigin } from "./candidateAssignmentFiles.js";
import { getDurableCandidateSizingInputObservation } from "./candidateSizingInputFiles.js";
import { getDurableBucketSelectionRequestObservation } from "./bucketSelectionRequestFiles.js";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation,
  type InvestmentMandateFileRepositoryOptions } from "./investmentMandateFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSelectorMandateAssignmentBindingResolver } from "./selectorMandateAssignmentBinding.js";

const inputSchema = z.object({ baseDir: z.string().min(1), mandateId: z.string().min(1).max(160).trim() }).strict();
const batchSchema = inputSchema.omit({ mandateId: true }).extend({ mandateIds: z.array(inputSchema.shape.mandateId).min(1).max(100_000) }).strict();

/** Read actual immutable sources, not current mandate activation, source-before-creation receipt or capacity authority. */
export async function resolveStoredSelectorMandateAssignmentBinding(value: z.input<typeof inputSchema>,
  options: InvestmentMandateFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("stored selector mandate query must already be canonical");
  return (await resolveStoredSelectorMandateAssignmentBindings({ baseDir: input.baseDir, mandateIds: [input.mandateId] }, options))[0]!;
}

/** Read each source journal once and reuse one independently validated allocation context per selected set. */
export async function resolveStoredSelectorMandateAssignmentBindings(value: z.input<typeof batchSchema>,
  options: InvestmentMandateFileRepositoryOptions = {}) {
  const input = batchSchema.parse(value);
  if (!isDeepStrictEqual(input, value) || new Set(input.mandateIds).size !== input.mandateIds.length) {
    throw new Error("stored selector mandate batch must be canonical with unique IDs");
  }
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  // Release the mandate lock before acquiring request -> snapshot -> sizing -> assignment locks.
  const source = await new InvestmentMandateFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const byId = new Map(history.records.map((record) => [record.mandateId, record]));
    const observation = getDurableInvestmentMandateObservation(history);
    const mandates = input.mandateIds.map((id) => {
      const mandate = byId.get(id);
      if (!mandate || mandate.assignmentSource !== "deterministic_selector") throw new Error("stored selector mandate source is missing or not selector");
      if (Date.parse(mandate.createdAt) > Date.parse(observation.observedAt)) {
        throw new Error("stored selector mandate creation is after its durable observation");
      }
      return mandate;
    });
    return Object.freeze({ mandates: Object.freeze(mandates), observation });
  });
  return new CandidateAssignmentFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history, inputs, requests) => {
    const observedAt = getDurableCandidateAssignmentObservation(history);
    if (Date.parse(observedAt) < Date.parse(source.observation.observedAt) || Date.now() < Date.parse(observedAt)) {
      throw new Error("stored selector mandate source observation clock moved backwards");
    }
    const sets = new Map(history.origins.filter((origin) => origin.kind === "set").map((origin) => [origin.record.candidateAssignmentSetId, origin]));
    type AssignmentOrigin = VerifiedCandidateAssignmentOrigin & { kind: "assignment" };
    const groups = new Map<string, AssignmentOrigin[]>();
    const assignments = new Map<string, AssignmentOrigin>();
    for (const origin of history.origins) {
      if (origin.kind !== "assignment") continue;
      assignments.set(origin.record.assignmentId, origin);
      const group = groups.get(origin.record.requestId) ?? [];
      group.push(origin); groups.set(origin.record.requestId, group);
    }
    const requestById = new Map(requests.requests.map((record) => [record.requestId, record]));
    const sizingById = new Map(inputs.origins.map((origin) => [origin.record.sizingInputRecordId, origin]));
    const contexts = new Map<string, ReturnType<typeof createSelectorMandateAssignmentBindingResolver>>();
    const requestObservation = getDurableBucketSelectionRequestObservation(requests);
    const sizingObservedAt = getDurableCandidateSizingInputObservation(inputs);
    return Object.freeze(source.mandates.map((mandate) => {
      const setOrigin = sets.get(mandate.candidateAssignmentSetId);
      if (!setOrigin || setOrigin.kind !== "set") throw new Error("stored selector mandate assignment set source is missing");
      const assignmentOrigins = groups.get(setOrigin.record.requestId) ?? [];
      const assignment = assignments.get(mandate.candidateAssignmentId)?.record;
      const request = requestById.get(setOrigin.record.requestId);
      const sizingOrigin = sizingById.get(assignment?.sizingInputRecordId ?? "");
      if (!request || !assignment || !sizingOrigin) throw new Error("stored selector mandate request assignment or sizing source is missing");
      if (Date.parse(setOrigin.committedAt) > Date.parse(mandate.createdAt)) throw new Error("stored selector mandate predates assignment set commit");
      let context = contexts.get(setOrigin.record.candidateAssignmentSetId);
      if (!context) {
        context = createSelectorMandateAssignmentBindingResolver({ request, set: setOrigin.record,
          assignments: assignmentOrigins.map((origin) => origin.record) });
        contexts.set(setOrigin.record.candidateAssignmentSetId, context);
      }
      const binding = context({ mandate, sizingInput: sizingOrigin.record });
      const assessment = Object.freeze({ verificationScope: "stored_selector_mandate_assignment_sources_only" as const,
        bindingAssessmentHash: binding.assessmentHash, mandateObservation: source.observation,
        assignmentGenerationHash: history.generationHash, assignmentObservedAt: observedAt,
        requestObservation,
        sizingGenerationHash: inputs.generationHash, sizingObservedAt,
        sourceBeforeCreationReceipt: "not_recorded" as const, mandateActivationAuthority: "not_verified" as const,
        candidateEligibilityAndSizing: "not_verified" as const, capacityReservationAuthority: "not_verified" as const,
        currentExecutionAuthority: "not_granted" as const });
      return Object.freeze({ binding, setOrigin, assignmentOrigins: Object.freeze(assignmentOrigins), sizingOrigin,
        assessment, assessmentHash: hashCanonicalPayload(assessment) });
    }));
  });
}
