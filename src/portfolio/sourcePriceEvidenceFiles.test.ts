import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import {
  SourcePriceEvidenceFileRepository,
  createSourcePriceEvidencePaths,
  getVerifiedSourcePriceEvidenceRecords,
  type VerifiedSourcePriceEvidenceHistory
} from "./sourcePriceEvidenceFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;

test("source price evidence repository appends, resolves, and converges retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    const record = sourcePriceEvidence();

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
    assert.equal(raw, `${JSON.stringify(record)}\n`);
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

test("source price evidence repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createSourcePriceEvidencePaths(baseDir);
    const record = sourcePriceEvidence();
    const repository = new SourcePriceEvidenceFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(record)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(record)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(record)}\n${JSON.stringify({
        ...record,
        evidenceHash: HASH_A
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ref/);

    const originCollision = sourcePriceEvidence({
      priceKrw: 101,
      sourceRefs: ["different-raw-source"]
    });
    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(record)}\n${JSON.stringify(originCollision)}\n`,
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
