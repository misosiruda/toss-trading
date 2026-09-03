import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioPolicyTriggerEvent,
  parsePortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import { hashDerivedId } from "./runtimePolicyContracts.js";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;
const AS_OF = "2026-09-03T00:00:00.000Z";
const CREATED_AT = "2026-09-03T00:00:01.000Z";

test("policy trigger event creates canonical immutable regime change", () => {
  const event = createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["regime-b", "regime-a"],
    asOf: AS_OF,
    eventType: "regime_change",
    market: "KR",
    previousRegime: "sideways",
    currentRegime: "bear",
    createdAt: CREATED_AT
  });

  assert.deepEqual(event.evidenceRefs, ["regime-a", "regime-b"]);
  assert.equal(
    event.policyTriggerEventId,
    hashDerivedId("portfolio_policy_trigger_event", event.eventHash)
  );
  assert.deepEqual(parsePortfolioPolicyTriggerEvent(event), event);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.evidenceRefs), true);
});

test("policy trigger event supports a distinct thesis status transition", () => {
  const event = createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["thesis-a"],
    asOf: AS_OF,
    eventType: "thesis_evidence_change",
    mandateId: "mandate-1",
    market: "US",
    symbol: "AAPL",
    previousThesisStatus: "intact",
    currentThesisStatus: "watch",
    createdAt: CREATED_AT
  });

  assert.equal(event.eventType, "thesis_evidence_change");
  assert.deepEqual(parsePortfolioPolicyTriggerEvent(event), event);
});

test("policy trigger event identity ignores createdAt for exact semantic retry", () => {
  const first = regimeEvent();
  if (first.eventType !== "regime_change") {
    throw new Error("expected regime change fixture");
  }
  const retry = createPortfolioPolicyTriggerEvent({
    portfolioId: first.portfolioId,
    policyHash: first.policyHash,
    evidenceRefs: first.evidenceRefs,
    asOf: first.asOf,
    eventType: first.eventType,
    market: first.market,
    previousRegime: first.previousRegime,
    currentRegime: first.currentRegime,
    createdAt: "2026-09-03T00:00:02.000Z"
  });

  assert.equal(retry.eventHash, first.eventHash);
  assert.equal(retry.policyTriggerEventId, first.policyTriggerEventId);
  assert.notEqual(retry.createdAt, first.createdAt);
});

test("policy trigger event uses shared UTF-8 evidence ordering", () => {
  const event = createPortfolioPolicyTriggerEvent({
    ...regimeInput(),
    evidenceRefs: ["😀", "\uE000"]
  });

  assert.deepEqual(event.evidenceRefs, ["\uE000", "😀"]);
  assert.deepEqual(parsePortfolioPolicyTriggerEvent(event), event);
});

test("policy trigger event rejects no-op transitions and invalid chronology", () => {
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvent({
        ...regimeInput(),
        currentRegime: "sideways"
      }),
    /distinct regime values/
  );
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvent({
        ...thesisInput(),
        currentThesisStatus: "intact"
      }),
    /distinct thesis statuses/
  );
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvent({
        ...regimeInput(),
        createdAt: "2026-09-02T23:59:59.000Z"
      }),
    /cannot be created before asOf/
  );
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvent({
        ...regimeInput(),
        asOf: "2026-09-03T00:00:00"
      }),
    /date-time/
  );
});

test("policy trigger event rejects noncanonical evidence and stored tampering", () => {
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvent({
        ...regimeInput(),
        evidenceRefs: ["same", "same"]
      }),
    /must not contain duplicates/
  );
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvent({
        ...regimeInput(),
        evidenceRefs: []
      }),
    /too_small/
  );

  const event = regimeEvent();
  assert.throws(
    () =>
      parsePortfolioPolicyTriggerEvent({
        ...event,
        evidenceRefs: [...event.evidenceRefs].reverse()
      }),
    /canonical order/
  );
  assert.throws(
    () =>
      parsePortfolioPolicyTriggerEvent({
        ...event,
        currentRegime: "bull"
      }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      parsePortfolioPolicyTriggerEvent({
        ...event,
        policyTriggerEventId: "wrong"
      }),
    /identity does not match payload/
  );
  assert.throws(
    () => parsePortfolioPolicyTriggerEvent({ ...event, extra: true }),
    /unrecognized_keys/
  );
});

function regimeEvent() {
  return createPortfolioPolicyTriggerEvent(regimeInput());
}

function regimeInput() {
  return {
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["regime-a", "regime-b"],
    asOf: AS_OF,
    eventType: "regime_change" as const,
    market: "KR" as const,
    previousRegime: "sideways",
    currentRegime: "bear",
    createdAt: CREATED_AT
  };
}

function thesisInput() {
  return {
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["thesis-a"],
    asOf: AS_OF,
    eventType: "thesis_evidence_change" as const,
    mandateId: "mandate-1",
    market: "KR" as const,
    symbol: "005930",
    previousThesisStatus: "intact" as const,
    currentThesisStatus: "watch" as const,
    createdAt: CREATED_AT
  };
}
