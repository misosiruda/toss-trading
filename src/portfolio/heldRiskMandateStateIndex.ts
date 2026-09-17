import { isDeepStrictEqual } from "node:util";
import { getDurableInvestmentMandateObservation, investmentMandateObservationSchema,
  type VerifiedInvestmentMandateHistory, type InvestmentMandateObservation } from "./investmentMandateFiles.js";
import type { InvestmentMandateState } from "./investmentMandateState.js";
import type { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { hashCanonicalArrayPrefixes } from "./runtimePolicyContracts.js";

/** One actual, already fully validated durable generation; no caller-supplied prevalidated state or escaping lease.
 * Indexing is linear in source bytes. Queries use prefix hashes and instrument timeline binary searches.
 */
export function createHeldRiskMandateStateResolver(history: VerifiedInvestmentMandateHistory) {
  const observation = getDurableInvestmentMandateObservation(history);
  const records = new Map(history.records.map((record, index) => [record.mandateId, { record, index }]));
  const recordHashes = hashCanonicalArrayPrefixes(history.records), eventHashes = hashCanonicalArrayPrefixes(history.events);
  const recordCreated = prefixMaximum(history.records.map((record) => Date.parse(record.createdAt)));
  const eventCreated = prefixMaximum(history.events.map((event) => Date.parse(event.createdAt)));
  if (Math.max(recordCreated.at(-1)!, eventCreated.at(-1)!) > Date.parse(observation.observedAt)) {
    throw new Error("capacity consumption mandate source creation follows its observation");
  }
  const dependencies = prefixMaximum(history.events.map((event) => Math.max(records.get(event.mandateId)!.index + 1,
    event.eventType === "retired" && event.supersededByMandateId !== undefined ? records.get(event.supersededByMandateId)!.index + 1 : 0)), 0);
  type IndexedEvent = { event: VerifiedInvestmentMandateHistory["events"][number]; index: number; availableAt: number };
  const instruments = new Map<string, IndexedEvent[]>(), mandateEvents = new Map<string, IndexedEvent[]>();
  history.events.forEach((event, index) => {
    const item = { event, index, availableAt: Math.max(Date.parse(event.asOf), Date.parse(event.createdAt)) };
    const key = scope(event), timeline = instruments.get(key) ?? [], own = mandateEvents.get(event.mandateId) ?? [];
    timeline.push(item); own.push(item); instruments.set(key, timeline); mandateEvents.set(event.mandateId, own);
  });
  const cache = new Map<string, InvestmentMandateState>();
  return (binding: ReturnType<typeof validateRiskDecisionPlanState>, receipt?: InvestmentMandateObservation): InvestmentMandateState => {
    // Recheck on every call, including cache hits. A resolver retained after callback exit is invalid.
    getDurableInvestmentMandateObservation(history);
    const selected = receipt === undefined ? observation : investmentMandateObservationSchema.parse(receipt);
    if (receipt !== undefined && !isDeepStrictEqual(selected, receipt)) throw new Error("mandate receipt must already be canonical");
    if (Date.parse(selected.observedAt) > Date.parse(observation.observedAt)) throw new Error("investment mandate observation clock moved backwards");
    const { recordCount, eventCount } = selected;
    if (recordHashes[recordCount] !== selected.recordsHash || eventHashes[eventCount] !== selected.eventsHash) {
      throw new Error("investment mandate observation does not match durable source prefixes");
    }
    // A valid full history's prefix is valid only if every referenced record/successor is also in the record prefix.
    if (dependencies[eventCount]! > recordCount) throw new Error("investment mandate prefix references an unknown mandate or successor");
    if (Math.max(recordCreated[recordCount]!, eventCreated[eventCount]!) > Date.parse(selected.observedAt)) {
      throw new Error("capacity consumption Risk mandate receipt predates source creation");
    }
    const { decision, action } = binding;
    if (action.lineageKind !== "mandate" || decision.riskRuleScope.scopeKind !== "bucket") {
      throw new Error("mandate-bound risk decision requires a mandate action and bucket scope");
    }
    const cutoff = Date.parse(decision.decidedAt), origin = records.get(action.mandateId);
    const key = JSON.stringify([action.mandateId, cutoff, recordCount, eventCount]);
    let state = cache.get(key);
    if (state === undefined) {
      const timeline = origin === undefined ? [] : instruments.get(scope(origin.record)) ?? [];
      const end = upperBound(timeline, (item) => item.index < eventCount);
      const position = upperBound(timeline, (item) => item.availableAt <= cutoff, end) - 1;
      const current = timeline[position]?.event;
      if (origin === undefined || origin.index >= recordCount || Date.parse(origin.record.createdAt) > cutoff ||
        current === undefined || current.mandateId !== action.mandateId || current.eventType === "retired" ||
        Date.parse(origin.record.validFrom) > cutoff || (origin.record.expiresAt !== undefined && cutoff >= Date.parse(origin.record.expiresAt))) {
        throw new Error("exactly one active investment mandate is required at the event cutoff");
      }
      state = Object.freeze({ record: origin.record, status: current.eventType === "activated" ? "active" : "review_required",
        currentEvent: current, events: Object.freeze((mandateEvents.get(action.mandateId) ?? [])
          .filter((item) => item.index < eventCount && item.availableAt <= cutoff).map((item) => item.event)) });
      cache.set(key, state);
    }
    const record = state.record;
    if (record.portfolioId !== decision.portfolioId || record.policyHash !== decision.policyHash || record.market !== decision.market || record.symbol !== decision.symbol) {
      throw new Error("exactly one active investment mandate is required at the event cutoff");
    }
    if (record.bucket !== decision.riskRuleScope.bucket) throw new Error("risk decision mandate bucket or current event mismatch");
    if (decision.decision === "approved" && decision.side === "BUY" && (state.status !== "active" ||
      (record.assignmentSource === "manual_policy" && record.manualAuthorizationScope === "classify_existing_reduce_only"))) {
      throw new Error("risk BUY approval requires an active open-or-increase mandate");
    }
    return state;
  };
}

function prefixMaximum(values: readonly number[], initial = Number.NEGATIVE_INFINITY) {
  const result = [initial];
  for (const value of values) result.push(Math.max(result.at(-1)!, value));
  return result;
}
function upperBound<T>(values: readonly T[], included: (value: T) => boolean, end = values.length) {
  let low = 0, high = end;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (included(values[middle]!)) low = middle + 1; else high = middle; }
  return low;
}
function scope(value: { portfolioId: string; market: string; symbol: string }) {
  return JSON.stringify([value.portfolioId, value.market, value.symbol]);
}
