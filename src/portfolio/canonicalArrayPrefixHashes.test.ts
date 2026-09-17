import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonicalArrayPrefixes, hashCanonicalPayload } from "./runtimePolicyContracts.js";

test("incremental canonical array prefix hashes match independent whole-prefix hashing", () => {
  const arrays: unknown[][] = [[], [null, false, true, 0, -0, 1.5, "한글", "😀"],
    [{ z: 2, a: { nested: [3, { b: 2, a: 1 }] } }, { a: undefined, b: null }, undefined, NaN],
    Array.from({ length: 300 }, (_, i) => ({ index: i, value: [i % 7, `item-${i}`] })), new Array(4)];
  for (const values of arrays) {
    const result = hashCanonicalArrayPrefixes(values);
    assert.ok(Object.isFrozen(result)); assert.equal(result.length, values.length + 1);
    result.forEach((hash, count) => assert.equal(hash, hashCanonicalPayload(values.slice(0, count))));
  }
});
