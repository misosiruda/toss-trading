import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReplayRuntimeStartupCandidate as evaluate, type ReplayRuntimeStartupCandidateReason,
  type ReplayRuntimeStartupCandidateResult } from "./replayRuntimeStartupCandidate.js";
import { startupCandidateFixture as fixture } from "./replayRuntimeStartupCandidateTestFixtures.js";

function expectUnavailable(value: unknown, reason: ReplayRuntimeStartupCandidateReason): void {
  const result = evaluate(value);
  assert.equal(result.status, "unavailable");
  assert.equal(result.status === "unavailable" && result.reason, reason);
  assert.equal(Object.hasOwn(result, "profile"), false);
  expectUnverified(result);
}

function expectUnverified(result: ReplayRuntimeStartupCandidateResult): void {
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.schemaVersion, "replay_runtime_startup_candidate_result.v1");
  assert.equal(result.evidence, "unverified_descriptor");
  for (const key of ["runtime", "dependencies", "result", "comparability"] as const) assert.equal(result[key], "unavailable");
  for (const key of ["completeRuntime", "completeConfiguration", "completeInput"] as const) assert.equal(result[key], false);
  assert.equal(Object.keys(result).length, 11);
  for (const key of ["identity", "descriptor", "verified", "hash", "receipt", "context"]) assert.equal(Object.hasOwn(result, key), false);
}

test("both paper fixture provider descriptions yield only an unverified immutable candidate", () => {
  for (const provider of ["mock", "deterministic_fixture"]) {
    for (const prototype of [Object.prototype, null]) {
      const input = Object.assign(Object.create(prototype), fixture(), { provider });
      for (const value of [input, Object.freeze(input), JSON.parse(JSON.stringify(input))]) {
        const result = evaluate(value);
        assert.equal(result.status, "candidate");
        assert.equal(result.status === "candidate" && result.profile, "linux_x64_node24_19_paper_fixture.v1");
        assert.equal(Object.hasOwn(result, "reason"), false);
        expectUnverified(result);
      }
    }
  }
});

test("descriptor and its ordinary clone have equal values, never startup authority or an identity binding", () => {
  const value = fixture();
  const result = evaluate(value);
  assert.deepEqual(evaluate(structuredClone(value)), result);
  value.provider = "external";
  assert.equal(result.status, "candidate");
  expectUnavailable(value, "unsupported_execution_profile");
  assert.throws(() => Object.assign(result, { completeRuntime: true }), TypeError);
  assert.throws(() => Object.setPrototypeOf(result, {}), TypeError);
  expectUnverified(result);
});

test("every mandatory scalar rejects omission, wrong type, hidden presence and unrecognized value", () => {
  const base = fixture();
  assert.equal(Object.keys(base).length, 18);
  for (const key of Object.keys(base)) {
    const missing = { ...base }; delete missing[key];
    expectUnavailable(missing, "invalid_descriptor");
    for (const value of [null, undefined, false, 0, {}, [], "synthetic-secret", "x".repeat(100_000)]) {
      expectUnavailable({ ...base, [key]: value }, "invalid_descriptor");
    }
    const hidden = { ...base };
    Object.defineProperty(hidden, key, { value: base[key], enumerable: false });
    expectUnavailable(hidden, "invalid_descriptor");
  }
});

test("closed shape rejects 17/19 fields, symbol fields and an extra field replacing a missing field", () => {
  const base = fixture();
  const missing = { ...base }; delete missing.mode;
  expectUnavailable(missing, "invalid_descriptor");
  expectUnavailable({ ...base, verified: true }, "invalid_descriptor");
  expectUnavailable({ ...base, [Symbol("synthetic-secret")]: "value" }, "invalid_descriptor");
  expectUnavailable({ ...missing, unexpected: "paper_only" }, "invalid_descriptor");
  expectUnavailable(Object.defineProperty({ ...base }, "synthetic-secret", { value: "value" }), "invalid_descriptor");
});

test("bounded release syntax distinguishes a different runtime from an invalid version", () => {
  for (const nodeVersion of ["v0.0.0", "v22.15.0", "v25.0.0", "v999.999.99", "v999.999.999"]) {
    expectUnavailable({ ...fixture(), nodeVersion }, "unsupported_runtime_profile");
  }
  for (const nodeVersion of ["", "24.19.0", "v024.19.0", "v24.019.0", "v24.19.00", "v24.19.0\n",
    "v24.19.0-rc.1", "v1000.0.0", "v999.999.9990", "v24.19.0 ", "v24.19.", "v２４.19.0"]) {
    expectUnavailable({ ...fixture(), nodeVersion }, "invalid_descriptor");
  }
  assert.equal("v999.999.999".length, 12);
});

const alternatives: [string, string[], ReplayRuntimeStartupCandidateReason][] = [
  ["platform", ["aix", "android", "darwin", "freebsd", "openbsd", "sunos", "win32", "unknown"], "unsupported_runtime_profile"],
  ["architecture", ["arm", "arm64", "ia32", "loong64", "mips", "mipsel", "ppc64", "riscv64", "s390", "s390x", "unknown"], "unsupported_runtime_profile"],
  ["mode", ["live", "unknown"], "unsupported_execution_profile"],
  ["provider", ["external", "unknown"], "unsupported_execution_profile"],
  ["bootstrap", ["application_loaded", "unknown"], "application_not_unloaded"],
  ["preloads", ["present", "unknown"], "unsupported_startup_profile"],
  ["compileCache", ["enabled", "unknown"], "unsupported_startup_profile"],
  ["startupSnapshot", ["present", "unknown"], "unsupported_startup_profile"],
  ["inspector", ["enabled", "unknown"], "unsupported_startup_profile"],
  ["startupConfig", ["present", "unknown"], "unsupported_startup_profile"],
  ["runtimeSettings", ["unsupported", "unknown"], "unsupported_startup_profile"],
  ["moduleLoader", ["custom_or_external", "unknown"], "unsupported_loading_profile"],
  ["moduleCache", ["preexisting", "unknown"], "unsupported_loading_profile"],
  ["nativeAssets", ["present", "unknown"], "unsupported_loading_profile"],
  ["generatedCode", ["present", "unknown"], "unsupported_loading_profile"],
  ["filesystem", ["unsupported", "unknown"], "unsupported_filesystem_profile"]
];
for (const [field, choices, reason] of alternatives) {
  test(`supported and unknown noncandidate descriptions preserve the ${field} reason`, () => {
    for (const value of choices) expectUnavailable({ ...fixture(), [field]: value }, reason);
  });
}

test("multiple failures use the fixed shape/runtime/execution/bootstrap/startup/loading/filesystem priority", () => {
  const input: Record<string, unknown> = { ...fixture(), platform: "unknown", mode: "live", bootstrap: "unknown",
    preloads: "present", moduleLoader: "custom_or_external", filesystem: "unknown", verified: true };
  expectUnavailable(input, "invalid_descriptor"); delete input.verified;
  expectUnavailable(input, "unsupported_runtime_profile"); input.platform = "linux";
  expectUnavailable(input, "unsupported_execution_profile"); input.mode = "paper_only";
  expectUnavailable(input, "application_not_unloaded"); input.bootstrap = "before_application_load";
  expectUnavailable(input, "unsupported_startup_profile"); input.preloads = "absent";
  expectUnavailable(input, "unsupported_loading_profile"); input.moduleLoader = "builtin_local_esm_cjs_json";
  expectUnavailable(input, "unsupported_filesystem_profile"); input.filesystem = "local_regular_files";
  assert.equal(evaluate(input).status, "candidate");
});

test("all states are fixed plain scalars with no input keys, values, hashes or error messages", () => {
  const sentinel = "synthetic-private-value-DO-NOT-COPY";
  const values = [null, sentinel, { ...fixture(), nodeVersion: sentinel }, { ...fixture(), [sentinel]: sentinel },
    ...alternatives.map(([field, choices]) => ({ ...fixture(), [field]: choices[0] })), fixture()];
  for (const input of values) {
    const result = evaluate(input);
    expectUnverified(result);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal(Object.values(result).every(value => typeof value === "string" || value === false), true);
  }
});
