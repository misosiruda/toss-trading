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

import { createBucketEquityEvent } from "./bucketEquity.js";
import {
  BucketEquityFileRepository,
  createBucketEquityPaths
} from "./bucketEquityFiles.js";
import { foldBucketEquityHistory } from "./bucketEquityState.js";
import {
  createBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import {
  BucketPositionMarkHeadFileRepository,
  createBucketPositionMarkHeadPaths
} from "./bucketPositionMarkHeadFiles.js";
import { foldBucketPositionMarkHeadHistory } from "./bucketPositionMarkHeadState.js";
import { resolveBucketValuationApplication } from "./bucketValuationApplication.js";
import {
  BucketValuationApplicationFileRepository,
  createBucketValuationApplicationPaths
} from "./bucketValuationApplicationFiles.js";
import { createBucketValuationMarkRecord } from "./bucketValuationMark.js";
import { BucketValuationMarkFileRepository } from "./bucketValuationMarkFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("valuation application repository commits every journal atomically", async () => {
  await withFixture(async (fixture) => {
    const repository = new BucketValuationApplicationFileRepository(
      fixture.baseDir
    );

    const persisted = await repository.apply(fixture.input);

    assert.equal(persisted.alreadyApplied, false);
    assert.equal(persisted.positionMarkHeadEvents.length, 2);
    const snapshot = await repository.readSnapshot();
    assert.deepEqual(snapshot.records, [fixture.mark]);
    assert.equal(snapshot.equity.events.length, 2);
    assert.equal(snapshot.equity.states[0]?.equityKrw, 1_010);
    assert.equal(snapshot.positions.events.length, 4);
    assert.deepEqual(
      snapshot.positions.states.map((state) => state.currentPriceKrw),
      [145, 110]
    );
    await assert.rejects(
      () => readFile(fixture.paths.transactionPath),
      isMissingFile
    );

    assert.equal(
      (await new BucketValuationMarkFileRepository(fixture.baseDir).readAll())
        .length,
      1
    );
    assert.equal(
      (await new BucketEquityFileRepository(fixture.baseDir).readSnapshot())
        .events.length,
      2
    );
    assert.equal(
      (
        await new BucketPositionMarkHeadFileRepository(
          fixture.baseDir
        ).readSnapshot()
      ).events.length,
      4
    );
  });
});

test("valuation application repository converges concurrent exact retries", async () => {
  await withFixture(async (fixture) => {
    const repository = new BucketValuationApplicationFileRepository(
      fixture.baseDir
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.apply(fixture.input))
    );

    assert.equal(results.filter((result) => !result.alreadyApplied).length, 1);
    assert.equal(results.filter((result) => result.alreadyApplied).length, 7);
    const snapshot = await repository.readSnapshot();
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.equity.events.length, 2);
    assert.equal(snapshot.positions.events.length, 4);
  });
});

test("valuation application repository serializes exact retries across processes", async () => {
  await withFixture(async (fixture) => {
    const fixturePath = join(fixture.baseDir, "valuation-application.json");
    await writeFile(fixturePath, JSON.stringify(fixture.input), "utf8");

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        applyFromChild(fixturePath, fixture.baseDir)
      )
    );

    assert.equal(results.filter((result) => !result.alreadyApplied).length, 1);
    assert.equal(results.filter((result) => result.alreadyApplied).length, 3);
    const snapshot =
      await new BucketValuationApplicationFileRepository(
        fixture.baseDir
      ).readSnapshot();
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.equity.events.length, 2);
    assert.equal(snapshot.positions.events.length, 4);
  });
});

test("valuation application repository requires durable evidence on apply and retry", async () => {
  await withFixture(async (fixture) => {
    const repository = new BucketValuationApplicationFileRepository(
      fixture.baseDir
    );
    await unlink(fixture.paths.evidenceRecordsPath);

    await assert.rejects(
      () => repository.apply(fixture.input),
      /durable price evidence does not resolve exactly once/
    );
    assert.deepEqual(
      await new BucketValuationMarkFileRepository(fixture.baseDir).readAll(),
      []
    );

    const evidenceRepository = new SourcePriceEvidenceFileRepository(
      fixture.baseDir
    );
    for (const evidence of fixture.evidence) {
      await evidenceRepository.append(evidence);
    }
    await repository.apply(fixture.input);
    await unlink(fixture.paths.evidenceRecordsPath);

    await assert.rejects(
      () => repository.apply(fixture.input),
      /durable price evidence does not resolve exactly once/
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /durable price evidence does not resolve exactly once/
    );
  });
});

test("valuation application repository completes a standalone stored mark", async () => {
  await withFixture(async (fixture) => {
    const markRepository = new BucketValuationMarkFileRepository(
      fixture.baseDir
    );
    await markRepository.append(fixture.mark);
    const repository = new BucketValuationApplicationFileRepository(
      fixture.baseDir
    );

    const applied = await repository.apply(fixture.input);
    const retried = await repository.apply(fixture.input);

    assert.equal(applied.alreadyApplied, false);
    assert.equal(retried.alreadyApplied, true);
    assert.deepEqual(await markRepository.readAll(), [fixture.mark]);
    const snapshot = await repository.readSnapshot();
    assert.equal(snapshot.equity.events.length, 2);
    assert.equal(snapshot.positions.events.length, 4);
  });
});

test("valuation application recovery completes a standalone stored mark", async () => {
  await withFixture(async (fixture) => {
    await new BucketValuationMarkFileRepository(fixture.baseDir).append(
      fixture.mark
    );
    const pending = await createPendingFixture(fixture, "already_stored");
    await writeFile(
      fixture.paths.transactionPath,
      `${JSON.stringify(pending.transaction, null, 2)}\n`,
      "utf8"
    );
    await appendFile(
      fixture.paths.equityEventsPath,
      pending.equityBytes.subarray(
        0,
        Math.floor(pending.equityBytes.length / 2)
      )
    );

    const recovered =
      await new BucketValuationApplicationFileRepository(
        fixture.baseDir
      ).readSnapshot();

    assert.deepEqual(recovered.records, [fixture.mark]);
    assert.equal(recovered.equity.events.length, 2);
    assert.equal(recovered.positions.events.length, 4);
  });
});

test("valuation application recovery rolls every partial target forward", async () => {
  await withFixture(async (fixture) => {
    const pending = await createPendingFixture(fixture);
    await writeFile(
      fixture.paths.transactionPath,
      `${JSON.stringify(pending.transaction, null, 2)}\n`,
      "utf8"
    );
    await appendFile(
      fixture.paths.markRecordsPath,
      pending.markBytes,
      "utf8"
    );
    await appendFile(
      fixture.paths.equityEventsPath,
      pending.equityBytes.subarray(
        0,
        Math.floor(pending.equityBytes.length / 2)
      )
    );
    await writeFile(
      fixture.paths.riskStatePath,
      pending.resultingRiskStateBytes
    );

    await assert.rejects(
      () => new BucketValuationMarkFileRepository(fixture.baseDir).readAll(),
      /requires aggregate recovery/
    );
    await assert.rejects(
      () => new BucketEquityFileRepository(fixture.baseDir).readSnapshot(),
      /requires aggregate recovery/
    );
    await assert.rejects(
      () =>
        new BucketPositionMarkHeadFileRepository(
          fixture.baseDir
        ).readSnapshot(),
      /requires aggregate recovery/
    );

    const recovered =
      await new BucketValuationApplicationFileRepository(
        fixture.baseDir
      ).readSnapshot();
    assert.equal(recovered.records.length, 1);
    assert.equal(recovered.equity.events.length, 2);
    assert.equal(recovered.positions.events.length, 4);
    assert.deepEqual(
      await readFile(fixture.paths.equityEventsPath),
      Buffer.concat([pending.previousEquityRaw, pending.equityBytes])
    );
    assert.deepEqual(
      await readFile(fixture.paths.positionEventsPath),
      Buffer.concat([pending.previousPositionRaw, pending.positionBytes])
    );
    await assert.rejects(
      () => readFile(fixture.paths.transactionPath),
      isMissingFile
    );
  });
});

test("valuation application recovery fails closed for journal drift", async () => {
  await withFixture(async (fixture) => {
    const pending = await createPendingFixture(fixture);
    await writeFile(
      fixture.paths.transactionPath,
      `${JSON.stringify({
        ...pending.transaction,
        previousMarkLogHash: HASH_A
      }, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(
      () =>
        new BucketValuationApplicationFileRepository(
          fixture.baseDir
        ).readSnapshot(),
      /transaction hash does not match/
    );

    await writeFile(
      fixture.paths.transactionPath,
      `${JSON.stringify(pending.transaction, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      fixture.paths.riskStatePath,
      `${JSON.stringify({ schemaVersion: 1, states: [] })}\n`,
      "utf8"
    );
    await assert.rejects(
      () =>
        new BucketValuationApplicationFileRepository(
          fixture.baseDir
        ).readSnapshot(),
      /risk state bytes do not match journal/
    );
  });
});

test("valuation application repository rejects pending component journals and locks", async () => {
  await withFixture(async (fixture) => {
    await writeFile(fixture.paths.equityTransactionPath, "pending\n", "utf8");
    await assert.rejects(
      () =>
        new BucketValuationApplicationFileRepository(
          fixture.baseDir
        ).apply(fixture.input),
      /requires single-repository recovery/
    );
    await unlink(fixture.paths.equityTransactionPath);

    const lockPath = fixture.paths.lockPaths[0] as string;
    await writeFile(lockPath, "abandoned\n", "utf8");
    await assert.rejects(
      () =>
        new BucketValuationApplicationFileRepository(fixture.baseDir, {
          lockTimeoutMs: 20,
          lockRetryDelayMs: 5
        }).apply(fixture.input),
      /repository lock is unavailable/
    );
    assert.equal(await readFile(lockPath, "utf8"), "abandoned\n");
  });
});

interface Fixture {
  baseDir: string;
  paths: ReturnType<typeof createBucketValuationApplicationPaths>;
  mark: ReturnType<typeof createBucketValuationMarkRecord>;
  evidence: readonly ReturnType<typeof createSourcePriceEvidenceRecord>[];
  input: {
    value: ReturnType<typeof createBucketValuationMarkRecord>;
  };
}

async function withFixture(
  operation: (fixture: Fixture) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "valuation-application-files-"));
  try {
    const equityRepository = new BucketEquityFileRepository(baseDir);
    await equityRepository.append(initialRiskEvent());
    const positionRepository = new BucketPositionMarkHeadFileRepository(baseDir);
    const roots = [positionRoot(), positionRoot({ symbol: "000660", price: 150 })];
    for (const root of roots) {
      await positionRepository.append(root);
    }
    const states = (await positionRepository.readSnapshot()).states;
    const evidence = Object.freeze([
      priceEvidence(),
      priceEvidence({ symbol: "000660", price: 145 })
    ]);
    const evidenceRepository = new SourcePriceEvidenceFileRepository(baseDir);
    for (const record of evidence) {
      await evidenceRepository.append(record);
    }
    const mark = createBucketValuationMarkRecord({
      portfolioId: "portfolio-1",
      bucket: "swing",
      policyHash: HASH_B,
      positionInputs: states.map((state) => {
        const current = evidence.find(
          (candidate) => candidate.symbol === state.symbol
        );
        assert.ok(current);
        return {
          market: state.market,
          symbol: state.symbol,
          quantity: state.quantity,
          previousPositionMarkHeadId: state.positionMarkHeadId,
          previousPositionMarkHeadHash: state.positionMarkHeadHash,
          previousPriceKrw: state.currentPriceKrw,
          currentPriceKrw: current.priceKrw,
          previousPriceEvidenceRef: state.currentPriceEvidenceRef,
          currentPriceEvidenceRef: current.evidenceRef
        };
      }),
      equityDeltaKrw: 10,
      asOf: "2026-09-01T02:00:00.000Z",
      createdAt: "2026-09-01T02:00:01.000Z"
    });
    await operation({
      baseDir,
      paths: createBucketValuationApplicationPaths(baseDir),
      mark,
      evidence,
      input: { value: mark }
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function applyFromChild(
  fixturePath: string,
  baseDir: string
): Promise<{ alreadyApplied: boolean }> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { BucketValuationApplicationFileRepository } from "./dist/portfolio/bucketValuationApplicationFiles.js";
    const input = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new BucketValuationApplicationFileRepository(process.argv[2]);
    const stored = await repository.apply(input);
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
      resolve(JSON.parse(stdout) as { alreadyApplied: boolean });
    });
  });
}

async function createPendingFixture(
  fixture: Fixture,
  recordWriteMode: "append" | "already_stored" = "append"
) {
  const equitySnapshot = await new BucketEquityFileRepository(
    fixture.baseDir
  ).readSnapshot();
  const positionSnapshot = await new BucketPositionMarkHeadFileRepository(
    fixture.baseDir
  ).readSnapshot();
  const currentRiskState = equitySnapshot.states[0];
  assert.ok(currentRiskState);
  const currentPositionEvents = positionSnapshot.states.map((state) => {
    const event = positionSnapshot.events.find(
      (candidate) =>
        candidate.positionMarkHeadEventId === state.lastPositionMarkHeadEventId
    );
    assert.ok(event);
    return event;
  });
  const application = resolveBucketValuationApplication({
    value: fixture.mark,
    currentPositionStates: positionSnapshot.states,
    currentPositionEvents,
    currentPriceEvidence: fixture.evidence,
    currentRiskState
  });
  const resultingRiskStates = foldBucketEquityHistory([
    ...equitySnapshot.events,
    application.bucketEquityEvent
  ]).states;
  const resultingPositionStates = foldBucketPositionMarkHeadHistory([
    ...positionSnapshot.events,
    ...application.positionMarkHeadEvents
  ]).states;
  const previousMarkRaw = await readOptional(fixture.paths.markRecordsPath);
  const previousEquityRaw = await readFile(fixture.paths.equityEventsPath);
  const previousPositionRaw = await readFile(fixture.paths.positionEventsPath);
  const previousRiskStateRaw = await readFile(fixture.paths.riskStatePath);
  const previousPositionStateRaw = await readFile(fixture.paths.positionStatePath);
  const payload = {
    schemaVersion: 1 as const,
    previousMarkFileByteLength: previousMarkRaw.length,
    previousMarkLogHash: hashBytes(previousMarkRaw),
    previousEquityEventFileByteLength: previousEquityRaw.length,
    previousEquityEventLogHash: hashBytes(previousEquityRaw),
    previousPositionEventFileByteLength: previousPositionRaw.length,
    previousPositionEventLogHash: hashBytes(previousPositionRaw),
    previousRiskStateDocumentHash: hashBytes(previousRiskStateRaw),
    previousPositionStateDocumentHash: hashBytes(previousPositionStateRaw),
    recordWriteMode,
    record: fixture.mark,
    bucketEquityEvent: application.bucketEquityEvent,
    positionMarkHeadEvents: application.positionMarkHeadEvents,
    resultingRiskStates,
    resultingPositionStates
  };
  return {
    transaction: {
      ...payload,
      transactionHash: hashCanonicalPayload(payload)
    },
    previousEquityRaw,
    previousPositionRaw,
    markBytes:
      recordWriteMode === "append"
        ? jsonLines([fixture.mark])
        : Buffer.alloc(0),
    equityBytes: jsonLines([application.bucketEquityEvent]),
    positionBytes: jsonLines(application.positionMarkHeadEvents),
    resultingRiskStateBytes: stateBytes(resultingRiskStates)
  };
}

function initialRiskEvent() {
  return createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-1",
    activationId: "activation-1",
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    drawdownSemanticsHash: HASH_A,
    initializationMode: "initial_or_empty",
    initialEquityKrw: 1_000,
    initialUnits: 1_000,
    initialUnitNavKrw: 1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-01T01:30:00.000Z"
  });
}

function positionRoot(
  overrides: Partial<{ symbol: string; price: number }> = {}
) {
  const symbol = overrides.symbol ?? "005930";
  const evidenceRef = `before-${symbol}`;
  return createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol,
    eventType: "initialized",
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef: `observed-${symbol}`,
      markEvidenceRef: evidenceRef
    },
    resultingQuantity: 2,
    resultingPriceKrw: overrides.price ?? 100,
    resultingPriceEvidenceRef: evidenceRef,
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
}

function priceEvidence(
  overrides: Partial<{ symbol: string; price: number }> = {}
) {
  const symbol = overrides.symbol ?? "005930";
  return createSourcePriceEvidenceRecord({
    sourceContractId: "contract-v1",
    market: "KR",
    symbol,
    priceField: "last_price",
    priceKrw: overrides.price ?? 110,
    observedAt: "2026-09-01T02:00:00.000Z",
    sourceRefs: [`source-${symbol}`],
    createdAt: "2026-09-01T02:00:00.000Z"
  });
}

function jsonLines(values: readonly unknown[]): Buffer {
  return Buffer.from(`${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

function stateBytes(states: readonly unknown[]): Buffer {
  return Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, states }, null, 2)}\n`,
    "utf8"
  );
}

function hashBytes(value: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readOptional(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return Buffer.alloc(0);
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
