import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository, createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { bindOpeningCapacityConsumptionOrigins as bind, type OpeningCapacityConsumptionSources as Sources } from "./openingCapacityConsumptionBinding.js";
import { fixture as manualFixture, PORTFOLIO, START, mandateEvent, type Options } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { at } from "./storedManualOpeningCapacityTestFixtures.js";

const options = { lockTimeoutMs: 100, lockRetryDelayMs: 3 };
const query = (baseDir: string) => ({ baseDir, portfolioId: PORTFOLIO });
async function hold<T>(dir: string, operation: (sources: Sources) => Promise<T>, beforeRisk: () => void = () => {}, beforeCapacity: () => void = () => {}) {
  return new SourcePriceEvidenceFileRepository(dir, options).withDurableVerifiedHistory((prices) =>
    new ManualAssignmentFileRepository(dir, options).withDurableVerifiedHistory((manual) =>
      new CandidateAssignmentFileRepository(dir, options).withDurableVerifiedHistory((assignments, inputs, requests, snapshots) =>
        new ManualOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(manual, snapshots, (manualReservations) =>
          new SelectorOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots, (selectorReservations) =>
            new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(dir, options), options).withDurableVerifiedHistory((planEvents) =>
              new InvestmentMandateFileRepository(dir, options).withDurableVerifiedHistory((mandates) => {
                beforeRisk();
                return new PortfolioActionRiskDecisionFileRepository(dir, options).withDurableVerifiedHistory((risks) =>
                  new PaperFillExecutionFileRepository(dir, options).withDurableVerifiedHistory((fills) => {
                    beforeCapacity();
                    return new OpeningCapacityReservationEventFileRepository(dir, options).withDurableVerifiedHistory((events) =>
                      operation({ manual, requests, inputs, assignments, manualReservations, selectorReservations, mandates, events, prices, planEvents, risks, fills }));
                  }));
              })))))));
}

test("held capacity consumption rejects every copied foreign and expired source even with empty histories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capacity-consumption-"));
  try {
    let expired!: Sources;
    await hold(dir, async (sources) => {
      expired = sources;
      assert.deepEqual(bind(query(dir), sources), { mandates: { roots: [], bindings: [] }, bindings: [] });
      assert.throws(() => bind({ ...query(dir), trusted: true } as never, sources));
      await hold(join(dir, "foreign"), async (foreign) => {
        for (const key of Object.keys(sources) as (keyof Sources)[]) {
          assert.deepEqual(sources[key], foreign[key]);
          assert.throws(() => bind(query(dir), { ...sources, [key]: { ...sources[key] } }), /verified|lease/);
          assert.throws(() => bind(query(dir), { ...sources, [key]: foreign[key] }), /different source path/);
        }
      });
    });
    await hold(dir, async (fresh) => {
      for (const key of Object.keys(fresh) as (keyof Sources)[]) {
        assert.throws(() => bind(query(dir), { ...fresh, [key]: expired[key] }), /verified|lease/);
      }
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [kind, fixture] of [["manual", manualFixture], ["selector", selectorFixture]] as const) {
  test(`held capacity consumption binds ${kind} gross partial and terminal fills without mutation across restart`, async (context) => {
    await fixture(context, { count: 3, feeBps: 250 }, async (state) => {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, before = await readFile(path, "utf8");
      const result = await hold(state.dir, async (sources) => bind(query(state.dir), sources));
      assert.deepEqual(result.bindings.map((binding) => binding.consumedNotionalKrw), [40, 30, 30]);
      assert.equal(result.bindings[0]!.execution.paperFill.netAmountKrw, 41);
      assert.equal(result.bindings[2]!.event.remainingReservedNotionalKrw, 0);
      assert.equal(result.mandates.bindings[0]!.sourceKind, kind);
      assert.equal(result.bindings[0]!.fillOrigin.riskOrigin!.commitHash, result.bindings[0]!.riskOrigin.commitHash);
      assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.bindings)); assert.ok(Object.isFrozen(result.bindings[0]));
      assert.deepEqual(await hold(state.dir, async (sources) => bind(query(state.dir), sources)), result);
      await hold(state.dir, async (sources) => assert.deepEqual(bind({ ...query(state.dir), portfolioId: "other" }, sources),
        { mandates: { roots: [], bindings: [] }, bindings: [] }));
      assert.equal(await readFile(path, "utf8"), before);
    });
  });
  const invalid: readonly [string, Options][] = [
    ["gross delta", { wrongDelta: true, feeBps: 250 }], ["fill Risk origin", { unbound: true }],
    ["Risk target", { wrongRiskTarget: true }], ["Risk bucket", { wrongRiskBucket: true }],
    ["mandate lineage", { wrongMandate: true }], ["capacity chronology", { earlyCapacity: true }],
    ...(["proposed", "review_required", "retired", "late_activation"] as const).map((mandateState): [string, Options] => [mandateState, { mandateState }]),
    ...(["wrong_mandate", "wrong_event", "wrong_prefix", "wrong_plan"] as const).map((receipt): [string, Options] => [receipt, { receipt }])
  ];
  for (const [label, settings] of invalid) test(`held capacity consumption rejects ${kind} ${label}`, async (context) => {
    await fixture(context, settings, async ({ dir }) => {
      await assert.rejects(hold(dir, async (sources) => bind(query(dir), sources)),
        /differs from actual filled|risk origin persisted|target|scope mismatch|lineage mismatch|chronology mismatch|mandate|receipt mismatch|durable source prefixes/);
    });
  });
  test(`held capacity consumption validates ${kind} historical receipts after later retirement`, async (context) => {
    await fixture(context, { receipt: "valid" }, async (state) => {
      const repository = new InvestmentMandateFileRepository(state.dir), history = await repository.readSnapshot();
      context.mock.timers.setTime(START + 100);
      await repository.appendEvent(mandateEvent(state.manual.mandate, "retired", 100, history.events[0]!.mandateEventId));
      await hold(state.dir, async (sources) => {
        const result = bind(query(state.dir), sources);
        assert.equal(result.bindings[0]!.mandateState.status, "active");
        assert.ok(result.bindings[0]!.riskOrigin.mandateOrigin);
      });
    });
  });
  for (const [label, offset, expected] of [["retroactive retirement", 42, /active investment mandate/],
    ["future source creation", 300, /mandate source creation follows its observation/]] as const) {
    test(`held capacity consumption rejects ${kind} ${label} despite an earlier valid receipt`, async (context) => {
      await fixture(context, { receipt: "valid" }, async (state) => {
        const repository = new InvestmentMandateFileRepository(state.dir), history = await repository.readSnapshot();
        context.mock.timers.setTime(START + 100);
        await repository.appendEvent(mandateEvent(state.manual.mandate, "retired", offset, history.events[0]!.mandateEventId));
        await assert.rejects(hold(state.dir, async (sources) => bind(query(state.dir), sources)), expected);
      });
    });
  }
  test(`held capacity consumption rejects ${kind} receipt predating its actual mandate prefix creation`, async (context) => {
    await fixture(context, { receipt: "valid" }, async ({ dir }) => {
      const riskPath = createPortfolioActionRiskDecisionPaths(dir).recordsPath;
      const [entry, marker] = (await readFile(riskPath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
      const { entryHash: _entryHash, ...oldEntry } = entry, { commitHash: _commitHash, ...oldMarker } = marker;
      const payload = { ...oldEntry, mandateOrigin: { ...oldEntry.mandateOrigin,
        observation: { ...oldEntry.mandateOrigin.observation, observedAt: at(40) } } };
      const entryHash = hashCanonicalPayload(payload), markerPayload = { ...oldMarker, entryHash }, commitHash = hashCanonicalPayload(markerPayload);
      await writeFile(riskPath, [JSON.stringify({ ...payload, entryHash }), JSON.stringify({ ...markerPayload, commitHash })].join("\n") + "\n");
      // Preserve the actual fill-to-Risk commit binding so rejection must come from the receipt chronology.
      const fillPath = createPaperFillExecutionPaths(dir).recordsPath;
      const [fillEntry, fillMarker] = (await readFile(fillPath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
      const { entryHash: _fillHash, ...oldFill } = fillEntry, { commitHash: _fillCommitHash, ...oldFillMarker } = fillMarker;
      const nextFill = { ...oldFill, riskOrigin: { ...oldFill.riskOrigin, commitHash } }, fillHash = hashCanonicalPayload(nextFill);
      const nextMarker = { ...oldFillMarker, entryHash: fillHash };
      await writeFile(fillPath, [JSON.stringify({ ...nextFill, entryHash: fillHash }),
        JSON.stringify({ ...nextMarker, commitHash: hashCanonicalPayload(nextMarker) })].join("\n") + "\n");
      await assert.rejects(hold(dir, async (sources) => bind(query(dir), sources)), /Risk mandate receipt predates source creation/);
    });
  });
  for (const [label, paths] of [["plan event", createRebalancePlanEventPaths], ["Risk", createPortfolioActionRiskDecisionPaths],
    ["fill", createPaperFillExecutionPaths], ["price", createSourcePriceEvidencePaths]] as const) {
    test(`held capacity consumption rejects ${kind} missing and corrupt ${label} without repairing bytes`, async (context) => {
      await fixture(context, {}, async ({ dir }) => {
        const source = paths(dir), path = "eventsPath" in source ? source.eventsPath : source.recordsPath;
        const original = await readFile(path, "utf8");
        await unlink(path);
        await assert.rejects(hold(dir, async (sources) => bind(query(dir), sources)));
        const corrupt = original + "{broken}\n";
        await writeFile(path, corrupt);
        await assert.rejects(hold(dir, async (sources) => bind(query(dir), sources)));
        assert.equal(await readFile(path, "utf8"), corrupt);
        await writeFile(path, original);
        assert.equal((await hold(dir, async (sources) => bind(query(dir), sources))).bindings.length, 1);
      });
    });
  }
}

test("held capacity consumption retains increase lineage and rejects clock reversal with locks released after failure", async (context) => {
  await manualFixture(context, { increase: true }, async ({ dir }) => {
    await assert.rejects(hold(dir, async (sources) => {
      assert.equal(bind(query(dir), sources).bindings[0]!.event.eventType, "partially_consumed");
      await assert.rejects(new PaperFillExecutionFileRepository(dir, options).readVerifiedHistory(), /lock|timeout/i);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.equal((await hold(dir, async (sources) => bind(query(dir), sources))).bindings.length, 1);
    context.mock.timers.setTime(START + 200);
    await assert.rejects(hold(dir, async (sources) => bind(query(dir), sources), () => context.mock.timers.setTime(START + 199),
      () => context.mock.timers.setTime(START + 200)), /capacity consumption observation clock moved backwards/);
  });
});

test("held capacity consumption requires actual completion strictly before the plan execution event", async (context) => {
  await manualFixture(context, {}, async ({ dir }) => {
    const path = createPaperFillExecutionPaths(dir).recordsPath, original = await readFile(path, "utf8");
    const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(entry.schemaVersion, "paper_fill_execution_entry.v2");
    const { entryHash: _entryHash, ...entryPayload } = entry;
    const payload = { ...entryPayload, schemaVersion: "paper_fill_execution_entry.v3" }, entryHash = hashCanonicalPayload(payload);
    const { commitHash: _commitHash, ...markerPayload } = marker;
    const nextMarker = { ...markerPayload, entryHash }, commitHash = hashCanonicalPayload(nextMarker);
    const prefix = [JSON.stringify({ ...payload, entryHash }), JSON.stringify({ ...nextMarker, commitHash })].join("\n") + "\n";
    for (const offset of [89, 90, 91]) {
      const completion = { schemaVersion: "paper_fill_execution_completion.v1", commitHash, completedAt: at(offset) };
      const bytes = prefix + JSON.stringify({ ...completion, completionHash: hashCanonicalPayload(completion) }) + "\n";
      await writeFile(path, bytes);
      if (offset === 89) assert.equal((await hold(dir, async (sources) => bind(query(dir), sources))).bindings.length, 1);
      else await assert.rejects(hold(dir, async (sources) => bind(query(dir), sources)), /capacity consumption source chronology mismatch/);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
  });
});
