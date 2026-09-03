import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import {
  BucketSelectionRequestFileRepository,
  createBucketSelectionRequestPaths
} from "./bucketSelectionRequestFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("selection request repository appends, resolves, and converges semantic retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketSelectionRequestFileRepository(baseDir);
    const first = request();
    const retry = request({ createdAt: "2026-09-02T00:05:00.000Z" });

    assert.deepEqual(await repository.append(first), first);
    assert.deepEqual(await repository.append(retry), first);
    assert.deepEqual(await repository.resolveById(first.requestId), first);
    assert.deepEqual(await repository.readAll(), [first]);
    const raw = await readFile(
      createBucketSelectionRequestPaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(first)}\n`);
  });
});

test("selection request repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketSelectionRequestFileRepository(baseDir);
    const candidate = request();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(candidate))
    );
    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [candidate]);
  });
});

test("selection request repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "request.json");
    const candidate = request();
    await writeFile(fixturePath, JSON.stringify(candidate), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );
    assert.deepEqual(stored, [candidate, candidate, candidate, candidate]);
    assert.deepEqual(
      await new BucketSelectionRequestFileRepository(baseDir).readAll(),
      [candidate]
    );
  });
});

test("selection request repository rejects cycle and bucket origin collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketSelectionRequestFileRepository(baseDir);
    await repository.append(request());
    await assert.rejects(
      () => repository.append(request({ gapKrw: 120 })),
      /origin collision/
    );
  });
});

test("selection request repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketSelectionRequestPaths(baseDir);
    const candidate = request();
    const repository = new BucketSelectionRequestFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify({
        ...candidate,
        requestHash: HASH_A
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify(candidate)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ID/);

    const originCollision = request({ gapKrw: 120 });
    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify(originCollision)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate origin/);
  });
});

test("selection request repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketSelectionRequestPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new BucketSelectionRequestFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });
    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function request(
  overrides: Partial<{ createdAt: string; gapKrw: number }> = {}
) {
  return createBucketSelectionRequest({
    cycleId: "cycle-1",
    triggerIdentity: "scheduled:boundary-1",
    triggerRef: "slot-1",
    portfolioId: "portfolio-1",
    portfolioSnapshotId: "portfolio-snapshot-1",
    portfolioSnapshotHash: HASH_A,
    policyHash: HASH_B,
    asOf: "2026-09-02T00:00:00.000Z",
    bucket: "long_term",
    gapBasis: "min",
    gapKrw: overrides.gapKrw ?? 100,
    availableSlots: 2,
    maximumAdditionalExposureKrw: 80,
    evidenceCutoffAt: "2026-09-01T23:59:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-02T00:00:01.000Z"
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-selection-request-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof request>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { BucketSelectionRequestFileRepository } from "./dist/portfolio/bucketSelectionRequestFiles.js";
    const request = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new BucketSelectionRequestFileRepository(process.argv[2]);
    const stored = await repository.append(request);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof request>);
    });
  });
}
