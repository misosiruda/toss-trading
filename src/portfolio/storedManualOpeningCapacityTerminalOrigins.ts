import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation,
  type InvestmentMandateFileRepositoryOptions } from "./investmentMandateFiles.js";
import { openingCapacityReservationEventPayloadSchema } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredManualOpeningCapacityFillOrigins } from "./storedManualOpeningCapacityFillOrigins.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

/** Historical retirement/release binding, not cancellation authorization, current capacity or an atomic release writer. */
export async function resolveStoredManualOpeningCapacityTerminalOrigins(value: z.input<typeof inputSchema>,
  options: InvestmentMandateFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("manual capacity terminal input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const fills = await resolveStoredManualOpeningCapacityFillOrigins({ baseDir, portfolioId: input.portfolioId }, lockOptions);
  const byReservation = new Map(fills.mandates.bindings.map((binding) => [reservationScope(binding.event), binding]));
  return new InvestmentMandateFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (mandates) => {
    const mandateObservation = getDurableInvestmentMandateObservation(mandates);
    const byMandate = new Map(mandates.states.map((state) => [state.record.mandateId, state]));
    const byEvent = new Map(mandates.events.map((event) => [event.mandateEventId, event]));
    return new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
      const observedAt = getDurableOpeningCapacityEventObservedAt(history);
      if (history.generationHash !== fills.assessment.eventGenerationHash) throw new Error("capacity generation changed during terminal resolution");
      if (Date.parse(mandateObservation.observedAt) < Date.parse(fills.assessment.eventObservedAt) ||
        Date.parse(observedAt) < Date.parse(mandateObservation.observedAt) || Date.now() < Date.parse(observedAt)) {
        throw new Error("capacity terminal observation clock moved backwards");
      }
      const verifiedIds = new Set<string>();
      const bindings = history.events.filter((event) => event.portfolioId === input.portfolioId && event.eventType === "released" &&
        event.releaseOrigin.originKind === "mandate_terminal" && byReservation.has(reservationScope(event))).map((event) => {
        if (event.eventType !== "released" || event.releaseOrigin.originKind !== "mandate_terminal") throw new Error("invalid terminal capacity event");
        const mandateBinding = byReservation.get(reservationScope(event))!;
        const source = event.releaseOrigin;
        const terminal = byEvent.get(source.mandateEventId), state = byMandate.get(source.mandateId);
        if (!terminal || !state || terminal.eventType !== "retired" || state.status !== "retired" ||
          terminal.mandateEventHash !== source.mandateEventHash || terminal.mandateId !== source.mandateId || terminal.mandateHash !== source.mandateHash ||
          state.currentEvent?.mandateEventId !== terminal.mandateEventId || !isDeepStrictEqual(state.record, mandateBinding.mandate)) {
          throw new Error("capacity release lacks its actual retired mandate event");
        }
        const predecessorOrigin = resolveStoredOpeningCapacityEventOrigin(history, event.previousCapacityReservationEventId);
        if (Date.parse(terminal.asOf) > Date.parse(event.asOf) || Date.parse(terminal.createdAt) > Date.parse(event.asOf) ||
          Date.parse(predecessorOrigin.committedAt) >= Date.parse(event.asOf)) throw new Error("capacity release source chronology mismatch");
        verifiedIds.add(event.capacityReservationEventId);
        return Object.freeze({ event, mandateBinding, terminalEvent: terminal, releasedNotionalKrw: predecessorOrigin.event.remainingReservedNotionalKrw,
          predecessorOrigin, eventOrigin: resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId) });
      });
      const assessment = Object.freeze({ verificationScope: "stored_manual_capacity_retirement_origins_only" as const,
        portfolioId: input.portfolioId, fillAssessmentHash: fills.assessmentHash, bindingsHash: hashCanonicalPayload(bindings),
        verifiedRetirementReleaseCount: bindings.length, mandateObservation, eventGenerationHash: history.generationHash, eventObservedAt: observedAt,
        unverifiedEventIds: Object.freeze(fills.assessment.unverifiedEventIds.filter((id) => !verifiedIds.has(id))),
        retirementAvailabilityBeforeRelease: "not_proven" as const, sourceBeforeCreationReceipt: "not_recorded" as const,
        requestCancellationAuthority: "not_verified" as const, targetCompletionAuthority: "not_verified" as const,
        accountingAndResultingPositionAuthority: "not_verified" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
        currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
      return Object.freeze({ fills, bindings: Object.freeze(bindings), assessment, assessmentHash: hashCanonicalPayload(assessment) });
    });
  });
}

function reservationScope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
