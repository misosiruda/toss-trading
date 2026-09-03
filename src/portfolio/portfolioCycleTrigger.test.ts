import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePortfolioCycleTrigger,
  resolvePortfolioCycleTrigger,
  type PortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const AS_OF = "2026-09-02T00:00:00.000Z";

test("scheduled trigger derives boundary identity, slot ref, and slot cutoff", () => {
  const trigger = scheduledTrigger();
  const resolved = resolvePortfolioCycleTrigger(trigger);

  assert.deepEqual(resolved.trigger, trigger);
  assert.equal(resolved.triggerIdentity, `scheduled:${HASH_A}`);
  assert.equal(resolved.triggerRef, "KR:2026-09-02:daily:15:30");
  assert.equal(resolved.evidenceCutoffAt, AS_OF);
  assert.equal(resolved.triggerPayloadHash, hashCanonicalPayload(trigger));
  assert.equal(Object.isFrozen(resolved), true);
});

test("every-tick trigger derives packet hash and as-of", () => {
  const trigger = {
    triggerKind: "every_tick" as const,
    packetHash: HASH_B,
    packetAsOf: AS_OF
  };
  const resolved = resolvePortfolioCycleTrigger(trigger);

  assert.equal(resolved.triggerIdentity, "every_tick");
  assert.equal(resolved.triggerRef, HASH_B);
  assert.equal(resolved.evidenceCutoffAt, AS_OF);
});

test("policy-event trigger derives declared event identity and evidence", () => {
  const trigger = {
    triggerKind: "policy_event" as const,
    eventType: "thesis_evidence_change" as const,
    policyTriggerEventId: "policy-trigger-event-1",
    eventHash: HASH_A,
    eventAsOf: AS_OF
  };
  const resolved = resolvePortfolioCycleTrigger(trigger);

  assert.equal(resolved.triggerIdentity, "event:thesis_evidence_change");
  assert.equal(resolved.triggerRef, HASH_A);
  assert.equal(resolved.evidenceCutoffAt, AS_OF);
});

test("risk-breach trigger derives update-kind identity and state update evidence", () => {
  const trigger = {
    triggerKind: "risk_breach" as const,
    stateUpdateKind: "risk_state" as const,
    riskStateUpdateRecordId: "risk-state-update-1",
    stateUpdateHash: HASH_B,
    stateUpdateAsOf: AS_OF
  };
  const resolved = resolvePortfolioCycleTrigger(trigger);

  assert.equal(resolved.triggerIdentity, "risk_breach:risk_state");
  assert.equal(resolved.triggerRef, HASH_B);
  assert.equal(resolved.evidenceCutoffAt, AS_OF);
});

test("cycle trigger rejects unknown fields, noncanonical IDs, and malformed variants", () => {
  assert.throws(() =>
    parsePortfolioCycleTrigger({ ...scheduledTrigger(), extra: true })
  );
  assert.throws(
    () =>
      parsePortfolioCycleTrigger({
        ...scheduledTrigger(),
        scheduleSlotId: " slot-1 "
      }),
    /already be canonical/
  );
  assert.throws(
    () =>
      parsePortfolioCycleTrigger({
        ...scheduledTrigger(),
        scheduleSlotId: `slot-${String.fromCharCode(0xd800)}`
      }),
    /well-formed Unicode/
  );
  assert.throws(() =>
    parsePortfolioCycleTrigger({
      triggerKind: "every_tick",
      packetHash: "not-a-hash",
      packetAsOf: AS_OF
    })
  );
  assert.throws(() =>
    parsePortfolioCycleTrigger({
      triggerKind: "policy_event",
      eventType: "risk_breach",
      policyTriggerEventId: "event-1",
      eventHash: HASH_A,
      eventAsOf: AS_OF
    })
  );
  assert.throws(
    () =>
      parsePortfolioCycleTrigger({
        ...scheduledTrigger(),
        slotEndsAt: "2026-09-02T00:00:00"
      }),
    /timezone offset/
  );
});

function scheduledTrigger(): Extract<
  PortfolioCycleTrigger,
  { triggerKind: "scheduled" }
> {
  return {
    triggerKind: "scheduled",
    scheduleBoundaryHash: HASH_A,
    scheduleSlotId: "KR:2026-09-02:daily:15:30",
    slotEndsAt: AS_OF
  };
}
