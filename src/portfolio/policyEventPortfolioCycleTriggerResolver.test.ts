import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioPolicyTriggerEvent,
  type PortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import { resolvePolicyEventPortfolioCycleTrigger } from "./policyEventPortfolioCycleTriggerResolver.js";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;

test("policy-event trigger resolves one exact immutable event", () => {
  const event = regimeEvent();
  const resolved = resolvePolicyEventPortfolioCycleTrigger({
    value: trigger(event),
    policyTriggerEvents: [event]
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
        policyTriggerEvents: []
      }),
    /resolved 0/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEvents: [event, event]
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
        policyTriggerEvents: [event, thesis]
      }),
    /does not match/
  );
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: { ...trigger(event), eventType: "thesis_evidence_change" },
        policyTriggerEvents: [event]
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
        policyTriggerEvents: [event]
      }),
    /does not match/
  );
});

test("policy-event trigger rejects corrupt unrelated history", () => {
  const event = regimeEvent();
  assert.throws(
    () =>
      resolvePolicyEventPortfolioCycleTrigger({
        value: trigger(event),
        policyTriggerEvents: [event, { ...thesisEvent(), eventHash: POLICY_HASH }]
      }),
    /identity does not match payload/
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
        policyTriggerEvents: [event]
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
