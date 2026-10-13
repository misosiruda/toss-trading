import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReplayRuntimeStartupCandidate as evaluate } from "./replayRuntimeStartupCandidate.js";
import { startupCandidateFixture as fixture } from "./replayRuntimeStartupCandidateTestFixtures.js";

test("proxy, revoked proxy, accessor, coercion, custom prototype and toJSON inputs execute no hook", () => {
  let calls = 0;
  const trap = () => { calls++; throw Error("synthetic-private-trap"); };
  const revoked = Proxy.revocable(fixture(), {}); revoked.revoke();
  const accessor = Object.defineProperty(fixture(), "nodeVersion", { get: trap, enumerable: true });
  const circular: Record<string, unknown> = fixture(); circular.nodeVersion = circular;
  const custom = Object.assign(Object.create({ toJSON: trap }), fixture());
  const inputValues = [null, undefined, "synthetic-private-trap", 1, false, [], () => fixture(), new Date(),
    new Proxy(fixture(), { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap }), revoked.proxy,
    accessor, circular, custom, { ...fixture(), toJSON: trap },
    { ...fixture(), nodeVersion: { toString: trap, valueOf: trap, [Symbol.toPrimitive]: trap } },
    Object.assign(Object.create(new Proxy({}, { get: trap, getPrototypeOf: trap })), fixture())];
  for (const value of inputValues) {
    const result = evaluate(value);
    assert.equal(result.status === "unavailable" && result.reason, "invalid_descriptor");
    assert.equal(JSON.stringify(result).includes("synthetic-private-trap"), false);
  }
  assert.equal(calls, 0);
});

test("every property accessor is rejected without evaluation or input mutation", () => {
  let calls = 0;
  for (const key of Object.keys(fixture())) {
    const input = Object.defineProperty(fixture(), key, { enumerable: true, configurable: true,
      get: () => { calls++; return "synthetic-private-value"; }, set: () => { calls++; } });
    const before = Object.getOwnPropertyDescriptors(input);
    const result = evaluate(input);
    assert.equal(result.status === "unavailable" && result.reason, "invalid_descriptor");
    assert.deepEqual(Object.getOwnPropertyDescriptors(input), before);
  }
  assert.equal(calls, 0);
});

for (const name of ["Object", "Array"] as const) {
  for (const kind of ["function", "getter", "setter"] as const) {
    test(`${name} prototype ${kind} toJSON is rejected with zero hooks, including result serialization`, () => {
      const prototype = name === "Object" ? Object.prototype : Array.prototype;
      const prior = Object.getOwnPropertyDescriptor(prototype, "toJSON");
      let calls = 0;
      const trap = () => { calls++; throw Error("synthetic-private-prototype"); };
      const descriptor = kind === "function" ? { value: trap } : kind === "getter" ? { get: trap } : { set: trap };
      let result: ReturnType<typeof evaluate> | undefined, serialized = "";
      try {
        Object.defineProperty(prototype, "toJSON", { configurable: true, ...descriptor });
        result = evaluate(fixture());
        serialized = JSON.stringify(result);
      } finally {
        if (prior) Object.defineProperty(prototype, "toJSON", prior); else Reflect.deleteProperty(prototype, "toJSON");
      }
      assert.equal(result?.status === "unavailable" && result.reason, "invalid_descriptor");
      assert.equal(calls, 0);
      assert.equal(serialized.includes("synthetic-private-prototype"), false);
    });
  }
}

test("inert non-callable standard prototype toJSON data does not affect candidate meaning", () => {
  const objectPrior = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const arrayPrior = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  const results: string[] = [];
  try {
    for (const value of [null, undefined, false, 0, "inert", Object.freeze({})]) {
      Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value });
      Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value });
      results.push(evaluate(fixture()).status);
    }
  } finally {
    if (objectPrior) Object.defineProperty(Object.prototype, "toJSON", objectPrior); else Reflect.deleteProperty(Object.prototype, "toJSON");
    if (arrayPrior) Object.defineProperty(Array.prototype, "toJSON", arrayPrior); else Reflect.deleteProperty(Array.prototype, "toJSON");
  }
  assert.deepEqual(results, Array(6).fill("candidate"));
});

test("unexpected or proxy standard array prototype chain is rejected without traversing it", () => {
  const prior = Object.getPrototypeOf(Array.prototype);
  let calls = 0;
  const trap = () => { calls++; throw Error("synthetic-private-chain"); };
  for (const replacement of [null, {}, new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap })]) {
    let result: ReturnType<typeof evaluate> | undefined;
    try { Object.setPrototypeOf(Array.prototype, replacement); result = evaluate(fixture()); }
    finally { Object.setPrototypeOf(Array.prototype, prior); }
    assert.equal(result?.status === "unavailable" && result.reason, "invalid_descriptor");
  }
  assert.equal(calls, 0);
});

test("valid frozen descriptor and all its own property descriptors remain unchanged", () => {
  for (const prototype of [Object.prototype, null]) {
    const input = Object.freeze(Object.assign(Object.create(prototype), fixture()));
    const before = Object.getOwnPropertyDescriptors(input);
    evaluate(input);
    assert.deepEqual(Object.getOwnPropertyDescriptors(input), before);
    assert.equal(Object.isFrozen(input), true);
    assert.equal(Object.getPrototypeOf(input), prototype);
  }
});
