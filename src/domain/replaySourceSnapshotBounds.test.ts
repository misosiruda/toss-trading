import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { prepareReplaySourceSnapshot, replaySourceSnapshotObservationSchema, REPLAY_SOURCE_SNAPSHOT_LIMITS as limits } from "./replaySourceSnapshot.js";
import { minimalSourceSnapshot, recordedSource, sourceAtJsonBytes } from "./replaySourceSnapshotTestFixtures.js";

test("source text, time, ref and tag bounds distinguish boundary-minus-one, exact and plus-one", () => {
  for (const field of ["snapshotId", "symbol", "name", "sector"]) {
    for (const units of [119, 120, 121]) {
      expectBound([{ ...minimalSourceSnapshot(), [field]: "x".repeat(units) }], units <= 120);
    }
  }
  for (const field of ["observedAt", "createdAt"]) {
    for (const units of [79, 80, 81]) {
      expectBound([{ ...minimalSourceSnapshot(), [field]: "2025-01-02".padEnd(units, " ") }], units <= 80);
    }
  }
  for (const size of [127, 128, 129]) expectBound([{ ...minimalSourceSnapshot(), sourceRefs: Array(size).fill("x") }], size <= 128);
  for (const units of [511, 512, 513]) expectBound([{ ...minimalSourceSnapshot(), sourceRefs: ["x".repeat(units)] }], units <= 512);
  for (const size of [31, 32, 33]) expectBound([{ ...minimalSourceSnapshot(), riskTags: Array(size).fill("inverse") }], size <= 32);
});

test("source string limits count UTF-16 code units independently from UTF-8 and JSON escaping", () => {
  for (const text of ["한".repeat(120), "😀".repeat(60), "\u0001".repeat(120)]) {
    const input = [{ ...minimalSourceSnapshot(), name: text }];
    assert.equal(text.length, 120);
    assert.deepEqual(recordedSource(input).snapshot, input);
    expectBound([{ ...input[0], name: text + "x" }], false);
  }
  expectBound([{ ...minimalSourceSnapshot(), sourceRefs: ["😀".repeat(256)] }], true);
  expectBound([{ ...minimalSourceSnapshot(), sourceRefs: ["😀".repeat(256) + "x"] }], false);
});

test("source record limit is checked before inspecting or serializing any record", t => {
  for (const length of [limits.records - 1, limits.records]) {
    const records = Array.from({ length }, minimalSourceSnapshot);
    assert.equal(recordedSource(records).snapshot.length, length);
  }
  let calls = 0;
  const tooMany = new Array(limits.records + 1);
  Object.defineProperty(tooMany, "0", { get() { calls += 1; throw new Error("Must not inspect oversized input"); }, enumerable: true });
  const stringify = t.mock.method(JSON, "stringify", () => { throw new Error("Must not serialize oversized count"); });
  try {
    expectBound(tooMany, false);
    assert.equal(calls, 0);
    assert.equal(stringify.mock.callCount(), 0);
  } finally { stringify.mock.restore(); }
});

test("source raw UTF-8 array budget preserves exact minus-one and boundary and rejects plus-one", () => {
  // Keep the heavy cases in this file and serial; never construct more than one boundary input at a time.
  for (const bytes of [limits.jsonBytes - 1, limits.jsonBytes, limits.jsonBytes + 1]) {
    const records = sourceAtJsonBytes(bytes);
    const observed = prepareReplaySourceSnapshot(records);
    if (bytes <= limits.jsonBytes) {
      assert.equal(observed.status, "recorded");
      if (observed.status === "recorded") assert.equal(Buffer.byteLength(JSON.stringify(observed.snapshot)), bytes);
    } else assert.deepEqual(observed, { status: "unavailable", reason: "limit" });
  }
});

test("oversized and redacted inputs never reach whole-array serialization, cloning or content hashing", t => {
  const byteOversize = sourceAtJsonBytes(limits.jsonBytes + 1);
  const stringify = JSON.stringify;
  const arrayStringify = t.mock.method(JSON, "stringify", (value: unknown) => {
    assert.equal(Array.isArray(value), false, "Only individual bounded records may be serialized");
    return stringify(value);
  });
  const clone = t.mock.method(globalThis, "structuredClone", () => { throw new Error("Must not clone rejected source"); });
  const hash = t.mock.method(crypto, "createHash", () => { throw new Error("Must not hash rejected source"); });
  syncBuiltinESMExports();
  try {
    for (const records of [new Array(limits.records + 1), [{ ...minimalSourceSnapshot(), name: "x".repeat(121) }], byteOversize]) {
      expectBound(records, false);
    }
    assert.deepEqual(prepareReplaySourceSnapshot([{ ...minimalSourceSnapshot(), snapshotId: "ord_abcdef" }]),
      { status: "unavailable", reason: "redacted" });
    assert.equal(clone.mock.callCount(), 0);
    assert.equal(hash.mock.callCount(), 0);
    assert.equal(arrayStringify.mock.callCount(), byteOversize.length);
  } finally {
    arrayStringify.mock.restore(); clone.mock.restore(); hash.mock.restore(); syncBuiltinESMExports();
  }
});

test("observation schema cannot bypass source preflight bounds or redaction through forged recorded content", () => {
  const reference = recordedSource([]);
  for (const snapshots of [new Array(limits.records + 1), [{ ...minimalSourceSnapshot(), name: "x".repeat(121) }],
    [{ ...minimalSourceSnapshot(), sourceRefs: ["exec_abcdef"] }], sourceAtJsonBytes(limits.jsonBytes + 1)]) {
    assert.equal(replaySourceSnapshotObservationSchema.safeParse({ ...reference, snapshot: snapshots }).success, false);
  }
});

function expectBound(value: unknown, recorded: boolean): void {
  const result = prepareReplaySourceSnapshot(value);
  if (recorded) assert.equal(result.status, "recorded");
  else assert.deepEqual(result, { status: "unavailable", reason: "limit" });
}
