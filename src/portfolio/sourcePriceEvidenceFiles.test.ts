import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
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
  type VerifiedSourcePriceEvidenceHistory
} from "./sourcePriceEvidenceFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;

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
