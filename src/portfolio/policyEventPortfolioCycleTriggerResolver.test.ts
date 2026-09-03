import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioPolicyTriggerEvent,
  type PortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import { parseVerifiedPortfolioPolicyTriggerEventHistory } from "./portfolioPolicyTriggerEventFiles.js";
import { resolvePolicyEventPortfolioCycleTrigger as resolvePolicyEventPortfolioCycleTriggerRaw } from "./policyEventPortfolioCycleTriggerResolver.js";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;

test("policy-event trigger resolves one exact immutable event", () => {
  const event = regimeEvent();
  const resolved = resolvePolicyEventPortfolioCycleTrigger({
    value: trigger(event),
    policyTriggerEventHistory: history(event)
  });

  assert.deepEqual(resolved.policyTriggerEvent, event);
  assert.equal(resolved.triggerIdentity, "event:regime_change");
  assert.equal(resolved.triggerRef, event.eventHash);
  assert.equal(resolved.evidenceCutoffAt, event.asOf);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.policyTriggerEvent), true);
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
}) {
  return resolvePolicyEventPortfolioCycleTriggerRaw({
    ...input,
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

function regimeEvent() {
  return createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["regime-a"],
    asOf: "2026-09-03T00:00:00.000Z",
    eventType: "regime_change",
    market: "KR",
    previousRegime: "sideways",
    currentRegime: "bear",
    createdAt: "2026-09-03T00:00:01.000Z"
  });
}

function thesisEvent() {
  return createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["thesis-a"],
    asOf: "2026-09-03T00:00:00.000Z",
    eventType: "thesis_evidence_change",
    mandateId: "mandate-1",
    market: "KR",
    symbol: "005930",
    previousThesisStatus: "intact",
    currentThesisStatus: "watch",
    createdAt: "2026-09-03T00:00:01.000Z"
  });
}
