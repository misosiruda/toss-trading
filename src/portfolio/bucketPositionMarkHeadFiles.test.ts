import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
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
import { foldBucketPositionMarkHeadHistory } from "./bucketPositionMarkHeadState.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

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
    const stateDocument = JSON.parse(
      await readFile(
        createBucketPositionMarkHeadPaths(baseDir).statePath,
        "utf8"
      )
    ) as { schemaVersion: number; states: unknown[] };
    assert.equal(stateDocument.schemaVersion, 1);
    assert.deepEqual(stateDocument.states, snapshot.states);
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

test("position mark head repository fails closed for invalid state snapshots", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = initialization();
    await repository.append(root);
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    const valid = await readFile(paths.statePath, "utf8");

    await unlink(paths.statePath);
    await assert.rejects(() => repository.readSnapshot(), /snapshot is missing/);

    await writeFile(paths.statePath, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt JSON/);

    await writeFile(paths.statePath, valid.trimEnd(), "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final write/);

    const foreign = foldBucketPositionMarkHeadHistory([
      initialization({ symbol: "000660", observedPositionRef: "observed-2" })
    ]).states;
    await writeFile(
      paths.statePath,
      `${JSON.stringify({ schemaVersion: 1, states: foreign })}\n`,
      "utf8"
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /does not match event replay/
    );
  });
});

test("position mark head repository rejects duplicate and non-canonical state scopes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    await repository.append(initialization());
    await repository.append(
      initialization({
        bucket: "hedge",
        market: "US",
        symbol: "AAPL",
        observedPositionRef: "observed-aapl"
      })
    );
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    const stored = JSON.parse(await readFile(paths.statePath, "utf8")) as {
      schemaVersion: 1;
      states: unknown[];
    };

    await writeFile(
      paths.statePath,
      `${JSON.stringify({ ...stored, states: [...stored.states].reverse() })}\n`,
      "utf8"
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /non-canonical ordering/
    );

    await writeFile(
      paths.statePath,
      `${JSON.stringify({
        ...stored,
        states: [stored.states[0], stored.states[0]]
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readSnapshot(), /duplicate scope/);
  });
});

test("position mark head repository completes a journaled event after restart", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = initialization();
    await repository.append(root);
    const valuation = valuationEvent(root);
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    const previousRaw = await readFile(paths.eventsPath);
    const resulting = foldBucketPositionMarkHeadHistory([root, valuation]);
    await writePendingTransaction(
      paths.transactionPath,
      previousRaw,
      valuation,
      resulting.states
    );
    await appendFile(paths.eventsPath, `${JSON.stringify(valuation)}\n`, "utf8");

    const recovered =
      await new BucketPositionMarkHeadFileRepository(baseDir).readSnapshot();
    assert.deepEqual(recovered.events, [root, valuation]);
    assert.equal(recovered.states[0]?.currentPriceKrw, 110);
    await assert.rejects(() => readFile(paths.transactionPath), isMissingFile);
    const stored = JSON.parse(await readFile(paths.statePath, "utf8")) as {
      states: unknown[];
    };
    assert.deepEqual(stored.states, recovered.states);
  });
});

test("position mark head repository rolls back a partial journaled event", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = initialization();
    await repository.append(root);
    const valuation = valuationEvent(root);
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    const previousRaw = await readFile(paths.eventsPath);
    const resulting = foldBucketPositionMarkHeadHistory([root, valuation]);
    await writePendingTransaction(
      paths.transactionPath,
      previousRaw,
      valuation,
      resulting.states
    );
    const candidateLine = Buffer.from(`${JSON.stringify(valuation)}\n`, "utf8");
    await appendFile(
      paths.eventsPath,
      candidateLine.subarray(0, Math.floor(candidateLine.length / 2))
    );
    await writeFile(
      paths.statePath,
      `${JSON.stringify({ schemaVersion: 1, states: resulting.states })}\n`,
      "utf8"
    );

    const recovered =
      await new BucketPositionMarkHeadFileRepository(baseDir).readSnapshot();
    assert.deepEqual(recovered.events, [root]);
    assert.equal(recovered.states[0]?.currentPriceKrw, 100);
    assert.deepEqual(await readFile(paths.eventsPath), previousRaw);
    await assert.rejects(() => readFile(paths.transactionPath), isMissingFile);
  });
});

test("position mark head repository fails closed for corrupt transaction journals", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketPositionMarkHeadFileRepository(baseDir);
    const root = initialization();
    await repository.append(root);
    const valuation = valuationEvent(root);
    const paths = createBucketPositionMarkHeadPaths(baseDir);
    const previousRaw = await readFile(paths.eventsPath);
    const current = await repository.readSnapshot();

    await writePendingTransaction(
      paths.transactionPath,
      previousRaw,
      valuation,
      current.states
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /resulting states do not match replay/
    );

    const resulting = foldBucketPositionMarkHeadHistory([root, valuation]);
    await writePendingTransaction(
      paths.transactionPath,
      Buffer.alloc(previousRaw.length),
      valuation,
      resulting.states
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /event-log prefix hash mismatch/
    );

    await writeFile(paths.transactionPath, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt JSON/);

    await writeFile(paths.transactionPath, "{}", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final write/);
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

function initialization(
  overrides: Partial<{
    bucket: "swing" | "hedge";
    market: "KR" | "US";
    symbol: string;
    observedPositionRef: string;
  }> = {}
) {
  return createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: overrides.bucket ?? "swing",
    market: overrides.market ?? "KR",
    symbol: overrides.symbol ?? "005930",
    eventType: "initialized",
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef:
        overrides.observedPositionRef ?? "observed-position-1",
      markEvidenceRef: "price-evidence-1"
    },
    resultingQuantity: 2,
    resultingPriceKrw: 100,
    resultingPriceEvidenceRef: "price-evidence-1",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
}

async function writePendingTransaction(
  path: string,
  previousEventLog: Buffer,
  event: unknown,
  resultingStates: readonly unknown[]
): Promise<void> {
  const payload = {
    schemaVersion: 1 as const,
    previousEventFileByteLength: previousEventLog.length,
    previousEventLogHash: `sha256:${createHash("sha256")
      .update(previousEventLog)
      .digest("hex")}`,
    event,
    resultingStates
  };
  await writeFile(
    path,
    `${JSON.stringify(
      { ...payload, transactionHash: hashCanonicalPayload(payload) },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
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
