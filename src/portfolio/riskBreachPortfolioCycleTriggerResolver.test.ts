import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioRiskStateUpdateRecord,
  type PortfolioRiskStateUpdateRecord
} from "./portfolioRiskStateUpdate.js";
import { parseVerifiedPortfolioRiskStateUpdateHistory } from "./portfolioRiskStateUpdateFiles.js";
import {
  createBucketEquityEvent,
  createBucketRiskState,
  type BucketEquityEvent,
  type BucketRiskState
} from "./bucketEquity.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import {
  createPortfolioSizingSnapshot,
  type PortfolioSizingSnapshot
} from "./portfolioSizingSnapshot.js";
import { resolveRiskBreachPortfolioCycleTrigger as resolveRiskBreachPortfolioCycleTriggerRaw } from "./riskBreachPortfolioCycleTriggerResolver.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

test("risk-breach trigger resolves one exact immutable state update", () => {
  const snapshot = marketMarkSnapshot();
  const update = marketMarkUpdate(snapshot);
  const resolved = resolveRiskBreachPortfolioCycleTrigger({
    value: trigger(update),
    riskStateUpdateHistory: history(update),
    marketMarkSource: snapshot
  });

  assert.deepEqual(resolved.riskStateUpdate, update);
  assert.deepEqual(resolved.marketMarkSnapshot, snapshot);
  assert.equal(resolved.triggerIdentity, "risk_breach:market_mark");
  assert.equal(resolved.triggerRef, update.stateUpdateHash);
  assert.equal(resolved.evidenceCutoffAt, update.asOf);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.riskStateUpdate), true);
});

test("risk-breach market mark requires an exact immutable snapshot origin", () => {
  const snapshot = marketMarkSnapshot();
  const update = marketMarkUpdate(snapshot);
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /requires its portfolio snapshot source/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        marketMarkSource: {
          ...snapshot,
          portfolioSnapshotHash: HASH_A
        }
      }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        marketMarkSource: marketMarkSnapshot("portfolio-version-2")
      }),
    /origin identity mismatch/
  );

  const lateUpdate = marketMarkUpdate(snapshot, {
    asOf: "2026-09-03T00:00:01.000Z",
    createdAt: "2026-09-03T00:00:02.000Z"
  });
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTrigger({
        value: trigger(lateUpdate),
        riskStateUpdateHistory: history(lateUpdate),
        marketMarkSource: snapshot
      }),
    /origin scope mismatch/
  );
});

test("risk-breach resolver rejects market-mark source for other update kinds", () => {
  const update = riskStateUpdate();
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        marketMarkSource: marketMarkSnapshot(),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /allowed only for a market_mark update/
  );
});

test("risk-breach trigger resolves one exact immutable bucket risk state", () => {
  const state = bucketRiskState();
  const update = riskStateUpdate(state);
  const resolved = resolveRiskBreachPortfolioCycleTriggerRaw({
    value: trigger(update),
    riskStateUpdateHistory: history(update),
    bucketRiskStateSource: state,
    expectedPortfolioId: update.portfolioId,
    expectedPolicyHash: update.policyHash
  });

  assert.deepEqual(resolved.riskStateUpdate, update);
  assert.deepEqual(resolved.bucketRiskState, state);
  assert.equal(resolved.triggerIdentity, "risk_breach:risk_state");
  assert.equal(Object.isFrozen(resolved.bucketRiskState), true);
});

test("risk-breach risk state requires an exact immutable state origin", () => {
  const state = bucketRiskState();
  const update = riskStateUpdate(state);
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /requires its bucket risk-state source/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        bucketRiskStateSource: { ...state, riskStateHash: HASH_A },
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /hash does not match its payload/
  );
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        bucketRiskStateSource: bucketRiskState("epoch-2"),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /origin identity mismatch/
  );

  const lateUpdate = riskStateUpdate(state, {
    asOf: "2026-09-03T00:00:01.000Z",
    createdAt: "2026-09-03T00:00:02.000Z"
  });
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(lateUpdate),
        riskStateUpdateHistory: history(lateUpdate),
        bucketRiskStateSource: state,
        expectedPortfolioId: lateUpdate.portfolioId,
        expectedPolicyHash: lateUpdate.policyHash
      }),
    /origin scope mismatch/
  );
});

test("risk-breach resolver rejects bucket risk state for other update kinds", () => {
  const snapshot = marketMarkSnapshot();
  const update = marketMarkUpdate(snapshot);
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        marketMarkSource: snapshot,
        bucketRiskStateSource: bucketRiskState(),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /allowed only for a risk_state update/
  );
});

for (const kind of ["fee", "cash_flow"] as const) {
  test(`risk-breach trigger resolves one exact ${kind} equity event`, () => {
    const event = equityEvent(kind);
    const update = equityEventUpdate(kind, event);
    const resolved = resolveRiskBreachPortfolioCycleTriggerRaw({
      value: trigger(update),
      riskStateUpdateHistory: history(update),
      bucketEquityEventSource: event,
      expectedPortfolioId: update.portfolioId,
      expectedPolicyHash: update.policyHash
    });

    assert.deepEqual(resolved.riskStateUpdate, update);
    assert.deepEqual(resolved.bucketEquityEvent, event);
    assert.equal(resolved.triggerIdentity, `risk_breach:${kind}`);
    assert.equal(Object.isFrozen(resolved.bucketEquityEvent), true);
  });

  test(`risk-breach ${kind} requires an exact immutable equity event`, () => {
    const event = equityEvent(kind);
    const update = equityEventUpdate(kind, event);
    assert.throws(
      () =>
        resolveRiskBreachPortfolioCycleTriggerRaw({
          value: trigger(update),
          riskStateUpdateHistory: history(update),
          expectedPortfolioId: update.portfolioId,
          expectedPolicyHash: update.policyHash
        }),
      /requires its bucket equity-event source/
    );
    assert.throws(
      () =>
        resolveRiskBreachPortfolioCycleTriggerRaw({
          value: trigger(update),
          riskStateUpdateHistory: history(update),
          bucketEquityEventSource: {
            ...event,
            bucketEquityEventHash: HASH_A
          },
          expectedPortfolioId: update.portfolioId,
          expectedPolicyHash: update.policyHash
        }),
      /identity does not match its payload/
    );
    assert.throws(
      () =>
        resolveRiskBreachPortfolioCycleTriggerRaw({
          value: trigger(update),
          riskStateUpdateHistory: history(update),
          bucketEquityEventSource: equityEvent(kind, "fill-2"),
          expectedPortfolioId: update.portfolioId,
          expectedPolicyHash: update.policyHash
      }),
      /origin identity mismatch/
    );
    const wrongLineageUpdate = equityEventUpdate(kind, event, {
      rebalancePlanId: "plan-2"
    });
    assert.throws(
      () =>
        resolveRiskBreachPortfolioCycleTriggerRaw({
          value: trigger(wrongLineageUpdate),
          riskStateUpdateHistory: history(wrongLineageUpdate),
          bucketEquityEventSource: event,
          expectedPortfolioId: wrongLineageUpdate.portfolioId,
          expectedPolicyHash: wrongLineageUpdate.policyHash
        }),
      /origin identity mismatch/
    );

    const lateUpdate = equityEventUpdate(kind, event, {
      asOf: "2026-09-03T00:00:01.000Z",
      createdAt: "2026-09-03T00:00:02.000Z"
    });
    assert.throws(
      () =>
        resolveRiskBreachPortfolioCycleTriggerRaw({
          value: trigger(lateUpdate),
          riskStateUpdateHistory: history(lateUpdate),
          bucketEquityEventSource: event,
          expectedPortfolioId: lateUpdate.portfolioId,
          expectedPolicyHash: lateUpdate.policyHash
        }),
      /origin scope mismatch/
    );
  });
}

test("risk-breach equity-event origin enforces the update kind mapping", () => {
  const event = equityEvent("cash_flow");
  const update = equityEventUpdate("fee", event);
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        bucketEquityEventSource: event,
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /origin identity mismatch/
  );
});

test("risk-breach resolver rejects equity-event source for other update kinds", () => {
  const snapshot = marketMarkSnapshot();
  const update = marketMarkUpdate(snapshot);
  assert.throws(
    () =>
      resolveRiskBreachPortfolioCycleTriggerRaw({
        value: trigger(update),
        riskStateUpdateHistory: history(update),
        marketMarkSource: snapshot,
        bucketEquityEventSource: equityEvent("fee"),
        expectedPortfolioId: update.portfolioId,
        expectedPolicyHash: update.policyHash
      }),
    /allowed only for a fee or cash_flow update/
  );
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
  marketMarkSource?: unknown;
}) {
  return resolveRiskBreachPortfolioCycleTriggerRaw({
    ...input,
    ...(input.marketMarkSource === undefined
      ? { marketMarkSource: marketMarkSnapshot() }
      : { marketMarkSource: input.marketMarkSource }),
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

function marketMarkUpdate(
  snapshot: PortfolioSizingSnapshot = marketMarkSnapshot(),
  overrides: Partial<{ asOf: string; createdAt: string }> = {}
) {
  return createPortfolioRiskStateUpdateRecord({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    asOf: overrides.asOf ?? snapshot.asOf,
    stateUpdateKind: "market_mark",
    portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

function marketMarkSnapshot(
  portfolioVersion = "portfolio-version-1"
): PortfolioSizingSnapshot {
  const exposure = createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 1_000_000,
    cashKrw: 1_000_000,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: 0,
      short_term: 0,
      swing: 0
    },
    symbolExposureKrw: [],
    marketExposureKrw: { KR: 0, US: 0 },
    sectorExposureKrw: {},
    countryExposureKrw: {},
    currencyExposureKrw: {},
    pendingBuyExposureKrw: 0,
    pendingSellExposureKrw: 0
  });
  return createPortfolioSizingSnapshot({
    portfolioId: "portfolio-1",
    portfolioVersion,
    policyHash: HASH_A,
    asOf: "2026-09-03T00:00:00.000Z",
    virtualPortfolio: {
      portfolioId: "portfolio-1",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-09-02T23:59:00.000Z"
    },
    valuationInputs: [],
    pendingActionInputs: [],
    ...exposure
  });
}

function riskStateUpdate(
  state: BucketRiskState = bucketRiskState(),
  overrides: Partial<{ asOf: string; createdAt: string }> = {}
) {
  return createPortfolioRiskStateUpdateRecord({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    asOf: overrides.asOf ?? state.asOf,
    stateUpdateKind: "risk_state",
    riskStateEpochId: state.riskStateEpochId,
    bucket: state.bucket,
    lastBucketEquityEventId: state.lastBucketEquityEventId,
    riskStateHash: state.riskStateHash,
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

function bucketRiskState(riskStateEpochId = "epoch-1"): BucketRiskState {
  return createBucketRiskState({
    riskStateEpochId,
    portfolioId: "portfolio-1",
    bucket: "short_term",
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    units: 1_000,
    unitNavKrw: 0.8,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 800,
    drawdownRatio: 1 - 0.8 / 1,
    lastBucketEquityEventId: "bucket-equity-event-1",
    asOf: "2026-09-03T00:00:00.000Z"
  });
}

type FillBucketEquityEvent = Extract<
  BucketEquityEvent,
  { eventType: "capital_flow" | "execution_cost" }
>;

function equityEvent(
  kind: "fee" | "cash_flow",
  fillId = "fill-1"
): FillBucketEquityEvent {
  const shared = {
    previousBucketEquityEventId: "bucket-equity-event-previous",
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "short_term" as const,
    policyHash: HASH_A,
    asOf: "2026-09-03T00:00:00.000Z",
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId,
    paperFillRecordId: `paper-${fillId}`,
    paperFillHash: HASH_B,
    fillAccountingGroupId: `group-${fillId}`
  };
  return createBucketEquityEvent(
    kind === "fee"
      ? {
          ...shared,
          eventType: "execution_cost",
          equityDeltaKrw: -5,
          fillAccountingSequence: 1,
          evidenceRefs: ["fee-1"]
        }
      : {
          ...shared,
          eventType: "capital_flow",
          amountKrw: 500,
          fillAccountingSequence: 0
        }
  ) as FillBucketEquityEvent;
}

function equityEventUpdate(
  kind: "fee" | "cash_flow",
  event: FillBucketEquityEvent,
  overrides: Partial<{
    asOf: string;
    createdAt: string;
    rebalancePlanId: string;
  }> = {}
) {
  return createPortfolioRiskStateUpdateRecord({
    portfolioId: event.portfolioId,
    policyHash: event.policyHash,
    asOf: overrides.asOf ?? event.asOf,
    stateUpdateKind: kind,
    bucketEquityEventId: event.bucketEquityEventId,
    rebalancePlanId: overrides.rebalancePlanId ?? event.rebalancePlanId,
    rebalanceActionId: event.rebalanceActionId,
    fillId: event.fillId,
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}
