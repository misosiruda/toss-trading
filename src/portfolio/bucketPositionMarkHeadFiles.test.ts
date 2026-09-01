import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type BucketPositionMarkHeadEvent,
  createBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import {
  BucketPositionMarkHeadFileRepository,
  createBucketPositionMarkHeadPaths
} from "./bucketPositionMarkHeadFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("position mark head repository appends, replays, resolves, and converges retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = initialization();
    const valuation = valuationEvent(root);

    assert.deepEqual(await repository.append(root), root);
    assert.deepEqual(await repository.append(valuation), valuation);
    assert.deepEqual(await repository.append(valuation), valuation);
    assert.deepEqual(
      await repository.resolveEventById(valuation.positionMarkHeadEventId),
      valuation
    );

    const snapshot = await repository.readSnapshot();
    assert.deepEqual(snapshot.events, [root, valuation]);
    assert.equal(snapshot.states[0]?.quantity, 2);
    assert.equal(snapshot.states[0]?.currentPriceKrw, 110);
    assert.equal(
      snapshot.states[0]?.lastPositionMarkHeadEventId,
      valuation.positionMarkHeadEventId
    );
    const raw = await readFile(
      createBucketPositionMarkHeadPaths(baseDir).eventsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(root)}\n${JSON.stringify(valuation)}\n`);
  });
});

test("position mark head repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = initialization();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(root))
    );
    assert.equal(results.length, 12);
    assert.deepEqual((await repository.readSnapshot()).events, [root]);
  });
});

test("position mark head repository serializes exact retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "event.json");
    const root = initialization();
    await writeFile(fixturePath, JSON.stringify(root), "utf8");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );
    assert.deepEqual(results, [root, root, root, root]);
    assert.deepEqual(
      (await new BucketPositionMarkHeadFileRepository(baseDir).readSnapshot())
        .events,
      [root]
    );
  });
});

test("position mark head repository rejects ID, origin, and branch collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = openingFillInitialization();
    await repository.append(root);

    await assert.rejects(
      () =>
        repository.append({
          ...root,
          createdAt: "2026-09-01T01:00:02.000Z"
        }),
      /ID collision/
    );

    await assert.rejects(
      () => repository.append(mutationEvent(root, "fill-open")),
      /duplicate origin/
    );

    const valuation = valuationEvent(root);
    await repository.append(valuation);
    await assert.rejects(
      () => repository.append(mutationEvent(root, "fill-branch")),
      /predecessor does not match current head/
    );
  });
});

test("position mark head repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    const root = initialization();
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);

    await writeFile(paths.eventsPath, `${JSON.stringify(root)}\n{`, "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final line/);

    await writeFile(paths.eventsPath, `${JSON.stringify(root)}\n\n`, "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt line 2/);

    await writeFile(
      paths.eventsPath,
      `${JSON.stringify(root)}\n${JSON.stringify({
        ...root,
        positionMarkHeadEventHash: HASH_C
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readSnapshot(), /corrupt line 2/);

    await writeFile(
      paths.eventsPath,
      `${JSON.stringify(root)}\n${JSON.stringify(root)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readSnapshot(), /duplicate event ID/);
  });
});

test("position mark head repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new BucketPositionMarkHeadFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });
    await assert.rejects(
      () => repository.readSnapshot(),
      /lock is unavailable/
    );
  });
});

function initialization() {
  return createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol: "005930",
    eventType: "initialized",
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef: "observed-position-1",
      markEvidenceRef: "price-evidence-1"
    },
    resultingQuantity: 2,
    resultingPriceKrw: 100,
    resultingPriceEvidenceRef: "price-evidence-1",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
}

function openingFillInitialization() {
  return createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol: "005930",
    eventType: "initialized",
    initializationOrigin: {
      originKind: "position_opening_fill",
      fillId: "fill-open",
      paperFillRecordId: "paper-fill-open",
      paperFillHash: HASH_A
    },
    resultingQuantity: 2,
    resultingPriceKrw: 100,
    resultingPriceEvidenceRef: "price-evidence-1",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
}

function valuationEvent(previous: BucketPositionMarkHeadEvent) {
  return createBucketPositionMarkHeadEvent({
    ...scope(previous),
    eventType: "valuation_applied",
    previousPositionMarkHeadEventId: previous.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: previous.positionMarkHeadEventHash,
    bucketValuationMarkRecordId: "valuation-1",
    valuationMarkHash: HASH_B,
    bucketEquityEventId: "equity-event-1",
    bucketEquityEventHash: HASH_C,
    resultingQuantity: previous.resultingQuantity,
    resultingPriceKrw: 110,
    resultingPriceEvidenceRef: "price-evidence-2",
    asOf: "2026-09-01T01:30:00.000Z",
    createdAt: "2026-09-01T01:30:01.000Z"
  });
}

function mutationEvent(
  previous: BucketPositionMarkHeadEvent,
  fillId: string
) {
  return createBucketPositionMarkHeadEvent({
    ...scope(previous),
    eventType: "position_mutation_applied",
    previousPositionMarkHeadEventId: previous.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: previous.positionMarkHeadEventHash,
    mutationOrigin: {
      originKind: "paper_fill",
      fillId,
      paperFillRecordId: `paper-${fillId}`,
      paperFillHash: HASH_A
    },
    resultingQuantity: 1,
    resultingPriceKrw: previous.resultingPriceKrw,
    resultingPriceEvidenceRef: previous.resultingPriceEvidenceRef,
    asOf: previous.asOf,
    createdAt: "2026-09-01T01:31:01.000Z"
  });
}

function scope(event: BucketPositionMarkHeadEvent) {
  return {
    portfolioId: event.portfolioId,
    bucket: event.bucket,
    market: event.market,
    symbol: event.symbol
  };
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-position-mark-heads-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof initialization>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { BucketPositionMarkHeadFileRepository } from "./dist/portfolio/bucketPositionMarkHeadFiles.js";
    const event = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new BucketPositionMarkHeadFileRepository(process.argv[2]);
    const stored = await repository.append(event);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof initialization>);
    });
  });
}
