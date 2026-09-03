import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioRiskStateUpdateRecord,
  type PortfolioRiskStateUpdateRecord
} from "./portfolioRiskStateUpdate.js";
import { parseVerifiedPortfolioRiskStateUpdateHistory } from "./portfolioRiskStateUpdateFiles.js";
import { resolveRiskBreachPortfolioCycleTrigger as resolveRiskBreachPortfolioCycleTriggerRaw } from "./riskBreachPortfolioCycleTriggerResolver.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

test("risk-breach trigger resolves one exact immutable state update", () => {
  const update = marketMarkUpdate();
  const resolved = resolveRiskBreachPortfolioCycleTrigger({
    value: trigger(update),
    riskStateUpdateHistory: history(update)
  });

  assert.deepEqual(resolved.riskStateUpdate, update);
  assert.equal(resolved.triggerIdentity, "risk_breach:market_mark");
  assert.equal(resolved.triggerRef, update.stateUpdateHash);
  assert.equal(resolved.evidenceCutoffAt, update.asOf);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.riskStateUpdate), true);
});

test("risk-breach trigger rejects missing and duplicate update IDs", () => {
  const update = marketMarkUpdate();
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: trigger(update),
        riskStateUpdateHistory: history()
      }),
    /resolved 0/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: trigger(update),
        riskStateUpdateHistory: history(update, update)
      }),
    /duplicate ID/
  );
});

test("risk-breach trigger rejects update hash, kind, and cutoff drift", () => {
  const update = marketMarkUpdate();
  const riskState = riskStateUpdate();
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: { ...trigger(update), stateUpdateHash: riskState.stateUpdateHash },
        riskStateUpdateHistory: history(update, riskState)
      }),
    /does not match/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: { ...trigger(update), stateUpdateKind: "risk_state" },
        riskStateUpdateHistory: history(update)
      }),
    /does not match/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: {
          ...trigger(update),
          stateUpdateAsOf: "2026-09-03T00:00:01.000Z"
        },
        riskStateUpdateHistory: history(update)
      }),
    /does not match/
  );
});

test("risk-breach trigger rejects portfolio and policy scope drift", () => {
  const update = marketMarkUpdate();
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        expectedPortfolioId: "portfolio-2",
        expectedPolicyHash: HASH_A
      }),
    /source scope mismatch/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: HASH_B
      }),
    /source scope mismatch/
  );
});

test("risk-breach trigger rejects corrupt unrelated complete history", () => {
  const update = marketMarkUpdate();
  assert.throws(
    () =>
      parseVerifiedPortfolioRiskStateUpdateHistory(
        `${JSON.stringify(update)}\n${JSON.stringify({
          ...riskStateUpdate(),
          riskStateHash: HASH_A
        })}\n`
      ),
    /corrupt line 2/
  );
});

test("risk-breach trigger rejects an unverified array wrapper", () => {
  const update = marketMarkUpdate();
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: trigger(update),
        riskStateUpdateHistory: {
          records: [update]
        } as never
      }),
    /history is not verified/
  );
});

test("risk-breach trigger rejects other trigger variants", () => {
  const update = marketMarkUpdate();
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: {
          triggerKind: "every_tick",
          packetHash: update.stateUpdateHash,
          packetAsOf: update.asOf
        },
        riskStateUpdateHistory: history(update)
      }),
    /requires a risk_breach trigger/
  );
});

function trigger(update: PortfolioRiskStateUpdateRecord) {
  return {
    triggerKind: "risk_breach" as const,
    stateUpdateKind: update.stateUpdateKind,
    riskStateUpdateRecordId: update.riskStateUpdateRecordId,
    stateUpdateHash: update.stateUpdateHash,
    stateUpdateAsOf: update.asOf
  };
}

function resolveRiskBreachPortfolioCycleTrigger(input: {
  value: unknown;
  riskStateUpdateHistory: ReturnType<typeof history>;
}) {
  return resolveRiskBreachPortfolioCycleTriggerRaw({
    ...input,
    expectedPortfolioId: "portfolio-1",
    expectedPolicyHash: HASH_A
  });
}

function history(...updates: readonly PortfolioRiskStateUpdateRecord[]) {
  return parseVerifiedPortfolioRiskStateUpdateHistory(
    updates.map((update) => JSON.stringify(update)).join("\n") +
      (updates.length === 0 ? "" : "\n")
  );
}

function marketMarkUpdate() {
  return createPortfolioRiskStateUpdateRecord({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    asOf: "2026-09-03T00:00:00.000Z",
    stateUpdateKind: "market_mark",
    portfolioSnapshotId: "snapshot-1",
    portfolioSnapshotHash: HASH_B,
    createdAt: "2026-09-03T00:00:01.000Z"
  });
}

function riskStateUpdate() {
  return createPortfolioRiskStateUpdateRecord({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    asOf: "2026-09-03T00:00:00.000Z",
    stateUpdateKind: "risk_state",
    riskStateEpochId: "epoch-1",
    bucket: "short_term",
    lastBucketEquityEventId: "bucket-equity-event-1",
    riskStateHash: HASH_B,
    createdAt: "2026-09-03T00:00:01.000Z"
  });
}
