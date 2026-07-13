import assert from "node:assert/strict";
import test from "node:test";

import { buildPaperFill, createPaperExecutionPolicy } from "./executionModel.js";

test("paper execution keeps spread unmodeled by default", () => {
  const policy = createPaperExecutionPolicy(undefined);
  const fill = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: 100_000,
    sourcePriceKrw: 10_000,
    policy
  });

  assert.equal(policy.halfSpreadBps, 0);
  assert.equal(fill.spreadCostKrw, 0);
  assert.equal(fill.totalCostKrw, 0);
  assert.equal(fill.netAmountKrw, 100_000);
});

test("paper execution charges fixed half-spread on buy and sell fills", () => {
  const policy = createPaperExecutionPolicy({ halfSpreadBps: 10 });
  const buy = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: 100_000,
    sourcePriceKrw: 10_000,
    policy
  });
  const sell = buildPaperFill({
    action: "VIRTUAL_SELL",
    targetNotionalKrw: 100_000,
    sourcePriceKrw: 10_000,
    quantityOverride: 10,
    policy
  });

  assert.equal(buy.spreadCostKrw, 100);
  assert.equal(buy.totalCostKrw, 100);
  assert.equal(buy.netAmountKrw, 100_100);
  assert.equal(sell.spreadCostKrw, 100);
  assert.equal(sell.totalCostKrw, 100);
  assert.equal(sell.netAmountKrw, 99_900);
});
