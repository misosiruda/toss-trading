import assert from "node:assert/strict";
import test from "node:test";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { createReplayAdmissionLineage } from "./replayAdmissionMapping.js";
import { REPLAY_ADMISSION_LINEAGE_MAX_BYTES, replayAdmissionLineageSchema } from "./replayAdmissionLineage.js";
import { durableSettingsObservationReference } from "./replaySettingsObservation.js";
import { admissionMappingFixture } from "./replayAdmissionTestFixtures.js";

const fixture = () => {
  const f = admissionMappingFixture();
  return { ...f, record: createReplayAdmissionLineage(f.evidence, f.actual, f.initial, f.settings) };
};

test("actual durable settings reference is small, detached and deeply frozen without changing A bytes", () => {
  const f = fixture(), before = JSON.stringify(f.a);
  const reference = durableSettingsObservationReference(f.a);
  assert.equal(JSON.stringify(f.a), before);
  assert.equal(reference.settingsObservation.observationHash, createReplayResearchHash(f.a));
  assert.ok(Buffer.byteLength(JSON.stringify(reference)) < 1_500);
  for (const value of [reference, reference.identity, reference.initialObservation, reference.initialObservation.initialPortfolio,
    reference.sourceObservation, reference.sourceObservation.source, reference.settingsObservation, reference.settingsObservation.settings]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.hasOwn(reference.settingsObservation.settings, "snapshot"), false);
  f.a.identity.runId = "later";
  assert.notEqual(reference.identity.runId, "later");
  assert.equal(f.a.admission, "unavailable");
});

for (const path of ["identity", "startedAt", "reservationHash", "initialHash", "initialState", "sourceVersion", "settingsVersion", "settingsHash"] as const) {
  test(`durable ${path} mismatch is rejected before lineage publication`, () => {
    const f = fixture(), reference = structuredClone(f.settings);
    if (path === "identity") reference.identity.runId += "_other";
    if (path === "startedAt") reference.startedAt = "2026-10-09T00:00:00.000Z";
    if (path === "reservationHash") reference.reservationHash = `sha256:${"f".repeat(64)}`;
    if (path === "initialHash") reference.initialObservation.observationHash = `sha256:${"f".repeat(64)}`;
    if (path === "initialState") reference.initialObservation.initialPortfolio = { status: "unavailable", reason: "limit" };
    if (path === "sourceVersion") Object.assign(reference.sourceObservation, { schemaVersion: "replay_source_observation.v2" });
    if (path === "settingsVersion") Object.assign(reference.settingsObservation.settings, { snapshotVersion: "replay_settings_snapshot.v2" });
    if (path === "settingsHash") Object.assign(reference.settingsObservation.settings, { contentHash: `sha256:${"f".repeat(64)}` });
    assert.throws(() => createReplayAdmissionLineage(f.evidence, f.actual, f.initial, reference), { message: "replay admission mapping mismatch" });
  });
}

test("strict versioned schema rejects extras, nonfinite values, false presence and unsupported claims", () => {
  const { record } = fixture();
  assert.deepEqual(replayAdmissionLineageSchema.parse(record), record);
  for (const changes of [
    { schemaVersion: "replay_admission_lineage.v2" }, { mode: "live" }, { phase: "completed" }, { extra: true },
    { runtime: "recorded" }, { result: "recorded" }, { completeInput: true }, { completeConfiguration: true }, { comparability: "comparable" },
    { startedAt: "2026-10-08T09:00:00Z" }, { identity: { ...record.identity, runIndex: Infinity } },
    { lineage: { ...record.lineage, mappingVersion: "paper_simulation_child_mapping.v2" } },
    { lineage: { ...record.lineage, expectedSettingsHash: undefined } },
    { settingsObservation: { ...record.settingsObservation, snapshot: {} } }
  ]) assert.equal(replayAdmissionLineageSchema.safeParse({ ...record, ...changes }).success, false);
  for (const reference of ["initialObservation", "sourceObservation", "settingsObservation"] as const) {
    assert.equal(replayAdmissionLineageSchema.safeParse({ ...record, [reference]: { ...record[reference], extra: true } }).success, false);
    assert.equal(replayAdmissionLineageSchema.safeParse({ ...record, [reference]: { ...record[reference], observationHash: "sha256:invalid" } }).success, false);
    assert.equal(replayAdmissionLineageSchema.safeParse({ ...record, [reference]: { ...record[reference], observationHash: record[reference].observationHash + "\n" } }).success, false);
  }
});

test("receipt identity, version and hash syntax are checked independently of settings agreement", () => {
  for (const changes of [
    { receiptVersion: "paper_simulation_admission_receipt.v2" }, { canonicalVersion: "paper_simulation_canonical_request.v2" },
    { inputVersion: "paper_simulation_input_provenance.v2" }, { canonicalRequestHash: "invalid" },
    { inputProvenanceHash: `sha256:${"a".repeat(64)}\n` }, { batchId: "paper_sim_20261008090000000_other" },
    { acceptedAt: "2026-10-08T09:00:00.001Z" }, { extra: true }
  ]) {
    const f = fixture();
    Object.assign(f.evidence.receipt, changes);
    assert.throws(() => createReplayAdmissionLineage(f.evidence, f.actual, f.initial, f.settings), { message: "replay admission mapping mismatch" });
  }
});

test("unavailable lineage allows only the three published child reasons and never a receipt or seed", () => {
  const { record } = fixture();
  for (const reason of ["unsupported_derivation", "settings_unavailable", "initial_unavailable"]) {
    const value = { ...record, lineage: { status: "unavailable", reason } };
    assert.equal(replayAdmissionLineageSchema.safeParse(value).success, true);
    for (const extra of [{ seed: "safe" }, { receipt: {} }, { inputProvenanceHash: `sha256:${"a".repeat(64)}` }]) {
      assert.equal(replayAdmissionLineageSchema.safeParse({ ...value, lineage: { ...value.lineage, ...extra } }).success, false);
    }
  }
  for (const reason of ["input_missing", "redacted", "mismatch", "unknown"]) {
    assert.equal(replayAdmissionLineageSchema.safeParse({ ...record, lineage: { status: "unavailable", reason } }).success, false);
  }
});

test("schema retains recorded field relationships, safe numeric bounds and calendar grammar", () => {
  const { record } = fixture(), lineage = record.lineage;
  assert.equal(lineage.status, "recorded"); if (lineage.status !== "recorded") return;
  const variants = [
    { ...lineage, expectedSettingsHash: `sha256:${"0".repeat(64)}` },
    { ...lineage, receipt: { ...lineage.receipt, batchId: "paper_sim_20261008090000000_other" } },
    { ...lineage, normalizedBatchSeed: " trailing " },
    { ...lineage, plannedWindow: { ...lineage.plannedWindow, seed: "other:0" } },
    { ...lineage, plannedWindow: { ...lineage.plannedWindow, selectedMonth: "100-01" } },
    { ...lineage, plannedWindow: { ...lineage.plannedWindow, localStartDate: "2024-02-30" } },
    { ...lineage, plannedWindow: { ...lineage.plannedWindow, rangeStart: "2024-02-30T00:00:00.000Z" } },
    { ...lineage, plannedWindow: { ...lineage.plannedWindow, candidateCount: Number.MAX_SAFE_INTEGER + 1 } },
    { ...lineage, plannedWindow: { ...lineage.plannedWindow, selectedCandidateIndex: lineage.plannedWindow.candidateCount } },
    { ...lineage, windowMode: "fixed_range" }
  ];
  for (const candidate of variants) assert.equal(replayAdmissionLineageSchema.safeParse({ ...record, lineage: candidate }).success, false);
});

test("strict parser rejects accessor and proxy envelopes before any untrusted execution or serialization", () => {
  const { record } = fixture(); let calls = 0;
  const trap = () => { calls++; throw Error("must not execute"); };
  const accessor = { ...record }; Object.defineProperty(accessor, "lineage", { enumerable: true, get: trap });
  const revoked = Proxy.revocable(record, {}); revoked.revoke();
  for (const value of [accessor, new Proxy(record, { get: trap, getPrototypeOf: trap, ownKeys: trap }), revoked.proxy,
    { ...record, lineage: new Proxy(record.lineage, { get: trap, ownKeys: trap }) }, { ...record, toJSON: trap }]) {
    assert.equal(replayAdmissionLineageSchema.safeParse(value).success, false);
  }
  assert.equal(calls, 0);
});

test("maximum schema-valid escaped envelope is measured independently of writer byte-guard boundaries", () => {
  const { record } = fixture(); assert.equal(record.lineage.status, "recorded"); if (record.lineage.status !== "recorded") return;
  const id = `paper_sim_99991231235959999_${"z".repeat(32)}`;
  const seed = "\u0000".repeat(120), index = 19;
  const largest = replayAdmissionLineageSchema.parse({ ...record,
    identity: { runId: "z".repeat(256), batchId: id, runIndex: index },
    startedAt: new Date(Date.parse(record.lineage.receipt.acceptedAt) + index).toISOString(),
    lineage: { ...record.lineage, receipt: { ...record.lineage.receipt, batchId: id, simulationRunId: id },
      effectiveRunCount: 20, normalizedBatchSeed: seed, initialCapitalRelation: "generated_matches_admission",
      plannedWindow: { ...record.lineage.plannedWindow, seed: `${seed}:${index}`, windowMonths: 12,
        candidateCount: Number.MAX_SAFE_INTEGER, selectedCandidateIndex: Number.MAX_SAFE_INTEGER - 1 } }
  });
  const bytes = Buffer.byteLength(JSON.stringify(largest) + "\n", "utf8");
  assert.equal(bytes, 4_687);
  assert.ok(bytes < REPLAY_ADMISSION_LINEAGE_MAX_BYTES);
  assert.equal(REPLAY_ADMISSION_LINEAGE_MAX_BYTES, 8_192);
  // The design's independent field maxima were not a valid derivation. The schema limits a
  // 120-unit batch seed to its actual :19 suffix, rather than independently filling 140 units.
  assert.equal(largest.lineage.status === "recorded" && largest.lineage.plannedWindow.seed.length, 123);
});
