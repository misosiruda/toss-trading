import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type InvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation, type InvestmentMandateObservation } from "./investmentMandateFiles.js";
import { resolveCurrentInvestmentMandateAsOf } from "./investmentMandateState.js";
import { type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin, type VerifiedOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { type PortfolioSizingSnapshotFileRepositoryOptions } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredManualOpeningCapacityTerminalOrigins, resolveStoredSelectorOpeningCapacityTerminalOrigins } from "./storedOpeningCapacityTerminalOrigins.js";
import { resolveStoredSnapshotPendingExecutionOrigins } from "./storedSnapshotPendingExecutionOrigins.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioSnapshotId: portfolioSizingSnapshotSchema.shape.portfolioSnapshotId }).strict();
type Reservation = Readonly<{ sourceKind: "manual" | "selector"; root: OpeningCapacityReservationEvent;
  rootOrigin: VerifiedOpeningCapacityEventOrigin; bound: OpeningCapacityReservationEvent;
  boundOrigin: VerifiedOpeningCapacityEventOrigin; mandate: InvestmentMandateRecord; sourceAssessmentHash: string }>;

/** Actual pending BUY/reservation membership and gross coverage, not current allocation or execution authority. */
export async function resolveStoredSnapshotPendingReservationOrigins(value: z.input<typeof inputSchema>,
  options: PortfolioSizingSnapshotFileRepositoryOptions = {}) {
  const parsed = inputSchema.parse(value);
  if (!isDeepStrictEqual(parsed, value)) throw new Error("snapshot pending reservation input must already be canonical");
  const baseDir = resolve(parsed.baseDir), lockOptions = { ...options };
  const pending = await resolveStoredSnapshotPendingExecutionOrigins({ baseDir, portfolioSnapshotId: parsed.portfolioSnapshotId }, lockOptions);
  const snapshot = pending.pending.snapshot;
  const query = { baseDir, portfolioId: snapshot.portfolioId };
  const manual = await resolveStoredManualOpeningCapacityTerminalOrigins(query, lockOptions);
  const selector = await resolveStoredSelectorOpeningCapacityTerminalOrigins(query, lockOptions);
  const mandateGenerationHash = mandateGeneration(selector.assessment.mandateObservation);
  for (const observation of [manual.fills.assessment.mandateObservation, manual.assessment.mandateObservation,
    selector.fills.assessment.mandateObservation]) {
    if (mandateGeneration(observation) !== mandateGenerationHash) throw new Error("snapshot pending reservation mandate generation changed");
  }
  if (manual.assessment.eventGenerationHash !== selector.assessment.eventGenerationHash ||
    manual.fills.assessment.planGenerationHash !== pending.pending.planReplay.assessment.sourceGenerationHash ||
    selector.fills.assessment.planGenerationHash !== pending.pending.planReplay.assessment.sourceGenerationHash) {
    throw new Error("snapshot pending reservation source generation changed");
  }
  if (Date.parse(manual.assessment.eventObservedAt) < Date.parse(pending.assessment.priceObservation.observedAt) ||
    Date.parse(selector.assessment.eventObservedAt) < Date.parse(manual.assessment.eventObservedAt)) {
    throw new Error("snapshot pending reservation observation clock moved backwards");
  }
  const reservations: Reservation[] = [
    ...manual.fills.mandates.bindings.map((binding) => Object.freeze({ sourceKind: "manual" as const,
      root: binding.root.event, rootOrigin: binding.root.eventOrigin, bound: binding.event, boundOrigin: binding.eventOrigin,
      mandate: binding.mandate, sourceAssessmentHash: manual.assessmentHash })),
    ...selector.fills.mandates.bindings.map((binding) => Object.freeze({ sourceKind: "selector" as const,
      root: binding.root, rootOrigin: binding.rootOrigin, bound: binding.event, boundOrigin: binding.eventOrigin,
      mandate: binding.mandate, sourceAssessmentHash: selector.assessmentHash }))
  ];
  const byMandate = new Map(reservations.map((item) => [item.mandate.mandateId, item]));
  if (byMandate.size !== reservations.length) throw new Error("snapshot pending reservation repeats a mandate binding");
  const consumption = [...manual.fills.bindings, ...selector.fills.bindings];
  const byFill = new Map(consumption.map((item) => [item.fillOrigin.record.paperFillRecordId, item]));
  if (byFill.size !== consumption.length) throw new Error("snapshot pending reservation repeats a fill source");
  const byPlan = new Map(pending.pending.planReplay.projection.planReplays.map((item) => [item.calculation.input.plan.planId, item.calculation.input.plan]));
  const priorExecutions = new Map<string, typeof pending.executionBindings[number][]>();
  for (const execution of pending.executionBindings) {
    const key = actionKey(execution.event.planId, execution.event.actionId);
    const group = priorExecutions.get(key) ?? []; group.push(execution); priorExecutions.set(key, group);
  }
  return new InvestmentMandateFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (mandates) => {
    const mandateObservation = getDurableInvestmentMandateObservation(mandates);
    if (mandateGeneration(mandateObservation) !== mandateGenerationHash) throw new Error("snapshot pending reservation mandate generation changed");
    if (Date.parse(mandateObservation.observedAt) < Date.parse(selector.assessment.eventObservedAt)) {
      throw new Error("snapshot pending reservation observation clock moved backwards");
    }
    // Complete repository validation already checked cross-record invariants; replay each instrument group only once per cutoff/mandate.
    const recordsByInstrument = new Map<string, typeof mandates.records[number][]>();
    const eventsByInstrument = new Map<string, typeof mandates.events[number][]>();
    const recordById = new Map(mandates.records.map((record) => [record.mandateId, record]));
    for (const record of mandates.records) {
      const key = instrumentKey(record), group = recordsByInstrument.get(key) ?? [];
      group.push(record); recordsByInstrument.set(key, group);
    }
    for (const event of mandates.events) {
      const key = instrumentKey(recordById.get(event.mandateId)!), group = eventsByInstrument.get(key) ?? [];
      group.push(event); eventsByInstrument.set(key, group);
    }
    const mandateStates = new Map<string, ReturnType<typeof resolveCurrentInvestmentMandateAsOf>>();
    return new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
      const observedAt = getDurableOpeningCapacityEventObservedAt(history);
      if (history.generationHash !== selector.assessment.eventGenerationHash) throw new Error("snapshot pending reservation capacity generation changed");
      if (Date.parse(observedAt) < Date.parse(mandateObservation.observedAt) || Date.now() < Date.parse(observedAt)) {
        throw new Error("snapshot pending reservation observation clock moved backwards");
      }
      const cutoff = Date.parse(snapshot.asOf), heads = new Map<string, VerifiedOpeningCapacityEventOrigin>();
      for (const event of history.events) {
        if (event.portfolioId !== snapshot.portfolioId) continue;
        const origin = resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId);
        if (Date.parse(origin.committedAt) === cutoff) throw new Error("snapshot pending reservation commit is ambiguous at cutoff");
        if (Date.parse(origin.committedAt) < cutoff && Date.parse(event.asOf) <= cutoff && Date.parse(event.createdAt) <= cutoff) heads.set(scope(event), origin);
      }
      const totals = new Map<string, bigint>();
      const bindings = pending.pending.bindings.filter((item) => item.pending.side === "BUY").map((item) => {
        const action = item.remaining.action, input = item.pending;
        if (input.side !== "BUY" || action.lineageKind !== "mandate") throw new Error("pending BUY requires a mandate reservation");
        const reservation = byMandate.get(action.mandateId), plan = byPlan.get(input.planId)!;
        if (!reservation || reservation.mandate.portfolioId !== snapshot.portfolioId || reservation.mandate.policyHash !== plan.policyHash ||
          reservation.mandate.market !== input.market || reservation.mandate.symbol !== input.symbol ||
          reservation.root.reservationId !== input.openingCapacityReservationId || reservation.root.reservationHash !== input.openingCapacityReservationHash) {
          throw new Error("snapshot pending BUY reservation or mandate lineage mismatch");
        }
        const key = scope(reservation.bound), head = heads.get(key);
        if (!head || head.event.eventType === "reserved" || head.event.eventType === "released" || head.event.remainingReservedNotionalKrw === 0 ||
          Date.parse(reservation.boundOrigin.committedAt) >= cutoff) throw new Error("snapshot pending BUY lacks an available bound reservation at cutoff");
        const stateKey = JSON.stringify([action.mandateId, snapshot.asOf]);
        let mandateState = mandateStates.get(stateKey);
        if (!mandateState) {
          const records = recordsByInstrument.get(instrumentKey(reservation.mandate)) ?? [];
          mandateState = resolveCurrentInvestmentMandateAsOf({ mandateId: action.mandateId, portfolioId: snapshot.portfolioId,
            policyHash: plan.policyHash, market: input.market, symbol: input.symbol, asOf: snapshot.asOf, knownAt: snapshot.asOf,
            records, events: eventsByInstrument.get(instrumentKey(reservation.mandate)) ?? [] });
          mandateStates.set(stateKey, mandateState);
        }
        if (mandateState.status !== "active" || !isDeepStrictEqual(mandateState.record, reservation.mandate)) {
          throw new Error("snapshot pending BUY requires an active opening mandate at cutoff");
        }
        const consumedOrigins = (priorExecutions.get(actionKey(input.planId, input.actionId)) ?? []).map((execution) => {
          const consumed = byFill.get(execution.paperFill.paperFillRecordId);
          if (!consumed || scope(consumed.event) !== key || consumed.event.capacityLedgerVersion > head.event.capacityLedgerVersion ||
            consumed.event.paperFillHash !== execution.paperFill.paperFillHash || Date.parse(consumed.eventOrigin.committedAt) >= cutoff) {
            throw new Error("snapshot pending BUY prior execution lacks its actual reservation consumption");
          }
          return consumed.eventOrigin;
        });
        const aggregate = (totals.get(key) ?? 0n) + BigInt(input.remainingNotionalKrw);
        if (aggregate > BigInt(head.event.remainingReservedNotionalKrw)) throw new Error("snapshot pending BUY exceeds remaining reservation gross");
        totals.set(key, aggregate);
        return Object.freeze({ pending: input, reservation, headOrigin: head, mandateState,
          priorConsumptionOrigins: Object.freeze(consumedOrigins) });
      });
      const reservedGroups = Object.freeze([...totals].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, total]) => Object.freeze({ reservationScope: key, pendingNotionalKrw: Number(total),
          remainingReservedNotionalKrw: heads.get(key)!.event.remainingReservedNotionalKrw })));
      const selectorUnverified = new Set(selector.assessment.unverifiedEventIds);
      const assessment = Object.freeze({ verificationScope: "stored_snapshot_pending_reservation_bindings_only" as const,
        portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
        pendingAssessmentHash: pending.assessmentHash, manualAssessmentHash: manual.assessmentHash, selectorAssessmentHash: selector.assessmentHash,
        bindingsHash: hashCanonicalPayload(bindings), reservationTotalsHash: hashCanonicalPayload(reservedGroups), verifiedPendingBuyCount: bindings.length,
        eventGenerationHash: history.generationHash, eventObservedAt: observedAt, mandateObservation,
        unverifiedCapacityEventIds: Object.freeze(manual.assessment.unverifiedEventIds.filter((id) => selectorUnverified.has(id))),
        rootAllocationAuthority: "not_verified" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
        accountingAndResultingStateAuthority: "not_verified" as const, riskPolicyAndRuleAuthority: "not_verified" as const,
        priceFreshnessAndTrust: "not_evaluated" as const, historicalDiskAvailability: "not_proven" as const,
        currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
      return Object.freeze({ pending, manual, selector, bindings: Object.freeze(bindings), reservationTotals: reservedGroups,
        assessment, assessmentHash: hashCanonicalPayload(assessment) });
    });
  });
}

function actionKey(planId: string, actionId: string) { return JSON.stringify([planId, actionId]); }
function scope(event: OpeningCapacityReservationEvent) { return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]); }
function instrumentKey(record: InvestmentMandateRecord) { return JSON.stringify([record.portfolioId, record.market, record.symbol]); }
function mandateGeneration(observation: InvestmentMandateObservation) {
  const { observedAt: _observedAt, ...generation } = observation;
  return hashCanonicalPayload(generation);
}
