import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { assertDurableBucketSelectionRequestSource, getDurableBucketSelectionRequestObservation,
  type VerifiedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { assertDurableCandidateAssignmentSource, getDurableCandidateAssignmentObservation,
  type VerifiedCandidateAssignmentHistory, type VerifiedCandidateAssignmentOrigin } from "./candidateAssignmentFiles.js";
import { assertDurableCandidateSizingInputSource, getDurableCandidateSizingInputObservation,
  type VerifiedCandidateSizingInputHistory } from "./candidateSizingInputFiles.js";
import { assertDurableInvestmentMandateSource, getDurableInvestmentMandateObservation,
  type VerifiedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import type { VerifiedManualAssignmentHistory } from "./manualAssignmentFiles.js";
import { resolveManualOpeningCapacityMandateBinding } from "./manualOpeningCapacityReservation.js";
import { getDurableManualCapacityReservationObservation, type VerifiedManualCapacityReservationHistory } from "./manualOpeningCapacityReservationFiles.js";
import { openingCapacityReservationEventPayloadSchema } from "./openingCapacityReservationEvent.js";
import { getDurableOpeningCapacityEventObservedAt, resolveStoredOpeningCapacityEventOrigin,
  type VerifiedOpeningCapacityEventHistory } from "./openingCapacityReservationEventFiles.js";
import { bindOpeningCapacityRootOrigins } from "./openingCapacityRootBinding.js";
import { getDurableSelectorCapacityReservationObservation, type VerifiedSelectorCapacityReservationHistory } from "./selectorOpeningCapacityReservationFiles.js";
import { createSelectorMandateAssignmentBindingResolver } from "./selectorMandateAssignmentBinding.js";

const querySchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

export interface OpeningCapacityMandateSources {
  readonly manual: VerifiedManualAssignmentHistory;
  readonly requests: VerifiedBucketSelectionRequestHistory;
  readonly inputs: VerifiedCandidateSizingInputHistory;
  readonly assignments: VerifiedCandidateAssignmentHistory;
  readonly manualReservations: VerifiedManualCapacityReservationHistory;
  readonly selectorReservations: VerifiedSelectorCapacityReservationHistory;
  readonly mandates: VerifiedInvestmentMandateHistory;
  readonly events: VerifiedOpeningCapacityEventHistory;
}

/** Synchronous actual-source binding under the caller's locks. Returned values are not leases or activation,
 * consumption, remaining-budget, sizing, allocation or execution authority. No journal is read or written here.
 */
export function bindOpeningCapacityMandateOrigins(value: z.input<typeof querySchema>, sources: OpeningCapacityMandateSources) {
  const input = querySchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("capacity mandate binding query must already be canonical");
  const { manual, requests, inputs, assignments, manualReservations, selectorReservations, mandates, events } = sources;
  // Never accept a caller-supplied list of supposedly authenticated roots.
  const roots = bindOpeningCapacityRootOrigins(input, manual, manualReservations, selectorReservations, events);
  assertDurableBucketSelectionRequestSource(requests, input.baseDir);
  assertDurableCandidateSizingInputSource(inputs, input.baseDir);
  assertDurableCandidateAssignmentSource(assignments, input.baseDir);
  assertDurableInvestmentMandateSource(mandates, input.baseDir);
  const mandateAt = getDurableInvestmentMandateObservation(mandates).observedAt;
  const ancestorTimes = [getDurableBucketSelectionRequestObservation(requests).observedAt,
    getDurableCandidateSizingInputObservation(inputs), getDurableCandidateAssignmentObservation(assignments),
    getDurableManualCapacityReservationObservation(manualReservations), getDurableSelectorCapacityReservationObservation(selectorReservations)];
  if (Date.parse(mandateAt) < Math.max(...ancestorTimes.map(Date.parse)) ||
    Date.parse(getDurableOpeningCapacityEventObservedAt(events)) < Date.parse(mandateAt)) {
    throw new Error("capacity mandate binding observation clock moved backwards");
  }
  const rootsByScope = new Map(roots.map((root) => [scope(root.event), root]));
  const mandatesById = new Map(mandates.records.map((mandate) => [mandate.mandateId, mandate]));
  const sets = new Map(assignments.origins.filter((origin) => origin.kind === "set").map((origin) => [origin.record.candidateAssignmentSetId, origin]));
  type AssignmentOrigin = VerifiedCandidateAssignmentOrigin & { kind: "assignment" };
  const groups = new Map<string, AssignmentOrigin[]>(), assignmentsById = new Map<string, AssignmentOrigin>();
  for (const origin of assignments.origins) {
    if (origin.kind !== "assignment") continue;
    assignmentsById.set(origin.record.assignmentId, origin);
    const group = groups.get(origin.record.requestId) ?? [];
    group.push(origin); groups.set(origin.record.requestId, group);
  }
  const requestsById = new Map(requests.requests.map((request) => [request.requestId, request]));
  const inputsById = new Map(inputs.origins.map((origin) => [origin.record.sizingInputRecordId, origin]));
  const contexts = new Map<string, ReturnType<typeof createSelectorMandateAssignmentBindingResolver>>();
  const bindings = events.events.filter((event) => event.portfolioId === input.portfolioId && event.eventType === "bound_to_mandate").map((event) => {
    if (event.eventType !== "bound_to_mandate") throw new Error("capacity mandate binding requires bound event");
    const root = rootsByScope.get(scope(event)), mandate = mandatesById.get(event.mandateId);
    if (!root || !mandate || mandate.mandateHash !== event.mandateHash) throw new Error("capacity bound mandate source is missing or differs");
    if (Date.parse(root.eventOrigin.committedAt) > Date.parse(mandate.createdAt) ||
      Date.parse(mandate.createdAt) > Date.parse(event.asOf) || Date.parse(mandate.createdAt) > Date.parse(mandateAt)) {
      throw new Error("capacity bound mandate source chronology mismatch");
    }
    const eventOrigin = resolveStoredOpeningCapacityEventOrigin(events, event.capacityReservationEventId);
    if (root.sourceKind === "manual") {
      const binding = resolveManualOpeningCapacityMandateBinding({ reservation: root.reservationOrigin.record,
        manualAssignmentEvent: root.manualAssignmentEvent, mandate });
      return Object.freeze({ sourceKind: "manual" as const, root, event, eventOrigin, mandate: binding.mandate });
    }
    const reference = root.event.reservationSource;
    if (reference.sourceKind !== "selector" || mandate.assignmentSource !== "deterministic_selector" ||
      mandate.portfolioId !== root.event.portfolioId || mandate.policyHash !== root.event.policyHash || mandate.bucket !== root.event.bucket ||
      mandate.openingCapacityReservationId !== root.event.reservationId || mandate.openingCapacityReservationHash !== root.event.reservationHash ||
      mandate.reservedSlotOrdinal !== reference.reservedSlotOrdinal || mandate.reservedMaximumNotionalKrw !== root.event.remainingReservedNotionalKrw ||
      mandate.candidateAssignmentSetId !== reference.candidateAssignmentSetId || mandate.candidateAssignmentSetHash !== reference.candidateAssignmentSetHash ||
      mandate.candidateAssignmentId !== reference.candidateAssignmentId) {
      throw new Error("selector capacity mandate does not preserve its exact root reservation lineage");
    }
    const setOrigin = sets.get(mandate.candidateAssignmentSetId);
    const assignment = assignmentsById.get(mandate.candidateAssignmentId)?.record;
    const request = setOrigin ? requestsById.get(setOrigin.record.requestId) : undefined;
    const sizingOrigin = inputsById.get(assignment?.sizingInputRecordId ?? "");
    if (!setOrigin || setOrigin.kind !== "set" || !assignment || !request || !sizingOrigin) {
      throw new Error("selector capacity mandate assignment request or sizing source is missing");
    }
    if (Date.parse(setOrigin.committedAt) > Math.min(Date.parse(root.event.asOf), Date.parse(mandate.createdAt))) {
      throw new Error("selector capacity mandate assignment chronology mismatch");
    }
    let context = contexts.get(setOrigin.record.candidateAssignmentSetId);
    if (!context) {
      context = createSelectorMandateAssignmentBindingResolver({ request, set: setOrigin.record,
        assignments: (groups.get(setOrigin.record.requestId) ?? []).map((origin) => origin.record) });
      contexts.set(setOrigin.record.candidateAssignmentSetId, context);
    }
    const binding = context({ mandate, sizingInput: sizingOrigin.record });
    return Object.freeze({ sourceKind: "selector" as const, root, event, eventOrigin, mandate: binding.mandate, binding, setOrigin, sizingOrigin });
  });
  return Object.freeze({ roots, bindings: Object.freeze(bindings) });
}

function scope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
