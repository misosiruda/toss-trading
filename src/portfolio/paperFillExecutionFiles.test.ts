import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import {
  PaperFillExecutionFileRepository,
  createPaperFillExecutionPaths,
  getVerifiedPaperFillExecutionRecords,
  getPersistedPaperFillExecutionRecords,
  resolvePersistedPaperFillExecutionOrigin,
  parseVerifiedPaperFillExecutionHistory,
  type VerifiedPaperFillExecutionHistory
} from "./paperFillExecutionFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}`;

test("paper fill repository appends, resolves, and converges createdAt retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    const retry = paperFill({ createdAt: "2026-09-03T00:00:02.000Z" });

    assert.deepEqual(await repository.append(first), first);
    assert.deepEqual(await repository.append(retry), first);
    assert.deepEqual(await repository.resolveById(first.paperFillRecordId), first);
    assert.deepEqual(await repository.readAll(), [first]);
    const history = await repository.readVerifiedHistory();
    assert.deepEqual(getVerifiedPaperFillExecutionRecords(history), [first]);
    assert.deepEqual(getPersistedPaperFillExecutionRecords(history), [first]);
    const raw = await readFile(
      createPaperFillExecutionPaths(baseDir).recordsPath,
      "utf8"
    );
    const entry = JSON.parse(raw);
    assert.deepEqual(entry.record, first);
    assert.equal(entry.schemaVersion, "paper_fill_execution_entry.v1");
    const restarted = await new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory();
    assert.equal(resolvePersistedPaperFillExecutionOrigin(restarted, first.paperFillRecordId).appendedAt, entry.appendedAt);
    await repository.append(retry);
    assert.equal(await readFile(createPaperFillExecutionPaths(baseDir).recordsPath, "utf8"), raw);
  });
});

test("paper fill repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const candidate = paperFill();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(candidate))
    );

    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [candidate]);
  });
});

test("paper fill repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "paper-fill.json");
    const candidate = paperFill();
    await writeFile(fixturePath, JSON.stringify(candidate), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );

    assert.deepEqual(stored, [candidate, candidate, candidate, candidate]);
    assert.deepEqual(
      await new PaperFillExecutionFileRepository(baseDir).readAll(),
      [candidate]
    );
  });
});

test("paper fill repository preserves distinct immutable records", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    const second = paperFill({ fillId: "fill-2" });

    await repository.append(first);
    await repository.append(second);
    assert.deepEqual(await repository.readAll(), [first, second]);
    await assert.rejects(
      () => repository.resolveById("missing"),
      /does not resolve exactly once/
    );
  });
});

test("paper fill repository enforces portfolio-wide fill ID uniqueness", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPaperFillExecutionPaths(baseDir);
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    const repeatedFill = paperFill({ rebalancePlanId: "plan-2" });

    await repository.append(first);
    await assert.rejects(
      () => repository.append(repeatedFill),
      /duplicate portfolio fill ID/
    );

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(first)}\n${JSON.stringify(repeatedFill)}\n`,
      "utf8"
    );
    await assert.rejects(
      () => repository.readAll(),
      /duplicate portfolio fill ID/
    );
  });
});

test("paper fill repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPaperFillExecutionPaths(baseDir);
    const candidate = paperFill();
    const repository = new PaperFillExecutionFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify({
        ...candidate,
        quantity: candidate.quantity + 1
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

test("paper fill repository rejects unverified history and abandoned locks", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    assert.throws(
      () => getVerifiedPaperFillExecutionRecords({ records: [] } as never),
      /history is not verified/
    );
    const parsed = parseVerifiedPaperFillExecutionHistory("");
    assert.deepEqual(getVerifiedPaperFillExecutionRecords(parsed), []);
    assert.throws(() => getPersistedPaperFillExecutionRecords(parsed), /not repository verified/);
    const forged = Object.create(parsed) as {
      records: readonly ReturnType<typeof paperFill>[];
    };
    Object.defineProperty(forged, "records", {
      value: Object.freeze([paperFill()]),
      enumerable: true
    });
    assert.throws(
      () =>
        getVerifiedPaperFillExecutionRecords(
          forged as VerifiedPaperFillExecutionHistory
        ),
      /history is not verified/
    );

    const paths = createPaperFillExecutionPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PaperFillExecutionFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });

    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("paper fill repository preserves legacy records without synthesizing append origins", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPaperFillExecutionPaths(baseDir);
    const first = paperFill();
    const raw = `${JSON.stringify(first)}\n`;
    await writeFile(paths.recordsPath, raw);
    const repository = new PaperFillExecutionFileRepository(baseDir);
    assert.deepEqual(await repository.append(first), first);
    assert.equal(await readFile(paths.recordsPath, "utf8"), raw);
    let history = await repository.readVerifiedHistory();
    assert.deepEqual(getPersistedPaperFillExecutionRecords(history), [first]);
    assert.throws(() => resolvePersistedPaperFillExecutionOrigin(history, first.paperFillRecordId), /legacy record requires review/);
    const second = paperFill({ fillId: "fill-2" });
    await repository.append(second);
    history = await new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory();
    assert.deepEqual(history.records, [first, second]);
    assert.equal(resolvePersistedPaperFillExecutionOrigin(history, second.paperFillRecordId).record.paperFillHash, second.paperFillHash);
    const mixed = await readFile(paths.recordsPath, "utf8");
    await writeFile(paths.recordsPath, mixed.slice(raw.length));
    await assert.rejects(() => repository.readVerifiedHistory(), /corrupt line/);
  });
});

test("paper fill repository authenticates append metadata and rejects entry downgrade", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    await repository.append(first);
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const entry = JSON.parse(raw);
    for (const damaged of [
      `${JSON.stringify({ ...entry, appendedAt: "2000-01-01T00:00:00.000Z" })}\n`,
      `${JSON.stringify({ ...entry, previousEntryHash: HASH_A })}\n`,
      raw + JSON.stringify(paperFill({ fillId: "fill-2" })) + "\n"
    ]) {
      await writeFile(path, damaged);
      await assert.rejects(() => repository.readVerifiedHistory(), /corrupt line/);
      await assert.rejects(() => repository.append(first), /corrupt line/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

function paperFill(
  overrides: Partial<{
    createdAt: string;
    fillId: string;
    rebalancePlanId: string;
  }> = {}
) {
  return createPaperFillExecutionRecord({
    ...validInput(),
    fillId: overrides.fillId ?? "fill-1",
    rebalancePlanId: overrides.rebalancePlanId ?? "plan-1",
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

function validInput() {
  const executionPolicy = {
    modelVersion:
      PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION,
    fillPriceRule: "current_candidate_last_price" as const,
    slippageBps: 0,
    feeBps: 0,
    taxBps: 0,
    halfSpreadBps: 0,
    fillRatio: 1,
    allowFractionalShares: true,
    maxVolumeParticipationRate: 0.1,
    minLiquidityFillRatio: 0.1,
    rejectStaleLiquidity: true,
    marketImpactBpsPerParticipationRate: 0
  };
  const replay = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: 1_000,
    sourcePriceKrw: 100,
    liquidityStale: false,
    policy: executionPolicy
  });
  return {
    portfolioId: "portfolio-1",
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId: "fill-1",
    market: "KR" as const,
    symbol: "KR:005930",
    side: "BUY" as const,
    requestedNotionalKrw: replay.requestedNotionalKrw,
    requestedQuantity: replay.requestedNotionalKrw / replay.fillPriceKrw,
    quantityOverride: null,
    sourcePriceKrw: replay.sourcePriceKrw,
    sourcePriceEvidence: {
      sourceContractId: "source-price-contract-v1",
      evidenceRef: "price-evidence-1",
      evidenceHash: HASH_A,
      market: "KR" as const,
      symbol: "KR:005930",
      priceField: "last_price" as const,
      observedAt: "2026-09-02T23:59:59.000Z"
    },
    averagePriceKrw: null,
    fillPriceKrw: replay.fillPriceKrw,
    quantity: replay.quantity,
    filledNotionalKrw: replay.filledNotionalKrw,
    grossAmountKrw: replay.grossAmountKrw,
    netAmountKrw: replay.netAmountKrw,
    participationRate: replay.participationRate ?? null,
    volume: replay.volume ?? null,
    averageVolume: replay.averageVolume ?? null,
    liquidityStale: false,
    fillStatus: replay.fillStatus as "filled" | "partial",
    liquidityStatus: replay.liquidityStatus as
      | "not_modeled"
      | "sufficient"
      | "partial",
    liquidityRejectReason: null,
    fractionalShares: replay.fractionalShares,
    executionPolicy,
    costBreakdown: {
      feeKrw: replay.feeKrw,
      taxKrw: replay.taxKrw,
      slippageKrw: replay.slippageKrw,
      spreadCostKrw: replay.spreadCostKrw,
      impactCostKrw: replay.impactCostKrw,
      totalCostKrw: replay.totalCostKrw
    },
    evidenceRefs: ["price-evidence-1", "fee-evidence-1"],
    asOf: "2026-09-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:01.000Z"
  };
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-paper-fill-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof paperFill>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PaperFillExecutionFileRepository } from "./dist/portfolio/paperFillExecutionFiles.js";
    const record = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PaperFillExecutionFileRepository(process.argv[2]);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof paperFill>);
    });
  });
}
