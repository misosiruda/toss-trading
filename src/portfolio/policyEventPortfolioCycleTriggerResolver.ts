import {
  parsePortfolioPolicyTriggerEvent,
  type PortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import {
  getVerifiedPortfolioPolicyTriggerEventRecords,
  type VerifiedPortfolioPolicyTriggerEventHistory
} from "./portfolioPolicyTriggerEventFiles.js";
import {
  parsePortfolioPolicyTriggerEvidenceRecord,
  type PortfolioPolicyTriggerEvidenceRecord
} from "./portfolioPolicyTriggerEvidence.js";
import {
  getVerifiedPortfolioPolicyTriggerEvidenceRecords,
  type VerifiedPortfolioPolicyTriggerEvidenceHistory
} from "./portfolioPolicyTriggerEvidenceFiles.js";
import {
  resolveCurrentInvestmentMandateAsOf,
  type InvestmentMandateState
} from "./investmentMandateState.js";
import {
  getVerifiedInvestmentMandateHistorySnapshot,
  type VerifiedInvestmentMandateHistory
} from "./investmentMandateFiles.js";
import {
  resolvePortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";

export interface ResolvedPolicyEventPortfolioCycleTrigger
  extends ResolvedPortfolioCycleTrigger {
  trigger: Extract<
    ResolvedPortfolioCycleTrigger["trigger"],
    { triggerKind: "policy_event" }
  >;
  policyTriggerEvent: PortfolioPolicyTriggerEvent;
  policyTriggerEvidenceRecords: readonly PortfolioPolicyTriggerEvidenceRecord[];
  activeMandate?: InvestmentMandateState;
}

/** Resolves a policy-event trigger against a complete immutable event history. */
export function resolvePolicyEventPortfolioCycleTrigger(input: {
  value: unknown;
  policyTriggerEventHistory: VerifiedPortfolioPolicyTriggerEventHistory;
  policyTriggerEvidenceHistory: VerifiedPortfolioPolicyTriggerEvidenceHistory;
  investmentMandateHistory?: VerifiedInvestmentMandateHistory;
  expectedPortfolioId: string;
  expectedPolicyHash: string;
}): ResolvedPolicyEventPortfolioCycleTrigger {
  const resolved = resolvePortfolioCycleTrigger(input.value);
  if (resolved.trigger.triggerKind !== "policy_event") {
    throw new Error(
      "policy-event trigger resolver requires a policy_event trigger"
    );
  }
  const trigger = resolved.trigger;
  const events = getVerifiedPortfolioPolicyTriggerEventRecords(
    input.policyTriggerEventHistory
  ).map((event) =>
    parsePortfolioPolicyTriggerEvent(event)
  );
  assertUniqueEventHistory(events);
  const matches = events.filter(
    (event) => event.policyTriggerEventId === trigger.policyTriggerEventId
  );
  if (matches.length !== 1) {
    throw new Error(
      `policy-event trigger event must resolve exactly once; resolved ${matches.length}`
    );
  }

  const policyTriggerEvent = matches[0] as PortfolioPolicyTriggerEvent;
  if (
    policyTriggerEvent.portfolioId !== input.expectedPortfolioId ||
    policyTriggerEvent.policyHash !== input.expectedPolicyHash
  ) {
    throw new Error("policy-event trigger source scope mismatch");
  }
  if (
    policyTriggerEvent.eventHash !== trigger.eventHash ||
    policyTriggerEvent.eventType !== trigger.eventType ||
    policyTriggerEvent.asOf !== trigger.eventAsOf
  ) {
    throw new Error("policy-event trigger does not match its immutable event");
  }
  const policyTriggerEvidenceRecords = resolveEventEvidence(
    policyTriggerEvent,
    input.policyTriggerEvidenceHistory
  );
  const activeMandate = resolveEventMandate(
    policyTriggerEvent,
    input.investmentMandateHistory
  );

  return deepFreeze({
    ...resolved,
    trigger,
    policyTriggerEvent,
    policyTriggerEvidenceRecords,
    ...(activeMandate === undefined ? {} : { activeMandate })
  });
}

function resolveEventMandate(
  event: PortfolioPolicyTriggerEvent,
  history: VerifiedInvestmentMandateHistory | undefined
): InvestmentMandateState | undefined {
  if (event.eventType === "regime_change") {
    if (history !== undefined) {
      throw new Error(
        "investment mandate history is allowed only for a thesis policy event"
      );
    }
    return undefined;
  }
  if (history === undefined) {
    throw new Error("thesis policy event requires investment mandate history");
  }
  const verifiedHistory = getVerifiedInvestmentMandateHistorySnapshot(history);
  return resolveCurrentInvestmentMandateAsOf({
    mandateId: event.mandateId,
    portfolioId: event.portfolioId,
    policyHash: event.policyHash,
    market: event.market,
    symbol: event.symbol,
    asOf: event.asOf,
    knownAt: event.createdAt,
    records: verifiedHistory.records,
    events: verifiedHistory.events
  });
}

function resolveEventEvidence(
  event: PortfolioPolicyTriggerEvent,
  history: VerifiedPortfolioPolicyTriggerEvidenceHistory
): readonly PortfolioPolicyTriggerEvidenceRecord[] {
  const records = getVerifiedPortfolioPolicyTriggerEvidenceRecords(history).map(
    (record) => parsePortfolioPolicyTriggerEvidenceRecord(record)
  );
  const recordsByRef = indexUniqueEvidenceHistory(records);
  return event.evidenceRefs.map((evidenceRef) => {
    const record = recordsByRef.get(evidenceRef);
    if (record === undefined) {
      throw new Error(
        "policy event evidence must resolve exactly once; resolved 0"
      );
    }
    assertEvidenceBinding(event, record);
    return record;
  });
}

function assertEvidenceBinding(
  event: PortfolioPolicyTriggerEvent,
  evidence: PortfolioPolicyTriggerEvidenceRecord
): void {
  if (
    evidence.portfolioId !== event.portfolioId ||
    evidence.policyHash !== event.policyHash ||
    evidence.market !== event.market
  ) {
    throw new Error("policy event evidence scope mismatch");
  }
  if (evidence.evidenceType !== event.eventType) {
    throw new Error("policy event evidence type mismatch");
  }
  if (Date.parse(evidence.observedAt) > Date.parse(event.asOf)) {
    throw new Error("policy event evidence observation postdates event cutoff");
  }
  if (Date.parse(evidence.createdAt) > Date.parse(event.createdAt)) {
    throw new Error("policy event evidence was created after its event");
  }
  if (event.eventType === "regime_change") {
    if (
      evidence.evidenceType !== "regime_change" ||
      evidence.previousRegime !== event.previousRegime ||
      evidence.currentRegime !== event.currentRegime
    ) {
      throw new Error("policy event regime evidence transition mismatch");
    }
    return;
  }
  if (
    evidence.evidenceType !== "thesis_evidence_change" ||
    evidence.mandateId !== event.mandateId ||
    evidence.symbol !== event.symbol ||
    evidence.previousThesisStatus !== event.previousThesisStatus ||
    evidence.currentThesisStatus !== event.currentThesisStatus
  ) {
    throw new Error("policy event thesis evidence transition mismatch");
  }
}

function assertUniqueEventHistory(
  events: readonly PortfolioPolicyTriggerEvent[]
): void {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const event of events) {
    if (ids.has(event.policyTriggerEventId)) {
      throw new Error("policy trigger event history contains a duplicate ID");
    }
    if (hashes.has(event.eventHash)) {
      throw new Error("policy trigger event history contains a duplicate hash");
    }
    ids.add(event.policyTriggerEventId);
    hashes.add(event.eventHash);
  }
}

function indexUniqueEvidenceHistory(
  records: readonly PortfolioPolicyTriggerEvidenceRecord[]
): ReadonlyMap<string, PortfolioPolicyTriggerEvidenceRecord> {
  const recordsByRef = new Map<
    string,
    PortfolioPolicyTriggerEvidenceRecord
  >();
  const hashes = new Set<string>();
  for (const record of records) {
    if (recordsByRef.has(record.evidenceRef)) {
      throw new Error("policy trigger evidence history contains a duplicate ref");
    }
    if (hashes.has(record.evidenceHash)) {
      throw new Error("policy trigger evidence history contains a duplicate hash");
    }
    recordsByRef.set(record.evidenceRef, record);
    hashes.add(record.evidenceHash);
  }
  return recordsByRef;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
