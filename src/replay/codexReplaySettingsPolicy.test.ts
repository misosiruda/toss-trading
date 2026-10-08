import assert from "node:assert/strict";
import test from "node:test";
import type { ReplaySettingsSnapshotObservation } from "../domain/replaySettingsSnapshot.js";
import { VirtualRiskEngine, type VirtualRiskInput } from "../paper/riskEngine.js";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import { SimulatedClock } from "./simulatedClock.js";
import { sourceDecision, sourceEarlierTime, sourceOptions, sourcePortfolio, sourceSnapshot, sourceTime } from "./codexReplaySourceTestFixtures.js";
import { settingsDecision } from "./codexReplaySettingsTestFixtures.js";

test("Risk keeps packet-dependent defaults separate from allocation caps and explicit budgets", async t => {
  for (const scenario of [
    { name: "late packet fallback", risk: {}, rejected: [] },
    { name: "explicit decision budget", risk: { maxBudgetPerDecisionKrw: 50_000, maxSymbolExposureKrw: 150_000 },
      rejected: ["VIRTUAL_BUDGET_EXCEEDED"] },
    { name: "explicit symbol exposure", risk: { maxBudgetPerDecisionKrw: 90_000, maxSymbolExposureKrw: 100_000 },
      rejected: ["VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED"] }
  ]) {
    await t.test(scenario.name, async () => {
      const options = sourceOptions({
        riskPolicy: { maxPositionWeightRatio: 1, minCashReserveRatio: 0, targetExposureRatio: 0.01, ...scenario.risk },
        allocationPolicy: { policyName: "separate_caps", targetExposureRatio: 0.8, minCashReserveRatio: 0,
          maxBudgetPerDecisionRatio: 0.06, maxSymbolExposureRatio: 0.9 },
        onSettings: observation => {
          assert.equal(observation.status, "recorded");
          if (observation.status !== "recorded") throw Error("Expected recorded settings");
          assert.deepEqual(observation.snapshot.riskPolicy, {
            maxPositionWeightRatio: 1, minCashReserveRatio: 0, targetExposureRatio: 0.01, ...scenario.risk
          });
          observation.snapshot.riskPolicy!.maxBudgetPerDecisionKrw = 1;
          observation.snapshot.riskPolicy!.maxSymbolExposureKrw = 1;
        },
        decisionProvider: { decide: async packet => {
          assert.equal(packet.constraints.maxBudgetPerSymbolKrw, 100_000);
          assert.equal(packet.portfolioAllocation!.maxBudgetPerDecisionKrw, 60_000);
          // The fallback belongs to the actual packet at Risk evaluation, not capture time.
          packet.constraints.maxBudgetPerSymbolKrw = 200_000;
          options.riskPolicy!.maxBudgetPerDecisionKrw = 1;
          options.riskPolicy!.maxSymbolExposureKrw = 1;
          await Promise.resolve();
          return settingsDecision(packet, 80_000);
        } }
      });
      const result = await runCodexHistoricalReplay(options, {
        initialPortfolio: sourcePortfolio({ cashKrw: 950_000, positions: [{ market: "KR", symbol: "000660",
          quantity: 500, averagePriceKrw: 100, marketValueKrw: 50_000, updatedAt: sourceEarlierTime }] }),
        snapshots: [sourceSnapshot({ symbol: "000660", lastPriceKrw: 100 })]
      });
      assert.equal(result.decisions[0]!.decisions[0]!.budgetKrw, 60_000);
      assert.deepEqual(result.riskDecisions[0]!.rejectCodes, scenario.rejected);
      assert.equal(result.tradeCount, scenario.rejected.length ? 0 : 1);
      if (!scenario.rejected.length) assert.equal(result.trades[0]!.amountKrw, 60_000);
    });
  }
});

test("captured dynamic Risk settings govern both pre-provider exit and post-provider buy", async t => {
  const evaluated: VirtualRiskInput[] = [];
  const evaluate = VirtualRiskEngine.prototype.evaluate;
  t.mock.method(VirtualRiskEngine.prototype, "evaluate", function (this: VirtualRiskEngine, input: VirtualRiskInput) {
    evaluated.push(structuredClone(input));
    return evaluate.call(this, input);
  });
  const options = sourceOptions({
    paperExitPolicy: { takeProfitRatio: 0.15 },
    riskPolicy: { maxBudgetPerDecisionKrw: 100_000, maxSymbolExposureKrw: 100_000,
      maxPositionWeightRatio: 1, minCashReserveRatio: 0.05, now: new Date("2030-01-01T00:00:00.000Z"),
      dynamicCashReservePolicy: { lookbackDays: 3, minSymbols: 2, minSnapshotsPerSymbol: 2,
        highVolatilityReturnThreshold: 1, regimeCashReserveRatios: { bear: 0.3 } },
      cooldownEntries: [{ symbol: "000660", activeUntil: "invalid-date-is-inactive" }] },
    onSourceSnapshots: () => {},
    onInitialPortfolio: async () => {
      options.riskPolicy!.dynamicCashReservePolicy!.regimeCashReserveRatios!.bear = 0;
      options.paperExitPolicy!.takeProfitRatio = 9;
      await Promise.resolve();
    },
    onSettings: observation => {
      assert.equal(observation.status, "recorded");
      if (observation.status !== "recorded") throw Error("Expected recorded settings");
      assert.equal(Object.hasOwn(observation.snapshot.riskPolicy!, "now"), false);
      assert.equal(observation.snapshot.riskPolicy!.cooldownEntries![0]!.activeUntil, "invalid-date-is-inactive");
      observation.snapshot.riskPolicy!.dynamicCashReservePolicy!.regimeCashReserveRatios!.bear = 0;
      observation.snapshot.riskPolicy!.cooldownEntries![0]!.activeUntil = "2030-01-01T00:00:00.000Z";
      observation.snapshot.paperExitPolicy!.takeProfitRatio = 9;
    },
    onProgress: async () => {
      options.riskPolicy!.dynamicCashReservePolicy!.minSymbols = 99;
      await Promise.resolve();
    },
    decisionProvider: { decide: async packet => {
      options.riskPolicy!.dynamicCashReservePolicy!.lookbackDays = 0.00001;
      await Promise.resolve();
      return sourceDecision(packet, "000660");
    } }
  });
  const result = await runCodexHistoricalReplay(options, {
    initialPortfolio: sourcePortfolio({ cashKrw: 98_800, positions: [{ market: "KR", symbol: "005930",
      quantity: 10, averagePriceKrw: 100, marketValueKrw: 1_000, updatedAt: sourceEarlierTime }] }),
    snapshots: [sourceSnapshot({ snapshotId: "held_before", observedAt: sourceEarlierTime, lastPriceKrw: 125 }),
      sourceSnapshot({ lastPriceKrw: 120 }),
      sourceSnapshot({ snapshotId: "buy_before", symbol: "000660", observedAt: sourceEarlierTime, lastPriceKrw: 100 }),
      sourceSnapshot({ snapshotId: "buy_now", symbol: "000660", lastPriceKrw: 96 })]
  });
  assert.deepEqual(evaluated.map(input => input.decision.action), ["VIRTUAL_SELL", "VIRTUAL_BUY"]);
  for (const input of evaluated) {
    assert.equal(input.policy!.now!.toISOString(), sourceTime);
    assert.equal(input.policy!.dynamicCashReserveMarketRegime!.label, "bear");
    assert.deepEqual(input.policy!.dynamicCashReservePolicy!.regimeCashReserveRatios, { bear: 0.3 });
    assert.equal(input.policy!.dynamicCashReservePolicy!.minSymbols, 2);
    assert.equal(input.policy!.dynamicCashReservePolicy!.lookbackDays, 3);
  }
  assert.deepEqual(result.riskDecisions.map(risk => risk.rejectCodes), [[], ["VIRTUAL_REGIME_CASH_RESERVE_BREACHED"]]);
  assert.deepEqual(result.trades.map(trade => [trade.action, trade.symbol]), [["VIRTUAL_SELL", "005930"]]);
  assert.equal(result.finalPortfolio.cashKrw, 100_000);
});

test("allocation, ramp derivation, regime weights and returned policy use the captured settings", async () => {
  const base = { policyName: "captured", targetExposureRatio: 0.8, minCashReserveRatio: 0.05,
    maxBudgetPerDecisionRatio: 0.2, maxSymbolExposureRatio: 0.3, deploymentRampDays: 2,
    maxInitialDeploymentRatio: 0.2, maxInitialOpenPositions: 1, maxConcurrentPositions: 4,
    positionSlotRampDays: 2, marketTargetExposureRatios: { KR: 0.4, US: 0.4 } };
  const options = sourceOptions({
    clock: new SimulatedClock({ startAt: new Date(sourceTime), endAt: new Date(Date.parse(sourceTime) + 60_000), stepSeconds: 60 }),
    allocationPolicy: structuredClone(base),
    marketRegimeAllocationPolicy: { lookbackDays: 3, policyNameSuffix: "_regimes", minSymbols: 1,
      minSnapshotsPerSymbol: 2, regimeWeights: { bear: 1, bull: 3 } },
    onInitialPortfolio: () => {
      options.allocationPolicy!.targetExposureRatio = 0.1;
      options.allocationPolicy!.marketTargetExposureRatios!.KR = 0.1;
      options.allocationPolicy!.rampDayIndex = 77;
      options.marketRegimeAllocationPolicy!.regimeWeights!.bear = 9;
    },
    onSettings: observation => {
      assert.equal(observation.status, "recorded");
      if (observation.status !== "recorded") throw Error("Expected recorded settings");
      assert.deepEqual(observation.snapshot.allocationPolicy, base);
      observation.snapshot.allocationPolicy!.maxInitialDeploymentRatio = 0.01;
      observation.snapshot.marketRegimeAllocationPolicy!.regimeWeights!.bull = 0;
    }
  });
  const result = await runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [
    sourceSnapshot({ snapshotId: "kr_old", observedAt: sourceEarlierTime, lastPriceKrw: 100 }),
    sourceSnapshot({ lastPriceKrw: 96 }),
    sourceSnapshot({ snapshotId: "us_old", market: "US", symbol: "AAPL", observedAt: sourceEarlierTime, lastPriceKrw: 100 }),
    sourceSnapshot({ snapshotId: "us_now", market: "US", symbol: "AAPL", lastPriceKrw: 104 })
  ] });
  assert.deepEqual(result.packets.map(packet => packet.portfolioAllocation!.rampDayIndex), [1, 2]);
  assert.deepEqual(result.packets.map(packet => packet.portfolioAllocation!.scheduledExposureCeilingRatio), [0.2, 0.8]);
  assert.deepEqual(result.packets.map(packet => packet.portfolioAllocation!.scheduledOpenPositionCeiling), [1, 4]);
  for (const packet of result.packets) {
    assert.equal(packet.portfolioAllocation!.policyName, "captured_regimes");
    assert.deepEqual(packet.portfolioAllocation!.marketTargetExposureRatios, { KR: 0.2, US: 0.6 });
  }
  assert.deepEqual(result.allocationPolicy, base);
  assert.equal(Object.hasOwn(result.allocationPolicy!, "rampDayIndex"), false);
  assert.equal(Object.isFrozen(result.allocationPolicy!), false);
  result.allocationPolicy!.marketTargetExposureRatios!.KR = 0;
  assert.equal(result.packets[0]!.portfolioAllocation!.marketTargetExposureRatios!.KR, 0.2);
});

test("supplied negative spread and impact remain raw while execution normalizes at fill time", async () => {
  let observed: ReplaySettingsSnapshotObservation | undefined;
  const result = await runCodexHistoricalReplay(sourceOptions({
    executionPolicy: { halfSpreadBps: -5, marketImpactBpsPerParticipationRate: -8 },
    onSettings: observation => { observed = observation; },
    decisionProvider: { decide: async packet => sourceDecision(packet, "005930") }
  }), { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot({ lastPriceKrw: 100 })] });
  assert.equal(observed?.status, "recorded");
  if (observed?.status !== "recorded") throw Error("Expected recorded settings");
  assert.deepEqual(observed.snapshot.executionPolicy, { halfSpreadBps: -5, marketImpactBpsPerParticipationRate: -8 });
  assert.equal(result.tradeCount, 1);
  assert.equal(result.trades[0]!.spreadCostKrw, 0);
  assert.equal(result.trades[0]!.impactCostKrw, 0);
  assert.equal(result.trades[0]!.amountKrw, 80_000);
});

test("exit normalization keeps absent, empty and secondary-only policies null and preserves warning inputs", async t => {
  for (const policy of [undefined, {}, { takeProfitMode: "partial_then_trail" as const, takeProfitSellRatio: 0.5 }]) {
    const result = await runCodexHistoricalReplay(sourceOptions({ onSettings: observation => {
      assert.equal(observation.status, "recorded");
      if (observation.status !== "recorded") throw Error("Expected recorded settings");
      assert.equal(Object.hasOwn(observation.snapshot, "paperExitPolicy"), policy !== undefined);
      assert.deepEqual(observation.snapshot.paperExitPolicy, policy);
    }, ...(policy === undefined ? {} : { paperExitPolicy: policy }) }), {
      initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()]
    });
    assert.equal(result.paperExitPolicy, null);
  }
  const events: string[] = [];
  const invalid = sourceOptions({ paperExitPolicy: { takeProfitRatio: -1 },
    onInitialPortfolio: () => { events.push("initial"); }, onSourceSnapshots: () => { events.push("source"); },
    onSettings: observation => { assert.equal(observation.status, "recorded"); events.push("settings"); },
    decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
  });
  const ticks = invalid.clock.ticks.bind(invalid.clock);
  t.mock.method(invalid.clock, "ticks", () => { events.push("ticks"); return ticks(); });
  await assert.rejects(runCodexHistoricalReplay(invalid, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] }), /takeProfitRatio/);
  assert.deepEqual(events, ["initial", "source", "settings", "ticks"]);

  const warningOptions = sourceOptions({ riskPolicy: { maxPositionWeightRatio: 0.8 },
    paperExitPolicy: { rebalanceMaxPositionWeightRatio: 0.5 }, marketRegimeAllocationPolicy: { lookbackDays: 3 },
    onSettings: () => {}, onInitialPortfolio: () => {
      warningOptions.riskPolicy!.maxPositionWeightRatio = 0.1;
      warningOptions.paperExitPolicy!.rebalanceMaxPositionWeightRatio = 0.9;
      warningOptions.allocationPolicy = { policyName: "late", targetExposureRatio: 0.8, minCashReserveRatio: 0.05,
        maxBudgetPerDecisionRatio: 0.2, maxSymbolExposureRatio: 0.3 };
    }
  });
  const warningResult = await runCodexHistoricalReplay(warningOptions, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
  assert.ok(warningResult.warnings.includes("paper exit rebalanceMaxPositionWeightRatio (0.5) is below risk maxPositionWeightRatio (0.8)"));
  assert.ok(warningResult.warnings.includes("market regime allocation policy ignored: allocationPolicy is not configured"));
  assert.equal(warningResult.allocationPolicy, null);
  assert.equal(warningResult.packets[0]!.portfolioAllocation, undefined);
});
