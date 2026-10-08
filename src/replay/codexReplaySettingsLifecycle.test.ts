import assert from "node:assert/strict";
import test from "node:test";
import type { ReplaySettingsSnapshot, ReplaySettingsSnapshotObservation } from "../domain/replaySettingsSnapshot.js";
import type { HistoricalUniverseManifest } from "./historicalUniverseCoverage.js";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import { sourceDecision, sourceOptions, sourcePortfolio, sourceSnapshot } from "./codexReplaySourceTestFixtures.js";

type Member = NonNullable<ReplaySettingsSnapshot["universeManifest"]>["symbols"][number];
const active: Member = { market: "KR", symbol: "005930", lifecycleStatus: "active", lifecycleStatusSource: "explicit" };
const suspended: Member = { ...active, lifecycleStatus: "suspended" };

function universe(symbols: Member[], description = "Synthetic label") {
  // Direct callers can supply legacy manifests without going through today's defaulting parser.
  return { mode: "paper_only_historical_universe", universeId: "synthetic", snapshotDate: "2025-01-03",
    description, disclaimer: "Synthetic paper fixture", symbols: structuredClone(symbols) } as HistoricalUniverseManifest;
}

test("lifecycle projection preserves absent, empty, explicit/defaulted and duplicate-last semantics", async t => {
  const cases: Array<{ name: string; members?: Member[]; status?: string; eligible: boolean }> = [
    { name: "absent manifest", eligible: true },
    { name: "empty manifest", members: [], status: "unknown", eligible: false },
    { name: "absent member", members: [{ ...active, symbol: "000660" }], status: "unknown", eligible: false },
    { name: "status and source omitted", members: [{ market: "KR", symbol: "005930" }], eligible: true },
    { name: "source omitted", members: [{ market: "KR", symbol: "005930", lifecycleStatus: "suspended" }], eligible: true },
    { name: "defaulted status", members: [{ ...suspended, lifecycleStatusSource: "defaulted" }], eligible: true },
    { name: "explicit missing status", members: [{ market: "KR", symbol: "005930", lifecycleStatusSource: "explicit" }], status: "unknown", eligible: false },
    { name: "explicit active", members: [active], status: "active", eligible: true },
    { name: "explicit suspended", members: [suspended], status: "suspended", eligible: false },
    { name: "duplicate last active", members: [suspended, active], status: "active", eligible: true },
    { name: "duplicate last suspended", members: [active, suspended], status: "suspended", eligible: false }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const supplied = scenario.members === undefined ? undefined : universe(scenario.members);
      let observed: ReplaySettingsSnapshotObservation | undefined;
      const options = sourceOptions({
        ...(supplied === undefined ? {} : { universeManifest: supplied }),
        onInitialPortfolio: () => {
          if (supplied !== undefined) supplied.symbols.splice(0, supplied.symbols.length, ...universe([suspended]).symbols);
        },
        onSettings: observation => {
          observed = structuredClone(observation);
          assert.equal(observation.status, "recorded");
          if (observation.status !== "recorded") throw Error("Expected recorded settings");
          assert.equal(Object.hasOwn(observation.snapshot, "universeManifest"), supplied !== undefined);
          assert.deepEqual(observation.snapshot.universeManifest, scenario.members === undefined ? undefined : { symbols: scenario.members });
          if (observation.snapshot.universeManifest !== undefined) {
            observation.snapshot.universeManifest.symbols.reverse();
            observation.snapshot.universeManifest.symbols.splice(0, observation.snapshot.universeManifest.symbols.length, { ...suspended });
          }
        },
        decisionProvider: { decide: async packet => sourceDecision(packet, "005930") }
      });
      const result = await runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
      assert.equal(observed?.status, "recorded");
      assert.equal(result.packets[0]!.candidates.length, 1, "universe projection does not add membership filtering");
      const candidate = result.packets[0]!.candidates[0]!;
      assert.equal(candidate.lifecycleStatus, scenario.status);
      assert.equal(candidate.buyEligible, scenario.eligible);
      assert.equal(result.tradeCount, scenario.eligible ? 1 : 0);
      assert.deepEqual(result.riskDecisions[0]!.rejectCodes, scenario.eligible ? [] : ["VIRTUAL_LIFECYCLE_NOT_ELIGIBLE"]);
    });
  }
});

test("ignored universe labels are absent from the partial snapshot and do not imply full universe identity", async () => {
  const observations: ReplaySettingsSnapshotObservation[] = [];
  const results = [];
  for (const label of ["First label", "Entirely different label"]) {
    const manifest = universe([active], label);
    manifest.symbols[0]!.name = label;
    manifest.symbols[0]!.tags = [label];
    results.push(await runCodexHistoricalReplay(sourceOptions({ universeManifest: manifest,
      onSettings: observation => { observations.push(observation); }
    }), { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot({ name: "Source name" })] }));
  }
  assert.deepEqual(observations[0], observations[1]);
  assert.equal(observations[0]!.status, "recorded");
  if (observations[0]!.status !== "recorded") throw Error("Expected recorded settings");
  assert.deepEqual(observations[0]!.snapshot.universeManifest, { symbols: [active] });
  assert.equal(results[0]!.packets[0]!.candidates[0]!.name, "Source name");
  assert.deepEqual(results[0]!.packets, results[1]!.packets);
});
