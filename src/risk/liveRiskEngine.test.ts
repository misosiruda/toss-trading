import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveRiskEngine,
  type LiveOrderIntent,
  type LiveRiskInput,
  type LiveRiskPolicy,
  type LiveRiskSnapshot
} from "./liveRiskEngine.js";

const now = new Date("2026-06-17T10:00:00.000Z");
const fresh = "2026-06-17T10:01:00.000Z";
const stale = "2026-06-17T09:59:00.000Z";

function baseIntent(overrides: Partial<LiveOrderIntent> = {}): LiveOrderIntent {
  return {
    orderIntentId: "intent_live_001",
    signalId: "signal_live_001",
    idempotencyKey: "idem_live_001",
    market: "KR",
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 1,
    estimatedGrossAmountKrw: 80_000,
    createdAt: now.toISOString(),
    expiresAt: fresh,
    preview: {
      previewId: "preview_live_001",
      orderIntentId: "intent_live_001",
      estimatedGrossAmountKrw: 80_000,
      expiresAt: fresh
    },
    ...overrides
  };
}

function baseSnapshot(
  overrides: Partial<LiveRiskSnapshot> = {}
): LiveRiskSnapshot {
  return {
    riskSnapshotRef: "risk_snapshot_live_001",
    capturedAt: now.toISOString(),
    dailyLossKrw: 0,
    positions: [
      {
        market: "KR",
        symbol: "000660",
        quantity: 2,
        averagePriceKrw: 100_000,
        marketValueKrw: 210_000
      }
    ],
    openOrders: [],
    marketSessions: { KR: "open", US: "open" },
    ...overrides
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
    allowedSymbols: ["005930", "000660"],
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

function evaluate(input: Partial<LiveRiskInput> = {}) {
  const engine = new LiveRiskEngine();
  return engine.evaluate({
    intent: input.intent ?? baseIntent(),
    snapshot: input.snapshot ?? baseSnapshot(),
    policy: input.policy ?? approvingPolicy()
  });
}

test("live risk engine approves a limit order only when every gate passes", () => {
  const decision = evaluate();

  assert.equal(decision.approved, true);
  assert.deepEqual(decision.rejectCodes, []);
  assert.equal(decision.orderIntentId, "intent_live_001");
  assert.equal(decision.signalId, "signal_live_001");
  assert.equal(decision.riskSnapshotRef, "risk_snapshot_live_001");
  assert.equal(decision.createdAt, now.toISOString());
  assert.ok(decision.checkedRules.includes("kill_switch"));
  assert.ok(decision.checkedRules.includes("preview_requirement"));
});

test("live risk engine defaults to fail-closed without explicit policy", () => {
  const decision = new LiveRiskEngine().evaluate({
    intent: baseIntent({
      expiresAt: "2999-01-01T00:00:00.000Z",
      preview: undefined
    }),
    snapshot: baseSnapshot()
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, [
    "KILL_SWITCH_ACTIVE",
    "MAX_ORDER_AMOUNT_EXCEEDED",
    "RISK_SNAPSHOT_STALE",
    "SYMBOL_NOT_ALLOWED",
    "MARKET_NOT_ALLOWED",
    "OPEN_ORDER_LIMIT_EXCEEDED",
    "PREVIEW_REQUIRED",
    "MAX_SYMBOL_EXPOSURE_EXCEEDED",
    "MAX_MARKET_EXPOSURE_EXCEEDED",
    "MAX_TOTAL_EXPOSURE_EXCEEDED"
  ]);
});

test("live risk engine rejects stale signals and unknown or closed market hours", () => {
  const staleDecision = evaluate({
    intent: baseIntent({ expiresAt: stale })
  });
  const unknownMarketHoursDecision = evaluate({
    snapshot: baseSnapshot({ marketSessions: {} })
  });
  const closedMarketDecision = evaluate({
    snapshot: baseSnapshot({ marketSessions: { KR: "closed" } })
  });

  assert.equal(staleDecision.approved, false);
  assert.deepEqual(staleDecision.rejectCodes, ["SIGNAL_STALE"]);
  assert.equal(unknownMarketHoursDecision.approved, false);
  assert.deepEqual(unknownMarketHoursDecision.rejectCodes, [
    "MARKET_HOURS_UNKNOWN"
  ]);
  assert.equal(closedMarketDecision.approved, false);
  assert.deepEqual(closedMarketDecision.rejectCodes, ["MARKET_CLOSED"]);
});

test("live risk engine rejects duplicate intent, reused idempotency, and cooldown", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      openOrders: [
        {
          orderIntentId: "intent_live_existing",
          signalId: "signal_live_001",
          idempotencyKey: "idem_live_001",
          market: "KR",
          symbol: "005930",
          side: "BUY",
          estimatedGrossAmountKrw: 1
        }
      ]
    }),
    policy: approvingPolicy({
      cooldownEntries: [
        {
          market: "KR",
          symbol: "005930",
          side: "BUY",
          activeUntil: fresh,
          reason: "previous reject"
        }
      ]
    })
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, [
    "IDEMPOTENCY_KEY_REUSED",
    "DUPLICATE_ORDER_INTENT",
    "COOLDOWN_ACTIVE"
  ]);
});

test("live risk engine rejects duplicate order intent id before approval", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      openOrders: [
        {
          orderIntentId: "intent_live_001",
          idempotencyKey: "idem_live_regenerated",
          market: "KR",
          symbol: "000660",
          side: "SELL",
          quantity: 1
        }
      ]
    })
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, ["DUPLICATE_ORDER_INTENT"]);
});

test("live risk engine enforces order amount, daily loss, and exposure caps", () => {
  const decision = evaluate({
    intent: baseIntent({ estimatedGrossAmountKrw: 120_000 }),
    snapshot: baseSnapshot({ dailyLossKrw: 60_000 }),
    policy: approvingPolicy({
      maxOrderAmountKrw: 100_000,
      maxDailyLossKrw: 50_000,
      maxSymbolExposureKrw: 100_000,
      maxMarketExposureKrw: 250_000,
      maxTotalExposureKrw: 250_000
    })
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, [
    "MAX_ORDER_AMOUNT_EXCEEDED",
    "MAX_DAILY_LOSS_EXCEEDED",
    "PREVIEW_MISMATCH",
    "MAX_SYMBOL_EXPOSURE_EXCEEDED",
    "MAX_MARKET_EXPOSURE_EXCEEDED",
    "MAX_TOTAL_EXPOSURE_EXCEEDED"
  ]);
});

test("live risk engine rejects stale risk snapshots", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      capturedAt: "2026-06-17T09:58:59.000Z"
    }),
    policy: approvingPolicy({ maxSnapshotAgeMs: 60_000 })
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("RISK_SNAPSHOT_STALE"));
});

test("live risk engine rejects invalid numeric policy limits", () => {
  const decision = evaluate({
    policy: approvingPolicy({
      maxOrderAmountKrw: Number.NaN,
      maxSymbolExposureKrw: Number.POSITIVE_INFINITY,
      maxOpenOrders: Number.NaN
    })
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_POLICY"));
  assert.ok(decision.rejectCodes.includes("MAX_ORDER_AMOUNT_EXCEEDED"));
  assert.ok(decision.rejectCodes.includes("OPEN_ORDER_LIMIT_EXCEEDED"));
});

test("live risk engine rejects malformed boolean policy gates", () => {
  const decision = evaluate({
    policy: ({
      ...approvingPolicy(),
      killSwitch: 0,
      requireMarketOpen: "false",
      requirePreview: 1
    } as unknown) as Partial<LiveRiskPolicy>
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_POLICY"));
  assert.ok(decision.rejectCodes.includes("KILL_SWITCH_ACTIVE"));
});

test("live risk engine rejects invalid market order policy", () => {
  const decision = evaluate({
    intent: baseIntent({
      orderType: "MARKET",
      approvals: { marketOrderApproved: true }
    }),
    policy: ({
      ...approvingPolicy({ marketOrderPolicy: "allowed" }),
      marketOrderPolicy: "require_approval"
    } as unknown) as Partial<LiveRiskPolicy>
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_POLICY"));
  assert.ok(decision.rejectCodes.includes("MARKET_ORDER_DISABLED"));
});

test("live risk engine rejects malformed policy collections without throwing", () => {
  const decision = evaluate({
    policy: ({
      ...approvingPolicy(),
      allowedSymbols: "005930",
      allowedMarkets: "KR",
      cooldownEntries: [{ symbol: 123, activeUntil: fresh }]
    } as unknown) as Partial<LiveRiskPolicy>
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_POLICY"));
  assert.ok(decision.rejectCodes.includes("SYMBOL_NOT_ALLOWED"));
  assert.ok(decision.rejectCodes.includes("MARKET_NOT_ALLOWED"));
});

test("live risk engine reserves pending buy exposure against caps", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      openOrders: [
        {
          orderIntentId: "intent_live_pending",
          signalId: "signal_live_pending",
          idempotencyKey: "idem_live_pending",
          market: "KR",
          symbol: "005930",
          side: "BUY",
          estimatedGrossAmountKrw: 30_000
        }
      ]
    }),
    policy: approvingPolicy({
      maxSymbolExposureKrw: 100_000,
      maxMarketExposureKrw: 500_000,
      maxTotalExposureKrw: 700_000
    })
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, [
    "MAX_SYMBOL_EXPOSURE_EXCEEDED"
  ]);
});

test("live risk engine aggregates duplicate position rows for symbol exposure", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 10_000,
          marketValueKrw: 10_000
        },
        {
          market: "KR",
          symbol: "005930",
          quantity: 2,
          averagePriceKrw: 10_000,
          marketValueKrw: 20_000
        }
      ]
    }),
    policy: approvingPolicy({
      maxSymbolExposureKrw: 100_000,
      maxMarketExposureKrw: 500_000,
      maxTotalExposureKrw: 700_000
    })
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, [
    "MAX_SYMBOL_EXPOSURE_EXCEEDED"
  ]);
});

test("live risk engine rejects pending buy exposure without notional", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      openOrders: [
        {
          orderIntentId: "intent_live_pending",
          signalId: "signal_live_pending",
          idempotencyKey: "idem_live_pending",
          market: "KR",
          symbol: "005930",
          side: "BUY"
        }
      ]
    }),
    policy: approvingPolicy({
      maxSymbolExposureKrw: 1_000_000,
      maxMarketExposureKrw: 1_000_000,
      maxTotalExposureKrw: 1_000_000
    })
  });

  assert.equal(decision.approved, false);
  assert.ok(
    decision.rejectCodes.includes("INVALID_RISK_SNAPSHOT")
  );
});

test("live risk engine rejects pending sell quantity beyond holdings", () => {
  const decision = evaluate({
    intent: baseIntent({
      side: "SELL",
      symbol: "000660",
      quantity: 2
    }),
    snapshot: baseSnapshot({
      openOrders: [
        {
          orderIntentId: "intent_live_pending_sell",
          signalId: "signal_live_pending_sell",
          idempotencyKey: "idem_live_pending_sell",
          market: "KR",
          symbol: "000660",
          side: "SELL",
          quantity: 1
        }
      ]
    })
  });

  assert.equal(decision.approved, false);
  assert.deepEqual(decision.rejectCodes, ["SELL_QUANTITY_EXCEEDED"]);
});

test("live risk engine rejects pending sell order without quantity", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      openOrders: [
        {
          orderIntentId: "intent_live_pending_sell",
          signalId: "signal_live_pending_sell",
          idempotencyKey: "idem_live_pending_sell",
          market: "KR",
          symbol: "000660",
          side: "SELL"
        }
      ]
    })
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_SNAPSHOT"));
});

test("live risk engine enforces market order and preview policies", () => {
  const disabledMarketOrderDecision = evaluate({
    intent: baseIntent({ orderType: "MARKET" })
  });
  const approvalRequiredDecision = evaluate({
    intent: baseIntent({ orderType: "MARKET" }),
    policy: approvingPolicy({ marketOrderPolicy: "requires_approval" })
  });
  const approvedMarketOrderDecision = evaluate({
    intent: baseIntent({
      orderType: "MARKET",
      approvals: { marketOrderApproved: true }
    }),
    policy: approvingPolicy({ marketOrderPolicy: "requires_approval" })
  });
  const expiredPreviewDecision = evaluate({
    intent: baseIntent({
      preview: {
        previewId: "preview_live_001",
        orderIntentId: "intent_live_001",
        estimatedGrossAmountKrw: 80_000,
        expiresAt: stale
      }
    })
  });

  assert.deepEqual(disabledMarketOrderDecision.rejectCodes, [
    "MARKET_ORDER_DISABLED"
  ]);
  assert.deepEqual(approvalRequiredDecision.rejectCodes, [
    "MARKET_ORDER_REQUIRES_APPROVAL"
  ]);
  assert.equal(approvedMarketOrderDecision.approved, true);
  assert.deepEqual(expiredPreviewDecision.rejectCodes, ["PREVIEW_EXPIRED"]);
});

test("live risk engine rejects sell intents without enough position", () => {
  const missingPositionDecision = evaluate({
    intent: baseIntent({
      side: "SELL",
      symbol: "005930",
      quantity: 1
    })
  });
  const oversizedSellDecision = evaluate({
    intent: baseIntent({
      side: "SELL",
      symbol: "000660",
      quantity: 3
    })
  });

  assert.equal(missingPositionDecision.approved, false);
  assert.deepEqual(missingPositionDecision.rejectCodes, [
    "POSITION_NOT_FOUND"
  ]);
  assert.equal(oversizedSellDecision.approved, false);
  assert.deepEqual(oversizedSellDecision.rejectCodes, [
    "SELL_QUANTITY_EXCEEDED"
  ]);
});

test("live risk engine rejects malformed numeric intent and snapshot values", () => {
  const invalidIntentDecision = evaluate({
    intent: baseIntent({
      quantity: 0,
      estimatedGrossAmountKrw: Number.NaN
    })
  });
  const invalidSnapshotDecision = evaluate({
    snapshot: baseSnapshot({
      dailyLossKrw: Number.NaN,
      positions: [
        {
          market: "KR",
          symbol: "000660",
          quantity: -1,
          averagePriceKrw: 100_000
        }
      ]
    })
  });

  assert.equal(invalidIntentDecision.approved, false);
  assert.ok(
    invalidIntentDecision.rejectCodes.includes("INVALID_ORDER_INTENT")
  );
  assert.equal(invalidSnapshotDecision.approved, false);
  assert.ok(
    invalidSnapshotDecision.rejectCodes.includes("INVALID_RISK_SNAPSHOT")
  );
});

test("live risk engine rejects malformed snapshot collections without throwing", () => {
  const decision = evaluate({
    snapshot: ({
      ...baseSnapshot(),
      positions: null,
      openOrders: undefined,
      marketSessions: null
    } as unknown) as LiveRiskSnapshot
  });
  const malformedElementDecision = evaluate({
    snapshot: ({
      ...baseSnapshot(),
      positions: [null],
      openOrders: [null]
    } as unknown) as LiveRiskSnapshot
  });

  assert.equal(decision.approved, false);
  assert.ok(
    decision.rejectCodes.includes("INVALID_RISK_SNAPSHOT")
  );
  assert.equal(malformedElementDecision.approved, false);
  assert.ok(
    malformedElementDecision.rejectCodes.includes("INVALID_RISK_SNAPSHOT")
  );
});

test("live risk engine rejects missing live risk input without throwing", () => {
  const decision = new LiveRiskEngine().evaluate(
    null as unknown as LiveRiskInput
  );

  assert.equal(decision.approved, false);
  assert.equal(decision.orderIntentId, "invalid_order_intent");
  assert.equal(decision.signalId, "invalid_signal");
  assert.equal(decision.riskSnapshotRef, "invalid_risk_snapshot");
  assert.ok(decision.rejectCodes.includes("INVALID_ORDER_INTENT"));
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_SNAPSHOT"));
});

test("live risk engine rejects malformed root payloads before dereferencing", () => {
  const decision = new LiveRiskEngine().evaluate(({
    intent: null,
    snapshot: null,
    policy: null
  } as unknown) as LiveRiskInput);

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_ORDER_INTENT"));
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_SNAPSHOT"));
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_POLICY"));
});

test("live risk engine rejects snapshot metadata without audit identity", () => {
  const decision = evaluate({
    snapshot: baseSnapshot({
      riskSnapshotRef: " ",
      capturedAt: "not-a-date"
    })
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_SNAPSHOT"));
});

test("live risk engine rejects malformed enum and identity intent fields", () => {
  const decision = evaluate({
    intent: ({
      ...baseIntent(),
      orderIntentId: " ",
      idempotencyKey: "",
      symbol: undefined,
      side: "WAIT",
      orderType: "STOP"
    } as unknown) as LiveOrderIntent
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_ORDER_INTENT"));
});

test("live risk engine rejects malformed live order previews", () => {
  const decision = evaluate({
    intent: baseIntent({
      preview: {
        previewId: " ",
        orderIntentId: "intent_live_001",
        estimatedGrossAmountKrw: 80_000,
        expiresAt: fresh
      }
    })
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_ORDER_INTENT"));
});

test("live risk engine rejects cooldown entries with invalid expiry dates", () => {
  const decision = evaluate({
    policy: approvingPolicy({
      cooldownEntries: [
        {
          market: "KR",
          symbol: "005930",
          side: "BUY",
          activeUntil: "not-a-date",
          reason: "malformed policy"
        }
      ]
    })
  });

  assert.equal(decision.approved, false);
  assert.ok(decision.rejectCodes.includes("INVALID_RISK_POLICY"));
});

test("live risk engine keeps sell exposure checks from increasing exposure", () => {
  const decision = evaluate({
    intent: baseIntent({
      side: "SELL",
      symbol: "000660",
      estimatedGrossAmountKrw: 600_000,
      preview: {
        previewId: "preview_live_sell_001",
        orderIntentId: "intent_live_001",
        estimatedGrossAmountKrw: 600_000,
        expiresAt: fresh
      }
    }),
    policy: approvingPolicy({
      maxOrderAmountKrw: 700_000,
      maxSymbolExposureKrw: 10_000,
      maxMarketExposureKrw: 220_000,
      maxTotalExposureKrw: 220_000
    })
  });

  assert.equal(decision.approved, true);
  assert.deepEqual(decision.rejectCodes, []);
});
