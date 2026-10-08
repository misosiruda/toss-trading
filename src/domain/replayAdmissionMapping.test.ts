import assert from "node:assert/strict";
import test from "node:test";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { heldSourcePortfolio } from "../replay/codexReplaySourceTestFixtures.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { initialPortfolioObservationReference } from "./replaySourceObservation.js";
import { durableSettingsObservationReference } from "./replaySettingsObservation.js";
import { prepareReplaySettingsSnapshot } from "./replaySettingsSnapshot.js";
import { captureReplayAdmissionActualChild, createReplayAdmissionLineage } from "./replayAdmissionMapping.js";
import { admissionMappingFixture } from "./replayAdmissionTestFixtures.js";

const error = { message: "replay admission mapping mismatch" };
const record = (f: ReturnType<typeof admissionMappingFixture>) => createReplayAdmissionLineage(f.evidence, f.actual, f.initial, f.settings);

test("random API derivation binds real workflow-normalized A and frozen actual references for multiple children", () => {
  const config = simulationConfig(); config.runType = "batch_replay"; config.runCount = 3; config.window.seed = "  token  ";
  const selected = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const f = admissionMappingFixture({ config, index, tickDelayMs: 231 });
    const b = record(f); assert.equal(b.lineage.status, "recorded"); if (b.lineage.status !== "recorded") return;
    assert.equal(b.lineage.normalizedBatchSeed, "token");
    assert.equal(b.lineage.plannedWindow.seed, `token:${index}`);
    assert.equal(b.lineage.plannedWindow.candidateCount, 12);
    selected.add(b.lineage.plannedWindow.selectedMonth);
    assert.equal(b.startedAt, `2026-10-08T09:00:00.00${index}Z`);
    assert.equal(b.lineage.expectedSettingsHash, f.a.settings.status === "recorded" && f.a.settings.contentHash);
    assert.deepEqual(b.lineage.receipt, f.evidence.receipt);
    assert.equal(b.lineage.initialCapitalRelation, "generated_matches_admission");
    assert.equal(b.clock, "unavailable"); assert.equal(b.result, "unavailable"); assert.equal(b.completeInput, false);
    assert.equal(b.completeConfiguration, false); assert.equal(b.comparability, "unavailable");
    assert.equal(Object.hasOwn(b.settingsObservation.settings, "snapshot"), false);
  }
  assert.ok(selected.size > 1);
});

test("fixed date-only +09 conversion preserves metadata months and child candidate zero", () => {
  const config = simulationConfig(); config.runType = "batch_replay"; config.runCount = 3;
  config.window = { mode: "fixed_range", seed: "  fixed  ", startAt: "2024-02-03", endAt: "2024-02-04", windowMonths: 7 };
  const f = admissionMappingFixture({ config, index: 2 }), b = record(f);
  assert.equal(b.lineage.status, "recorded"); if (b.lineage.status !== "recorded") return;
  assert.equal(f.evidence.snapshot.effectiveConfig.window.windowMonths, null);
  assert.equal(b.lineage.windowMode, "fixed_range"); assert.equal(b.lineage.plannedWindow.windowMonths, 7);
  assert.equal(b.lineage.plannedWindow.startAt, "2024-02-02T15:00:00.000Z");
  assert.equal(b.lineage.plannedWindow.endAt, "2024-02-04T14:59:59.999Z");
  assert.equal(b.lineage.plannedWindow.seed, "fixed:2"); assert.equal(b.lineage.plannedWindow.selectedCandidateIndex, 0);
});

test("single override and omitted batch count use admitted effective count", () => {
  const single = simulationConfig(); single.runCount = 20;
  const a = record(admissionMappingFixture({ config: single }));
  assert.equal(a.lineage.status === "recorded" && a.lineage.effectiveRunCount, 1);
  const batch = simulationConfig(); batch.runType = "batch_replay"; delete batch.runCount;
  const b = record(admissionMappingFixture({ config: batch, index: 4 }));
  assert.equal(b.lineage.status === "recorded" && b.lineage.effectiveRunCount, 5);
  assert.throws(() => record(admissionMappingFixture({ config: batch, index: 5 })), error);
});

test("stored cash zero and holdings retain precedence over requested cash without becoming unknown", () => {
  const f = admissionMappingFixture({ storedPortfolio: heldSourcePortfolio() }), b = record(f);
  assert.equal(b.lineage.status === "recorded" && b.lineage.initialCapitalRelation, "stored_portfolio_precedence");
  assert.equal(f.initial.initialPortfolio.status, "recorded");
  assert.equal(f.initial.initialPortfolio.status === "recorded" && f.initial.initialPortfolio.snapshot.cashKrw, 0);
  assert.deepEqual(b.initialObservation, initialPortfolioObservationReference(f.initial));
});

for (const field of ["runId", "batchId", "runIndex", "startedAt", "windowSamplingMode", "seed", "candidateCount", "selectedCandidateIndex", "selectedMonth", "localStartDate", "startAt"] as const) {
  test(`supported actual ${field} mutation cannot become verified or unavailable`, () => {
    const f = admissionMappingFixture();
    if (field === "runId" || field === "batchId") f.actual.identity[field] += "_other";
    else if (field === "runIndex") f.actual.identity.runIndex++;
    else if (field === "startedAt") f.actual.startedAt = "2026-10-08T09:00:00.001Z";
    else if (field === "windowSamplingMode") f.actual.windowSamplingMode = "fixed_range";
    else if (field === "candidateCount" || field === "selectedCandidateIndex") f.actual.windowSelection[field]++;
    else f.actual.windowSelection[field] = field === "selectedMonth" ? "100-01" : "password=SYNTHETIC_MUTATION";
    assert.throws(() => record(f), error);
  });
}

for (const field of ["packetIdPrefix", "maxSnapshotAgeSeconds", "packetExpiresInSeconds", "maxCandidates", "tickDelayMs", "constraints", "executionPolicy", "riskPolicy", "allocationPolicy", "paperExitPolicy", "universeManifest", "candidateStrategyBucket", "marketRegimeAllocationPolicy"] as const) {
  test(`A ${field} value or presence mismatch is detected by actual recorded snapshot hash`, () => {
    const f = admissionMappingFixture();
    const options = { ...f.plan.runnerOptions };
    if (field === "packetIdPrefix") options.packetIdPrefix += "_other";
    else if (field === "constraints") options.constraints = { ...options.constraints, allowedActions: [...options.constraints.allowedActions].reverse() };
    else if (field === "executionPolicy" || field === "riskPolicy" || field === "allocationPolicy" || field === "tickDelayMs") delete options[field];
    else if (field === "paperExitPolicy") options.paperExitPolicy = { takeProfitRatio: 0.2 };
    else if (field === "candidateStrategyBucket") options.candidateStrategyBucket = "swing";
    else if (field === "universeManifest") options.universeManifest = { mode: "paper_only_historical_universe",
      universeId: "synthetic", snapshotDate: "2026-10-08", symbols: [], disclaimer: "Synthetic fixture." };
    else if (field === "marketRegimeAllocationPolicy") options.marketRegimeAllocationPolicy = { lookbackDays: 1 };
    else options[field] = field === "maxSnapshotAgeSeconds" ? 300 : options[field] + 1;
    f.a.settings = prepareReplaySettingsSnapshot(options);
    assert.equal(f.a.settings.status, "recorded");
    f.settings = durableSettingsObservationReference(f.a);
    assert.throws(() => record(f), error);
  });
}

test("explicit execution, exit, allocation presence and action ordering preserve the admitted projection", () => {
  const config = simulationConfig(); config.executionCosts = { feeBps: 3, taxBps: 9, slippageBps: 11 }; config.paperExitPolicy = "take_profit_stop_loss";
  const f = admissionMappingFixture({ config });
  assert.equal(record(f).lineage.status, "recorded");
  const a = f.a.settings; assert.equal(a.status, "recorded"); if (a.status !== "recorded") return;
  assert.equal(a.snapshot.executionPolicy?.feeBps, 3);
  assert.equal(a.snapshot.executionPolicy?.taxBps, 9);
  assert.equal(a.snapshot.paperExitPolicy?.takeProfitMode, "full_exit");
  assert.deepEqual(a.snapshot.constraints.allowedActions, f.evidence.snapshot.effectiveConfig.constraints.allowedActions);
});

for (const change of ["cash", "positions", "time", "contentHash"] as const) {
  test(`generated portfolio ${change} mismatch rejects even after rebinding the observed initial hash`, () => {
    const f = admissionMappingFixture(), p = f.initial.initialPortfolio;
    assert.equal(p.status, "recorded"); if (p.status !== "recorded") return;
    if (change === "cash") p.snapshot.cashKrw++;
    if (change === "positions") p.snapshot.positions = heldSourcePortfolio().positions;
    if (change === "time") p.snapshot.updatedAt = f.actual.startedAt;
    p.contentHash = change === "contentHash" ? `sha256:${"0".repeat(64)}` : createReplayResearchHash({ schemaVersion: p.snapshotVersion, snapshot: p.snapshot });
    f.a.initialObservation = initialPortfolioObservationReference(f.initial);
    f.settings = durableSettingsObservationReference(f.a);
    assert.throws(() => record(f), error);
  });
}

for (const reason of ["unsupported_shape", "limit"] as const) {
  test(`A ${reason} remains unavailable and cannot hide a window mutation`, () => {
    const f = admissionMappingFixture(); f.a.settings = { status: "unavailable", reason };
    f.settings = durableSettingsObservationReference(f.a);
    assert.deepEqual(record(f).lineage, { status: "unavailable", reason: "settings_unavailable" });
    f.actual.windowSelection.selectedMonth = "100-01";
    assert.throws(() => record(f), error);
  });
}

test("initial unavailable preserves reason privately in earlier reference and cannot hide A mismatch", () => {
  const f = admissionMappingFixture(); f.initial.initialPortfolio = { status: "unavailable", origin: "generated", reason: "unsupported_shape" };
  f.a.initialObservation = initialPortfolioObservationReference(f.initial); f.settings = durableSettingsObservationReference(f.a);
  assert.deepEqual(record(f).lineage, { status: "unavailable", reason: "initial_unavailable" });
  f.a.settings = prepareReplaySettingsSnapshot({ ...f.plan.runnerOptions, maxSnapshotAgeSeconds: 300 });
  f.settings = durableSettingsObservationReference(f.a);
  assert.throws(() => record(f), error);
});

for (const reason of ["redacted", "inspection_unavailable"] as const) {
  test(`A ${reason} retains its existing stop instead of receiving B unavailable`, () => {
    const f = admissionMappingFixture(); f.a.settings = { status: "unavailable", reason }; f.settings = durableSettingsObservationReference(f.a);
    assert.throws(() => record(f), error);
  });
}

test("owner-derived early0100 and extended local labels stay unsupported without repairing the sampler", () => {
  for (const mode of ["random_month", "fixed_range"] as const) {
    const config = simulationConfig(); config.window.mode = mode;
    config.window.startAt = mode === "random_month" ? "0100-01-01T00:00:00.000Z" : "9999-12-31T15:00:00.000Z";
    config.window.endAt = mode === "random_month" ? "0100-04-01T00:00:00.000Z" : "9999-12-31T23:00:00.000Z";
    const f = admissionMappingFixture({ config });
    assert.deepEqual(record(f).lineage, { status: "unavailable", reason: "unsupported_derivation" });
    f.actual.windowSelection.seed += "changed";
    assert.throws(() => record(f), error);
  }
});

test("unsupported mode is partial only when every supportable comparison still agrees", () => {
  const f = admissionMappingFixture(); f.actual.windowSamplingMode = "balanced_regime";
  assert.deepEqual(record(f).lineage, { status: "unavailable", reason: "unsupported_derivation" });
  f.a.settings = prepareReplaySettingsSnapshot({ ...f.plan.runnerOptions, maxSnapshotAgeSeconds: 300 });
  f.settings = durableSettingsObservationReference(f.a);
  assert.throws(() => record(f), error);
});

test("actual capture is detached and deeply frozen; forged getters, proxies and inherited fields execute nothing", () => {
  const f = admissionMappingFixture(), captured = captureReplayAdmissionActualChild(f.actual);
  f.actual.windowSelection.seed = "mutated";
  assert.notEqual(captured.windowSelection.seed, f.actual.windowSelection.seed);
  assert.equal(Object.isFrozen(captured.identity), true); assert.equal(Object.isFrozen(captured.windowSelection), true);
  let executions = 0;
  const trap = () => { executions++; throw Error("must not execute"); };
  const accessor = { ...f.actual }; Object.defineProperty(accessor, "windowSelection", { enumerable: true, get: trap });
  const proxy = new Proxy(f.actual, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable(f.actual, {}); revoked.revoke();
  for (const value of [null, {}, Object.create(f.actual), accessor, proxy, revoked.proxy,
    { ...f.actual, windowSelection: new Proxy(f.actual.windowSelection, { get: trap, ownKeys: trap }) },
    { ...f.actual, identity: new Proxy(f.actual.identity, { get: trap, ownKeys: trap }) },
    { ...f.actual, toJSON: trap }]) assert.throws(() => captureReplayAdmissionActualChild(value), error);
  assert.equal(executions, 0);
});
