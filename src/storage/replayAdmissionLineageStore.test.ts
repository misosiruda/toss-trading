import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { resolvePaperSimulationConfig } from "../api/paperSimulationConfig.js";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME, REPLAY_ADMISSION_LINEAGE_MAX_BYTES,
  replayAdmissionLineageSchema } from "../domain/replayAdmissionLineage.js";
import { prepareReplaySourceSnapshot } from "../domain/replaySourceSnapshot.js";
import { durableSettingsObservationReference, durableSourceObservationReference,
  replaySettingsObservationSchema } from "../domain/replaySettingsObservation.js";
import { replayInitialPortfolioObservationSchema } from "../domain/replayInitialPortfolioObservation.js";
import { replaySourceObservationSchema } from "../domain/replaySourceObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { assertReplayAdmissionLineageFileSize, writeReplayAdmissionLineage } from "./replayAdmissionLineageStore.js";
import { admissionPredecessors, admissionStorageFixture, childFileBytes,
  writeAdmissionPredecessors } from "./replayAdmissionLineageTestFixtures.js";
import { acceptPaperSimulationWithAdmissionContext, paperSimulationObservationPath,
  resolvePaperSimulationAdmissionContext, type PaperSimulationAdmissionContext } from "./paperSimulationObservationStore.js";
import { paperSimulationInputPath } from "./paperSimulationInputStore.js";
import { paperSimulationRequestPath } from "./paperSimulationRequestStore.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "./replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "./replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE, writeReplaySettingsObservation } from "./replaySettingsObservationStore.js";

const storageFailure = { message: "admission lineage observation storage failed" };
const readJson = async (path: string): Promise<unknown> => JSON.parse(await fs.readFile(path, "utf8"));
const readLineage = async (directory: string) => replayAdmissionLineageSchema.parse(
  await readJson(join(directory, REPLAY_ADMISSION_LINEAGE_FILE_NAME)));
const absentLineage = (directory: string) => assert.rejects(fs.lstat(join(directory, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });

for (const stored of [false, true]) {
  test(`real admission and durable child bind exact stored hashes with ${stored ? "stored" : "generated"} initial capital`, async t => {
    const f = await admissionStorageFixture(t, stored), writer = await f.reserve();
    await writeAdmissionPredecessors(f, writer);
    const before = await childFileBytes(f.childDir);
    await writer.observeAdmission(f.context, f.actual);
    const record = await readLineage(f.childDir), id = f.actual.identity.batchId;
    const canonical = await readJson(paperSimulationRequestPath(f.admissionDir, id));
    const input = await readJson(paperSimulationInputPath(f.admissionDir, id));
    const accepted = JSON.parse((await fs.readFile(paperSimulationObservationPath(f.admissionDir, id), "utf8")).trim());
    const reservation = await readJson(join(f.childDir, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE));
    const initial = replayInitialPortfolioObservationSchema.parse(await readJson(join(f.childDir, REPLAY_INITIAL_PORTFOLIO_FILE)));
    const source = replaySourceObservationSchema.parse(await readJson(join(f.childDir, REPLAY_SOURCE_OBSERVATION_FILE)));
    const settings = replaySettingsObservationSchema.parse(await readJson(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE)));
    assert.deepEqual(record.identity, f.actual.identity);
    assert.equal(record.startedAt, "2026-10-08T09:00:00.002Z");
    assert.equal(record.reservationHash, createReplayResearchHash(reservation));
    assert.equal(record.initialObservation.observationHash, createReplayResearchHash(initial));
    assert.equal(record.sourceObservation.observationHash, createReplayResearchHash(source));
    assert.equal(record.settingsObservation.observationHash, createReplayResearchHash(settings));
    assert.deepEqual(record.initialObservation, settings.initialObservation);
    assert.deepEqual(record.sourceObservation, settings.sourceObservation);
    assert.deepEqual(record.settingsObservation, durableSettingsObservationReference(settings).settingsObservation);
    assert.equal(record.lineage.status, "recorded");
    if (record.lineage.status !== "recorded" || settings.settings.status !== "recorded") return;
    assert.deepEqual(record.lineage.receipt, { receiptVersion: "paper_simulation_admission_receipt.v1",
      simulationRunId: id, batchId: id, acceptedAt: "2026-10-08T09:00:00.000Z",
      canonicalVersion: "paper_simulation_canonical_request.v1", canonicalRequestHash: createReplayResearchHash(canonical),
      inputVersion: "paper_simulation_input_provenance.v1", inputProvenanceHash: createReplayResearchHash(input) });
    assert.equal(accepted.canonicalRequestHash, record.lineage.receipt.canonicalRequestHash);
    assert.equal(accepted.inputProvenanceHash, record.lineage.receipt.inputProvenanceHash);
    assert.equal(record.lineage.expectedSettingsHash, settings.settings.contentHash);
    assert.equal(record.lineage.normalizedBatchSeed, "storage-fixture");
    assert.deepEqual(record.lineage.plannedWindow, f.actual.windowSelection);
    assert.equal(record.lineage.initialCapitalRelation, stored ? "stored_portfolio_precedence" : "generated_matches_admission");
    for (const preceding of [initial, source, settings]) assert.equal(preceding.admission, "unavailable");
    for (const name of ["clock", "sampler", "provider", "acquisition", "sourceTrust", "sourceFileIdentity",
      "sourceReadCompleteness", "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[name], "unavailable");
    assert.equal(record.completeInput, false); assert.equal(record.completeConfiguration, false);
    assert.deepEqual((await childFileBytes(f.childDir)).filter(([name]) => name !== REPLAY_ADMISSION_LINEAGE_FILE_NAME), before);
    const complete = await childFileBytes(f.childDir);
    await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
    assert.deepEqual(await childFileBytes(f.childDir), complete);
  });
}

test("B uses owned durable references and snapshots despite caller or current-file mutations", async t => {
  const f = await admissionStorageFixture(t), writer = await f.reserve();
  f.a.settings = structuredClone(f.a.settings);
  await writeAdmissionPredecessors(f, writer);
  const original = replaySettingsObservationSchema.parse(await readJson(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE)));
  f.plan.initialPortfolio.cashKrw = 7;
  if (f.a.settings.status === "recorded") f.a.settings.snapshot.maxCandidates = 1;
  f.admissionSnapshot.effectiveConfig.tickDelayMs = 999;
  await fs.writeFile(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE), "{}\n");
  await fs.writeFile(paperSimulationInputPath(f.admissionDir, f.actual.identity.batchId), "{}\n");
  await writer.observeAdmission(f.context, f.actual);
  const record = await readLineage(f.childDir);
  assert.equal(record.settingsObservation.observationHash, createReplayResearchHash(original));
  assert.equal(record.lineage.status, "recorded");
  assert.equal(await fs.readFile(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"), "{}\n");
});

test("forged context fails before every B input getter and proxy trap", async t => {
  const f = await admissionStorageFixture(t);
  let calls = 0;
  const trap = () => { calls++; throw Error("private forged context detail"); };
  const accessor = Object.defineProperties({}, { receipt: { get: trap }, status: { get: trap }, toJSON: { get: trap } });
  const proxy = new Proxy(accessor, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable(f.context, {}); revoked.revoke();
  const evidence = resolvePaperSimulationAdmissionContext(f.context);
  const poison = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }) as Parameters<typeof writeReplayAdmissionLineage>[1];
  for (const forged of [undefined, null, false, "context", {}, { ...f.context }, JSON.parse(JSON.stringify(f.context)),
    Object.create(f.context), evidence, evidence.status === "available" ? evidence.receipt : {}, accessor, proxy,
    new Proxy(f.context, {}), revoked.proxy]) {
    await assert.rejects(writeReplayAdmissionLineage(forged, poison), storageFailure);
  }
  const writer = await f.reserve();
  await assert.rejects(writer.observeAdmission(proxy as PaperSimulationAdmissionContext, poison),
    { message: "paper simulation admission context is not issued" });
  await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
  assert.equal(calls, 0); await absentLineage(f.childDir);
});

for (const kind of ["canonical-only", "credential-seed", "redacted-jwt"] as const) {
  test(`genuine ${kind} issuer returns before B input metadata or identity inspection`, async t => {
    const f = await admissionStorageFixture(t), config = simulationConfig();
    if (kind === "credential-seed") config.window.seed = "password=SYNTH_B";
    if (kind === "redacted-jwt") config.window.seed = "abcdefghijklmnop.abcdefgh.ijklmnop";
    const snapshot = resolvePaperSimulationConfig(config, {});
    const context = await acceptPaperSimulationWithAdmissionContext(join(f.root, "unavailable"),
      "paper_sim_20261008090000000_password_SYNTH_B", f.evidence.acceptedAt,
      kind === "canonical-only" ? { requestedConfig: config } : { requestedConfig: config, inputSnapshot: snapshot });
    assert.deepEqual(resolvePaperSimulationAdmissionContext(context),
      { status: "unavailable", reason: kind === "canonical-only" ? "input_missing" : "redacted" });
    let calls = 0;
    const trap = () => { calls++; throw Error("B metadata must not be inspected"); };
    const accessors = Object.defineProperties({}, Object.fromEntries(["storageBaseDir", "actual", "initialObservation", "settingsReference"]
      .map(name => [name, { get: trap }])));
    for (const poison of [accessors, new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap })]) {
      await writeReplayAdmissionLineage(context, poison as Parameters<typeof writeReplayAdmissionLineage>[1]);
    }
    const writer = await f.reserve();
    // No initial/source/settings state exists. An unavailable issuer must return even before that gate.
    await writer.observeAdmission(context, new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }));
    assert.equal(calls, 0);
    assert.deepEqual(await fs.readdir(f.childDir), [REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE]);
    await absentLineage(f.childDir);
    await assert.rejects(writer.observeAdmission(context, f.actual), { message: "admission lineage observation already attempted" });
  });
}

for (const stage of ["reservation", "initial", "source"] as const) {
  test(`B before durable settings at ${stage} consumes its attempt and publishes nothing`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve();
    if (stage !== "reservation") await writer(f.plan.initialPortfolio);
    if (stage === "source") await writer.observeSource(prepareReplaySourceSnapshot([]));
    const before = await childFileBytes(f.childDir);
    await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage preceding state unavailable" });
    assert.deepEqual(await childFileBytes(f.childDir), before);
    await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
  });
}

test("settings return their frozen reference only after directory close", async t => {
  const f = await admissionStorageFixture(t), writer = await f.reserve();
  await writer(f.plan.initialPortfolio); await writer.observeSource(prepareReplaySourceSnapshot([]));
  const initial = replayInitialPortfolioObservationSchema.parse(await readJson(join(f.childDir, REPLAY_INITIAL_PORTFOLIO_FILE)));
  const source = replaySourceObservationSchema.parse(await readJson(join(f.childDir, REPLAY_SOURCE_OBSERVATION_FILE)));
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
  const pending = writeReplaySettingsObservation({ storageBaseDir: f.childDir, initialObservation: initial,
    sourceReference: durableSourceObservationReference(source), settings: f.a.settings }).then(reference => { settled = true; return reference; });
  try {
    await waiting; assert.equal(settled, false);
    await absentLineage(f.childDir);
    release(); const reference = await pending;
    assert.equal(closed, true);
    const actual = replaySettingsObservationSchema.parse(await readJson(join(f.childDir, REPLAY_SETTINGS_OBSERVATION_FILE)));
    assert.deepEqual(reference, durableSettingsObservationReference(actual));
    for (const value of [reference, reference.identity, reference.initialObservation, reference.sourceObservation,
      reference.settingsObservation, reference.settingsObservation.settings]) assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.hasOwn(reference.settingsObservation.settings, "snapshot"), false);
  } finally { release(); await pending.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

for (const mismatch of ["batch", "child", "index", "time", "window", "settings"] as const) {
  test(`actual ${mismatch} mismatch fails closed with existing records preserved`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve(), actual = structuredClone(f.actual);
    if (mismatch === "settings" && f.a.settings.status === "recorded") {
      const snapshot = { ...f.a.settings.snapshot, maxCandidates: 1 };
      f.a.settings = { ...f.a.settings, snapshot,
        contentHash: createReplayResearchHash({ schemaVersion: f.a.settings.snapshotVersion, snapshot }) };
    }
    await writeAdmissionPredecessors(f, writer);
    if (mismatch === "batch") actual.identity.batchId = "paper_sim_20261008090000000_other";
    if (mismatch === "child") actual.identity.runId += "_other";
    if (mismatch === "index") actual.identity.runIndex = 1;
    if (mismatch === "time") actual.startedAt = "2026-10-08T09:00:00.003Z";
    if (mismatch === "window") actual.windowSelection.seed += "_other";
    const before = await childFileBytes(f.childDir);
    await assert.rejects(writer.observeAdmission(f.context, actual), storageFailure);
    await absentLineage(f.childDir);
    await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
    assert.deepEqual(await childFileBytes(f.childDir), before);
  });
}

test("issued context still rejects actual-child getters and proxies without executing them", async t => {
  for (const proxy of [false, true]) {
    const f = await admissionStorageFixture(t), writer = await f.reserve();
    await writeAdmissionPredecessors(f, writer);
    let calls = 0;
    const trap = () => { calls++; throw Error("synthetic-private-actual-detail"); };
    const actual = proxy ? new Proxy(f.actual, { get: trap, ownKeys: trap, getPrototypeOf: trap })
      : Object.defineProperty({ ...f.actual }, "identity", { enumerable: true, get: trap });
    const before = await childFileBytes(f.childDir);
    await assert.rejects(writer.observeAdmission(f.context, actual), storageFailure);
    assert.equal(calls, 0); assert.deepEqual(await childFileBytes(f.childDir), before);
  }
});

for (const unavailable of ["initial", "unsupported_shape", "limit", "redacted", "inspection_unavailable"] as const) {
  test(`actual ${unavailable} observation never becomes recorded lineage`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve();
    await writer(unavailable === "initial" ? { ...f.plan.initialPortfolio, cashKrw: -1 } : f.plan.initialPortfolio);
    await writer.observeSource(prepareReplaySourceSnapshot([]));
    await writer.observeSettings(unavailable === "initial" ? f.a.settings : { status: "unavailable", reason: unavailable });
    if (unavailable === "redacted" || unavailable === "inspection_unavailable") {
      await assert.rejects(writer.observeAdmission(f.context, f.actual), storageFailure);
      await absentLineage(f.childDir);
    } else {
      await writer.observeAdmission(f.context, f.actual);
      assert.deepEqual((await readLineage(f.childDir)).lineage,
        { status: "unavailable", reason: unavailable === "initial" ? "initial_unavailable" : "settings_unavailable" });
    }
  });
}

for (const kind of ["file", "directory", "symlink", "hardlink"] as const) {
  test(`existing orphan B ${kind} rejects reservation without changing the original`, async t => {
    const f = await admissionStorageFixture(t), path = join(f.childDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME);
    await fs.mkdir(f.childDir); const sentinel = join(f.root, "sentinel");
    await fs.writeFile(sentinel, "synthetic retained original\n");
    if (kind === "file") await fs.writeFile(path, "partial B\n");
    if (kind === "directory") await fs.mkdir(path);
    if (kind === "symlink") await fs.symlink(sentinel, path);
    if (kind === "hardlink") await fs.link(sentinel, path);
    const before = await fs.lstat(path);
    await assert.rejects(f.reserve(), { message: "initial portfolio observation reservation failed" });
    assert.deepEqual(await fs.readdir(f.childDir), [REPLAY_ADMISSION_LINEAGE_FILE_NAME]);
    const after = await fs.lstat(path);
    assert.equal(after.ino, before.ino); assert.equal(after.size, before.size);
    assert.equal(await fs.readFile(sentinel, "utf8"), "synthetic retained original\n");
    if (kind !== "directory") assert.equal(await fs.readFile(path, "utf8"), kind === "file" ? "partial B\n" : "synthetic retained original\n");
  });
}

test("a B file racing after reservation is never overwritten and its attempt cannot be retried", async t => {
  const f = await admissionStorageFixture(t), writer = await f.reserve();
  await writeAdmissionPredecessors(f, writer);
  await fs.writeFile(join(f.childDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME), "racing original\n");
  const before = await childFileBytes(f.childDir);
  await assert.rejects(writer.observeAdmission(f.context, f.actual), storageFailure);
  await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
  assert.deepEqual(await childFileBytes(f.childDir), before);
});

for (const failure of ["open", "write", "file-sync", "file-close", "directory-open", "directory-sync", "directory-close"] as const) {
  test(`B ${failure} failure preserves all predecessors and the partial reservation barrier`, async t => {
    const f = await admissionStorageFixture(t), writer = await f.reserve();
    await writeAdmissionPredecessors(f, writer);
    const before = await childFileBytes(f.childDir);
    let injected = false, opened = false, continued = false;
    const fail = async () => { injected = true; throw Object.assign(Error("synthetic-private-lineage-detail"), { code: "EIO" }); };
    const original = fs.open;
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const isB = String(args[0]) === join(f.childDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME) && typeof args[1] === "number";
      const isDirectory = opened && String(args[0]) === f.childDir && args[1] === "r";
      if (isB && failure === "open" || isDirectory && failure === "directory-open") return fail();
      const handle = await original(...args);
      if (isB) {
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
      await assert.rejects(writer.observeAdmission(f.context, f.actual).then(() => { continued = true; }), storageFailure);
      assert.equal(injected, true); assert.equal(continued, false);
      assert.deepEqual((await childFileBytes(f.childDir)).filter(([name]) => admissionPredecessors.includes(name)), before);
      if (failure === "open") await absentLineage(f.childDir);
      else assert.equal((await fs.stat(join(f.childDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME))).isFile(), true);
      mock.mock.restore(); syncBuiltinESMExports();
      const partial = await childFileBytes(f.childDir);
      await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
      await assert.rejects(f.reserve(), { message: "initial portfolio observation reservation failed" });
      assert.deepEqual(await childFileBytes(f.childDir), partial);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("B directory close is awaited and pending callback re-entry cannot publish twice", async t => {
  const f = await admissionStorageFixture(t), writer = await f.reserve();
  await writeAdmissionPredecessors(f, writer);
  let entered!: () => void, release!: () => void, closed = false, continued = false, writes = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(REPLAY_ADMISSION_LINEAGE_FILE_NAME) && typeof args[1] === "number") writes++;
    if (String(args[0]) === f.childDir && args[1] === "r") {
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => { entered(); await gate; await close(); closed = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const first = writer.observeAdmission(f.context, f.actual).then(() => { assert.equal(closed, true); continued = true; });
  try {
    await waiting; assert.equal(continued, false);
    await assert.rejects(writer.observeAdmission(f.context, f.actual), { message: "admission lineage observation already attempted" });
    release(); await first;
    assert.equal(continued, true); assert.equal(writes, 1);
    assert.equal((await readLineage(f.childDir)).lineage.status, "recorded");
  } finally { release(); await first.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

for (const bytes of [REPLAY_ADMISSION_LINEAGE_MAX_BYTES - 1, REPLAY_ADMISSION_LINEAGE_MAX_BYTES, REPLAY_ADMISSION_LINEAGE_MAX_BYTES + 1]) {
  test(`pure UTF-8 byte guard accepts or rejects exactly ${bytes} bytes including newline`, () => {
    // These are size-guard probes, not schema-valid lineage envelopes or issued contexts.
    for (const prefix of ["", "한😀é"]) {
      const text = prefix + "a".repeat(bytes - Buffer.byteLength(prefix, "utf8") - 1) + "\n";
      assert.equal(Buffer.byteLength(text, "utf8"), bytes);
      if (bytes > REPLAY_ADMISSION_LINEAGE_MAX_BYTES) assert.throws(() => assertReplayAdmissionLineageFileSize(text),
        { message: "admission lineage file limit" });
      else assert.doesNotThrow(() => assertReplayAdmissionLineageFileSize(text));
    }
  });
}
