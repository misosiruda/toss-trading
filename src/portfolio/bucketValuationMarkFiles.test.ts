import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBucketValuationMarkRecord } from "./bucketValuationMark.js";
import {
  BucketValuationMarkFileRepository,
  createBucketValuationMarkPaths
} from "./bucketValuationMarkFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("valuation mark repository durably appends and resolves exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketValuationMarkFileRepository(baseDir);
    const record = valuationMark();

    assert.deepEqual(await repository.append(record), record);
    assert.deepEqual(await repository.append(record), record);
    assert.deepEqual(
      await repository.resolveById(record.bucketValuationMarkRecordId),
      record
    );
    assert.deepEqual(await repository.readAll(), [record]);
    const raw = await readFile(
      createBucketValuationMarkPaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(record)}\n`);
  });
});

test("valuation mark repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketValuationMarkFileRepository(baseDir);
    const record = valuationMark();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(record))
    );
    assert.equal(results.length, 12);
    assert.deepEqual(await repository.readAll(), [record]);
  });
});

test("valuation mark repository serializes exact retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "record.json");
    const record = valuationMark();
    await writeFile(fixturePath, JSON.stringify(record), "utf8");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );
    assert.deepEqual(results, [record, record, record, record]);
    assert.deepEqual(
      await new BucketValuationMarkFileRepository(baseDir).readAll(),
      [record]
    );
  });
});

test("valuation mark repository rejects semantic origin collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketValuationMarkFileRepository(baseDir);
    const record = valuationMark();
    await repository.append(record);
    await assert.rejects(
      () =>
        repository.append({
          ...record,
          createdAt: "2026-09-01T01:00:02.000Z"
        }),
      /ID collision/
    );
    await assert.rejects(
      () =>
        repository.append(
          valuationMark({
            currentPriceKrw: 120,
            equityDeltaKrw: 20,
            currentPriceEvidenceRef: "new-price-evidence"
          })
        ),
      /origin collision/
    );
    await assert.rejects(
      () =>
        repository.append(
          valuationMark({
            asOf: "2026-09-01T10:00:00+09:00",
            createdAt: "2026-09-01T10:00:01+09:00"
          })
        ),
      /origin collision/
    );
  });
});

test("valuation mark repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketValuationMarkPaths(baseDir);
    const record = valuationMark();
    await writeFile(paths.recordsPath, `${JSON.stringify(record)}\n{`, "utf8");
    const repository = new BucketValuationMarkFileRepository(baseDir);
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(record)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(record)}\n${JSON.stringify({
        ...record,
        valuationMarkHash: HASH_B
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ID/);

    const originCollision = valuationMark({
      currentPriceKrw: 120,
      equityDeltaKrw: 20,
      currentPriceEvidenceRef: "new-price-evidence"
    });
    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(record)}\n${JSON.stringify(originCollision)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate origin/);
  });
});

test("valuation mark repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketValuationMarkPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new BucketValuationMarkFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });
    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
  });
});

function valuationMark(
  overrides: Partial<{
    currentPriceKrw: number;
    equityDeltaKrw: number;
    currentPriceEvidenceRef: string;
    asOf: string;
    createdAt: string;
  }> = {}
) {
  const currentPriceKrw = overrides.currentPriceKrw ?? 110;
  return createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_A,
    positionInputs: [
      {
        market: "KR",
        symbol: "005930",
        quantity: 1,
        previousPositionMarkHeadId: "mark-head-1",
        previousPositionMarkHeadHash: HASH_B,
        previousPriceKrw: 100,
        currentPriceKrw,
        previousPriceEvidenceRef: "previous-price-evidence",
        currentPriceEvidenceRef:
          overrides.currentPriceEvidenceRef ?? "current-price-evidence"
      }
    ],
    equityDeltaKrw: overrides.equityDeltaKrw ?? currentPriceKrw - 100,
    asOf: overrides.asOf ?? "2026-09-01T01:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-01T01:00:01.000Z"
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-valuation-marks-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof valuationMark>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { BucketValuationMarkFileRepository } from "./dist/portfolio/bucketValuationMarkFiles.js";
    const record = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new BucketValuationMarkFileRepository(process.argv[2]);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof valuationMark>);
    });
  });
}
