import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation,
  type InvestmentMandateFileRepositoryOptions } from "./investmentMandateFiles.js";
import { resolveManualOpeningCapacityMandateBinding } from "./manualOpeningCapacityReservation.js";
import { openingCapacityReservationEventPayloadSchema } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredManualOpeningCapacityEventOrigins } from "./storedManualOpeningCapacityEventOrigins.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

/** Historical manual reservation -> bound mandate content binding, not activation/current allocation authority. */
export async function resolveStoredManualOpeningCapacityMandateOrigins(value: z.input<typeof inputSchema>,
  options: InvestmentMandateFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("manual capacity mandate input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const manualRoots = await resolveStoredManualOpeningCapacityEventOrigins({ baseDir, portfolioId: input.portfolioId }, lockOptions);
  const mandates = await new InvestmentMandateFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) =>
    ({ records: history.records, observation: getDurableInvestmentMandateObservation(history) }));
  const byMandateId = new Map(mandates.records.map((record) => [record.mandateId, record]));
  const byReservationScope = new Map(manualRoots.bindings.map((binding) => [reservationScope(binding.event), binding]));
  // Re-read the journal after all source observations. A changed generation requires a fresh resolution, not partial reuse.
  return new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const observedAt = getDurableOpeningCapacityEventObservedAt(history);
    if (history.generationHash !== manualRoots.assessment.eventGenerationHash) throw new Error("manual capacity event generation changed during mandate resolution");
    if (Date.parse(mandates.observation.observedAt) < Date.parse(manualRoots.assessment.eventObservedAt) ||
      Date.parse(observedAt) < Date.parse(mandates.observation.observedAt) || Date.now() < Date.parse(observedAt)) {
      throw new Error("manual capacity mandate observation clock moved backwards");
    }
    const verifiedIds = new Set(manualRoots.bindings.map((binding) => binding.event.capacityReservationEventId));
    const selected = history.events.filter((event) => event.portfolioId === input.portfolioId);
    const bindings = selected.filter((event) => event.eventType === "bound_to_mandate" && byReservationScope.has(reservationScope(event))).map((event) => {
      if (event.eventType !== "bound_to_mandate") throw new Error("manual capacity mandate binding event is invalid");
      const root = byReservationScope.get(reservationScope(event))!;
      const mandate = byMandateId.get(event.mandateId);
      if (!mandate || mandate.mandateHash !== event.mandateHash) throw new Error("manual capacity bound mandate source is missing or differs");
      const binding = resolveManualOpeningCapacityMandateBinding({ reservation: root.reservation, manualAssignmentEvent: root.manualAssignmentEvent, mandate });
      if (Date.parse(mandate.createdAt) > Date.parse(event.asOf)) throw new Error("manual capacity bound mandate was created after its evaluation");
      verifiedIds.add(event.capacityReservationEventId);
      return Object.freeze({ root, event, mandate: binding.mandate,
        eventOrigin: resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId) });
    });
    const unverifiedEventIds = Object.freeze(selected.filter((event) => !verifiedIds.has(event.capacityReservationEventId)).map((event) => event.capacityReservationEventId));
    const assessment = Object.freeze({ verificationScope: "stored_manual_capacity_mandate_bindings_only" as const,
      portfolioId: input.portfolioId, manualRootAssessmentHash: manualRoots.assessmentHash, bindingsHash: hashCanonicalPayload(bindings),
      verifiedBoundMandateCount: bindings.length, mandateObservation: mandates.observation,
      eventGenerationHash: history.generationHash, eventObservedAt: observedAt, unverifiedEventIds,
      mandateActivationAuthority: "not_verified" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
      mandateAvailabilityAtBinding: "not_proven" as const, sourceBeforeCreationReceipt: "not_recorded" as const,
      currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
    return Object.freeze({ manualRoots, bindings: Object.freeze(bindings), assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}

function reservationScope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
