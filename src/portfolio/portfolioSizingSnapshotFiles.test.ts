import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import {
  PortfolioSizingSnapshotFileRepository,
  createPortfolioSizingSnapshotPaths
} from "./portfolioSizingSnapshotFiles.js";

const HASH = `sha256:${"a".repeat(64)}` as const;

test("sizing snapshot repository appends, resolves, and converges retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const snapshot = sizingSnapshot();

    assert.deepEqual(await repository.append(snapshot), snapshot);
    assert.deepEqual(await repository.append(snapshot), snapshot);
    assert.deepEqual(
      await repository.resolveById(snapshot.portfolioSnapshotId),
      snapshot
    );
    assert.deepEqual(await repository.readAll(), [snapshot]);
    const raw = await readFile(
      createPortfolioSizingSnapshotPaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(snapshot)}\n`);
  });
});

test("sizing snapshot repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const snapshot = sizingSnapshot();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(snapshot))
    );
    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [snapshot]);
  });
});

test("sizing snapshot repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "snapshot.json");
    const snapshot = sizingSnapshot();
    await writeFile(fixturePath, JSON.stringify(snapshot), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );
    assert.deepEqual(stored, [snapshot, snapshot, snapshot, snapshot]);
    assert.deepEqual(
      await new PortfolioSizingSnapshotFileRepository(baseDir).readAll(),
      [snapshot]
    );
  });
});

test("sizing snapshot repository rejects semantic origin collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    await repository.append(sizingSnapshot());

    await assert.rejects(
      () => repository.append(sizingSnapshot({ priceKrw: 101 })),
      /origin collision/
    );
  });
});

test("sizing snapshot repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioSizingSnapshotPaths(baseDir);
    const snapshot = sizingSnapshot();
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(snapshot)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(snapshot)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(snapshot)}\n${JSON.stringify({
        ...snapshot,
        portfolioSnapshotHash: HASH
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(snapshot)}\n${JSON.stringify(snapshot)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ID/);

    const originCollision = sizingSnapshot({ priceKrw: 101 });
    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(snapshot)}\n${JSON.stringify(originCollision)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate origin/);
  });
});

test("sizing snapshot repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioSizingSnapshotPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });
    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function sizingSnapshot(overrides: { priceKrw?: number } = {}) {
  const priceKrw = overrides.priceKrw ?? 100;
  const positionExposureKrw = priceKrw * 2;
  const exposure = createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 100 + positionExposureKrw,
    cashKrw: 100,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: positionExposureKrw,
      short_term: 0,
      swing: 0
    },
    symbolExposureKrw: [
      { market: "KR", symbol: "005930", exposureKrw: positionExposureKrw }
    ],
    marketExposureKrw: { KR: positionExposureKrw, US: 0 },
    sectorExposureKrw: { Electronics: positionExposureKrw },
    countryExposureKrw: { KR: positionExposureKrw },
    currencyExposureKrw: { KRW: positionExposureKrw },
    pendingBuyExposureKrw: 0,
    pendingSellExposureKrw: 0
  });
  return createPortfolioSizingSnapshot({
    portfolioId: "portfolio-1",
    portfolioVersion: "portfolio-version-1",
    policyHash: HASH,
    asOf: "2026-09-02T00:00:00.000Z",
    virtualPortfolio: {
      portfolioId: "portfolio-1",
      cashKrw: 100,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          riskTags: [],
          strategyBucket: "long_term",
          sector: "Electronics",
          quantity: 2,
          averagePriceKrw: 100,
          marketPriceKrw: priceKrw,
          marketValueKrw: positionExposureKrw,
          unrealizedPnlKrw: positionExposureKrw - 200,
          updatedAt: "2026-09-01T23:30:00.000Z"
        }
      ],
      updatedAt: "2026-09-01T23:30:00.000Z"
    },
    valuationInputs: [
      {
        kind: "mark_price",
        market: "KR",
        symbol: "005930",
        priceKrw,
        evidenceRef: "price-KR-005930",
        evidenceAsOf: "2026-09-01T23:00:00.000Z"
      }
    ],
    pendingActionInputs: [],
    ...exposure
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-sizing-snapshot-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof sizingSnapshot>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PortfolioSizingSnapshotFileRepository } from "./dist/portfolio/portfolioSizingSnapshotFiles.js";
    const snapshot = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PortfolioSizingSnapshotFileRepository(process.argv[2]);
    const stored = await repository.append(snapshot);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof sizingSnapshot>);
    });
  });
}
