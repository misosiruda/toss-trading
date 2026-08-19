import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSyntheticDryRunApprovalFixture,
  routeDryRunOrder,
  type DryRunOrderRouterConfig,
  type SyntheticDryRunApprovalFixture
} from "./dryRunOrderRouter.js";
import {
  createDryRunShadowState,
  inspectDryRunShadowState
} from "./dryRunShadowState.js";
import { evaluateLiveRiskAuthority } from "../risk/liveRiskAuthority.js";
import type {
  LiveOrderIntent,
  LiveRiskPolicy,
  LiveRiskSnapshot
} from "../risk/liveRiskEngine.js";

const now = new Date("2026-06-17T10:00:00.000Z");
const fresh = "2026-06-17T10:01:00.000Z";

function safeConfig(): DryRunOrderRouterConfig {
  return {
    BROKER_PROVIDER: "mock",
    TRADING_ENABLED: false,
    TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED: false,
    TOSS_OPEN_API_DRY_RUN: true
  };
}

function baseIntent(overrides: Partial<LiveOrderIntent> = {}): LiveOrderIntent {
  return {
    orderIntentId: "intent_dry_run_router_001",
    signalId: "signal_dry_run_router_001",
    idempotencyKey: "idem_dry_run_router_001",
    market: "KR",
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 1,
    estimatedGrossAmountKrw: 80_000,
    createdAt: now.toISOString(),
    expiresAt: fresh,
    preview: {
      previewId: "preview_dry_run_router_001",
      orderIntentId: "intent_dry_run_router_001",
      estimatedGrossAmountKrw: 80_000,
      expiresAt: fresh
    },
    ...overrides
  };
}

function baseSnapshot(): LiveRiskSnapshot {
  return {
    riskSnapshotRef: "risk_snapshot_dry_run_router_001",
    capturedAt: now.toISOString(),
    dailyLossKrw: 0,
    positions: [],
    openOrders: [],
    marketSessions: { KR: "open" }
  };
}

function policy(
  overrides: Partial<LiveRiskPolicy> = {}
): Partial<LiveRiskPolicy> {
  return {
    killSwitch: false,
    maxOrderAmountKrw: 100_000,
    maxDailyLossKrw: 50_000,
    maxSymbolExposureKrw: 150_000,
    maxMarketExposureKrw: 500_000,
    maxTotalExposureKrw: 700_000,
    maxSnapshotAgeMs: 60_000,
    allowedSymbols: ["005930"],
    allowedMarkets: ["KR"],
    requireMarketOpen: true,
    maxOpenOrders: 5,
    marketOrderPolicy: "disabled",
    requirePreview: true,
    cooldownEntries: [],
    now,
    ...overrides
  };
}

function approvedEvaluation() {
  return evaluateLiveRiskAuthority({
    intent: baseIntent(),
    snapshot: baseSnapshot(),
    policy: policy()
  });
}

function approvalFor(
  evaluation: ReturnType<typeof approvedEvaluation>,
  scenarioId = "scenario_router_success_001"
): SyntheticDryRunApprovalFixture {
  return createSyntheticDryRunApprovalFixture({
    scenarioId,
    intent: evaluation.intent,
    authority: evaluation.authority
  });
}

test("dry-run router validates exact safe gates and reserves only shadow state", () => {
  const evaluation = approvedEvaluation();
  const scenarioId = "scenario_router_success_001";
  const result = routeDryRunOrder({
    config: safeConfig(),
    scenarioId,
    intent: evaluation.intent,
    authority: evaluation.authority,
    approval: approvalFor(evaluation, scenarioId),
    shadowState: createDryRunShadowState()
  });
  const snapshot = inspectDryRunShadowState(result.state);

  assert.equal(result.outcome, "dry_run_validated");
  assert.equal(result.record.status, "shadow_reserved");
  assert.equal(result.auditEvent.riskAuthorityVerified, true);
  assert.equal(result.auditEvent.syntheticApprovalConsumed, true);
  assert.equal(result.auditEvent.simulationOnly, true);
  assert.equal(result.auditEvent.externalEffect, "none");
  assert.equal(result.shadowAuditEvent.externalEffect, "none");
  assert.match(result.auditEvent.scenarioRef, /^scenario:sha256:[a-f0-9]{64}$/);
  assert.match(result.auditEvent.syntheticIntentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.tombstones.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.auditEvent), true);
});

test("dry-run router rejects every non-exact safe gate before routing", () => {
  const evaluation = approvedEvaluation();
  const scenarioId = "scenario_router_config_001";
  const invalidConfigs: Array<readonly [Record<string, unknown>, RegExp]> = [
    [{ ...safeConfig(), BROKER_PROVIDER: "toss" }, /BROKER_PROVIDER=mock/],
    [{ ...safeConfig(), TRADING_ENABLED: true }, /TRADING_ENABLED=false/],
    [
      { ...safeConfig(), TOSS_OPEN_API_ORDER_MUTATIONS_ENABLED: true },
      /ORDER_MUTATIONS_ENABLED=false/
    ],
    [{ ...safeConfig(), TOSS_OPEN_API_DRY_RUN: false }, /DRY_RUN=true/],
    [{ ...safeConfig(), extra: false }, /unknown fields/]
  ];

  for (const [config, error] of invalidConfigs) {
    assert.throws(
      () =>
        routeDryRunOrder({
          config: config as unknown as DryRunOrderRouterConfig,
          scenarioId,
          intent: evaluation.intent,
          authority: evaluation.authority,
          approval: approvalFor(evaluation, scenarioId),
          shadowState: createDryRunShadowState()
        }),
      error
    );
  }

  const accessorConfig = safeConfig();
  Object.defineProperty(accessorConfig, "BROKER_PROVIDER", {
    enumerable: true,
    get: () => "mock"
  });
  assert.throws(
    () =>
      routeDryRunOrder({
        config: accessorConfig,
        scenarioId,
        intent: evaluation.intent,
        authority: evaluation.authority,
        approval: approvalFor(evaluation, scenarioId),
        shadowState: createDryRunShadowState()
      }),
    /enumerable data fields/
  );
});

test("rejected risk authority cannot mint a synthetic approval fixture", () => {
  const rejected = evaluateLiveRiskAuthority({
    intent: baseIntent(),
    snapshot: baseSnapshot(),
    policy: policy({ killSwitch: true })
  });

  assert.equal(rejected.decision.approved, false);
  assert.throws(
    () =>
      createSyntheticDryRunApprovalFixture({
        scenarioId: "scenario_router_rejected_001",
        intent: rejected.intent,
        authority: rejected.authority
      }),
    /decision is not approved/
  );
});

test("dry-run router rejects counterfeit and mismatched approval bindings", () => {
  const evaluation = approvedEvaluation();
  const other = evaluateLiveRiskAuthority({
    intent: baseIntent({ orderIntentId: "intent_dry_run_router_002" }),
    snapshot: baseSnapshot(),
    policy: policy()
  });
  const scenarioId = "scenario_router_binding_001";
  const counterfeit = Object.freeze({
    toJSON(): never {
      throw new Error("counterfeit");
    }
  }) as SyntheticDryRunApprovalFixture;

  assert.throws(
    () =>
      routeDryRunOrder({
        config: safeConfig(),
        scenarioId,
        intent: evaluation.intent,
        authority: evaluation.authority,
        approval: counterfeit,
        shadowState: createDryRunShadowState()
      }),
    /active fixture minted by the router/
  );
  assert.throws(
    () =>
      routeDryRunOrder({
        config: safeConfig(),
        scenarioId,
        intent: other.intent,
        authority: other.authority,
        approval: approvalFor(evaluation, scenarioId),
        shadowState: createDryRunShadowState()
      }),
    /does not match the exact authority, intent, and scenario/
  );
  assert.throws(
    () =>
      routeDryRunOrder({
        config: safeConfig(),
        scenarioId: "scenario_router_binding_002",
        intent: evaluation.intent,
        authority: evaluation.authority,
        approval: approvalFor(evaluation, scenarioId),
        shadowState: createDryRunShadowState()
      }),
    /does not match the exact authority, intent, and scenario/
  );
});

test("synthetic approval is one-time and fails closed after consumption", () => {
  const evaluation = approvedEvaluation();
  const scenarioId = "scenario_router_one_time_001";
  const approval = approvalFor(evaluation, scenarioId);
  routeDryRunOrder({
    config: safeConfig(),
    scenarioId,
    intent: evaluation.intent,
    authority: evaluation.authority,
    approval,
    shadowState: createDryRunShadowState()
  });

  assert.throws(
    () =>
      routeDryRunOrder({
        config: safeConfig(),
        scenarioId,
        intent: evaluation.intent,
        authority: evaluation.authority,
        approval,
        shadowState: createDryRunShadowState()
      }),
    /active fixture minted by the router/
  );
  assert.throws(() => JSON.stringify(approval), /cannot be serialized/);
});

test("shadow duplicate is rejected with a fresh one-time fixture", () => {
  const evaluation = approvedEvaluation();
  const scenarioId = "scenario_router_duplicate_001";
  const first = routeDryRunOrder({
    config: safeConfig(),
    scenarioId,
    intent: evaluation.intent,
    authority: evaluation.authority,
    approval: approvalFor(evaluation, scenarioId),
    shadowState: createDryRunShadowState()
  });
  const duplicate = routeDryRunOrder({
    config: safeConfig(),
    scenarioId,
    intent: evaluation.intent,
    authority: evaluation.authority,
    approval: approvalFor(evaluation, scenarioId),
    shadowState: first.state
  });

  assert.equal(duplicate.outcome, "shadow_duplicate_rejected");
  assert.equal(duplicate.record.status, "shadow_reserved");
  assert.equal(duplicate.auditEvent.externalEffect, "none");
  assert.equal(duplicate.shadowAuditEvent.event, "shadow_duplicate_rejected");
  assert.equal(inspectDryRunShadowState(duplicate.state).records.length, 1);
});

test("router output masks account-like scenario input and has no broker identity", () => {
  const evaluation = approvedEvaluation();
  const scenarioId = "scenario_1234-5678-901234";
  const result = routeDryRunOrder({
    config: safeConfig(),
    scenarioId,
    intent: evaluation.intent,
    authority: evaluation.authority,
    approval: approvalFor(evaluation, scenarioId),
    shadowState: createDryRunShadowState()
  });
  const output = JSON.stringify({
    record: result.record,
    shadowAuditEvent: result.shadowAuditEvent,
    auditEvent: result.auditEvent,
    snapshot: inspectDryRunShadowState(result.state)
  });

  assert.equal(output.includes("1234-5678-901234"), false);
  assert.equal(output.includes("accountId"), false);
  assert.equal(output.includes("brokerOrderId"), false);
  assert.equal(output.includes("executionId"), false);
});

test("router burns synthetic approval when the shadow state is stale", () => {
  const evaluation = approvedEvaluation();
  const scenarioId = "scenario_router_stale_state_001";
  const staleState = createDryRunShadowState();
  const staleApproval = approvalFor(evaluation, scenarioId);
  routeDryRunOrder({
    config: safeConfig(),
    scenarioId: "scenario_router_stale_seed_001",
    intent: evaluation.intent,
    authority: evaluation.authority,
    approval: approvalFor(evaluation, "scenario_router_stale_seed_001"),
    shadowState: staleState
  });

  assert.throws(
    () =>
      routeDryRunOrder({
        config: safeConfig(),
        scenarioId,
        intent: evaluation.intent,
        authority: evaluation.authority,
        approval: staleApproval,
        shadowState: staleState
      }),
    /isolated shadow module/
  );
  assert.throws(
    () =>
      routeDryRunOrder({
        config: safeConfig(),
        scenarioId,
        intent: evaluation.intent,
        authority: evaluation.authority,
        approval: staleApproval,
        shadowState: createDryRunShadowState()
      }),
    /active fixture minted by the router/
  );
});

test("dry-run router has no live integration or ambient I/O surface", () => {
  const source = readFileSync(
    new URL("../../src/order/dryRunOrderRouter.ts", import.meta.url),
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
    "evaluateLiveRiskAuthority",
    "inspectLiveRiskAuthority",
    "node:http",
    "node:https",
    "node:fs",
    "process.",
    "fetch("
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(source.includes("verifyLiveRiskAuthority"), true);
});
