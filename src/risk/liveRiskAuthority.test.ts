import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateLiveRiskAuthority,
  inspectLiveRiskAuthority,
  verifyLiveRiskAuthority,
  type FrozenLiveOrderIntent
} from "./liveRiskAuthority.js";
import type {
  LiveOrderIntent,
  LiveRiskPolicy,
  LiveRiskSnapshot
} from "./liveRiskEngine.js";

const now = new Date("2026-06-17T10:00:00.000Z");
const fresh = "2026-06-17T10:01:00.000Z";

function baseIntent(overrides: Partial<LiveOrderIntent> = {}): LiveOrderIntent {
  return {
    orderIntentId: "intent_live_authority_001",
    signalId: "signal_live_authority_001",
    idempotencyKey: "idem_live_authority_001",
    market: "KR",
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 1,
    estimatedGrossAmountKrw: 80_000,
    createdAt: now.toISOString(),
    expiresAt: fresh,
    preview: {
      previewId: "preview_live_authority_001",
      orderIntentId: "intent_live_authority_001",
      estimatedGrossAmountKrw: 80_000,
      expiresAt: fresh
    },
    ...overrides
  };
}

function baseSnapshot(): LiveRiskSnapshot {
  return {
    riskSnapshotRef: "risk_snapshot_live_authority_001",
    capturedAt: now.toISOString(),
    dailyLossKrw: 0,
    positions: [],
    openOrders: [],
    marketSessions: { KR: "open" }
  };
}

function approvingPolicy(
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

test("live risk authority owns an approved deep-frozen intent handoff", () => {
  const original = baseIntent();
  const evaluation = evaluateLiveRiskAuthority({
    intent: original,
    snapshot: baseSnapshot(),
    policy: approvingPolicy()
  });

  assert.notEqual(evaluation.intent, original);
  assert.equal(Object.isFrozen(evaluation), true);
  assert.equal(Object.isFrozen(evaluation.intent), true);
  assert.equal(Object.isFrozen(evaluation.intent.preview), true);
  assert.equal(Object.isFrozen(evaluation.authority), true);
  assert.equal(Object.isFrozen(evaluation.decision), true);
  assert.equal(Object.isFrozen(evaluation.decision.rejectCodes), true);
  assert.equal(Object.isFrozen(evaluation.decision.checkedRules), true);
  assert.equal(evaluation.decision.approved, true);
  assert.match(evaluation.decision.evaluatedIntentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    inspectLiveRiskAuthority(evaluation.authority),
    evaluation.decision
  );
  assert.equal(
    verifyLiveRiskAuthority(evaluation.authority, evaluation.intent),
    evaluation.decision
  );

  original.symbol = "000660";
  original.preview!.previewId = "mutated";
  assert.equal(evaluation.intent.symbol, "005930");
  assert.equal(evaluation.intent.preview?.previewId, "preview_live_authority_001");
});

test("live risk authority hash binds raw symbol and optional-field presence", () => {
  const rawSymbol = evaluateLiveRiskAuthority({
    intent: baseIntent({ symbol: " 005930 " }),
    snapshot: baseSnapshot(),
    policy: approvingPolicy()
  });
  const normalizedSymbol = evaluateLiveRiskAuthority({
    intent: baseIntent({ symbol: "005930" }),
    snapshot: baseSnapshot(),
    policy: approvingPolicy()
  });
  const previewAbsentIntent = baseIntent({ preview: undefined });
  delete previewAbsentIntent.preview;
  const previewAbsent = evaluateLiveRiskAuthority({
    intent: previewAbsentIntent,
    snapshot: baseSnapshot(),
    policy: approvingPolicy({ requirePreview: false })
  });
  const previewUndefined = evaluateLiveRiskAuthority({
    intent: baseIntent({ preview: undefined }),
    snapshot: baseSnapshot(),
    policy: approvingPolicy({ requirePreview: false })
  });

  assert.equal(rawSymbol.decision.approved, true);
  assert.equal(normalizedSymbol.decision.approved, true);
  assert.notEqual(
    rawSymbol.decision.evaluatedIntentHash,
    normalizedSymbol.decision.evaluatedIntentHash
  );
  assert.notEqual(
    previewAbsent.decision.evaluatedIntentHash,
    previewUndefined.decision.evaluatedIntentHash
  );
});

test("live risk authority rejects counterfeit and reconstructed handoffs", () => {
  const evaluation = evaluateLiveRiskAuthority({
    intent: baseIntent(),
    snapshot: baseSnapshot(),
    policy: approvingPolicy()
  });
  const reconstructed = Object.freeze({
    ...evaluation.intent,
    preview: Object.freeze({ ...evaluation.intent.preview! })
  }) as FrozenLiveOrderIntent;
  const counterfeit = Object.freeze({
    toJSON(): never {
      throw new Error("counterfeit");
    }
  });

  assert.throws(
    () => inspectLiveRiskAuthority(counterfeit),
    /minted by the risk engine/
  );
  assert.throws(
    () => verifyLiveRiskAuthority(evaluation.authority, reconstructed),
    /exact evaluated intent snapshot/
  );
});

test("rejected live risk authority cannot be mutated into approval", () => {
  const evaluation = evaluateLiveRiskAuthority({
    intent: baseIntent(),
    snapshot: baseSnapshot(),
    policy: approvingPolicy({ killSwitch: true })
  });

  assert.equal(evaluation.decision.approved, false);
  assert.deepEqual(evaluation.decision.rejectCodes, ["KILL_SWITCH_ACTIVE"]);
  assert.throws(
    () => verifyLiveRiskAuthority(evaluation.authority, evaluation.intent),
    /decision is not approved/
  );
  assert.throws(() => {
    (evaluation.decision as { approved: boolean }).approved = true;
  }, TypeError);
  assert.equal(inspectLiveRiskAuthority(evaluation.authority).approved, false);
});

test("live risk authority rejects non-data and shape-loose intents before evaluation", () => {
  const extraFieldIntent = {
    ...baseIntent(),
    unboundField: "not allowed"
  };
  const accessorIntent = baseIntent();
  Object.defineProperty(accessorIntent, "symbol", {
    enumerable: true,
    get: () => "005930"
  });

  assert.throws(
    () =>
      evaluateLiveRiskAuthority({
        intent: extraFieldIntent,
        snapshot: baseSnapshot(),
        policy: approvingPolicy()
      }),
    /unknown fields/
  );
  assert.throws(
    () =>
      evaluateLiveRiskAuthority({
        intent: accessorIntent,
        snapshot: baseSnapshot(),
        policy: approvingPolicy()
      }),
    /enumerable data fields/
  );
});

test("live risk authority snapshots risk state and policy without proxy rereads", () => {
  let positionReads = 0;
  let policyReads = 0;
  const position = new Proxy(
    {
      market: "KR" as const,
      symbol: "005930",
      quantity: 1,
      averagePriceKrw: 10_000,
      marketValueKrw: 10_000
    },
    {
      get(target, property, receiver) {
        positionReads += 1;
        return Reflect.get(target, property, receiver);
      }
    }
  );
  const policy = new Proxy(approvingPolicy(), {
    get(target, property, receiver) {
      policyReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const snapshot = {
    ...baseSnapshot(),
    positions: [position]
  };

  const evaluation = evaluateLiveRiskAuthority({
    intent: baseIntent(),
    snapshot,
    policy
  });

  assert.equal(evaluation.decision.approved, true);
  assert.equal(positionReads, 0);
  assert.equal(policyReads, 0);
});

test("live risk authority rejects accessor-backed risk state and policy", () => {
  const snapshot = baseSnapshot();
  Object.defineProperty(snapshot, "dailyLossKrw", {
    enumerable: true,
    get: () => 0
  });
  const policy = approvingPolicy();
  Object.defineProperty(policy, "killSwitch", {
    enumerable: true,
    get: () => false
  });

  assert.throws(
    () =>
      evaluateLiveRiskAuthority({
        intent: baseIntent(),
        snapshot,
        policy: approvingPolicy()
      }),
    /enumerable data fields/
  );
  assert.throws(
    () =>
      evaluateLiveRiskAuthority({
        intent: baseIntent(),
        snapshot: baseSnapshot(),
        policy
      }),
    /enumerable data fields/
  );
});

test("live risk authority cannot be serialized", () => {
  const evaluation = evaluateLiveRiskAuthority({
    intent: baseIntent(),
    snapshot: baseSnapshot(),
    policy: approvingPolicy()
  });

  assert.throws(() => JSON.stringify(evaluation.authority), /cannot be serialized/);
});
