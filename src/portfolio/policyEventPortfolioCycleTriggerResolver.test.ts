import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvestmentMandateEvent,
  createInvestmentMandateRecord,
  type InvestmentMandateEvent,
  type InvestmentMandateRecord
} from "./investmentMandate.js";
import {
  createPortfolioPolicyTriggerEvent,
  type CreatePortfolioPolicyTriggerEventInput,
  type PortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import { parseVerifiedPortfolioPolicyTriggerEventHistory } from "./portfolioPolicyTriggerEventFiles.js";
import {
  createPortfolioPolicyTriggerEvidenceRecord,
  type CreatePortfolioPolicyTriggerEvidenceRecordInput,
  type PortfolioPolicyTriggerEvidenceRecord
} from "./portfolioPolicyTriggerEvidence.js";
import { parseVerifiedPortfolioPolicyTriggerEvidenceHistory } from "./portfolioPolicyTriggerEvidenceFiles.js";
import { resolvePolicyEventPortfolioCycleTrigger as resolvePolicyEventPortfolioCycleTriggerRaw } from "./policyEventPortfolioCycleTriggerResolver.js";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;

test("policy-event trigger resolves one exact immutable event", () => {
  const event = regimeEvent();
  const resolved = resolvePolicyEventPortfolioCycleTrigger({
    value: trigger(event),
    policyTriggerEventHistory: history(event)
  });

  assert.deepEqual(resolved.policyTriggerEvent, event);
  assert.deepEqual(resolved.policyTriggerEvidenceRecords, [regimeEvidence()]);
  assert.equal(resolved.triggerIdentity, "event:regime_change");
  assert.equal(resolved.triggerRef, event.eventHash);
  assert.equal(resolved.evidenceCutoffAt, event.asOf);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.policyTriggerEvent), true);
  assert.equal(Object.isFrozen(resolved.policyTriggerEvidenceRecords), true);
});

test("policy-event trigger resolves every referenced evidence record in order", () => {
  const first = regimeEvidence({ sourceArtifactId: "regime-source-a" });
  const second = regimeEvidence({ sourceArtifactId: "regime-source-b" });
  const event = regimeEvent({
    evidenceRefs: [first.evidenceRef, second.evidenceRef]
  });
  const resolved = resolvePolicyEventPortfolioCycleTrigger({
    value: trigger(event),
    policyTriggerEventHistory: history(event),
    policyTriggerEvidenceHistory: evidenceHistory(second, first)
  });

  assert.deepEqual(
    resolved.policyTriggerEvidenceRecords.map((record) => record.evidenceRef),
    event.evidenceRefs
  );
});

test("policy-event trigger rejects missing and unverified evidence histories", () => {
  const evidence = regimeEvidence();
  const event = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEventHistory: history(event),
        policyTriggerEvidenceHistory: evidenceHistory()
      }),
    /resolved 0/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEventHistory: history(event),
        policyTriggerEvidenceHistory: { records: [evidence] } as never
      }),
    /history is not verified/
  );
});

test("policy-event trigger rejects evidence scope and type drift", () => {
  const drifts = [
    regimeEvidence({ portfolioId: "portfolio-2" }),
    regimeEvidence({ policyHash: `sha256:${"b".repeat(64)}` }),
    regimeEvidence({ market: "US" }),
    thesisEvidence()
  ];
  for (const evidence of drifts) {
    const event = regimeEvent({ evidenceRefs: [evidence.evidenceRef] });
    assert.throws(
      () =>
        resolvePolicyEventPortfolioCycleTrigger({
          value: trigger(event),
          policyTriggerEventHistory: history(event),
          policyTriggerEvidenceHistory: evidenceHistory(evidence)
        }),
      /scope mismatch|type mismatch/
    );
  }
});

test("policy-event trigger rejects transition and chronology drift", () => {
  const transition = regimeEvidence({ previousRegime: "bull" });
  const futureObservation = regimeEvidence({
    observedAt: "2026-09-03T00:00:00.750Z",
    createdAt: "2026-09-03T00:00:00.900Z"
  });
  const lateCreation = regimeEvidence({
    createdAt: "2026-09-03T00:00:02.000Z"
  });
  for (const [evidence, message] of [
    [transition, /transition mismatch/],
    [futureObservation, /observation postdates/],
    [lateCreation, /created after/]
  ] as const) {
    const event = regimeEvent({ evidenceRefs: [evidence.evidenceRef] });
    assert.throws(
      () =>
        resolvePolicyEventPortfolioCycleTrigger({
          value: trigger(event),
          policyTriggerEventHistory: history(event),
          policyTriggerEvidenceHistory: evidenceHistory(evidence)
        }),
      message
    );
  }
});

test("policy-event trigger exact-binds thesis evidence scope and transition", () => {
  const evidence = thesisEvidence();
  const event = thesisEvent();
  const mandate = thesisMandate();
  const activated = mandateEvent(mandate, {
    eventType: "activated",
    asOf: "2026-09-02T00:00:00.000Z",
    createdAt: "2026-09-02T00:00:01.000Z"
  });
  const resolved = resolvePolicyEventPortfolioCycleTrigger({
    value: trigger(event),
    policyTriggerEventHistory: history(event),
    policyTriggerEvidenceHistory: evidenceHistory(evidence),
    investmentMandateHistory: {
      records: [mandate],
      events: [activated]
    }
  });
  assert.deepEqual(resolved.policyTriggerEvidenceRecords, [evidence]);
  assert.equal(resolved.activeMandate?.record.mandateId, mandate.mandateId);
  assert.equal(resolved.activeMandate?.status, "active");

  const wrongMandate = thesisEvidence({ mandateId: "mandate-2" });
  const mismatchedEvent = thesisEvent({
    evidenceRefs: [wrongMandate.evidenceRef]
  });
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(mismatchedEvent),
        policyTriggerEventHistory: history(mismatchedEvent),
        policyTriggerEvidenceHistory: evidenceHistory(wrongMandate),
        investmentMandateHistory: {
          records: [mandate],
          events: [activated]
        }
      }),
    /thesis evidence transition mismatch/
  );
});

test("policy-event trigger requires mandate history only for thesis events", () => {
  const evidence = thesisEvidence();
  const thesis = thesisEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(thesis),
        policyTriggerEventHistory: history(thesis),
        policyTriggerEvidenceHistory: evidenceHistory(evidence)
      }),
    /requires investment mandate history/
  );

  const regime = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(regime),
        policyTriggerEventHistory: history(regime),
        policyTriggerEvidenceHistory: evidenceHistory(regimeEvidence()),
        investmentMandateHistory: { records: [], events: [] }
      }),
    /allowed only for a thesis policy event/
  );
});

test("policy-event trigger rejects missing and duplicate event IDs", () => {
  const event = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEventHistory: history()
      }),
    /resolved 0/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEventHistory: history(event, event)
      }),
    /duplicate ID/
  );
});

test("policy-event trigger rejects event hash, type, and cutoff drift", () => {
  const event = regimeEvent();
  const thesis = thesisEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: { ...trigger(event), eventHash: thesis.eventHash },
        policyTriggerEventHistory: history(event, thesis)
      }),
    /does not match/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: { ...trigger(event), eventType: "thesis_evidence_change" },
        policyTriggerEventHistory: history(event)
      }),
    /does not match/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: {
          ...trigger(event),
          eventAsOf: "2026-09-03T00:00:01.000Z"
        },
        policyTriggerEventHistory: history(event)
      }),
    /does not match/
  );
});

test("policy-event trigger rejects portfolio and policy scope drift", () => {
  const event = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTriggerRaw({
        value: trigger(event),
        policyTriggerEventHistory: history(event),
        policyTriggerEvidenceHistory: evidenceHistory(regimeEvidence()),
        expectedPortfolioId: "portfolio-2",
        expectedPolicyHash: POLICY_HASH
      }),
    /source scope mismatch/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTriggerRaw({
        value: trigger(event),
        policyTriggerEventHistory: history(event),
        policyTriggerEvidenceHistory: evidenceHistory(regimeEvidence()),
        expectedPortfolioId: event.portfolioId,
        expectedPolicyHash: `sha256:${"b".repeat(64)}`
      }),
    /source scope mismatch/
  );
});

test("policy-event trigger rejects corrupt unrelated complete history", () => {
  const event = regimeEvent();
  assert.throws(
    () =>
      parseVerifiedPortfolioPolicyTriggerEventHistory(
        `${JSON.stringify(event)}\n${JSON.stringify({
          ...thesisEvent(),
          eventHash: POLICY_HASH
        })}\n`
      ),
    /corrupt line 2/
  );
});

test("policy-event trigger rejects an unverified array wrapper", () => {
  const event = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEventHistory: {
          records: [event]
        } as never
      }),
    /history is not verified/
  );
});

test("policy-event trigger rejects other trigger variants", () => {
  const event = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: {
          triggerKind: "every_tick",
          packetHash: event.eventHash,
          packetAsOf: event.asOf
        },
        policyTriggerEventHistory: history(event)
      }),
    /requires a policy_event trigger/
  );
});

function trigger(event: PortfolioPolicyTriggerEvent) {
  return {
    triggerKind: "policy_event" as const,
    eventType: event.eventType,
    policyTriggerEventId: event.policyTriggerEventId,
    eventHash: event.eventHash,
    eventAsOf: event.asOf
  };
}

function resolvePolicyEventPortfolioCycleTrigger(input: {
  value: unknown;
  policyTriggerEventHistory: ReturnType<typeof history>;
  policyTriggerEvidenceHistory?: ReturnType<typeof evidenceHistory>;
  investmentMandateHistory?: {
    records: readonly InvestmentMandateRecord[];
    events: readonly InvestmentMandateEvent[];
  };
}) {
  return resolvePolicyEventPortfolioCycleTriggerRaw({
    ...input,
    policyTriggerEvidenceHistory:
      input.policyTriggerEvidenceHistory ?? evidenceHistory(regimeEvidence()),
    expectedPortfolioId: "portfolio-1",
    expectedPolicyHash: POLICY_HASH
  });
}

function history(...events: readonly PortfolioPolicyTriggerEvent[]) {
  return parseVerifiedPortfolioPolicyTriggerEventHistory(
    events.map((event) => JSON.stringify(event)).join("\n") +
      (events.length === 0 ? "" : "\n")
  );
}

function evidenceHistory(
  ...records: readonly PortfolioPolicyTriggerEvidenceRecord[]
) {
  return parseVerifiedPortfolioPolicyTriggerEvidenceHistory(
    records.map((record) => JSON.stringify(record)).join("\n") +
      (records.length === 0 ? "" : "\n")
  );
}

function regimeEvent(
  override: Partial<
    Omit<
      Extract<
        CreatePortfolioPolicyTriggerEventInput,
        { eventType: "regime_change" }
      >,
      "eventType"
    >
  > = {}
) {
  return createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: [regimeEvidence().evidenceRef],
    asOf: "2026-09-03T00:00:00.000Z",
    eventType: "regime_change",
    market: "KR",
    previousRegime: "sideways",
    currentRegime: "bear",
    createdAt: "2026-09-03T00:00:01.000Z",
    ...override
  });
}

function thesisEvent(
  override: Partial<
    Omit<
      Extract<
        CreatePortfolioPolicyTriggerEventInput,
        { eventType: "thesis_evidence_change" }
      >,
      "eventType"
    >
  > = {}
) {
  return createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: [thesisEvidence().evidenceRef],
    asOf: "2026-09-03T00:00:00.000Z",
    eventType: "thesis_evidence_change",
    mandateId: thesisMandate().mandateId,
    market: "KR",
    symbol: "005930",
    previousThesisStatus: "intact",
    currentThesisStatus: "watch",
    createdAt: "2026-09-03T00:00:01.000Z",
    ...override
  });
}

function regimeEvidence(
  override: Partial<
    Omit<
      Extract<
        CreatePortfolioPolicyTriggerEvidenceRecordInput,
        { evidenceType: "regime_change" }
      >,
      "evidenceType"
    >
  > = {}
) {
  return createPortfolioPolicyTriggerEvidenceRecord({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    market: "KR",
    evidenceType: "regime_change",
    sourceContractId: "market-regime-evidence.v1",
    sourceArtifactId: "regime-source-1",
    sourceArtifactHash: `sha256:${"c".repeat(64)}`,
    observedAt: "2026-09-03T00:00:00.000Z",
    previousRegime: "sideways",
    currentRegime: "bear",
    createdAt: "2026-09-03T00:00:00.500Z",
    ...override
  });
}

function thesisEvidence(
  override: Partial<
    Omit<
      Extract<
        CreatePortfolioPolicyTriggerEvidenceRecordInput,
        { evidenceType: "thesis_evidence_change" }
      >,
      "evidenceType"
    >
  > = {}
) {
  return createPortfolioPolicyTriggerEvidenceRecord({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    market: "KR",
    evidenceType: "thesis_evidence_change",
    sourceContractId: "thesis-evidence.v1",
    sourceArtifactId: "thesis-source-1",
    sourceArtifactHash: `sha256:${"d".repeat(64)}`,
    observedAt: "2026-09-03T00:00:00.000Z",
    mandateId: thesisMandate().mandateId,
    symbol: "005930",
    previousThesisStatus: "intact",
    currentThesisStatus: "watch",
    createdAt: "2026-09-03T00:00:00.500Z",
    ...override
  });
}

function thesisMandate(
  override: Partial<{
    policyHash: string;
    symbol: string;
    validFrom: string;
    expiresAt: string;
    createdAt: string;
  }> = {}
): InvestmentMandateRecord {
  return createInvestmentMandateRecord({
    portfolioId: "portfolio-1",
    market: "KR",
    symbol: override.symbol ?? "005930",
    bucket: "long_term",
    policyHash: override.policyHash ?? POLICY_HASH,
    asOf: "2026-09-01T00:00:00.000Z",
    targetWeightRatio: 0.2,
    minWeightRatio: 0.1,
    maxWeightRatio: 0.3,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: ["manual-classification"],
    evidenceRefs: ["classification-evidence"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    reviewCadence: {
      mode: "scheduled",
      boundaryRefs: [
        {
          scheduleBoundaryRecordId: "boundary-1",
          version: "v1",
          hash: `sha256:${"e".repeat(64)}`,
          lineageHash: `sha256:${"f".repeat(64)}`
        }
      ]
    },
    validFrom: override.validFrom ?? "2026-09-02T00:00:00.000Z",
    reviewAfter: "2026-09-04T00:00:00.000Z",
    expiresAt: override.expiresAt ?? "2026-09-05T00:00:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-assignment-1",
    createdAt: override.createdAt ?? "2026-09-01T00:00:01.000Z"
  });
}

function mandateEvent(
  mandate: InvestmentMandateRecord,
  transition:
    | {
        eventType: "activated";
        previousMandateEventId?: string;
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "review_required";
        previousMandateEventId: string;
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "retired";
        previousMandateEventId: string;
        asOf: string;
        createdAt: string;
      }
): InvestmentMandateEvent {
  return createInvestmentMandateEvent({
    mandateId: mandate.mandateId,
    mandateHash: mandate.mandateHash,
    portfolioId: mandate.portfolioId,
    market: mandate.market,
    symbol: mandate.symbol,
    bucket: mandate.bucket,
    policyHash: mandate.policyHash,
    reasonCodes: ["lifecycle"],
    ...transition
  });
}
