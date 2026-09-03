import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioRiskStateUpdateRecord } from "./portfolioRiskStateUpdate.js";
import {
  PortfolioRiskStateUpdateFileRepository,
  createPortfolioRiskStateUpdatePaths,
  getVerifiedPortfolioRiskStateUpdateRecords,
  parseVerifiedPortfolioRiskStateUpdateHistory,
  type VerifiedPortfolioRiskStateUpdateHistory
} from "./portfolioRiskStateUpdateFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

test("risk state update repository appends, resolves, and converges semantic retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioRiskStateUpdateFileRepository(baseDir);
    const first = riskStateUpdate();
    const retry = riskStateUpdate({ createdAt: "2026-09-03T00:00:02.000Z" });

    assert.deepEqual(await repository.append(first), first);
    assert.deepEqual(await repository.append(retry), first);
    assert.deepEqual(
      await repository.resolveById(first.riskStateUpdateRecordId),
      first
    );
    assert.deepEqual(await repository.readAll(), [first]);
    const history = await repository.readVerifiedHistory();
    assert.deepEqual(getVerifiedPortfolioRiskStateUpdateRecords(history), [
      first
    ]);
    const raw = await readFile(
      createPortfolioRiskStateUpdatePaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(first)}\n`);
  });
});

test("risk state update repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioRiskStateUpdateFileRepository(baseDir);
    const candidate = riskStateUpdate();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(candidate))
    );

    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [candidate]);
  });
});

test("risk state update repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "risk-state-update.json");
    const candidate = riskStateUpdate();
    await writeFile(fixturePath, JSON.stringify(candidate), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );

    assert.deepEqual(stored, [candidate, candidate, candidate, candidate]);
    assert.deepEqual(
      await new PortfolioRiskStateUpdateFileRepository(baseDir).readAll(),
      [candidate]
    );
  });
});

test("risk state update repository preserves distinct immutable records", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioRiskStateUpdateFileRepository(baseDir);
    const first = riskStateUpdate();
    const second = riskStateUpdate({ portfolioSnapshotId: "snapshot-2" });

    await repository.append(first);
    await repository.append(second);
    assert.deepEqual(await repository.readAll(), [first, second]);
    await assert.rejects(
      () => repository.resolveById("missing"),
      /does not resolve exactly once/
    );
  });
});

test("risk state update repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioRiskStateUpdatePaths(baseDir);
    const candidate = riskStateUpdate();
    const repository = new PortfolioRiskStateUpdateFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify({
        ...candidate,
        portfolioSnapshotId: "snapshot-2"
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
  });
});

test("risk state update repository rejects unverified history and abandoned locks", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    assert.throws(
      () =>
        getVerifiedPortfolioRiskStateUpdateRecords({
          records: []
        } as never),
      /history is not verified/
    );
    const parsed = parseVerifiedPortfolioRiskStateUpdateHistory("");
    assert.deepEqual(getVerifiedPortfolioRiskStateUpdateRecords(parsed), []);
    const forged = Object.create(parsed) as {
      records: readonly ReturnType<typeof riskStateUpdate>[];
    };
    Object.defineProperty(forged, "records", {
      value: Object.freeze([riskStateUpdate()]),
      enumerable: true
    });
    assert.throws(
      () =>
        getVerifiedPortfolioRiskStateUpdateRecords(
          forged as VerifiedPortfolioRiskStateUpdateHistory
        ),
      /history is not verified/
    );

    const paths = createPortfolioRiskStateUpdatePaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PortfolioRiskStateUpdateFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });

    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function riskStateUpdate(
  overrides: Partial<{
    createdAt: string;
    portfolioSnapshotId: string;
  }> = {}
) {
  return createPortfolioRiskStateUpdateRecord({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    asOf: "2026-09-03T00:00:00.000Z",
    stateUpdateKind: "market_mark",
    portfolioSnapshotId: overrides.portfolioSnapshotId ?? "snapshot-1",
    portfolioSnapshotHash: HASH_B,
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-risk-state-update-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof riskStateUpdate>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PortfolioRiskStateUpdateFileRepository } from "./dist/portfolio/portfolioRiskStateUpdateFiles.js";
    const record = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PortfolioRiskStateUpdateFileRepository(process.argv[2]);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof riskStateUpdate>);
    });
  });
}
