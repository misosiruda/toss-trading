import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioRiskStateUpdateRecord,
  type PortfolioRiskStateUpdateRecord
} from "./portfolioRiskStateUpdate.js";
import { parseVerifiedPortfolioRiskStateUpdateHistory } from "./portfolioRiskStateUpdateFiles.js";
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
