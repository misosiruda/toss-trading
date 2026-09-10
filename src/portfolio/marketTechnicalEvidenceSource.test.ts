import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { getDurableHistoricalMarketSnapshotObservation, type VerifiedHistoricalMarketSnapshotHistory } from "../storage/historicalMarketSnapshotSource.js";
import { FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import { createMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { createMarketTechnicalEvidenceFromHistory, MarketTechnicalEvidenceFileSource, resolveMarketTechnicalEvidenceSourceBinding,
  type MarketTechnicalEvidenceSourceBinding, type MarketTechnicalEvidenceSourceInput } from "./marketTechnicalEvidenceSource.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

test("market technical file source selects every matching observation and preserves whole-source provenance", async () => withSource(async (path, store) => {
  const records = [snapshot(3), { ...snapshot(2), snapshotId: "other-symbol", symbol: "OTHER" }, snapshot(1),
    { ...snapshot(2), snapshotId: "other-market", market: "US" as const }, snapshot(2),
    { ...snapshot(2), snapshotId: "other-interval", interval: "1h" as const }, snapshot(5)];
  records[0]!.sourceRefs = ["synthetic-z", "synthetic-a"];
  await store.replaceAll(records);
  await new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (binding, history) => {
    assert.deepEqual(binding.evidence.calculationInput.snapshots.map((row) => row.snapshotId), ["row-1", "row-2", "row-3"]);
    assert.deepEqual(binding.evidence.calculationInput.snapshots[2]!.sourceRefs, ["synthetic-a", "synthetic-z"]);
    assert.equal(binding.sourceObservation.recordCount, records.length);
    assert.equal(binding.sourceObservation.recordsHash, hashCanonicalPayload(records));
    assert.deepEqual(history.records, records);
    assert.deepEqual(resolveMarketTechnicalEvidenceSourceBinding(history, JSON.parse(JSON.stringify(binding))), binding);
    frozen(binding);
    assert.equal("eligibility" in binding, false);
    assert.equal("selectionScore" in binding.evidence, false);
  });
}));

test("market technical source replay uses the saved prefix after restart and appends, not a newly expanded window", async () => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(3)]);
  const original = await new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (binding) => binding);
  const saved = `${path}.evidence-fixture.json`;
  await writeFile(saved, JSON.stringify(original));
  await store.append(snapshot(2));
  await new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (current, history) => {
    const restored: unknown = JSON.parse(await readFile(saved, "utf8"));
    assert.deepEqual(resolveMarketTechnicalEvidenceSourceBinding(history, restored), original);
    assert.equal(current.evidence.calculation.observationCount, 3);
    assert.equal(original.evidence.calculation.observationCount, 2);
    assert.notEqual(current.evidence.evidenceHash, original.evidence.evidenceHash);
  });
}));

test("market technical source rejects omitted or fabricated observations even when all evidence hashes are recomputed", async () => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(2), snapshot(3)]);
  await new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (binding, history) => {
    for (const snapshots of [[snapshot(1), snapshot(3)], [snapshot(1), { ...snapshot(2), lastPriceKrw: 999 }, snapshot(3)]]) {
      const evidence = createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: binding.evidence.sourceContractId,
        createdAt: binding.evidence.createdAt, calculationInput: { ...binding.evidence.calculationInput, snapshots } });
      assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(history, { ...binding, evidence }), /complete source window/);
    }
    const corrupt = structuredClone(binding);
    corrupt.evidence.calculation.featureInputs[0]!.value += 1;
    assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(history, corrupt), /replay mismatch/);
    for (const patch of [{ recordCount: 4 }, { recordsHash: `sha256:${"a".repeat(64)}` }, { observedAt: "2099-01-01T00:00:00.000Z" }]) {
      assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(history,
        { ...binding, sourceObservation: { ...binding.sourceObservation, ...patch } }));
    }
    assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(history, { ...binding, verified: true }));
  });
}));

test("market technical source replay rejects changed unrelated prefix content and missing original materialization", async () => withSource(async (path, store) => {
  const records = [snapshot(1), snapshot(3), { ...snapshot(2), snapshotId: "unrelated", symbol: "OTHER" }];
  await store.replaceAll(records);
  const binding = await new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (value) => value);
  for (const changed of [records.slice(0, 2), [records[0]!, records[1]!, { ...records[2]!, lastPriceKrw: 321 }],
    [{ ...records[0]!, createdAt: "2026-09-06T00:00:00.000Z" }, ...records.slice(1)]]) {
    await store.replaceAll(changed);
    await store.withDurableVerifiedHistory(async (history) => {
      assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(history, binding), /source prefix/);
    });
  }
}));

test("market technical source requires a live actual history and expires after the consumer", async () => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(3)]);
  let retained!: VerifiedHistoricalMarketSnapshotHistory;
  let binding!: MarketTechnicalEvidenceSourceBinding;
  await new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (value, history) => {
    retained = history; binding = value;
    assert.throws(() => createMarketTechnicalEvidenceFromHistory(structuredClone(history), input()), /live durable/);
    assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(structuredClone(history), value), /live durable/);
  });
  assert.throws(() => createMarketTechnicalEvidenceFromHistory(retained, input()), /live durable/);
  assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(retained, binding), /live durable/);
}));

test("market technical file source holds the writer lock through the consumer and releases it on failure", async () => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(3)]);
  const contender = new FileHistoricalMarketSnapshotStore(path, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
  let retained!: VerifiedHistoricalMarketSnapshotHistory;
  await assert.rejects(new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async (_, history) => {
    retained = history;
    await assert.rejects(contender.append(snapshot(2)), /lock is unavailable/);
    await assert.rejects(contender.replaceAll([snapshot(1), snapshot(2)]), /lock is unavailable/);
    throw new Error("consumer failed");
  }), /consumer failed/);
  assert.throws(() => getDurableHistoricalMarketSnapshotObservation(retained), /live durable/);
  await contender.append(snapshot(2));
}));

test("market technical file source copies query before waiting and rejects caller-supplied snapshots", async () => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(3)]);
  const value = input();
  const pending = new MarketTechnicalEvidenceFileSource(path).withEvidence(value, async (binding) => binding);
  value.query.symbol = "MUTATED"; value.sourceContractId = "mutated";
  const binding = await pending;
  assert.equal(binding.evidence.calculation.symbol, "SYNTH");
  assert.equal(binding.evidence.sourceContractId, "synthetic-local.v1");
  await assert.rejects(new MarketTechnicalEvidenceFileSource(path).withEvidence(
    { ...input(), query: { ...input().query, snapshots: [snapshot(1), snapshot(2)] } } as MarketTechnicalEvidenceSourceInput, async () => {}));
}));

test("market technical source enforces observation-to-evidence chronology without promoting historical PIT availability", async (context) => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(3)]);
  await store.withDurableVerifiedHistory(async (history) => {
    const receipt = getDurableHistoricalMarketSnapshotObservation(history);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(receipt.observedAt) - 1 });
    try { assert.throws(() => createMarketTechnicalEvidenceFromHistory(history, input()), /clock moved backwards/); }
    finally { context.mock.timers.reset(); }
    const binding = createMarketTechnicalEvidenceFromHistory(history, input());
    const evidence = createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: binding.evidence.sourceContractId,
      calculationInput: binding.evidence.calculationInput, createdAt: "2026-09-06T00:00:00.000Z" });
    assert.throws(() => resolveMarketTechnicalEvidenceSourceBinding(history, { ...binding, evidence }), /predates source observation/);
    assert.ok(binding.evidence.calculationInput.snapshots.every((row) => Date.parse(row.createdAt) > Date.parse(input().query.asOf)));
  });
}));

test("market technical source validates the entire file before applying the query", async () => withSource(async (path, store) => {
  await store.replaceAll([snapshot(1), snapshot(3)]);
  await writeFile(path, `${await readFile(path, "utf8")}not-json\n`);
  let invoked = false;
  await assert.rejects(new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async () => { invoked = true; }));
  assert.equal(invoked, false);
}));

test("market technical source rejects insufficient stale duplicate and incomplete window data", async () => withSource(async (path, store) => {
  for (const records of [[snapshot(1)], [snapshot(1), snapshot(2)],
    [snapshot(1), { ...snapshot(1), snapshotId: "duplicate-time" }, snapshot(3)],
    [snapshot(1), { ...snapshot(3), volume: undefined }]]) {
    await store.replaceAll(records);
    await assert.rejects(new MarketTechnicalEvidenceFileSource(path).withEvidence(input(), async () => {}));
  }
}));

test("market technical source rejects oversized windows instead of silently selecting the first 4096", async () => withSource(async (path, store) => {
  const records = Array.from({ length: 4097 }, (_, index) => ({ ...snapshot(1), snapshotId: `minute-${index}`, interval: "1m" as const,
    observedAt: new Date(Date.parse("2026-09-01T00:00:00.000Z") + index * 60_000).toISOString() }));
  await store.replaceAll(records);
  const value = input(); value.query.interval = "1m";
  await assert.rejects(new MarketTechnicalEvidenceFileSource(path).withEvidence(value, async () => {}), /4096/);
}));

function input(): MarketTechnicalEvidenceSourceInput {
  return { sourceContractId: "synthetic-local.v1", query: { market: "KR", symbol: "SYNTH", interval: "1d",
    windowStart: "2026-09-01T00:00:00.000Z", asOf: "2026-09-04T00:00:00.000Z", minimumObservationCount: 2, maximumAgeSeconds: 86400 } };
}
function snapshot(day: number): HistoricalMarketSnapshot {
  return { snapshotId: `row-${day}`, market: "KR", symbol: "SYNTH", interval: "1d", observedAt: `2026-09-0${day}T00:00:00.000Z`,
    createdAt: "2026-09-05T00:00:00.000Z", lastPriceKrw: day * 100, volume: 10, sourceRefs: ["synthetic-local"] };
}
function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function withSource(run: (path: string, store: FileHistoricalMarketSnapshotStore) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "toss-market-technical-source-"));
  try { const path = join(directory, "source.jsonl"); await run(path, new FileHistoricalMarketSnapshotStore(path)); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
