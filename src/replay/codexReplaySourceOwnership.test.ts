import assert from "node:assert/strict";
import test from "node:test";
import {
  REPLAY_SOURCE_SNAPSHOT_LIMITS,
  REPLAY_SOURCE_SNAPSHOT_VERSION,
  type ReplaySourceSnapshotObservation
} from "../domain/replaySourceSnapshot.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import {
  heldSourcePortfolio, sourceDecision, sourceGate, sourceOptions, sourcePortfolio, sourceSnapshot
} from "./codexReplaySourceTestFixtures.js";

test("source capture precedes the first await and isolates caller and observer mutations from packets and marks", async () => {
  const first = sourceSnapshot({ lastPriceKrw: 100, sourceRefs: ["fixture:first"] });
  const last = sourceSnapshot({ lastPriceKrw: 110, sourceRefs: ["fixture:last"] });
  // Exact duplicates and equal timestamp/symbol/id ties must remain in their original order.
  const snapshots = [first, structuredClone(first), last];
  const expected = structuredClone(snapshots);
  const expectedHash = createReplayResearchHash({ schemaVersion: REPLAY_SOURCE_SNAPSHOT_VERSION, snapshot: expected });
  const entered = sourceGate(), gate = sourceGate();
  let recorded: ReplaySourceSnapshotObservation | undefined;
  const replay = runCodexHistoricalReplay(sourceOptions({
    onInitialPortfolio: async () => { entered.release(); await gate.promise; },
    onSourceSnapshots: source => {
      assert.equal(source.status, "recorded");
      if (source.status !== "recorded") throw Error("Expected a recorded source");
      assert.deepEqual(source.snapshot, expected);
      assert.equal(source.contentHash, expectedHash);
      recorded = structuredClone(source);
      assert.equal(Object.isFrozen(source.snapshot), false);
      source.snapshot[2]!.lastPriceKrw = 777;
      source.snapshot[2]!.sourceRefs.push("fixture:observer");
      source.snapshot[2]!.riskTags!.push("inverse");
      source.snapshot.reverse();
      source.snapshot.splice(0, 1, sourceSnapshot({ lastPriceKrw: 888 }));
    }
  }), { initialPortfolio: heldSourcePortfolio(), snapshots });
  await entered.promise;
  assert.equal(recorded, undefined);
  assert.equal(Object.isFrozen(snapshots), false);
  assert.equal(Object.isFrozen(last), false);
  last.lastPriceKrw = 999;
  last.sourceRefs.push("fixture:caller");
  last.riskTags!.push("leveraged");
  snapshots.reverse();
  snapshots[1] = sourceSnapshot({ lastPriceKrw: 666 });
  snapshots.push(sourceSnapshot({ symbol: "000660", snapshotId: "caller_added" }));
  gate.release();
  const result = await replay;

  assert.deepEqual(recorded, { status: "recorded", snapshotVersion: REPLAY_SOURCE_SNAPSHOT_VERSION,
    snapshot: expected, contentHash: expectedHash });
  assert.equal(result.packetCount, 1);
  assert.deepEqual(result.packets[0]!.candidates.map(candidate => candidate.symbol), ["005930"]);
  const candidate = result.packets[0]!.candidates[0]!;
  assert.equal(candidate.lastPriceKrw, 110);
  assert.deepEqual(candidate.sourceRefs, ["historical_snapshot:source_fixture", "fixture:last"]);
  assert.deepEqual(candidate.riskTags, ["currency_exposed"]);
  const position = result.finalPortfolio.positions[0]!;
  assert.equal(position.marketPriceKrw, 110);
  assert.equal(position.marketValueKrw, 275);
  assert.equal(position.unrealizedPnlKrw, 25);
  assert.deepEqual(position.priceSourceRefs, candidate.sourceRefs);

  const reversed = await runCodexHistoricalReplay(sourceOptions({ onSourceSnapshots: () => {} }), {
    initialPortfolio: heldSourcePortfolio(), snapshots: structuredClone(expected).reverse()
  });
  assert.equal(reversed.packets[0]!.candidates[0]!.lastPriceKrw, 100);
  assert.equal(reversed.finalPortfolio.positions[0]!.marketValueKrw, 250);
});

test("source observation is awaited after initial observation and before clock or provider execution", async t => {
  const events: string[] = [], entered = sourceGate(), gate = sourceGate();
  const options = sourceOptions({
    onInitialPortfolio: () => { events.push("initial"); },
    onSourceSnapshots: async source => {
      assert.equal(source.status, "recorded");
      events.push("source-start"); entered.release(); await gate.promise; events.push("source-durable");
    },
    decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
  });
  const originalTicks = options.clock.ticks.bind(options.clock);
  t.mock.method(options.clock, "ticks", () => { events.push("clock"); return originalTicks(); });
  const replay = runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
  await entered.promise;
  assert.deepEqual(events, ["initial", "source-start"]);
  gate.release();
  const result = await replay;
  assert.deepEqual(events, ["initial", "source-start", "source-durable", "clock", "provider"]);
  assert.equal(result.decisionProviderCallCount, 1);
});

test("recorded and unavailable source observation failures prevent clock and provider execution", async t => {
  for (const status of ["recorded", "unavailable"] as const) {
    await t.test(status, async subtest => {
      let ticks = 0, providers = 0, progress = 0, initial = 0;
      const snapshots = [sourceSnapshot(status === "recorded" ? {} : {
        sourceRefs: Array.from({ length: REPLAY_SOURCE_SNAPSHOT_LIMITS.sourceRefs + 1 }, (_, index) => `fixture:${index}`)
      })];
      const options = sourceOptions({
        onInitialPortfolio: () => { initial++; },
        onSourceSnapshots: async source => {
          assert.equal(source.status, status);
          throw Error(`synthetic ${status} source write failure`);
        },
        onProgress: () => { progress++; },
        decisionProvider: { decide: async packet => { providers++; return sourceDecision(packet); } }
      });
      subtest.mock.method(options.clock, "ticks", () => { ticks++; return []; });
      await assert.rejects(runCodexHistoricalReplay(options, {
        initialPortfolio: sourcePortfolio(), snapshots
      }), new RegExp(`synthetic ${status} source write failure`));
      assert.equal(initial, 1);
      assert.equal(ticks, 0);
      assert.equal(providers, 0);
      assert.equal(progress, 0);
    });
  }
});

test("direct legacy runner without a source observer retains caller ownership across the initial await", async () => {
  const snapshots = [sourceSnapshot()];
  const result = await runCodexHistoricalReplay(sourceOptions({
    onInitialPortfolio: () => {
      snapshots[0]!.lastPriceKrw = 175;
      snapshots[0]!.sourceRefs.push("fixture:legacy-change");
      snapshots[0]!.riskTags!.push("inverse");
    }
  }), { initialPortfolio: heldSourcePortfolio(), snapshots });
  assert.equal(result.packets[0]!.candidates[0]!.lastPriceKrw, 175);
  assert.deepEqual(result.packets[0]!.candidates[0]!.riskTags, ["currency_exposed", "inverse"]);
  assert.equal(result.finalPortfolio.positions[0]!.marketValueKrw, 438);
  assert.ok(result.finalPortfolio.positions[0]!.priceSourceRefs!.includes("fixture:legacy-change"));
  assert.equal(Object.isFrozen(snapshots[0]!.sourceRefs), false);
});

test("observation bounds report unavailable without rejecting or freezing supported replay input", async () => {
  const snapshots = [sourceSnapshot({
    sourceRefs: Array.from({ length: REPLAY_SOURCE_SNAPSHOT_LIMITS.sourceRefs + 1 }, (_, index) => `fixture:${index}`)
  })];
  let observation: ReplaySourceSnapshotObservation | undefined;
  const result = await runCodexHistoricalReplay(sourceOptions({
    onInitialPortfolio: () => { snapshots[0]!.lastPriceKrw = 175; },
    onSourceSnapshots: source => {
      observation = source;
      assert.deepEqual(source, { status: "unavailable", reason: "limit" });
      snapshots[0]!.lastPriceKrw = 190;
    }
  }), { initialPortfolio: heldSourcePortfolio(), snapshots });
  assert.deepEqual(observation, { status: "unavailable", reason: "limit" });
  assert.equal(Object.isFrozen(snapshots), false);
  assert.equal(Object.isFrozen(snapshots[0]!.sourceRefs), false);
  assert.equal(result.decisionProviderCallCount, 1);
  assert.equal(result.packets[0]!.candidates[0]!.lastPriceKrw, 190);
  assert.equal(result.finalPortfolio.positions[0]!.marketValueKrw, 475);
  const legacy = await runCodexHistoricalReplay(sourceOptions(), {
    initialPortfolio: heldSourcePortfolio(), snapshots: structuredClone(snapshots)
  });
  assert.deepEqual(result.packets, legacy.packets);
  assert.deepEqual(result.finalPortfolio, legacy.finalPortfolio);
});
