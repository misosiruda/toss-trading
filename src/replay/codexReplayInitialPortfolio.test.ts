import assert from "node:assert/strict";
import test from "node:test";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import { initialOptions, initialPortfolio } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";

test("runner initializes an isolated portfolio before observation and awaits it before reading ticks", async t => {
  const portfolio = initialPortfolio(), expected = structuredClone(portfolio), options = initialOptions("unused");
  let entered!: () => void, release!: () => void, ticks = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalTicks = options.clock.ticks.bind(options.clock);
  t.mock.method(options.clock, "ticks", () => { ticks++; return originalTicks(); });
  const replay = runCodexHistoricalReplay({ ...options,
    decisionProvider: { decide: async () => { throw Error("no candidates"); } },
    onInitialPortfolio: async observed => {
      assert.deepEqual(observed, expected);
      observed.cashKrw = 999; observed.positions[0]!.riskTags!.push("leveraged");
      observed.positions[0]!.priceSourceRefs!.push("observer-change");
      entered(); await gate;
    }
  }, { initialPortfolio: portfolio, snapshots: [] });
  await started;
  assert.equal(ticks, 0);
  portfolio.cashKrw = 444; portfolio.positions[0]!.riskTags!.push("inverse");
  portfolio.positions[0]!.priceSourceRefs!.push("caller-change");
  release();
  const result = await replay;
  assert.deepEqual(result.initialPortfolio, expected);
  assert.deepEqual(result.finalPortfolio.positions[0]!.riskTags, expected.positions[0]!.riskTags);
  assert.equal(ticks, 1);
});

test("initial observation rejection prevents clock/provider/state transition work", async t => {
  const options = initialOptions("unused"); let ticks = 0, providers = 0;
  t.mock.method(options.clock, "ticks", () => { ticks++; return []; });
  await assert.rejects(runCodexHistoricalReplay({ ...options,
    decisionProvider: { decide: async () => { providers++; throw Error("must not run"); } },
    onInitialPortfolio: async () => { throw Error("synthetic observation failure"); }
  }, { initialPortfolio: initialPortfolio(), snapshots: [] }), /synthetic observation failure/);
  assert.equal(ticks, 0); assert.equal(providers, 0);
});
