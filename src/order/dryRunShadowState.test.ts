import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  completeDryRunShadow,
  createDryRunShadowState,
  inspectDryRunShadowState,
  markDryRunShadowTimeoutUnknown,
  reconcileDryRunShadowNoExternalEffect,
  reserveDryRunShadow,
  type DryRunShadowIdentity
} from "./dryRunShadowState.js";

function identity(
  overrides: Partial<DryRunShadowIdentity> = {}
): DryRunShadowIdentity {
  return {
    scenarioId: "scenario_timeout_001",
    syntheticIntentHash: `sha256:${"a".repeat(64)}`,
    ...overrides
  };
}

test("dry-run shadow reservation creates an immutable permanent tombstone", () => {
  const initial = createDryRunShadowState();
  const result = reserveDryRunShadow(initial, identity());
  const snapshot = inspectDryRunShadowState(result.state);

  assert.equal(result.outcome, "shadow_reserved");
  assert.equal(result.record.status, "shadow_reserved");
  assert.deepEqual(result.record.stateHistory, [
    "shadow_created",
    "shadow_reserved"
  ]);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.tombstones.length, 1);
  assert.equal(snapshot.tombstones[0]?.permanent, true);
  assert.equal(snapshot.audit[0]?.simulationOnly, true);
  assert.equal(snapshot.audit[0]?.externalEffect, "none");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.records), true);
  assert.equal(Object.isFrozen(snapshot.records[0]), true);
  assert.equal(Object.isFrozen(snapshot.tombstones[0]), true);
});

test("dry-run shadow duplicate is rejected in every record state", () => {
  const reserved = reserveDryRunShadow(createDryRunShadowState(), identity());
  const reservedDuplicate = reserveDryRunShadow(reserved.state, identity());
  const completed = completeDryRunShadow(reserved.state, identity());
  const completedDuplicate = reserveDryRunShadow(completed.state, identity());
  const timeout = markDryRunShadowTimeoutUnknown(reserved.state, identity());
  const timeoutDuplicate = reserveDryRunShadow(timeout.state, identity());
  const reconciled = reconcileDryRunShadowNoExternalEffect(
    timeout.state,
    identity()
  );
  const reconciledDuplicate = reserveDryRunShadow(
    reconciled.state,
    identity()
  );

  for (const duplicate of [
    reservedDuplicate,
    completedDuplicate,
    timeoutDuplicate,
    reconciledDuplicate
  ]) {
    assert.equal(duplicate.outcome, "shadow_duplicate_rejected");
    assert.equal(duplicate.auditEvent?.event, "shadow_duplicate_rejected");
    const snapshot = inspectDryRunShadowState(duplicate.state);
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.tombstones.length, 1);
    assert.equal(snapshot.audit.at(-1)?.externalEffect, "none");
  }
});

test("dry-run shadow timeout reconciles only to no external effect", () => {
  const reserved = reserveDryRunShadow(createDryRunShadowState(), identity());
  const timeout = markDryRunShadowTimeoutUnknown(reserved.state, identity());
  const reconciled = reconcileDryRunShadowNoExternalEffect(
    timeout.state,
    identity()
  );
  const snapshot = inspectDryRunShadowState(reconciled.state);

  assert.equal(timeout.outcome, "shadow_timeout_unknown");
  assert.equal(reconciled.outcome, "shadow_reconciled_no_external_effect");
  assert.deepEqual(reconciled.record.stateHistory, [
    "shadow_created",
    "shadow_reserved",
    "shadow_timeout_unknown",
    "shadow_reconciled_no_external_effect"
  ]);
  assert.equal(snapshot.tombstones.length, 1);
  assert.equal(snapshot.audit.length, 3);
  assert.deepEqual(
    snapshot.audit.map((event) => event.sequence),
    [1, 2, 3]
  );
  assert.ok(snapshot.audit.every((event) => event.externalEffect === "none"));
});

test("dry-run shadow rejects invalid or out-of-order transitions", () => {
  const initial = createDryRunShadowState();
  const reserved = reserveDryRunShadow(initial, identity());
  const completed = completeDryRunShadow(reserved.state, identity());

  assert.throws(
    () => completeDryRunShadow(initial, identity()),
    /requires a reserved record/
  );
  assert.throws(
    () => reconcileDryRunShadowNoExternalEffect(reserved.state, identity()),
    /requires shadow_timeout_unknown/
  );
  assert.throws(
    () => markDryRunShadowTimeoutUnknown(completed.state, identity()),
    /requires shadow_reserved/
  );
});

test("dry-run shadow identity requires strict synthetic data fields", () => {
  const initial = createDryRunShadowState();
  const accessorIdentity = identity();
  Object.defineProperty(accessorIdentity, "scenarioId", {
    enumerable: true,
    get: () => "scenario_accessor"
  });

  assert.throws(
    () =>
      reserveDryRunShadow(initial, {
        ...identity(),
        scenarioId: "account_123"
      }),
    /synthetic scenario_ namespace/
  );
  assert.throws(
    () =>
      reserveDryRunShadow(initial, {
        ...identity(),
        syntheticIntentHash: "not-a-hash"
      }),
    /canonical sha256/
  );
  assert.throws(
    () => reserveDryRunShadow(initial, accessorIdentity),
    /enumerable data fields/
  );
  assert.throws(
    () =>
      reserveDryRunShadow(initial, {
        ...identity(),
        extra: true
      } as DryRunShadowIdentity),
    /unknown fields/
  );
});

test("dry-run shadow rejects counterfeit state and serialization", () => {
  const state = createDryRunShadowState();

  assert.throws(
    () => inspectDryRunShadowState(Object.freeze({})),
    /isolated shadow module/
  );
  assert.throws(() => JSON.stringify(state), /cannot be serialized/);
});

test("dry-run shadow module has no live integration or ambient I/O imports", () => {
  const source = readFileSync(
    new URL("../../src/order/dryRunShadowState.ts", import.meta.url),
    "utf8"
  );
  for (const forbidden of [
    "../broker/",
    "../api/",
    "../mcp/",
    "../cli/",
    "../ai/",
    "../paper/",
    "../storage/",
    "node:http",
    "node:https",
    "node:fs",
    "process.",
    "fetch("
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
