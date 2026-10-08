import assert from "node:assert/strict";
import test from "node:test";
import type { ReplaySettingsSnapshotObservation } from "../domain/replaySettingsSnapshot.js";
import { runCodexHistoricalReplay, type CodexHistoricalReplayRunnerOptions } from "./codexHistoricalReplayRunner.js";
import { ReplaySamplingPolicy } from "./replaySamplingPolicy.js";
import { SimulatedClock } from "./simulatedClock.js";
import { heldSourcePortfolio, sourceDecision, sourceOptions, sourcePortfolio, sourceSnapshot, sourceTime } from "./codexReplaySourceTestFixtures.js";

test("unsupported selected getters, proxies, unknown fields and own undefined preserve legacy reads", async t => {
  for (const kind of ["root getter", "nested getter", "nested proxy", "options proxy", "unknown field", "own undefined"] as const) {
    await t.test(kind, async () => {
      const run = async (observe: boolean) => {
        const events: string[] = [];
        let observation: ReplaySettingsSnapshotObservation | undefined;
        let prefix = "before_initial";
        const options = sourceOptions({
          onInitialPortfolio: () => { events.push("initial"); prefix = "after_initial"; },
          onSourceSnapshots: () => { events.push("source"); },
          decisionProvider: { decide: async packet => sourceDecision(packet, "005930") },
          ...(observe ? { onSettings: (value: ReplaySettingsSnapshotObservation) => {
            observation = value;
            assert.deepEqual(events, ["initial", "source"], "capture must not invoke unsupported accessors or proxies");
          } } : {})
        });
        let runOptions = options;
        if (kind === "root getter") {
          Object.defineProperty(options, "packetIdPrefix", { enumerable: true,
            get() { events.push("prefix"); return prefix; } });
        } else if (kind === "nested getter") {
          options.executionPolicy = {};
          Object.defineProperty(options.executionPolicy, "feeBps", { enumerable: true,
            get() { events.push("fee"); return 25; } });
        } else if (kind === "nested proxy") {
          options.riskPolicy = new Proxy({ minCashReserveRatio: 0 }, {
            get(target, key, receiver) { events.push(`risk:${String(key)}`); return Reflect.get(target, key, receiver); },
            ownKeys(target) { events.push("risk:keys"); return Reflect.ownKeys(target); }
          });
        } else if (kind === "options proxy") {
          runOptions = new Proxy(options, {
            get(target, key, receiver) {
              if (["packetIdPrefix", "maxSnapshotAgeSeconds", "constraints"].includes(String(key))) events.push(String(key));
              return Reflect.get(target, key, receiver);
            },
            ownKeys(target) { events.push("options:keys"); return Reflect.ownKeys(target); }
          });
        } else if (kind === "unknown field") {
          options.riskPolicy = Object.assign({ minCashReserveRatio: 0 }, { futurePolicyField: 5 });
        } else {
          options.executionPolicy = undefined;
        }
        const result = await runCodexHistoricalReplay(runOptions, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
        return { result, events, observation };
      };
      const legacy = await run(false);
      const observed = await run(true);
      assert.deepEqual(observed.observation, { status: "unavailable", reason: "unsupported_shape" });
      assert.deepEqual(observed.result, legacy.result);
      assert.deepEqual(observed.events, legacy.events);
      assert.equal(observed.result.tradeCount, 1);
      if (kind === "root getter") assert.equal(observed.result.packets[0]!.packetId, "after_initial_0");
    });
  }
});

test("opaque getters keep legacy call order and already-used sampler/provider state", async () => {
  const run = async (observe: boolean) => {
    const events: string[] = [], delays: number[] = [];
    const sampler = new ReplaySamplingPolicy({ maxDecisionCalls: 2 });
    await runCodexHistoricalReplay(sourceOptions({ samplingPolicy: sampler }), {
      initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()]
    });
    const clock = new SimulatedClock({ startAt: new Date(sourceTime),
      endAt: new Date(Date.parse(sourceTime) + 60_000), stepSeconds: 60 });
    const ticks = clock.ticks.bind(clock);
    clock.ticks = () => { events.push("ticks"); return ticks(); };
    clock.metadata = () => { throw Error("runner must not recreate opaque clock from metadata"); };
    let performanceCounter = 40;
    const provider = { calls: 3, async decide(packet: Parameters<typeof sourceDecision>[0]) {
      assert.equal(this, provider);
      this.calls++;
      events.push("decide");
      return sourceDecision(packet);
    } };
    const options = sourceOptions({ tickDelayMs: 5,
      onInitialPortfolio: () => { events.push("initial"); },
      onSourceSnapshots: () => { events.push("source"); },
      onProgress: () => { events.push("progress"); },
      ...(observe ? { onSettings: (observation: ReplaySettingsSnapshotObservation) => {
        assert.equal(observation.status, "recorded");
        assert.deepEqual(events, ["initial", "source"]);
        if (observation.status !== "recorded") throw Error("Expected recorded settings");
        for (const key of ["clock", "samplingPolicy", "decisionProvider", "performanceClock", "tickDelay", "onProgress"]) {
          assert.equal(Object.hasOwn(observation.snapshot, key), false);
        }
      } } : {})
    });
    const opaque = {
      clock, samplingPolicy: sampler, decisionProvider: provider,
      performanceClock: () => { events.push("performance"); return performanceCounter++; },
      tickDelay: async (ms: number) => { events.push("delay"); delays.push(ms); }
    };
    for (const [key, value] of Object.entries(opaque)) {
      Object.defineProperty(options, key, { enumerable: true, get() { events.push(`${key}:get`); return value; } });
    }
    const result = await runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
    return { result, events, delays, providerCalls: provider.calls };
  };
  const legacy = await run(false), observed = await run(true);
  assert.deepEqual(observed, legacy);
  assert.equal(observed.result.decisionProviderCallCount, 1);
  assert.equal(observed.providerCalls, 4);
  assert.deepEqual(observed.result.samplingDecisions.map(item => [item.reason, item.decisionCallsUsed]), [
    ["POLICY_ALLOWED", 2], ["DECISION_CALL_BUDGET_EXHAUSTED", 2]
  ]);
  assert.deepEqual(observed.delays, [5, 5]);
});

test("opaque clock session remains live through the settings callback", async () => {
  const session = { startTime: "00:00", endTime: "00:00", timezoneOffsetMinutes: 0 };
  const clock = new SimulatedClock({ startAt: new Date(sourceTime),
    endAt: new Date(Date.parse(sourceTime) + 60_000), stepSeconds: 60, session });
  const result = await runCodexHistoricalReplay(sourceOptions({ clock, onSettings: observation => {
    assert.equal(observation.status, "recorded");
    session.startTime = "00:01";
    session.endTime = "00:01";
  } }), { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
  assert.equal(result.tickCount, 1);
  assert.equal(result.packets[0]!.packetId, "source_packet_1");
});

test("pacing uses captured delay in every early-return branch and keeps the opaque delay lazy", async t => {
  for (const branch of ["packet failed", "sampling skipped", "provider failed", "packet mismatch", "scope rejected", "completed"] as const) {
    await t.test(branch, async () => {
      const delays: number[] = [];
      let delayGets = 0;
      const options = sourceOptions({ tickDelayMs: 7, onSettings: () => {},
        onInitialPortfolio: () => { options.tickDelayMs = 90; } });
      if (branch === "sampling skipped") {
        options.samplingPolicy = new ReplaySamplingPolicy({ maxDecisionCalls: 1 });
        await runCodexHistoricalReplay(sourceOptions({ samplingPolicy: options.samplingPolicy }), {
          initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()]
        });
      }
      if (branch === "provider failed") options.decisionProvider = { decide: async () => ({ attempted: true,
        command: null, decision: null, failure: { code: "AI_DECISION_FAILED", reason: "synthetic" } }) };
      if (branch === "packet mismatch") options.decisionProvider = { decide: async packet => {
        const result = sourceDecision(packet);
        result.decision!.packetId = "wrong_packet";
        return result;
      } };
      if (branch === "scope rejected") {
        options.candidateStrategyBucket = "short_term";
        options.decisionProvider = { decide: async packet => sourceDecision(packet, "005930") };
      }
      Object.defineProperty(options, "tickDelay", { enumerable: true, get() {
        delayGets++;
        return async (ms: number) => { delays.push(ms); };
      } });
      const result = await runCodexHistoricalReplay(options, {
        initialPortfolio: branch === "scope rejected" ? heldSourcePortfolio() : sourcePortfolio(),
        snapshots: branch === "packet failed" ? [] : [sourceSnapshot({ strategyBucket: "swing" })]
      });
      assert.deepEqual(delays, [7]);
      assert.equal(delayGets, 1);
      if (branch === "packet failed") assert.equal(result.packetCount, 0);
      if (branch === "sampling skipped") assert.equal(result.decisionSkippedCount, 1);
      if (branch === "provider failed") assert.ok(result.auditEvents.some(event => event.eventType === "HISTORICAL_AI_DECISION_FAILED"));
      if (branch === "packet mismatch" || branch === "scope rejected") {
        assert.ok(result.auditEvents.some(event => event.eventType === "HISTORICAL_DECISION_REJECTED"));
      }
    });
  }
  for (const tickDelayMs of [undefined, 0, -1]) {
    const options: CodexHistoricalReplayRunnerOptions = sourceOptions({ onSettings: () => {},
      ...(tickDelayMs === undefined ? {} : { tickDelayMs }) });
    Object.defineProperty(options, "tickDelay", { get() { throw Error("disabled pacing must not read tickDelay"); } });
    const result = await runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
    assert.equal(result.tickCount, 1);
  }
});
