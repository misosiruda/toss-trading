import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPaperCostModel } from "../paper/costModel.js";
import { createPaperExecutionPolicy } from "../paper/executionModel.js";
import { resolvePaperRiskProfile } from "../paper/riskProfile.js";
import {
  PAPER_EXPERIMENT_LIMITS,
  PaperExperimentValidationError,
  parsePaperExperimentInput,
  type PaperExperimentInput,
  type PaperExperimentValidationCode
} from "./paperExperimentInput.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { SimulatedClock } from "./simulatedClock.js";

const fixtureText = readFileSync(new URL("../../src/replay/fixtures/paper-experiment.v1.json", import.meta.url), "utf8");
const identity = { implementationRevision: "76e203bf6993e7c5cb24fd59ad34a53175b8fdb7" };
const goldenHash = "sha256:1231f1832a0819231271bde9514d7e3b3bebaf9090bea601969bf228af62a651";

function fixture(): PaperExperimentInput {
  return JSON.parse(fixtureText) as PaperExperimentInput;
}

function parse(value: unknown) {
  return parsePaperExperimentInput(JSON.stringify(value), identity);
}

function changed(path: string, value: unknown): unknown {
  const input = JSON.parse(fixtureText) as Record<string, unknown>;
  const keys = path.split(".");
  const leaf = keys.pop()!;
  let parent = input;
  for (const key of keys) parent = parent[key] as Record<string, unknown>;
  if (value === undefined) delete parent[leaf];
  else parent[leaf] = value;
  return input;
}

function rejects(value: unknown, code?: PaperExperimentValidationCode) {
  assert.throws(() => parse(value), (error: unknown) => {
    assert.ok(error instanceof PaperExperimentValidationError);
    if (code !== undefined) assert.equal(error.code, code);
    assert.equal(error.message, `Paper experiment validation failed: ${error.code}`);
    return true;
  });
}

test("paper experiment pins the tracked golden fixture and complete effective input", () => {
  const result = parsePaperExperimentInput(fixtureText, identity);
  assert.equal(result.inputHash, goldenHash);
  assert.equal(result.inputHash, createReplayResearchHash(result.normalizedInput));
  assert.equal(result.normalizedInput.implementationRevision, identity.implementationRevision);
  assert.deepEqual(result.preflight, {
    tickCount: 3, decisionCallUpperBound: 3, snapshotCount: 3, symbolCount: 1,
    usableTickCount: 3, missingSymbolTickCount: 0, status: "available_fixture",
    ticks: [1, 2, 3].map((day) => ({
      simulatedAt: `2025-01-0${day}T00:00:00.000Z`,
      usableSnapshotIds: [`fixture_a_day_${day}`], missing: []
    }))
  });
  const profile = resolvePaperRiskProfile({ name: "conservative", initialCashKrw: 1_000_000 });
  assert.deepEqual(result.normalizedInput.configuration.riskPolicy, profile.riskPolicy);
  assert.deepEqual(result.normalizedInput.configuration.allocationPolicy, profile.allocationPolicy);
  assert.equal(result.normalizedInput.configuration.paperExitPolicy, null);
  assert.deepEqual(result.normalizedInput.costModel, createPaperCostModel(result.normalizedInput.configuration.executionPolicy));
  assert.equal(result.normalizedInput.provider.externalCalls, 0);
});

test("paper experiment normalized payload reparses without original fixture or mutable state", () => {
  const first = parse(fixture());
  const second = parse(first.normalizedInput);
  assert.deepEqual(second, first);
  const input = fixture();
  delete input.universe.symbols[0]!.lifecycleStatus;
  const defaulted = parse(input);
  assert.equal(defaulted.normalizedInput.universe.symbols[0]!.lifecycleStatus, "unknown");
  assert.deepEqual(parse(defaulted.normalizedInput), defaulted);
  delete input.configuration.executionPolicy;
  assert.deepEqual(parse(input).normalizedInput.configuration.executionPolicy, createPaperExecutionPolicy(undefined));
});

test("paper experiment output and all nested data are immutable and detached", () => {
  const input = fixture();
  const result = parse(input);
  const serialized = JSON.stringify(result);
  input.source.snapshots[0]!.lastPriceKrw = 1;
  input.configuration.constraints.allowedActions.reverse();
  assert.equal(JSON.stringify(result), serialized);
  function assertFrozen(value: unknown) {
    if (value === null || typeof value !== "object") return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozen(child);
  }
  assertFrozen(result);
  assert.equal(Reflect.set(result.normalizedInput.source.snapshots[0]!, "lastPriceKrw", 1), false);
});

test("paper experiment ignores object/snapshot/universe order and equivalent explicit timezones", () => {
  const input = fixture();
  input.source.snapshots.reverse();
  for (const snapshot of input.source.snapshots) {
    snapshot.observedAt = snapshot.observedAt.replace("T00:00:00.000Z", "T09:00:00+09:00");
    snapshot.createdAt = snapshot.createdAt.replace("T00:00:00.000Z", "T19:00:00-05:00").replace("01-04", "01-03");
  }
  input.configuration.clock.startAt = "2025-01-01T09:00:00+09:00";
  input.configuration.clock.endAt = "2025-01-02T19:00:00-05:00";
  input.evaluation.evidenceCutoff = "2025-01-03T09:00:00.000+09:00";
  input.evaluation.generatedAt = "2025-01-04T00:00:00Z";
  function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
    }
    return value;
  }
  assert.deepEqual(parse(reverseKeys(input)), parse(fixture()));
  const multiple = fixture();
  multiple.universe.symbols.push({ ...multiple.universe.symbols[0]!, symbol: "FIXTURE_B" });
  multiple.source.snapshots.push({ ...multiple.source.snapshots[0]!, symbol: "FIXTURE_B", snapshotId: "fixture_b" });
  const normal = parse(multiple);
  multiple.universe.symbols.reverse();
  multiple.source.snapshots.reverse();
  assert.deepEqual(parse(multiple), normal);
});

for (const [path, value] of [
  ["source.snapshots.0.lastPriceKrw", 10001],
  ["source.snapshots.0.createdAt", "2025-01-05T00:00:00.000Z"],
  ["evaluation.evidenceCutoff", "2025-01-03T00:00:00.001Z"],
  ["configuration.executionPolicy.feeBps", 2],
  ["configuration.executionPolicy.halfSpreadBps", 3],
  ["configuration.executionPolicy.marketImpactBpsPerParticipationRate", 1],
  ["configuration.riskPolicy", { maxPositionWeightRatio: 0.2 }],
  ["configuration.riskProfile", "balanced"],
  ["question", "다른 engineering 질문"],
  ["configuration.initialCashKrw", 2_000_000]
] as const) {
  test(`paper experiment binds ${path} in its input hash`, () => {
    assert.notEqual(parse(changed(path, value)).inputHash, parse(fixture()).inputHash);
  });
}

for (const [path, value] of [
  ["schemaVersion", "paper_experiment_input.v2"], ["fixture.id", "arbitrary-fixture"],
  ["fixture.version", 2], ["provider.version", "first_priced_fixture.v2"],
  ["provider.mode", "codex_cli"], ["provider.externalCalls", 1], ["mode", "live"],
  ["source.kind", "external"], ["source.path", "/tmp/source"],
  ["source.url", "https://example.com"], ["provider.modulePath", "../provider.js"],
  ["configuration.clock.session", { startTime: "09:00", endTime: "15:00" }],
  ["configuration.clock.source", "random_window"], ["configuration.strategyPreset", "momentum"],
  ["configuration.candidateStrategyBucket", "swing"],
  ["configuration.paperExitPolicy", { stopLossRatio: 0.1 }],
  ["configuration.marketRegimeAllocationPolicy", { lookbackDays: 5 }],
  ["configuration.riskPolicy", { dynamicCashReservePolicy: { lookbackDays: 5 } }],
  ["initialPositions", [{ symbol: "REAL" }]], ["evaluation.primaryBenchmark", "equalWeight"],
  ["evaluation.limitations", []], ["configuration.clock.speedMultiplier", 2],
  ["configuration.samplingPolicy.timezoneOffsetMinutes", 540],
  ["configuration.samplingPolicy.maxDecisionCalls", null],
  ["source.snapshots.0.symbol", "005930"],
  ["source.snapshots.0.sourceRefs", []],
  ["source.snapshots.0.sourceRefs", ["https://example.com/market"]],
  ["source.snapshots.0.sourceRefs", ["fixture:paper-experiment.v2"]],
  ["universe.symbols.0.sourceSymbol", "REAL"],
  ["configuration.executionPolicy.fillRatio", 1.1],
  ["configuration.executionPolicy.halfSpreadBps", -1],
  ["configuration.executionPolicy.marketImpactBpsPerParticipationRate", -1],
  ["configuration.executionPolicy.feeBps", -1],
  ["configuration.executionPolicy.minLiquidityFillRatio", 1.1],
  ["configuration.executionPolicy.maxVolumeParticipationRate", 1.1],
  ["configuration.riskPolicy", { minCashReserveRatio: 2 }],
  ["configuration.initialCashKrw", Number.MAX_SAFE_INTEGER + 1],
  ["source.snapshots.0.volume", -1], ["source.snapshots.0", null],
  ["source.snapshots", []], ["source.snapshots", undefined],
  ["universe.symbols", []], ["question", ""], ["implementationRevision", "not-a-revision"]
] as const) {
  test(`paper experiment rejects unsupported/invalid ${path}: ${JSON.stringify(value)}`, () => {
    rejects(changed(path, value));
  });
}

for (const path of ["configuration.clock.startAt", "configuration.clock.endAt", "evaluation.evidenceCutoff", "evaluation.generatedAt", "source.snapshots.0.observedAt", "source.snapshots.0.createdAt"]) {
  test(`paper experiment requires valid explicit millisecond/second ISO timestamps at ${path}`, () => {
    for (const value of ["2025-01-01", "2025-01-01T00:00:00", "Wed, 01 Jan 2025 00:00:00 GMT", "2025-02-30T00:00:00.000Z", "2025-01-01T24:00:00.000Z", "2025-01-01T00:00:60.000Z", "2025-01-01T00:00:00.0001Z", "2025-01-01T00:00:00+24:00", "9999-12-31T23:59:59-10:00", "invalid"]) {
      rejects(changed(path, value));
    }
  });
}

test("paper experiment rejects unknown nested fields without disclosing their keys or values", () => {
  for (const parent of ["", "fixture", "source", "source.snapshots.0", "universe", "universe.symbols.0", "configuration", "configuration.clock", "configuration.samplingPolicy", "configuration.constraints", "configuration.executionPolicy", "provider", "evaluation"]) {
    const rawSecret = "private-user-secret-/home/user/file";
    const path = parent.length === 0 ? rawSecret : `${parent}.${rawSecret}`;
    assert.throws(() => parse(changed(path, rawSecret)), (error: unknown) => {
      assert.ok(error instanceof PaperExperimentValidationError);
      assert.ok(!String(error).includes(rawSecret));
      return true;
    });
  }
  rejects(changed("configuration.riskPolicy", { unknownSecret: true }));
  const normalized = JSON.parse(JSON.stringify(parse(fixture()).normalizedInput));
  normalized.configuration.allocationPolicy.unknownSecret = true;
  rejects(normalized);
  normalized.configuration.allocationPolicy = null;
  normalized.costModel.unknownSecret = true;
  rejects(normalized, "COST_MODEL_MISMATCH");
  delete normalized.costModel.unknownSecret;
  normalized.costModel.modelVersion = "paper_cost_model.v999";
  rejects(normalized, "COST_MODEL_MISMATCH");
});

test("paper experiment rejects malformed JSON, malformed UTF-8 and nonfinite encoded numbers", () => {
  for (const text of ["", "null", "[]", "{", "{}\n{}", fixtureText.replace('"volume": 10000', '"volume": 1e999')]) {
    assert.throws(() => parsePaperExperimentInput(text, identity), PaperExperimentValidationError);
  }
  assert.throws(() => parsePaperExperimentInput(new Uint8Array([0xc3, 0x28]), identity), { code: "INVALID_JSON" });
  assert.deepEqual(parsePaperExperimentInput(Buffer.from(fixtureText), identity), parse(fixture()));
});

test("paper experiment enforces a UTF-8 byte cap before parsing including exact boundaries", () => {
  const size = Buffer.byteLength(fixtureText);
  const exact = fixtureText + " ".repeat(PAPER_EXPERIMENT_LIMITS.inputBytes - size);
  assert.deepEqual(parsePaperExperimentInput(exact, identity), parse(fixture()));
  assert.deepEqual(parsePaperExperimentInput(Buffer.from(exact), identity), parse(fixture()));
  assert.throws(() => parsePaperExperimentInput(exact + " ", identity), { code: "INPUT_SIZE" });
  assert.throws(() => parsePaperExperimentInput(Buffer.from(exact + " "), identity), { code: "INPUT_SIZE" });
  const multiByte = `{"question":"${"한".repeat(800_000)}"}`;
  assert.ok(multiByte.length < PAPER_EXPERIMENT_LIMITS.inputBytes);
  assert.throws(() => parsePaperExperimentInput(multiByte, identity), { code: "INPUT_SIZE" });
});

test("paper experiment enforces independent 100 snapshot and 10 symbol limits", () => {
  const input = fixture();
  input.source.snapshots = Array.from({ length: 100 }, (_, index) => ({
    ...input.source.snapshots[0]!, snapshotId: `snapshot_${index}`,
    observedAt: new Date(Date.parse("2025-01-01T00:00:00Z") + index * 60_000).toISOString()
  }));
  assert.equal(parse(input).preflight.snapshotCount, 100);
  input.source.snapshots.push({ ...input.source.snapshots[0]!, snapshotId: "snapshot_101", observedAt: "2025-01-02T00:00:00Z" });
  rejects(input);
  input.source.snapshots = [];
  const member = input.universe.symbols[0]!;
  input.universe.symbols = Array.from({ length: 10 }, (_, index) => ({ ...member, symbol: `FIXTURE_${index}` }));
  input.source.snapshots = input.universe.symbols.map((symbol, index) => ({
    ...fixture().source.snapshots[0]!, symbol: symbol.symbol, snapshotId: `snapshot_${index}`
  }));
  assert.equal(parse(input).preflight.symbolCount, 10);
  input.universe.symbols.push({ ...member, symbol: "FIXTURE_10" });
  input.source.snapshots.push({ ...input.source.snapshots[0]!, symbol: "FIXTURE_10", snapshotId: "snapshot_10" });
  rejects(input);
});

test("paper experiment bounds ticks arithmetically before allocation independently of call limits", (context) => {
  const input = fixture();
  input.configuration.clock.stepSeconds = 60;
  input.configuration.clock.endAt = input.configuration.clock.startAt;
  assert.equal(parse(input).preflight.tickCount, 1);
  input.configuration.clock.endAt = "2025-01-01T01:39:00.000Z";
  input.configuration.samplingPolicy.maxDecisionCalls = 100;
  assert.equal(parse(input).preflight.tickCount, 100);
  assert.equal(parse(input).preflight.decisionCallUpperBound, 100);
  input.configuration.samplingPolicy.maxDecisionCalls = 101;
  rejects(input);
  input.configuration.samplingPolicy.maxDecisionCalls = 1;
  input.configuration.samplingPolicy.everyNSteps = 100;
  const ticks = context.mock.method(SimulatedClock.prototype, "ticks", () => { throw Error("must not allocate ticks"); });
  input.configuration.clock.endAt = "2025-01-01T01:40:00.000Z";
  rejects(input, "TICK_LIMIT");
  input.configuration.clock.endAt = "9999-12-31T23:59:59.999Z";
  rejects(input, "TICK_LIMIT");
  assert.equal(ticks.mock.callCount(), 0);
});

test("paper experiment rejects reversed windows and subminimum or unsafe steps", () => {
  rejects(changed("configuration.clock.endAt", "2024-12-31T00:00:00.000Z"), "INVALID_WINDOW");
  for (const step of [0, -1, 59, 60.5, Number.MAX_SAFE_INTEGER]) rejects(changed("configuration.clock.stepSeconds", step));
  for (const calls of [0, -1, 1.5, 101]) rejects(changed("configuration.samplingPolicy.maxDecisionCalls", calls));
});

test("paper experiment rejects snapshot collisions after timestamp normalization", () => {
  const input = fixture();
  input.universe.symbols.push({ ...input.universe.symbols[0]!, symbol: "FIXTURE_B" });
  input.source.snapshots.push({ ...input.source.snapshots[0]!, symbol: "FIXTURE_B" });
  rejects(input, "SOURCE_CONFLICT");
  const duplicate = fixture();
  duplicate.source.snapshots.push({ ...duplicate.source.snapshots[0]!, snapshotId: "different_id", observedAt: "2025-01-01T09:00:00+09:00" });
  rejects(duplicate, "SOURCE_CONFLICT");
});

test("paper experiment checks membership, duplicates and inconsistent universe metadata", () => {
  const input = fixture();
  input.universe.symbols.push({ ...input.universe.symbols[0]! });
  rejects(input);
  rejects(changed("source.snapshots.0.symbol", "FIXTURE_UNKNOWN"), "UNIVERSE_MISMATCH");
  rejects(changed("universe.symbols.0.assetType", "ETF"), "UNIVERSE_MISMATCH");
  input.universe.symbols[1]!.symbol = "FIXTURE_UNKNOWN";
  rejects(input, "UNIVERSE_MISMATCH");
});

test("paper experiment cutoff applies to observedAt, not fixture creation or first tick", () => {
  const result = parse(fixture());
  assert.equal(result.preflight.usableTickCount, 3);
  rejects(changed("source.snapshots.2.observedAt", "2025-01-03T00:00:00.001Z"), "SOURCE_CUTOFF");
  rejects(changed("evaluation.evidenceCutoff", "2025-01-02T23:59:59.999Z"), "SOURCE_CUTOFF");
  assert.doesNotThrow(() => parse(changed("source.snapshots.2.createdAt", "2026-01-01T00:00:00Z")));
});

test("paper experiment rejects all-unusable sources and preserves partial coverage reasons", () => {
  const input = fixture();
  input.source.snapshots = [input.source.snapshots[1]!];
  input.configuration.maxSnapshotAgeSeconds = 0;
  const result = parse(input);
  assert.equal(result.preflight.status, "insufficient_data");
  assert.equal(result.preflight.usableTickCount, 1);
  assert.deepEqual(result.preflight.ticks.map((tick) => tick.missing[0]?.reason ?? null), ["future_only", null, "stale"]);
  input.configuration.clock.startAt = "2025-01-03T00:00:00Z";
  rejects(input, "NO_USABLE_SOURCE");
  input.configuration.clock.startAt = "2025-01-01T00:00:00Z";
  input.configuration.clock.endAt = "2025-01-01T00:00:00Z";
  rejects(input, "NO_USABLE_SOURCE");
  input.source.snapshots = fixture().source.snapshots.map((snapshot) => ({ ...snapshot, lastPriceKrw: 0 }));
  rejects(input, "NO_USABLE_SOURCE");
  input.configuration.clock.endAt = "2025-01-03T00:00:00Z";
  input.source.snapshots[1]!.lastPriceKrw = 1;
  assert.equal(parse(input).preflight.ticks[0]!.missing[0]!.reason, "price_unavailable");
});

test("paper experiment requires caller identity and rejects mismatched requested revisions", () => {
  rejects(changed("implementationRevision", "a".repeat(40)), "REVISION_MISMATCH");
  assert.equal(parse(changed("implementationRevision", identity.implementationRevision)).inputHash, parse(fixture()).inputHash);
  for (const context of [{ implementationRevision: "bad" }, { ...identity, path: "/private" }, {}]) {
    assert.throws(() => parsePaperExperimentInput(fixtureText, context as typeof identity), { code: "INVALID_EXECUTION_IDENTITY" });
  }
  assert.notEqual(parsePaperExperimentInput(fixtureText, { implementationRevision: "a".repeat(40) }).inputHash, goldenHash);
});

test("paper experiment import and admission are pure under hostile environment in fresh processes", () => {
  const moduleUrl = new URL("./paperExperimentInput.js", import.meta.url).href;
  const program = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import fsPromises from 'node:fs/promises';
    import childProcess from 'node:child_process';
    import http from 'node:http';
    import https from 'node:https';
    import net from 'node:net';
    import { syncBuiltinESMExports } from 'node:module';
    const calls = [];
    const deny = name => (...args) => { calls.push(name); throw new Error('forbidden side effect'); };
    for (const api of [fs, fsPromises]) {
      for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename', 'copyFile', 'truncate', 'chmod', 'chown', 'mkdtemp', 'symlink', 'link', 'createWriteStream']) {
        if (name in api) api[name] = deny(name);
        if (name + 'Sync' in api) api[name + 'Sync'] = deny(name + 'Sync');
      }
      for (const name of ['open', 'openSync']) {
        if (!(name in api)) continue;
        const original = api[name];
        api[name] = (...args) => { if (args[1] !== 'r' && args[1] !== 0) return deny(name)(); return original(...args); };
      }
    }
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = deny(name);
    for (const api of [http, https]) for (const name of ['request', 'get']) api[name] = deny(name);
    for (const name of ['connect', 'createConnection']) net[name] = deny(name);
    globalThis.fetch = deny('fetch');
    const OriginalDate = Date;
    globalThis.Date = new Proxy(OriginalDate, {
      construct(target, args) { if (args.length === 0) return deny('wall clock constructor')(); return Reflect.construct(target, args); },
      apply() { return deny('wall clock function')(); }
    });
    Date.now = deny('Date.now');
    Math.random = deny('Math.random');
    syncBuiltinESMExports();
    const { parsePaperExperimentInput } = await import(${JSON.stringify(moduleUrl)});
    const result = parsePaperExperimentInput(${JSON.stringify(fixtureText)}, ${JSON.stringify(identity)});
    assert.equal(result.inputHash, ${JSON.stringify(goldenHash)});
    assert.deepEqual(calls, []);
    process.stdout.write(result.inputHash);
  `;
  for (const timezone of ["UTC", "Asia/Seoul", "America/New_York"]) {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", program], {
      env: { ...process.env, TZ: timezone, AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "live", BROKER_PROVIDER: "toss", TRADING_ENABLED: "true", CODEX_PATH: "/forbidden" },
      encoding: "utf8", timeout: 15_000
    });
    assert.equal(result, goldenHash);
  }
});
