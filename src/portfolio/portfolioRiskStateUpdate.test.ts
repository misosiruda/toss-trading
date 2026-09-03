import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioRiskStateUpdateRecord,
  parsePortfolioRiskStateUpdateRecord,
  type CreatePortfolioRiskStateUpdateInput
} from "./portfolioRiskStateUpdate.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const AS_OF = "2026-09-03T00:00:00.000Z";
const CREATED_AT = "2026-09-03T00:00:01.000Z";

test("risk state update creates and parses every strict variant", () => {
  const inputs: CreatePortfolioRiskStateUpdateInput[] = [
    marketMarkInput(),
    fillInput({
      scopeKind: "bucket",
      fillAccountingGroupId: "accounting-group-1"
    }),
    fillInput({
      scopeKind: "legacy_portfolio",
      legacyAccountingRecordId: "legacy-accounting-1",
      legacyAccountingHash: HASH_B
    }),
    equityEventInput("fee"),
    equityEventInput("cash_flow"),
    riskStateInput()
  ];

  for (const input of inputs) {
    const record = createPortfolioRiskStateUpdateRecord(input);
    assert.match(
      record.riskStateUpdateRecordId,
      new RegExp(`^portfolio_risk_state_update_${record.stateUpdateKind}_`)
    );
    assert.deepEqual(parsePortfolioRiskStateUpdateRecord(record), record);
    assert.equal(Object.isFrozen(record), true);
    if (record.stateUpdateKind === "fill") {
      assert.equal(Object.isFrozen(record.accountingScope), true);
    }
  }
});

test("risk state update identity ignores createdAt for semantic retry", () => {
  const first = createPortfolioRiskStateUpdateRecord(marketMarkInput());
  const retry = createPortfolioRiskStateUpdateRecord({
    ...marketMarkInput(),
    createdAt: "2026-09-03T00:00:02.000Z"
  });

  assert.equal(retry.stateUpdateHash, first.stateUpdateHash);
  assert.equal(retry.riskStateUpdateRecordId, first.riskStateUpdateRecordId);
  assert.notEqual(retry.createdAt, first.createdAt);
});

test("risk state update rejects mixed accounting scopes", () => {
  assert.throws(
    () =>
      createPortfolioRiskStateUpdateRecord({
        ...fillInput({
          scopeKind: "bucket",
          fillAccountingGroupId: "accounting-group-1"
        }),
        accountingScope: {
          scopeKind: "bucket",
          fillAccountingGroupId: "accounting-group-1",
          legacyAccountingRecordId: "legacy-accounting-1"
        }
      } as never),
    /unrecognized_keys/
  );
  assert.throws(
    () =>
      createPortfolioRiskStateUpdateRecord({
        ...fillInput({
          scopeKind: "legacy_portfolio",
          legacyAccountingRecordId: "legacy-accounting-1",
          legacyAccountingHash: HASH_B
        }),
        accountingScope: {
          scopeKind: "legacy_portfolio",
          legacyAccountingRecordId: "legacy-accounting-1"
        }
      } as never),
    /legacyAccountingHash/
  );
});

test("risk state update rejects invalid chronology and identifiers", () => {
  assert.throws(
    () =>
      createPortfolioRiskStateUpdateRecord({
        ...marketMarkInput(),
        createdAt: "2026-09-02T23:59:59.000Z"
      }),
    /cannot be created before asOf/
  );
  assert.throws(
    () =>
      createPortfolioRiskStateUpdateRecord({
        ...marketMarkInput(),
        asOf: "2026-09-03T00:00:00"
      }),
    /date-time/
  );
  assert.throws(
    () =>
      createPortfolioRiskStateUpdateRecord({
        ...marketMarkInput(),
        portfolioSnapshotId: " snapshot-1 "
      }),
    /already be canonical/
  );
});

test("risk state update rejects stored payload, hash, ID, and shape tampering", () => {
  const record = createPortfolioRiskStateUpdateRecord(marketMarkInput());
  assert.throws(
    () =>
      parsePortfolioRiskStateUpdateRecord({
        ...record,
        portfolioSnapshotId: "snapshot-2"
      }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      parsePortfolioRiskStateUpdateRecord({
        ...record,
        stateUpdateHash: HASH_B
      }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      parsePortfolioRiskStateUpdateRecord({
        ...record,
        riskStateUpdateRecordId: "wrong"
      }),
    /identity does not match payload/
  );
  assert.throws(
    () => parsePortfolioRiskStateUpdateRecord({ ...record, extra: true }),
    /unrecognized_keys/
  );
});

function baseInput() {
  return {
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    asOf: AS_OF,
    createdAt: CREATED_AT
  };
}

function marketMarkInput() {
  return {
    ...baseInput(),
    stateUpdateKind: "market_mark" as const,
    portfolioSnapshotId: "snapshot-1",
    portfolioSnapshotHash: HASH_B
  };
}

function fillInput(
  accountingScope:
    | { scopeKind: "bucket"; fillAccountingGroupId: string }
    | {
        scopeKind: "legacy_portfolio";
        legacyAccountingRecordId: string;
        legacyAccountingHash: string;
      }
) {
  return {
    ...baseInput(),
    stateUpdateKind: "fill" as const,
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    planExecutionEventId: "execution-event-1",
    fillId: "fill-1",
    paperFillRecordId: "paper-fill-1",
    paperFillHash: HASH_B,
    accountingScope
  };
}

function equityEventInput(stateUpdateKind: "fee" | "cash_flow") {
  return {
    ...baseInput(),
    stateUpdateKind,
    bucketEquityEventId: "bucket-equity-event-1",
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId: "fill-1"
  };
}

function riskStateInput() {
  return {
    ...baseInput(),
    stateUpdateKind: "risk_state" as const,
    riskStateEpochId: "epoch-1",
    bucket: "short_term" as const,
    lastBucketEquityEventId: "bucket-equity-event-1",
    riskStateHash: HASH_B
  };
}
