import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME, durableAdmissionLineageReference,
  replayAdmissionLineageSchema } from "../domain/replayAdmissionLineage.js";
import { REPLAY_PROCESS_OBSERVATION_FILE_NAME, REPLAY_PROCESS_OBSERVATION_MAX_BYTES,
  replayProcessObservationSchema } from "../domain/replayProcessObservation.js";
import { replayInitialPortfolioObservationSchema } from "../domain/replayInitialPortfolioObservation.js";
import { durableSettingsObservationReference, replaySettingsObservationSchema } from "../domain/replaySettingsObservation.js";
import { prepareReplaySourceSnapshot } from "../domain/replaySourceSnapshot.js";
import { resolveReplayProcessObservationContext, type ReplayProcessObservationContext } from "../replay/codexHistoricalReplayRunner.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { acceptPaperSimulationWithAdmissionContext } from "./paperSimulationObservationStore.js";
import { writeReplayAdmissionLineage } from "./replayAdmissionLineageStore.js";
import { admissionStorageFixture, childFileBytes, writeAdmissionPredecessors } from "./replayAdmissionLineageTestFixtures.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "./replayInitialPortfolioObservationStore.js";
import { assertReplayProcessObservationFileSize, writeReplayProcessObservation } from "./replayProcessObservationStore.js";
import { processStorageFixture, readStoredJson, runnerProcessContext } from "./replayProcessObservationTestFixtures.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "./replaySettingsObservationStore.js";

const storageFailure = { message: "process observation storage failed" };
const attemptedFailure = { message: "process observation already attempted" };
const cName = REPLAY_PROCESS_OBSERVATION_FILE_NAME;
const bName = REPLAY_ADMISSION_LINEAGE_FILE_NAME;
const readC = async (directory: string) => replayProcessObservationSchema.parse(await readStoredJson(directory, cName));
const readB = async (directory: string) => replayAdmissionLineageSchema.parse(await readStoredJson(directory, bName));
const absentC = (directory: string) => assert.rejects(fs.lstat(join(directory, cName)), { code: "ENOENT" });

for (const stored of [false, true]) {
  test(`C binds the whole durable B and five runner scalars with ${stored ? "stored" : "generated"} capital`, async t => {
    const f = await processStorageFixture(t, stored), b = await readB(f.childDir);
    const before = await childFileBytes(f.childDir);
    await f.writer.observeProcess(f.processContext);
    const record = await readC(f.childDir), evidence = resolveReplayProcessObservationContext(f.processContext);
    assert.deepEqual(record.identity, f.actual.identity);
    assert.equal(record.startedAt, f.actual.startedAt);
    assert.equal(record.reservationHash, b.reservationHash);
    for (const key of ["initialObservation", "sourceObservation", "settingsObservation"] as const) assert.deepEqual(record[key], b[key]);
    assert.deepEqual(record.admissionObservation, { schemaVersion: b.schemaVersion,
      observationHash: createReplayResearchHash(b), lineage: { status: "recorded", mappingVersion: "paper_simulation_child_mapping.v1" } });
    assert.notEqual(record.admissionObservation.observationHash, createReplayResearchHash(b.lineage));
    assert.deepEqual(record.process, { status: "recorded", nodeVersion: process.version, platform: process.platform,
      architecture: process.arch, costModelVersion: "paper_cost_model.v5", executionModelVersion: "execution_simulator.v4" });
    assert.deepEqual(record.process, evidence.process);
    for (const value of [f.processContext, evidence, evidence.binding, evidence.binding.identity, evidence.process]) assert.equal(Object.isFrozen(value), true);
    assert.throws(() => Object.assign(evidence.process, { nodeVersion: "v0.0.0" }), TypeError);
    assert.throws(() => Object.assign(evidence.binding.identity, { runId: "changed" }), TypeError);
    for (const name of ["implementation", "sourceBuild", "dependencyLock", "loadedDependencies", "nodeArtifact",
      "runtimeConfiguration", "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[name], "unavailable");
    for (const name of ["completeRuntime", "completeConfiguration", "completeInput"] as const) assert.equal(record[name], false);
    assert.deepEqual((await childFileBytes(f.childDir)).filter(([name]) => name !== cName), before);
    const complete = await childFileBytes(f.childDir);
    await assert.rejects(f.writer.observeProcess(f.processContext), attemptedFailure);
    await assert.rejects(f.reserve(), { message: "initial portfolio observation reservation failed" });
    assert.deepEqual(await childFileBytes(f.childDir), complete);
  });
}

test("C uses owned original B references despite current files and caller binding mutations", async t => {
  const f = await processStorageFixture(t), original = await readB(f.childDir);
  const binding = structuredClone({ identity: f.actual.identity, startedAt: f.actual.startedAt });
  const context = await runnerProcessContext(f, { binding, onInitial: () => {
    binding.identity.runId = "after-first-await"; binding.startedAt = "2026-10-08T09:00:00.999Z";
  } });
  await fs.writeFile(join(f.childDir, bName), "{}\n");
  await fs.writeFile(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE), "{}\n");
  await f.writer.observeProcess(context);
  const record = await readC(f.childDir);
  assert.equal(record.admissionObservation.observationHash, createReplayResearchHash(original));
  assert.deepEqual(record.settingsObservation, original.settingsObservation);
  assert.deepEqual(record.identity, original.identity); assert.equal(record.startedAt, original.startedAt);
  assert.equal(await fs.readFile(join(f.childDir, bName), "utf8"), "{}\n");
  assert.equal(await fs.readFile(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"), "{}\n");
});

for (const mismatch of ["runId", "batchId", "runIndex", "startedAt"] as const) {
  test(`equal process values from another runner ${mismatch} cannot replace the bound child`, async t => {
    const f = await processStorageFixture(t), binding = structuredClone({ identity: f.actual.identity, startedAt: f.actual.startedAt });
    if (mismatch === "runId") binding.identity.runId += "_other";
    if (mismatch === "batchId") binding.identity.batchId = "paper_sim_20261008090000000_other";
    if (mismatch === "runIndex") binding.identity.runIndex = 1;
    if (mismatch === "startedAt") binding.startedAt = "2026-10-08T09:00:00.003Z";
    const other = await runnerProcessContext(f, { binding });
    assert.notEqual(other, f.processContext);
    assert.deepEqual(resolveReplayProcessObservationContext(other).process, resolveReplayProcessObservationContext(f.processContext).process);
    const before = await childFileBytes(f.childDir);
    await assert.rejects(f.writer.observeProcess(other), storageFailure);
    await assert.rejects(f.writer.observeProcess(f.processContext), attemptedFailure);
    await absentC(f.childDir); assert.deepEqual(await childFileBytes(f.childDir), before);
  });
}

test("forged C handles fail before input getters, serialization hooks, and proxy traps", async t => {
  const f = await processStorageFixture(t);
  let calls = 0;
  const trap = () => { calls++; throw Error("synthetic-private-process-detail"); };
  const accessor = Object.defineProperties({}, { process: { get: trap }, binding: { get: trap }, toJSON: { get: trap } });
  const proxy = new Proxy(accessor, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable(f.processContext, {}); revoked.revoke();
  const input = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }) as Parameters<typeof writeReplayProcessObservation>[1];
  for (const forged of [undefined, null, false, "context", {}, { ...f.processContext }, structuredClone(f.processContext),
    JSON.parse(JSON.stringify(f.processContext)), Object.create(f.processContext),
    resolveReplayProcessObservationContext(f.processContext), accessor, proxy, new Proxy(f.processContext, {}), revoked.proxy]) {
    await assert.rejects(writeReplayProcessObservation(forged, input), storageFailure);
  }
  const before = await childFileBytes(f.childDir);
  await assert.rejects(f.writer.observeProcess(proxy as ReplayProcessObservationContext), { message: "process observation context unavailable" });
  await assert.rejects(f.writer.observeProcess(f.processContext), attemptedFailure);
  assert.equal(calls, 0); await absentC(f.childDir); assert.deepEqual(await childFileBytes(f.childDir), before);
});

for (const stage of ["reservation", "initial", "source", "settings", "unavailable-admission"] as const) {
  test(`C before durable B at ${stage} consumes the attempt and leaves predecessors unchanged`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve(), context = await runnerProcessContext(f);
    if (stage !== "reservation") await writer(f.plan.initialPortfolio);
    if (["source", "settings", "unavailable-admission"].includes(stage)) await writer.observeSource(prepareReplaySourceSnapshot([]));
    if (["settings", "unavailable-admission"].includes(stage)) await writer.observeSettings(f.a.settings);
    if (stage === "unavailable-admission") {
      const unavailable = await acceptPaperSimulationWithAdmissionContext(join(f.root, "without-input"),
        "paper_sim_20261008090000000_without_input", f.evidence.acceptedAt, { requestedConfig: simulationConfig() });
      await writer.observeAdmission(unavailable, f.actual);
    }
    const before = await childFileBytes(f.childDir);
    await assert.rejects(writer.observeProcess(context), { message: "process observation preceding state unavailable" });
    await assert.rejects(writer.observeProcess(context), attemptedFailure);
    await absentC(f.childDir); assert.deepEqual(await childFileBytes(f.childDir), before);
  });
}

for (const unavailable of ["initial", "settings", "derivation"] as const) {
  test(`actual B ${unavailable} unavailable remains unavailable while process scalars can be recorded`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve();
    await writer(unavailable === "initial" ? { ...f.plan.initialPortfolio, cashKrw: -1 } : f.plan.initialPortfolio);
    await writer.observeSource(prepareReplaySourceSnapshot([]));
    await writer.observeSettings(unavailable === "settings" ? { status: "unavailable", reason: "unsupported_shape" } : f.a.settings);
    const actual = unavailable === "derivation" ? { ...f.actual, windowSamplingMode: "custom" } : f.actual;
    await writer.observeAdmission(f.context, actual);
    await writer.observeProcess(await runnerProcessContext(f));
    const b = await readB(f.childDir), c = await readC(f.childDir);
    assert.deepEqual(b.lineage, { status: "unavailable", reason: unavailable === "initial" ? "initial_unavailable"
      : unavailable === "settings" ? "settings_unavailable" : "unsupported_derivation" });
    assert.deepEqual(c.admissionObservation.lineage, b.lineage);
    assert.equal(c.admissionObservation.observationHash, createReplayResearchHash(b));
    assert.equal(c.process.status, "recorded"); assert.equal(c.completeInput, false); assert.equal(c.completeRuntime, false);
  });
}

test("actual runner unsupported process scalar records only unavailable and preserves durable B", async t => {
  const f = await processStorageFixture(t), before = await childFileBytes(f.childDir);
  const originalVersion = process.version;
  const context = await runnerProcessContext(f, { unsupportedVersion: "v24.1.0-private-synthetic-marker" });
  assert.equal(process.version, originalVersion);
  await f.writer.observeProcess(context);
  assert.deepEqual((await readC(f.childDir)).process, { status: "unavailable", reason: "unsupported_process_observation" });
  assert.equal((await fs.readFile(join(f.childDir, cName), "utf8")).includes("private-synthetic-marker"), false);
  assert.deepEqual((await childFileBytes(f.childDir)).filter(([name]) => name !== cName), before);
});

test("B returns a detached frozen whole-record reference only after directory close", async t => {
  const f = await admissionStorageFixture(t), writer = await f.reserve();
  await writeAdmissionPredecessors(f, writer);
  const initial = replayInitialPortfolioObservationSchema.parse(await readStoredJson(f.childDir, REPLAY_INITIAL_PORTFOLIO_FILE));
  const settings = replaySettingsObservationSchema.parse(await readStoredJson(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE));
  let entered!: () => void, release!: () => void, closed = false, settled = false;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]) === f.childDir && args[1] === "r") {
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => { entered(); await gate; await close(); closed = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const pending = writeReplayAdmissionLineage(f.context, { storageBaseDir: f.childDir, actual: f.actual,
    initialObservation: initial, settingsReference: durableSettingsObservationReference(settings) }).then(reference => { settled = true; return reference; });
  try {
    await waiting; assert.equal(settled, false); await absentC(f.childDir);
    release(); const reference = await pending;
    assert.equal(closed, true); assert.ok(reference);
    assert.deepEqual(reference, durableAdmissionLineageReference(await readB(f.childDir)));
    for (const value of [reference, reference.identity, reference.initialObservation, reference.initialObservation.initialPortfolio,
      reference.sourceObservation, reference.sourceObservation.source, reference.settingsObservation, reference.settingsObservation.settings,
      reference.admissionObservation, reference.admissionObservation.lineage]) assert.equal(Object.isFrozen(value), true);
    assert.deepEqual(Object.keys(reference.admissionObservation).sort(), ["lineage", "observationHash", "schemaVersion"]);
  } finally { release(); await pending.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

for (const failClose of [false, true]) {
  test(`a B file with ${failClose ? "failed" : "pending"} directory close cannot authorize C`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve();
    await writeAdmissionPredecessors(f, writer);
    const context = await runnerProcessContext(f);
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const original = fs.open;
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (String(args[0]) === f.childDir && args[1] === "r") {
        const close = handle.close.bind(handle);
        t.mock.method(handle, "close", async () => {
          entered(); await gate; await close();
          if (failClose) throw Error("synthetic B close failure");
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    const pending = writer.observeAdmission(f.context, f.actual);
    try {
      await waiting;
      const written = await childFileBytes(f.childDir);
      assert.equal((await readB(f.childDir)).lineage.status, "recorded");
      if (failClose) { release(); await assert.rejects(pending, { message: "admission lineage observation storage failed" }); }
      await assert.rejects(writer.observeProcess(context), { message: "process observation preceding state unavailable" });
      if (!failClose) { release(); await pending; }
      await assert.rejects(writer.observeProcess(context), attemptedFailure);
      await absentC(f.childDir); assert.deepEqual(await childFileBytes(f.childDir), written);
    } finally { release(); await pending.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

for (const kind of ["file", "directory", "symlink", "hardlink"] as const) {
  test(`orphan C ${kind} rejects reservation without modifying the original`, async t => {
    const f = await admissionStorageFixture(t), path = join(f.childDir, cName), sentinel = join(f.root, "sentinel");
    await fs.mkdir(f.childDir); await fs.writeFile(sentinel, "synthetic retained original\n");
    if (kind === "file") await fs.writeFile(path, "partial C\n");
    if (kind === "directory") await fs.mkdir(path);
    if (kind === "symlink") await fs.symlink(sentinel, path);
    if (kind === "hardlink") await fs.link(sentinel, path);
    const before = await fs.lstat(path);
    await assert.rejects(f.reserve(), { message: "initial portfolio observation reservation failed" });
    assert.deepEqual(await fs.readdir(f.childDir), [cName]);
    const after = await fs.lstat(path);
    assert.equal(after.ino, before.ino); assert.equal(after.size, before.size);
    assert.equal(await fs.readFile(sentinel, "utf8"), "synthetic retained original\n");
    if (kind !== "directory") assert.equal(await fs.readFile(path, "utf8"), kind === "file" ? "partial C\n" : "synthetic retained original\n");
  });
}

for (const kind of ["file", "symlink", "hardlink"] as const) {
  test(`racing C ${kind} after B durability is retained and consumes the attempt`, async t => {
    const f = await processStorageFixture(t), path = join(f.childDir, cName), sentinel = join(f.root, "race-sentinel");
    await fs.writeFile(sentinel, "racing original\n");
    if (kind === "file") await fs.writeFile(path, "racing original\n");
    if (kind === "symlink") await fs.symlink(sentinel, path);
    if (kind === "hardlink") await fs.link(sentinel, path);
    const before = await childFileBytes(f.childDir), inode = (await fs.lstat(path)).ino;
    await assert.rejects(f.writer.observeProcess(f.processContext), storageFailure);
    await assert.rejects(f.writer.observeProcess(f.processContext), attemptedFailure);
    assert.equal((await fs.lstat(path)).ino, inode);
    assert.equal(await fs.readFile(sentinel, "utf8"), "racing original\n");
    assert.deepEqual(await childFileBytes(f.childDir), before);
  });
}

for (const failure of ["open", "write", "file-sync", "file-close", "directory-open", "directory-sync", "directory-close"] as const) {
  test(`C ${failure} failure preserves original A/B and the partial reservation barrier`, async t => {
    const f = await processStorageFixture(t), before = await childFileBytes(f.childDir);
    let injected = false, opened = false, resolved = false;
    const fail = async () => { injected = true; throw Object.assign(Error("synthetic-private-process-storage-detail"), { code: "EIO" }); };
    const original = fs.open;
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const isC = String(args[0]) === join(f.childDir, cName) && typeof args[1] === "number";
      const isDirectory = opened && String(args[0]) === f.childDir && args[1] === "r";
      if (isC && failure === "open" || isDirectory && failure === "directory-open") return fail();
      const handle = await original(...args);
      if (isC) {
        opened = true;
        if (failure === "write") t.mock.method(handle, "writeFile", fail);
        if (failure === "file-sync") t.mock.method(handle, "sync", fail);
        if (failure === "file-close") { const close = handle.close.bind(handle); t.mock.method(handle, "close", async () => { await close(); return fail(); }); }
      }
      if (isDirectory) {
        if (failure === "directory-sync") t.mock.method(handle, "sync", fail);
        if (failure === "directory-close") { const close = handle.close.bind(handle); t.mock.method(handle, "close", async () => { await close(); return fail(); }); }
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(f.writer.observeProcess(f.processContext).then(() => { resolved = true; }), storageFailure);
      assert.equal(injected, true); assert.equal(resolved, false);
      assert.deepEqual((await childFileBytes(f.childDir)).filter(([name]) => name !== cName), before);
      if (failure === "open") await absentC(f.childDir);
      else assert.equal((await fs.stat(join(f.childDir, cName))).isFile(), true);
      mock.mock.restore(); syncBuiltinESMExports();
      const partial = await childFileBytes(f.childDir);
      await assert.rejects(f.writer.observeProcess(f.processContext), attemptedFailure);
      await assert.rejects(f.reserve(), { message: "initial portfolio observation reservation failed" });
      assert.deepEqual(await childFileBytes(f.childDir), partial);
      assert.equal(partial.some(([name]) => name === REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), true);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("C directory close is awaited and simultaneous owner re-entry cannot publish twice", async t => {
  const f = await processStorageFixture(t);
  let entered!: () => void, release!: () => void, closed = false, resolved = false, writes = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]) === join(f.childDir, cName) && typeof args[1] === "number") writes++;
    if (String(args[0]) === f.childDir && args[1] === "r") {
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => { entered(); await gate; await close(); closed = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const pending = f.writer.observeProcess(f.processContext).then(() => { assert.equal(closed, true); resolved = true; });
  try {
    await waiting; assert.equal(resolved, false);
    await assert.rejects(f.writer.observeProcess(f.processContext), attemptedFailure);
    release(); await pending; assert.equal(resolved, true); assert.equal(writes, 1);
    assert.equal((await readC(f.childDir)).process.status, "recorded");
  } finally { release(); await pending.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

for (const bytes of [4_095, 4_096, 4_097]) {
  test(`C pure UTF-8 size guard handles exactly ${bytes} bytes including newline`, () => {
    assert.equal(REPLAY_PROCESS_OBSERVATION_MAX_BYTES, 4_096);
    // Deliberately not schema-valid records: this isolates byte counting from schema and producer authority.
    for (const prefix of ["", "한😀é"]) {
      const text = prefix + "a".repeat(bytes - Buffer.byteLength(prefix, "utf8") - 1) + "\n";
      assert.equal(Buffer.byteLength(text, "utf8"), bytes);
      if (bytes > REPLAY_PROCESS_OBSERVATION_MAX_BYTES) assert.throws(() => assertReplayProcessObservationFileSize(text), { message: "process observation file limit" });
      else assert.doesNotThrow(() => assertReplayProcessObservationFileSize(text));
    }
  });
}
