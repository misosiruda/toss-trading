import assert from "node:assert/strict";
import test from "node:test";
import { VirtualRiskEngine, type VirtualRiskInput } from "../paper/riskEngine.js";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import {
  sourceDecision, sourceEarlierTime, sourceOptions, sourcePortfolio, sourceSnapshot, sourceTime
} from "./codexReplaySourceTestFixtures.js";

test("market regime allocation consumes the captured history despite caller and source observer edits", async () => {
  const snapshots = [
    sourceSnapshot({ snapshotId: "kr_early", observedAt: sourceEarlierTime, lastPriceKrw: 100 }),
    sourceSnapshot({ snapshotId: "kr_now", lastPriceKrw: 96 }),
    sourceSnapshot({ snapshotId: "us_early", market: "US", symbol: "AAPL", observedAt: sourceEarlierTime, lastPriceKrw: 100 }),
    sourceSnapshot({ snapshotId: "us_now", market: "US", symbol: "AAPL", lastPriceKrw: 104 })
  ];
  const options = sourceOptions({
    allocationPolicy: {
      policyName: "source_allocation", targetExposureRatio: 0.85, minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2, maxSymbolExposureRatio: 0.3
    },
    marketRegimeAllocationPolicy: { lookbackDays: 3, minSymbols: 1, minSnapshotsPerSymbol: 2 }
  });
  const result = await runCodexHistoricalReplay({ ...options,
    onInitialPortfolio: () => {
      // Reverse both classifications while leaving tick prices unchanged.
      snapshots[0]!.lastPriceKrw = 90;
      snapshots[2]!.lastPriceKrw = 110;
    },
    onSourceSnapshots: source => {
      assert.equal(source.status, "recorded");
      if (source.status !== "recorded") throw Error("Expected recorded source");
      source.snapshot[0]!.lastPriceKrw = 90;
      source.snapshot[2]!.lastPriceKrw = 110;
    }
  }, { initialPortfolio: sourcePortfolio(), snapshots });
  assert.deepEqual(result.packets[0]!.portfolioAllocation!.marketTargetExposureRatios, { KR: 0.17, US: 0.68 });
  assert.equal(result.packets[0]!.portfolioAllocation!.marketAllocations!.KR!.maxAdditionalBuyBudgetKrw, 170_000);
  assert.equal(result.packets[0]!.portfolioAllocation!.marketAllocations!.US!.maxAdditionalBuyBudgetKrw, 680_000);

  const changed = await runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots });
  assert.deepEqual(changed.packets[0]!.portfolioAllocation!.marketTargetExposureRatios, { KR: 0.68, US: 0.17 });
});

test("exit and provider risk evaluation both receive the captured regime and retain real risk outcomes", async t => {
  const snapshots = [
    sourceSnapshot({ snapshotId: "exit_early", observedAt: sourceEarlierTime, lastPriceKrw: 125 }),
    sourceSnapshot({ snapshotId: "exit_now", lastPriceKrw: 120 }),
    sourceSnapshot({ snapshotId: "buy_early", symbol: "000660", observedAt: sourceEarlierTime, lastPriceKrw: 100 }),
    sourceSnapshot({ snapshotId: "buy_now", symbol: "000660", lastPriceKrw: 96 })
  ];
  const evaluated: VirtualRiskInput[] = [];
  const evaluate = VirtualRiskEngine.prototype.evaluate;
  t.mock.method(VirtualRiskEngine.prototype, "evaluate", function (this: VirtualRiskEngine, input: VirtualRiskInput) {
    evaluated.push(structuredClone(input));
    return evaluate.call(this, input);
  });
  const initialPortfolio = sourcePortfolio({ cashKrw: 98_800, positions: [{
    market: "KR", symbol: "005930", quantity: 10, averagePriceKrw: 100,
    marketValueKrw: 1_000, updatedAt: sourceEarlierTime
  }] });
  const options = sourceOptions({
    paperExitPolicy: { takeProfitRatio: 0.15 },
    riskPolicy: {
      maxBudgetPerDecisionKrw: 100_000, maxSymbolExposureKrw: 100_000,
      maxPositionWeightRatio: 1, minCashReserveRatio: 0.05,
      dynamicCashReservePolicy: {
        lookbackDays: 3, minSymbols: 2, minSnapshotsPerSymbol: 2, highVolatilityReturnThreshold: 1
      }
    },
    decisionProvider: { decide: async packet => sourceDecision(packet, "000660") }
  });
  const result = await runCodexHistoricalReplay({ ...options,
    onInitialPortfolio: () => { snapshots[0]!.lastPriceKrw = 110; snapshots[2]!.lastPriceKrw = 90; },
    onSourceSnapshots: source => {
      assert.equal(source.status, "recorded");
      if (source.status !== "recorded") throw Error("Expected recorded source");
      source.snapshot[0]!.lastPriceKrw = 110;
      source.snapshot[2]!.lastPriceKrw = 90;
    }
  }, { initialPortfolio, snapshots });
  assert.deepEqual(evaluated.map(input => [input.decision.action, input.decision.symbol]), [
    ["VIRTUAL_SELL", "005930"], ["VIRTUAL_BUY", "000660"]
  ]);
  for (const input of evaluated) {
    assert.equal(input.policy!.now!.toISOString(), sourceTime);
    assert.equal(input.policy!.dynamicCashReserveMarketRegime!.label, "bear");
    assert.deepEqual(input.policy!.dynamicCashReserveMarketRegime!.symbolReturns.map(item => [
      item.symbol, item.firstPriceKrw, item.lastPriceKrw
    ]).sort(), [["000660", 100, 96], ["005930", 125, 120]]);
  }
  assert.deepEqual(result.trades.map(trade => [trade.action, trade.symbol]), [["VIRTUAL_SELL", "005930"]]);
  assert.deepEqual(result.riskDecisions.map(risk => risk.rejectCodes), [[], ["VIRTUAL_REGIME_CASH_RESERVE_BREACHED"]]);
  assert.equal(result.finalPortfolio.cashKrw, 100_000);
  assert.deepEqual(result.finalPortfolio.positions, []);

  // Sensitivity control: caller-mutated history really produces bull and allows this same buy.
  evaluated.length = 0;
  const changed = await runCodexHistoricalReplay(options, { initialPortfolio, snapshots });
  assert.deepEqual(evaluated.map(input => input.policy!.dynamicCashReserveMarketRegime!.label), ["bull", "bull"]);
  assert.deepEqual(changed.trades.map(trade => [trade.action, trade.symbol]), [
    ["VIRTUAL_SELL", "005930"], ["VIRTUAL_BUY", "000660"]
  ]);
  assert.equal(changed.rejectedCount, 0);
});
