import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { mkdtemp, open, readFile, rename, rm, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import {
  SourcePriceEvidenceFileRepository,
  createSourcePriceEvidencePaths,
  getVerifiedSourcePriceEvidenceRecords,
  parseSourcePriceEvidenceRecords,
  resolveVerifiedSourcePriceEvidenceOrigin,
  getDurableSourcePriceEvidenceObservation,
  resolveObservedSourcePriceEvidenceHistory,
  type SourcePriceEvidenceObservation,
  type VerifiedSourcePriceEvidenceHistory
} from "./sourcePriceEvidenceFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;

test("source price observation issues a callback-only lease and preserves exact original prefixes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const first = sourcePriceEvidence();
    const second = sourcePriceEvidence({ observedAt: "2026-09-01T01:01:00.000Z", createdAt: "2026-09-01T01:01:01.000Z" });
    await repository.append(first);
    const ordinary = await repository.readVerifiedHistory();
    assert.throws(() => getDurableSourcePriceEvidenceObservation(ordinary), /observation lease/);
    let retained!: VerifiedSourcePriceEvidenceHistory;
    let receipt!: SourcePriceEvidenceObservation;
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    await repository.withDurableVerifiedHistory(async (history) => {
      retained = history;
      receipt = getDurableSourcePriceEvidenceObservation(history);
      assert.equal(receipt.recordCount, 1);
      assert.ok(Object.isFrozen(receipt));
      assert.ok(Date.parse(receipt.observedAt) >= Date.parse(resolveVerifiedSourcePriceEvidenceOrigin(history, first.evidenceRef).appendedAt));
      assert.throws(() => getDurableSourcePriceEvidenceObservation({ ...history }), /observation lease/);
      assert.throws(() => getDurableSourcePriceEvidenceObservation(Object.create(history)), /observation lease/);
      const prefix = resolveObservedSourcePriceEvidenceHistory(history, receipt);
      assert.deepEqual(getVerifiedSourcePriceEvidenceRecords(prefix), [first]);
      assert.throws(() => getDurableSourcePriceEvidenceObservation(prefix), /observation lease/);
    });
    assert.throws(() => getDurableSourcePriceEvidenceObservation(retained), /observation lease/);
    assert.equal(await readFile(path, "utf8"), bytes);
    await repository.append(second);
    await new SourcePriceEvidenceFileRepository(baseDir).withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(resolveObservedSourcePriceEvidenceHistory(history, receipt).records, [first]);
      for (const invalid of [{ ...receipt, recordCount: 0 }, { ...receipt, recordCount: 3 },
        { ...receipt, entriesHash: HASH_A }, { ...receipt, unexpected: true }, { ...receipt, recordCount: -0 },
        { ...receipt, observedAt: "2099-01-01T00:00:00.000Z" }, { ...receipt, observedAt: first.createdAt }]) {
        assert.throws(() => resolveObservedSourcePriceEvidenceHistory(history, invalid));
      }
    });
  });
});

test("source price observation holds the shared writer lock and revokes leases after consumer failure", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const writer = new SourcePriceEvidenceFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    let retained!: VerifiedSourcePriceEvidenceHistory;
    await assert.rejects(repository.withDurableVerifiedHistory(async (history) => {
      retained = history;
      await assert.rejects(writer.append(sourcePriceEvidence()), /lock is unavailable/);
      throw new Error("consumer failed");
    }), /consumer failed/);
    assert.throws(() => getDurableSourcePriceEvidenceObservation(retained), /observation lease/);
    await writer.append(sourcePriceEvidence());
  });
});

test("source price observation rechecks commit provenance without upgrading legacy availability", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const first = sourcePriceEvidence();
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    await repository.append(first);
    const original = await readFile(path, "utf8");
    let receipt!: SourcePriceEvidenceObservation;
    await repository.withDurableVerifiedHistory(async (history) => { receipt = getDurableSourcePriceEvidenceObservation(history); });
    const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _entryHash, ...payload } = entry;
    payload.appendStartedAt = new Date(Date.parse(payload.appendStartedAt) - 1).toISOString();
    const entryHash = hashCanonicalPayload(payload);
    const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
    const changed = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
    for (const raw of [changed, ""]) {
      await writeFile(path, raw);
      await repository.withDurableVerifiedHistory(async (history) => {
        assert.throws(() => resolveObservedSourcePriceEvidenceHistory(history, receipt), /source prefix/);
      });
      assert.equal(await readFile(path, "utf8"), raw);
    }
    await writeFile(path, `${original}{broken}\n`);
    let called = false;
    await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /corrupt line/);
    assert.equal(called, false);
    const legacy = `${JSON.stringify(durableEntry(first, first.createdAt, null))}\n`;
    await writeFile(path, legacy);
    await repository.withDurableVerifiedHistory(async (history) => {
      const prefix = resolveObservedSourcePriceEvidenceHistory(history, getDurableSourcePriceEvidenceObservation(history));
      assert.deepEqual(prefix.records, [first]);
      assert.throws(() => resolveVerifiedSourcePriceEvidenceOrigin(prefix, first.evidenceRef), /legacy record requires review/);
    });
    assert.equal(await readFile(path, "utf8"), legacy);
  });
});

test("source price observation dates successful fsync and rejects fsync failure or backward clock", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    await repository.append(sourcePriceEvidence());
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    let fail = true;
    let syncedAt = 0;
    let called = false;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        if (fail) throw new Error("injected evidence sync failure");
        await originalSync.call(this);
        context.mock.timers.tick(10);
        syncedAt = Date.now();
        return;
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /injected evidence sync failure/);
      assert.equal(called, false);
      fail = false;
      await repository.withDurableVerifiedHistory(async (history) => assert.equal(Date.parse(getDurableSourcePriceEvidenceObservation(history).observedAt), syncedAt));
      context.mock.timers.setTime(Date.parse("2026-08-01T00:00:00.000Z"));
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /clock precedes stored origin/);
      assert.equal(called, false);
      assert.equal(await readFile(path, "utf8"), original);
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  });
});

test("source price observation rejects non-cooperative rewrite, replacement and removal during fsync", async (context) => {
  for (const mode of ["rewrite", "replace", "remove"] as const) await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    await repository.append(sourcePriceEvidence());
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let changed = false;
    let called = false;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (!changed && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        changed = true;
        if (mode === "remove") await unlink(path);
        else {
          if (mode === "replace") await rename(path, join(baseDir, "displaced-evidence.jsonl"));
          await writeFile(path, mode === "replace" ? original : "");
        }
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /changed during durable observation|ENOENT/);
      assert.equal(changed, true);
      assert.equal(called, false);
    } finally { mock.mock.restore(); }
    assert.equal(await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)), mode === "remove" ? null : mode === "rewrite" ? "" : original);
  });
});

test("source price observation verifies absence, flushes empty files and never creates a source", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    await repository.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(history.records, []);
      assert.equal(getDurableSourcePriceEvidenceObservation(history).recordCount, 0);
    });
    await assert.rejects(readFile(path), /ENOENT/);
    const originalLstat = fs.lstat;
    const absenceMock = context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
      if (args[0] === path) await writeFile(path, "");
      return originalLstat(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("consumer must not run")), /appeared during durable observation/); }
    finally { absenceMock.mock.restore(); syncBuiltinESMExports(); }
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const emptyMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) throw new Error("empty evidence sync failed");
      return originalSync.call(this);
    });
    try { await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("consumer must not run")), /empty evidence sync failed/); }
    finally { emptyMock.mock.restore(); }
    await repository.withDurableVerifiedHistory(async (history) => assert.deepEqual(history.records, []));
    assert.equal(await readFile(path, "utf8"), "");
  });
});

test("source price receipt time precedes post-verification source replacement or creation", async (context) => {
  for (const present of [true, false]) await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const first = sourcePriceEvidence();
    const replacement = sourcePriceEvidence({ priceKrw: 101 });
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    if (present) await repository.append(first);
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    let changedAt = 0;
    const replace = async () => {
      context.mock.timers.tick(1_000);
      changedAt = Date.now();
      if (present) await rename(path, join(baseDir, "old-evidence.jsonl"));
      await writeFile(path, `${JSON.stringify(durableEntry(replacement, replacement.createdAt, null))}\n`);
    };
    const originalOpen = fs.open;
    const originalLstat = fs.lstat;
    const mock = present
      ? context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (args[0] === path && args[1] === "r+") {
          const close = handle.close.bind(handle);
          handle.close = async () => { try { await replace(); } finally { await close(); } };
        }
        return handle;
      })
      : context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
        try { return await originalLstat(...args); }
        catch (error) {
          if (args[0] === path && error instanceof Error && "code" in error && error.code === "ENOENT") await replace();
          throw error;
        }
      });
    syncBuiltinESMExports();
    try {
      await repository.withDurableVerifiedHistory(async (history) => {
        assert.deepEqual(history.records, present ? [first] : []);
        assert.ok(changedAt > Date.parse(getDurableSourcePriceEvidenceObservation(history).observedAt));
      });
    } finally { mock.mock.restore(); syncBuiltinESMExports(); context.mock.timers.reset(); }
    assert.deepEqual(await repository.readAll(), [replacement]);
  });
});

test("source price observation does not swallow directory I/O failure", async (context) => {
  for (const present of [true, false]) await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    if (present) await repository.append(sourcePriceEvidence());
    const originalOpen = fs.open;
    let directoryOpens = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === baseDir && args[1] === "r" && ++directoryOpens === 2) {
        throw Object.assign(new Error("injected evidence directory failure"), { code: "EIO" });
      }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("consumer must not run")), /injected evidence directory failure/);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await repository.withDurableVerifiedHistory(async (history) => assert.equal(history.records.length, present ? 1 : 0));
  });
});

test("source price evidence repository appends, resolves, and converges retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const record = sourcePriceEvidence();
    const beforeAppend = Date.now();

    assert.deepEqual(await repository.append(record), record);
    assert.deepEqual(await repository.append(record), record);
    assert.deepEqual(await repository.resolveByRef(record.evidenceRef), record);
    assert.deepEqual(await repository.readAll(), [record]);
    const history = await repository.readVerifiedHistory();
    assert.deepEqual(getVerifiedSourcePriceEvidenceRecords(history), [record]);
    const forged = Object.create(history) as VerifiedSourcePriceEvidenceHistory;
    Object.defineProperty(forged, "records", {
      value: Object.freeze([
        { ...record, createdAt: "2026-09-01T01:00:00.000Z" }
      ]),
      enumerable: true
    });
    assert.throws(
      () => getVerifiedSourcePriceEvidenceRecords(forged),
      /history is not verified/
    );
    const raw = await readFile(
      createSourcePriceEvidencePaths(baseDir).recordsPath,
      "utf8"
    );
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(entry.record, record);
    assert.equal(entry.previousEntryHash, null);
    assert.equal(entry.schemaVersion, "source_price_evidence_entry.v2");
    assert.equal(marker.schemaVersion, "source_price_evidence_commit.v1");
    assert.ok(Date.parse(marker.committedAt) >= beforeAppend);
    assert.ok(Date.parse(marker.committedAt) <= Date.now());
    assert.equal(
      entry.entryHash,
      hashCanonicalPayload({
        schemaVersion: entry.schemaVersion,
        record,
        appendStartedAt: entry.appendStartedAt,
        previousEntryHash: null
      })
    );
    assert.equal(marker.entryHash, entry.entryHash);
    const restarted = await new SourcePriceEvidenceFileRepository(baseDir).readVerifiedHistory();
    assert.equal(resolveVerifiedSourcePriceEvidenceOrigin(restarted, record.evidenceRef).appendedAt, marker.committedAt);
    assert.deepEqual(parseSourcePriceEvidenceRecords(raw), [record]);
    await repository.append(record);
    assert.equal(await readFile(createSourcePriceEvidencePaths(baseDir).recordsPath, "utf8"), raw);
  });
});

test("source price evidence repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const record = sourcePriceEvidence();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(record))
    );
    assert.equal(results.length, 12);
    assert.deepEqual(await repository.readAll(), [record]);
  });
});

test("source price evidence repository serializes exact retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "evidence.json");
    const record = sourcePriceEvidence();
    await writeFile(fixturePath, JSON.stringify(record), "utf8");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );
    assert.deepEqual(results, [record, record, record, record]);
    assert.deepEqual(
      await new SourcePriceEvidenceFileRepository(baseDir).readAll(),
      [record]
    );
  });
});

test("source price evidence repository rejects ref and semantic origin collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const record = sourcePriceEvidence();
    await repository.append(record);

    await assert.rejects(
      () =>
        repository.append({
          ...record,
          createdAt: "2026-09-01T01:00:02.000Z"
        }),
      /ref collision/
    );
    await assert.rejects(
      () =>
        repository.append(
          sourcePriceEvidence({
            priceKrw: 101,
            sourceRefs: ["different-raw-source"]
          })
        ),
      /origin collision/
    );
    await assert.rejects(
      () =>
        repository.append(
          sourcePriceEvidence({
            observedAt: "2026-09-01T10:00:00+09:00",
            createdAt: "2026-09-01T10:00:01+09:00",
            priceKrw: 102
          })
        ),
      /origin collision/
    );
  });
});

test("source price evidence repository preserves legacy corruption and duplicate detection", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createSourcePriceEvidencePaths(baseDir);
    const record = sourcePriceEvidence();
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const validRaw = JSON.stringify(durableEntry(record, record.createdAt, null)) + "\n";
    const firstEntry = JSON.parse(validRaw) as {
      appendedAt: string;
      entryHash: string;
    };

    await writeFile(paths.recordsPath, `${validRaw}{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${validRaw}\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    const corruptEntry = durableEntry(
      { ...record, evidenceHash: HASH_A },
      firstEntry.appendedAt,
      firstEntry.entryHash
    );
    await writeFile(
      paths.recordsPath,
      `${validRaw}${JSON.stringify(corruptEntry)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    const duplicateEntry = durableEntry(
      record,
      firstEntry.appendedAt,
      firstEntry.entryHash
    );
    await writeFile(
      paths.recordsPath,
      `${validRaw}${JSON.stringify(duplicateEntry)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ref/);

    const originCollision = sourcePriceEvidence({
      priceKrw: 101,
      sourceRefs: ["different-raw-source"]
    });
    const collisionEntry = durableEntry(
      originCollision,
      firstEntry.appendedAt,
      firstEntry.entryHash
    );
    await writeFile(
      paths.recordsPath,
      `${validRaw}${JSON.stringify(collisionEntry)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate origin/);
  });
});

test("source price evidence repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    assert.throws(
      () =>
        getVerifiedSourcePriceEvidenceRecords({
          records: []
        } as VerifiedSourcePriceEvidenceHistory),
      /history is not verified/
    );
    const paths = createSourcePriceEvidencePaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new SourcePriceEvidenceFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });
    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("source price evidence preserves legacy query and retry without promoting an origin", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const first = sourcePriceEvidence();
    const legacyEntry = durableEntry(first, first.createdAt, null);
    const raw = JSON.stringify(legacyEntry) + "\n";
    const paths = createSourcePriceEvidencePaths(baseDir);
    await writeFile(paths.recordsPath, raw);
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    assert.deepEqual(await repository.append(first), first);
    assert.equal(await readFile(paths.recordsPath, "utf8"), raw);
    const legacyHistory = await repository.readVerifiedHistory();
    assert.deepEqual(legacyHistory.records, [first]);
    assert.throws(() => resolveVerifiedSourcePriceEvidenceOrigin(legacyHistory, first.evidenceRef), /legacy record requires review/);
    const second = sourcePriceEvidence({ observedAt: "2026-09-01T01:00:01.000Z" });
    await repository.append(second);
    const history = await new SourcePriceEvidenceFileRepository(baseDir).readVerifiedHistory();
    assert.deepEqual(history.records, [first, second]);
    assert.equal(resolveVerifiedSourcePriceEvidenceOrigin(history, second.evidenceRef).record.evidenceRef, second.evidenceRef);
    assert.throws(() => resolveVerifiedSourcePriceEvidenceOrigin(history, first.evidenceRef), /legacy record requires review/);
    const mixed = await readFile(paths.recordsPath, "utf8");
    assert.equal(JSON.parse(mixed.split("\n")[1]!).previousEntryHash, legacyEntry.entryHash);
    for (const damaged of [mixed.slice(raw.length), mixed + raw]) {
      await writeFile(paths.recordsPath, damaged);
      await assert.rejects(() => repository.readAll(), /corrupt line/);
      await assert.rejects(() => repository.append(second), /corrupt line/);
    }
  });
});

test("source price evidence requires complete paired markers and authenticates the commit chain", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const first = sourcePriceEvidence();
    const second = sourcePriceEvidence({ observedAt: "2026-09-01T01:00:01.000Z" });
    await repository.append(first);
    await repository.append(second);
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const lines = raw.trimEnd().split("\n");
    const [entry, marker, nextEntry, nextMarker] = lines.map((line) => JSON.parse(line));
    assert.equal(nextEntry.previousEntryHash, marker.commitHash);
    assert.deepEqual(await repository.readAll(), [first, second]);
    for (const damaged of [
      `${lines[0]}\n`, `${lines[0]}\n{`, `${lines[1]}\n`,
      `${lines[0]}\n${lines[3]}\n`,
      JSON.stringify({ ...entry, previousEntryHash: HASH_A }) + "\n" + lines[1] + "\n",
      lines[0] + "\n" + JSON.stringify({ ...marker, committedAt: "2000-01-01T00:00:00.000Z" }) + "\n",
      lines.slice(2).join("\n") + "\n",
      lines.slice(0, 2).join("\n") + "\n" + JSON.stringify({ ...nextEntry, previousEntryHash: entry.entryHash }) + "\n" + JSON.stringify(nextMarker) + "\n",
      raw + lines[1] + "\n"
    ]) {
      await writeFile(path, damaged);
      await assert.rejects(() => repository.readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(() => repository.append(first), /corrupt|torn/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("source price evidence origin is sampled after delayed record fsync", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const path = createSourcePriceEvidencePaths(baseDir).recordsPath;
    const probe = await open(join(baseDir, "probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let duringWrite = 0;
    let afterRecordSync = 0;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const ownStat = await this.stat();
      const targetStat = await stat(path).catch(() => undefined);
      const isRecord = afterRecordSync === 0 && targetStat !== undefined &&
        ownStat.isFile() && ownStat.ino === targetStat.ino &&
        (process.platform === "win32" || ownStat.dev === targetStat.dev);
      if (isRecord) {
        duringWrite = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await originalSync.call(this);
      if (isRecord) afterRecordSync = Date.now();
    });
    try {
      const record = sourcePriceEvidence();
      const repository = new SourcePriceEvidenceFileRepository(baseDir);
      await repository.append(record);
      const history = await new SourcePriceEvidenceFileRepository(baseDir).readVerifiedHistory();
      const origin = resolveVerifiedSourcePriceEvidenceOrigin(history, record.evidenceRef);
      assert.ok(duringWrite > 0);
      assert.ok(afterRecordSync > duringWrite);
      assert.ok(Date.parse(origin.appendedAt) >= afterRecordSync);
      assert.ok(Date.parse(origin.appendedAt) > duringWrite);
    } finally {
      syncMock.mock.restore();
    }
  });
});

function durableEntry(
  record: unknown,
  appendedAt: string,
  previousEntryHash: string | null
) {
  const payload = { record, appendedAt, previousEntryHash };
  return { ...payload, entryHash: hashCanonicalPayload(payload) };
}

function sourcePriceEvidence(
  overrides: Partial<{
    priceKrw: number;
    sourceRefs: string[];
    observedAt: string;
    createdAt: string;
  }> = {}
) {
  return createSourcePriceEvidenceRecord({
    sourceContractId: "contract-v1",
    market: "KR",
    symbol: "005930",
    priceField: "last_price",
    priceKrw: overrides.priceKrw ?? 100,
    observedAt: overrides.observedAt ?? "2026-09-01T01:00:00.000Z",
    sourceRefs: overrides.sourceRefs ?? ["raw-source-a"],
    createdAt: overrides.createdAt ?? "2026-09-01T01:00:01.000Z"
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-price-evidence-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof sourcePriceEvidence>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { SourcePriceEvidenceFileRepository } from "./dist/portfolio/sourcePriceEvidenceFiles.js";
    const record = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new SourcePriceEvidenceFileRepository(process.argv[2]);
    const stored = await repository.append(record);
    process.stdout.write(JSON.stringify(stored));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, fixturePath, baseDir],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `child exited with code ${code}`));
        return;
      }
      resolve(JSON.parse(stdout) as ReturnType<typeof sourcePriceEvidence>);
    });
  });
}
