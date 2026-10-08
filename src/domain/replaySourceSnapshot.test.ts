import assert from "node:assert/strict";
import test from "node:test";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { historicalMarketSnapshotSchema } from "./schemas.js";
import { prepareReplaySourceSnapshot, replaySourceSnapshotObservationSchema, replaySourceSnapshotSchema,
  REPLAY_SOURCE_SNAPSHOT_VERSION } from "./replaySourceSnapshot.js";
import { minimalSourceSnapshot, recordedSource, sourceSnapshot } from "./replaySourceSnapshotTestFixtures.js";

test("source v1 preserves all 20 parsed fields and each field changes the versioned hash", () => {
  const input = sourceSnapshot();
  assert.deepEqual(historicalMarketSnapshotSchema.parse(input), input);
  const reference = recordedSource([input]);
  assert.deepEqual(reference.snapshot, [input]);
  assert.equal(reference.contentHash, createReplayResearchHash({ schemaVersion: REPLAY_SOURCE_SNAPSHOT_VERSION, snapshot: [input] }));
  assert.notEqual(reference.contentHash, createReplayResearchHash([input]));
  const variations = { snapshotId: "synthetic-other", market: "US", symbol: "OTHER", name: "Other stock",
    assetType: "ETF", assetClass: "bond", region: "GLOBAL", riskTags: ["inverse"], strategyBucket: "hedge",
    sector: "other", observedAt: "2025-01-02T00:00:02Z", interval: "5m", openPriceKrw: 99, highPriceKrw: 111,
    lowPriceKrw: 89, closePriceKrw: 100, lastPriceKrw: 103, volume: 13.5, sourceRefs: ["synthetic:other"],
    createdAt: "2025-01-02T00:00:03Z" };
  assert.equal(Object.keys(variations).length, 20);
  assert.deepEqual(Object.keys(variations).sort(), Object.keys(input).sort());
  for (const [field, next] of Object.entries(variations)) {
    const changed = { ...input, [field]: next };
    assert.deepEqual(historicalMarketSnapshotSchema.parse(changed), changed, field);
    assert.notEqual(recordedSource([changed]).contentHash, reference.contentHash, field);
  }
});

test("source v1 preserves optional omission, explicit zero and empty risk tags without defaults", () => {
  const input = sourceSnapshot(), reference = recordedSource([input]);
  for (const field of ["name", "assetType", "assetClass", "region", "riskTags", "strategyBucket", "sector",
    "openPriceKrw", "highPriceKrw", "lowPriceKrw", "closePriceKrw", "volume"] as const) {
    const omitted = { ...input }; delete omitted[field];
    const result = recordedSource([omitted]);
    assert.equal(Object.hasOwn(result.snapshot[0]!, field), false, field);
    assert.notEqual(result.contentHash, reference.contentHash, field);
  }
  const minimal = minimalSourceSnapshot();
  for (const field of ["openPriceKrw", "highPriceKrw", "lowPriceKrw", "closePriceKrw", "volume"] as const) {
    const zero = recordedSource([{ ...minimal, [field]: 0 }]);
    assert.equal(zero.snapshot[0]![field], 0);
    assert.notEqual(zero.contentHash, recordedSource([minimal]).contentHash);
  }
  assert.notEqual(recordedSource([{ ...minimal, riskTags: [] }]).contentHash, recordedSource([minimal]).contentHash);
  assert.deepEqual(recordedSource([]).snapshot, []);
});

test("source array, nested refs, and risk tag order and duplicates remain significant", () => {
  const first = sourceSnapshot(), second = { ...first, lastPriceKrw: 104 };
  const original = recordedSource([first, second]);
  assert.notEqual(original.contentHash, recordedSource([second, first]).contentHash);
  assert.notEqual(original.contentHash, recordedSource([first, second, first]).contentHash);
  for (const field of ["sourceRefs", "riskTags"] as const) {
    const reversed = { ...first, [field]: [...first[field]!].reverse() };
    const duplicated = { ...first, [field]: [...first[field]!, first[field]![0]!] };
    assert.notEqual(recordedSource([first]).contentHash, recordedSource([reversed]).contentHash);
    assert.notEqual(recordedSource([first]).contentHash, recordedSource([duplicated]).contentHash);
    assert.deepEqual(recordedSource([duplicated]).snapshot, [duplicated]);
  }
});

test("source copy owns all nested arrays, freezes deeply, and cannot be changed by caller or callback copies", () => {
  const input = [sourceSnapshot()], observed = recordedSource(input);
  assert.notEqual(observed.snapshot, input);
  assert.notEqual(observed.snapshot[0], input[0]);
  assert.notEqual(observed.snapshot[0]!.sourceRefs, input[0]!.sourceRefs);
  assert.notEqual(observed.snapshot[0]!.riskTags, input[0]!.riskTags);
  const original = structuredClone(observed);
  input[0]!.lastPriceKrw = 999;
  input[0]!.sourceRefs.push("caller:changed");
  input[0]!.riskTags!.reverse();
  input.push(minimalSourceSnapshot());
  const callbackCopy = structuredClone(observed);
  callbackCopy.snapshot[0]!.sourceRefs.length = 0;
  callbackCopy.snapshot.length = 0;
  assert.deepEqual(observed, original);
  for (const object of [observed.snapshot, observed.snapshot[0], observed.snapshot[0]!.sourceRefs, observed.snapshot[0]!.riskTags]) {
    assert.equal(Object.isFrozen(object), true);
  }
  assert.throws(() => { observed.snapshot[0]!.lastPriceKrw = 999; }, TypeError);
  assert.throws(() => { observed.snapshot[0]!.sourceRefs.push("mutation"); }, TypeError);
});

test("source schema rejects unknown fields and versions, retains text verbatim, and does not infer permission from labels", () => {
  const record = recordedSource([sourceSnapshot()]);
  for (const changed of [{ ...record, snapshotVersion: "replay_source_snapshot.v2" }, { ...record, extra: true },
    { ...record, snapshot: [{ ...sourceSnapshot(), extra: true }] }, { ...record, contentHash: "sha256:unknown" },
    { status: "unavailable", reason: "limit", snapshot: [] }, { status: "unavailable", reason: "limit", contentHash: record.contentHash }]) {
    assert.equal(replaySourceSnapshotObservationSchema.safeParse(changed).success, false);
  }
  for (const reason of ["unsupported_shape", "redacted", "limit", "retention_unavailable"]) {
    assert.deepEqual(replaySourceSnapshotObservationSchema.parse({ status: "unavailable", reason }), { status: "unavailable", reason });
  }
  const text = { ...minimalSourceSnapshot(), snapshotId: " padded ", sourceRefs: [" official_calendar_non_exporting_label "] };
  assert.deepEqual(recordedSource([text]).snapshot, [text]);
  assert.deepEqual(replaySourceSnapshotSchema.parse([minimalSourceSnapshot()]), [minimalSourceSnapshot()]);
});

test("frozen source schema retains the historical price and scalar validity constraints", () => {
  for (const changed of [{ lastPriceKrw: -1 }, { lastPriceKrw: 1.2 }, { volume: -1 }, { highPriceKrw: 1, lowPriceKrw: 2 },
    { market: "JP" }, { interval: "2m" }, { observedAt: "not-a-date" }, { sourceRefs: [] }, { riskTags: ["unknown"] },
    { snapshotId: "" }, { lastPriceKrw: "12" }]) {
    assert.deepEqual(prepareReplaySourceSnapshot([{ ...minimalSourceSnapshot(), ...changed }]),
      { status: "unavailable", reason: "unsupported_shape" });
  }
});
