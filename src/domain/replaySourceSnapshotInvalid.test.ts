import assert from "node:assert/strict";
import test from "node:test";
import { prepareReplaySourceSnapshot, replaySourceSnapshotObservationSchema, replaySourceSnapshotSchema } from "./replaySourceSnapshot.js";
import { minimalSourceSnapshot, sourceSnapshot } from "./replaySourceSnapshotTestFixtures.js";

test("generic masking covers every source string and never grants replay identity exceptions", () => {
  const sensitive = ["account:123456-123-123456", "abcdefghijklmnop.abcdefgh.ijklmnop", "ord_abcdef", "exec_abcdef"];
  for (const value of sensitive) {
    for (const field of ["snapshotId", "market", "symbol", "name", "assetType", "assetClass", "region", "strategyBucket",
      "sector", "observedAt", "interval", "createdAt", "sourceRefs", "riskTags"]) {
      const input = [{ ...sourceSnapshot(), [field]: field === "sourceRefs" || field === "riskTags" ? [value] : value }];
      const result = prepareReplaySourceSnapshot(input);
      assert.deepEqual(result, { status: "unavailable", reason: "redacted" }, field);
      assert.equal(JSON.stringify(result).includes(value), false);
      assert.equal(replaySourceSnapshotSchema.safeParse(input).success, false);
    }
  }
});

test("source rejects explicit undefined, negative zero, nonfinite numbers and non-JSON values without coercion", () => {
  const invalid = [undefined, -0, NaN, Infinity, -Infinity, 1n, Symbol("synthetic"), () => 0, new Number(1), new Date(0)];
  for (const value of invalid) {
    assertUnavailable([{ ...sourceSnapshot(), volume: value }]);
  }
  for (const field of Object.keys(sourceSnapshot())) assertUnavailable([{ ...sourceSnapshot(), [field]: undefined }]);
  const cycle: Record<string, unknown> = { ...sourceSnapshot() }; cycle.name = cycle;
  assertUnavailable([cycle]);
  assertUnavailable([{ ...sourceSnapshot(), sourceRefs: [undefined] }]);
  assertUnavailable([{ ...sourceSnapshot(), riskTags: [undefined] }]);
  for (const value of [null, undefined, {}, new Set(), new Map(), new Uint8Array(), "[]"]) assertUnavailable(value);
});

test("source rejects unpaired Unicode instead of hashing JSON replacement or escaped surrogate values", () => {
  for (const bad of ["\ud800", "\udfff", "x\ud800x", "\ud800\ud800", "\udc00\ud800"]) {
    for (const field of ["snapshotId", "symbol", "name", "sector", "sourceRefs", "riskTags"]) {
      assertUnavailable([{ ...sourceSnapshot(), [field]: field === "sourceRefs" || field === "riskTags" ? [bad] : bad }]);
    }
  }
});

test("source rejects getters, sparse arrays, symbols, custom prototypes and proxies without invoking user code", () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error("Getter must not run"); };
  const record = Object.defineProperty(sourceSnapshot(), "symbol", { get: getter, enumerable: true });
  const unknownGetter = Object.defineProperty(minimalSourceSnapshot(), "unknown", { get: getter, enumerable: true });
  const hiddenGetter = Object.defineProperty(minimalSourceSnapshot(), "hidden", { get: getter });
  const topGetter = Object.defineProperty([sourceSnapshot()], "0", { get: getter, enumerable: true });
  const refGetter = Object.defineProperty(["synthetic"], "0", { get: getter, enumerable: true });
  const toJson = Object.assign(sourceSnapshot(), { toJSON: getter });
  const proxy = new Proxy(sourceSnapshot(), { get: getter, ownKeys: getter, getPrototypeOf: getter, getOwnPropertyDescriptor: getter });
  const arrayProxy = new Proxy([sourceSnapshot()], { get: getter, ownKeys: getter, getPrototypeOf: getter, getOwnPropertyDescriptor: getter });
  const revocable = Proxy.revocable([], {}); revocable.revoke();
  class RecordSubclass { constructor() { Object.assign(this, sourceSnapshot()); } }
  class ArraySubclass extends Array<unknown> {}
  for (const value of [[record], [unknownGetter], [hiddenGetter], topGetter, [toJson], [proxy], arrayProxy, revocable.proxy,
    [new RecordSubclass()], new ArraySubclass(sourceSnapshot()), [Object.create(sourceSnapshot())],
    [Object.assign(sourceSnapshot(), { [Symbol("unknown")]: 1 })],
    [Object.defineProperty(sourceSnapshot(), "name", { value: "hidden", enumerable: false })],
    Object.assign([sourceSnapshot()], { extra: true }), new Array(1), [undefined],
    [{ ...sourceSnapshot(), sourceRefs: new Array(1) }], [{ ...sourceSnapshot(), riskTags: new Array(1) }],
    [{ ...sourceSnapshot(), sourceRefs: refGetter }], [{ ...sourceSnapshot(), sourceRefs: new Set(["x"]) }]]) {
    assertUnavailable(value);
  }
  assert.equal(calls, 0);
  for (const value of [Object.defineProperty({ status: "unavailable", reason: "limit" }, "status", { get: getter }), arrayProxy,
    new Proxy({ status: "unavailable", reason: "limit" }, { get: getter, ownKeys: getter, getPrototypeOf: getter })]) {
    assert.equal(replaySourceSnapshotObservationSchema.safeParse(value).success, false);
  }
  assert.equal(calls, 0);
});

function assertUnavailable(value: unknown): void {
  assert.deepEqual(prepareReplaySourceSnapshot(value), { status: "unavailable", reason: "unsupported_shape" });
  assert.equal(replaySourceSnapshotSchema.safeParse(value).success, false);
}
