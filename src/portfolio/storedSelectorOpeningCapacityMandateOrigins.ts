import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { openingCapacityReservationEventPayloadSchema, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin, type VerifiedOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSelectorMandateAssignmentBinding } from "./storedSelectorMandateAssignmentBinding.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

/** Historical selector root -> bound mandate source-content checks, not root allocation or current execution authority. */
export async function resolveStoredSelectorOpeningCapacityMandateOrigins(value: z.input<typeof inputSchema>,
  options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("selector capacity mandate query must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options }, startedAt = Date.now();
  const repo = new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions);
  // Release the event lock before entering mandate and request -> snapshot -> sizing -> assignment repositories.
  const initial = await repo.withDurableVerifiedHistory(async (history) => ({ history,
    observedAt: getDurableOpeningCapacityEventObservedAt(history) }));
  let lastObservedAt = initial.observedAt;
  if (Date.parse(lastObservedAt) < startedAt) throw new Error("selector capacity mandate observation clock moved backwards");
  const selected = initial.history.events.filter((event) => event.portfolioId === input.portfolioId);
  const roots = new Map(selected.filter((event) => event.eventType === "reserved" && event.reservationSource.sourceKind === "selector")
    .map((event) => [scope(event), event]));
  const bindings: Readonly<{ root: OpeningCapacityReservationEvent; rootOrigin: VerifiedOpeningCapacityEventOrigin;
    event: OpeningCapacityReservationEvent; eventOrigin: VerifiedOpeningCapacityEventOrigin;
    source: Awaited<ReturnType<typeof resolveStoredSelectorMandateAssignmentBinding>> }>[] = [];
  const verifiedIds = new Set<string>();
  for (const event of selected) {
    if (event.eventType !== "bound_to_mandate") continue;
    const root = roots.get(scope(event));
    if (!root || root.eventType !== "reserved" || root.reservationSource.sourceKind !== "selector") continue;
    const source = await resolveStoredSelectorMandateAssignmentBinding({ baseDir, mandateId: event.mandateId }, lockOptions);
    const mandate = source.binding.mandate, reference = root.reservationSource;
    if (Date.parse(source.assessment.mandateObservation.observedAt) < Date.parse(lastObservedAt)) {
      throw new Error("selector capacity mandate observation clock moved backwards");
    }
    lastObservedAt = source.assessment.assignmentObservedAt;
    if (mandate.mandateHash !== event.mandateHash || mandate.portfolioId !== root.portfolioId ||
      mandate.policyHash !== root.policyHash || mandate.bucket !== root.bucket ||
      mandate.openingCapacityReservationId !== root.reservationId || mandate.openingCapacityReservationHash !== root.reservationHash ||
      mandate.reservedSlotOrdinal !== reference.reservedSlotOrdinal || mandate.reservedMaximumNotionalKrw !== root.remainingReservedNotionalKrw ||
      mandate.candidateAssignmentSetId !== reference.candidateAssignmentSetId ||
      mandate.candidateAssignmentSetHash !== reference.candidateAssignmentSetHash || mandate.candidateAssignmentId !== reference.candidateAssignmentId) {
      throw new Error("selector capacity mandate does not preserve its exact root reservation lineage");
    }
    const rootOrigin = resolveStoredOpeningCapacityEventOrigin(initial.history, root.capacityReservationEventId);
    if (Date.parse(source.setOrigin.committedAt) > Date.parse(root.asOf) ||
      Date.parse(rootOrigin.committedAt) > Date.parse(mandate.createdAt) || Date.parse(mandate.createdAt) > Date.parse(event.asOf)) {
      throw new Error("selector capacity mandate source chronology mismatch");
    }
    verifiedIds.add(root.capacityReservationEventId); verifiedIds.add(event.capacityReservationEventId);
    bindings.push(Object.freeze({ root, rootOrigin, event,
      eventOrigin: resolveStoredOpeningCapacityEventOrigin(initial.history, event.capacityReservationEventId), source }));
  }
  // A changed journal requires a new complete resolution; never combine different event generations.
  return repo.withDurableVerifiedHistory(async (history) => {
    const observedAt = getDurableOpeningCapacityEventObservedAt(history);
    if (history.generationHash !== initial.history.generationHash) throw new Error("selector capacity event generation changed during mandate resolution");
    if (Date.parse(observedAt) < Date.parse(lastObservedAt) || Date.now() < Date.parse(observedAt)) {
      throw new Error("selector capacity mandate observation clock moved backwards");
    }
    const assessment = Object.freeze({ verificationScope: "stored_selector_capacity_mandate_bindings_only" as const,
      portfolioId: input.portfolioId, bindingsHash: hashCanonicalPayload(bindings), verifiedBoundMandateCount: bindings.length,
      eventGenerationHash: history.generationHash, initialEventObservedAt: initial.observedAt, eventObservedAt: observedAt,
      unverifiedEventIds: Object.freeze(selected.filter((event) => !verifiedIds.has(event.capacityReservationEventId)).map((event) => event.capacityReservationEventId)),
      rootAllocationAuthority: "not_verified" as const, mandateActivationAuthority: "not_verified" as const,
      candidateEligibilityAndSizing: "not_verified" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
      sourceBeforeCreationReceipt: "not_recorded" as const, currentExecutionAuthority: "not_granted" as const });
    return Object.freeze({ bindings: Object.freeze(bindings), assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}

function scope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
