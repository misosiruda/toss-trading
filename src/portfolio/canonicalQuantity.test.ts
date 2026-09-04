import assert from "node:assert/strict";
import test from "node:test";
import { addCanonicalQuantities, canonicalQuantityUnits } from "./canonicalQuantity.js";

test("canonical quantity addition avoids binary drift without tolerating target excess", () => {
  assert.equal(addCanonicalQuantities(0.1, 0.2), 0.3);
  assert.equal(addCanonicalQuantities(0.3, 0.7), 1);
  assert.equal(canonicalQuantityUnits(0.3) - canonicalQuantityUnits(0.1), canonicalQuantityUnits(0.2));
  assert.ok(canonicalQuantityUnits(0.30000000000000004) > canonicalQuantityUnits(0.3));
  let cumulative = 0;
  for (let index = 0; index < 10; index += 1) cumulative = addCanonicalQuantities(cumulative, 0.1);
  assert.equal(cumulative, 1);
});

test("canonical quantities support exponent notation and smallest positive numbers", () => {
  assert.equal(addCanonicalQuantities(1e-7, 2e-7), 3e-7);
  assert.equal(addCanonicalQuantities(Number.MIN_VALUE, Number.MIN_VALUE), 1e-323);
  assert.equal(addCanonicalQuantities(0, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});

test("canonical quantity arithmetic rejects invalid input, unsafe sums and precision loss", () => {
  for (const value of [NaN, Infinity, -1, -0, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => canonicalQuantityUnits(value), /quantity/);
  assert.throws(() => addCanonicalQuantities(Number.MAX_SAFE_INTEGER, 1), /safe range/);
  assert.throws(() => addCanonicalQuantities(1, Number.MIN_VALUE), /not exactly representable/);
});
