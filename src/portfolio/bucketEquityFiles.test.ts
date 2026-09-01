import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
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

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("bucket equity repository converges concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const nestedBaseDir = join(baseDir, "portfolio", "equity");
    const left = new BucketEquityFileRepository(nestedBaseDir);
    const right = new BucketEquityFileRepository(nestedBaseDir);
    const event = initialization();
    const [leftEvent, rightEvent] = await Promise.all([
      left.append(event),
      right.append(event)
    ]);
    assert.deepEqual(rightEvent, leftEvent);

    const snapshot = await left.readSnapshot();
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.states[0]?.equityKrw, 1_000);
    const raw = await readFile(
      createBucketEquityPaths(nestedBaseDir).eventsPath,
      "utf8"
    );
    assert.equal(nonblankLineCount(raw), 1);
  });
});

test("bucket equity repository validates candidate history before writing", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const initialized = initialization();
    await repository.append(initialized);
    const paths = createBucketEquityPaths(baseDir);
    const before = await readFile(paths.eventsPath, "utf8");
    const branch = createBucketEquityEvent({
      previousBucketEquityEventId: "unknown-head",
      riskStateEpochId: initialized.riskStateEpochId,
      portfolioId: initialized.portfolioId,
      bucket: initialized.bucket,
      policyHash: initialized.policyHash,
      asOf: "2026-09-01T01:00:00.000Z",
      eventType: "capital_flow",
      amountKrw: 100,
      rebalancePlanId: "plan-1",
      rebalanceActionId: "action-1",
      fillId: "fill-1",
      paperFillRecordId: "paper-fill-1",
      paperFillHash: HASH_A,
      fillAccountingGroupId: "group-1",
      fillAccountingSequence: 0
    });
    await assert.rejects(
      () => repository.append(branch),
      /predecessor does not match current head/
    );
    assert.equal(await readFile(paths.eventsPath, "utf8"), before);
  });
});

test("bucket equity repository rebuilds current risk state after restart", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const initialized = initialization();
    const valuation = createBucketEquityEvent({
      previousBucketEquityEventId: initialized.bucketEquityEventId,
      riskStateEpochId: initialized.riskStateEpochId,
      portfolioId: initialized.portfolioId,
      bucket: initialized.bucket,
      policyHash: initialized.policyHash,
      asOf: "2026-09-01T01:00:00.000Z",
      eventType: "valuation",
      equityDeltaKrw: -125,
      bucketValuationMarkRecordId: "mark-1",
      valuationMarkHash: HASH_B,
      evidenceRefs: ["price-a"]
    });
    await repository.append(initialized);
    await repository.append(valuation);

    const restarted = new BucketEquityFileRepository(baseDir);
    const snapshot = await restarted.readSnapshot();
    assert.equal(snapshot.events.length, 2);
    assert.equal(snapshot.states[0]?.equityKrw, 875);
    assert.equal(snapshot.states[0]?.unitNavKrw, 0.875);
    assert.equal(snapshot.states[0]?.drawdownRatio, 0.125);
  });
});

test("bucket equity repository fails closed for torn, corrupt, blank, and duplicate lines", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    await repository.append(initialization());
    const path = createBucketEquityPaths(baseDir).eventsPath;
    const valid = await readFile(path, "utf8");

    await appendFile(path, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt line 2/);

    await writeFile(path, valid.trimEnd(), "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final line/);

    await writeFile(path, `${valid}\n`, "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt line 2/);

    await writeFile(path, `${valid}${valid}`, "utf8");
    await assert.rejects(() => repository.readSnapshot(), /duplicate event ID/);
  });
});

test("bucket equity repository rehashes stored lines after restart", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const initialized = initialization();
    await repository.append(initialized);
    const path = createBucketEquityPaths(baseDir).eventsPath;
    await writeFile(
      path,
      `${JSON.stringify({ ...initialized, initialEquityKrw: 999 })}\n`,
      "utf8"
    );
    await assert.rejects(
      () => new BucketEquityFileRepository(baseDir).readSnapshot(),
      /corrupt line 1/
    );
  });
});

test("bucket equity repository leaves an abandoned lock fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createBucketEquityPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new BucketEquityFileRepository(baseDir, {
      lockTimeoutMs: 20,
      lockRetryDelayMs: 500
    });

    const startedAt = Date.now();
    await assert.rejects(
      () => repository.readSnapshot(),
      /repository lock is unavailable/
    );
    assert.ok(Date.now() - startedAt < 250);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function initialization() {
  return createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-1",
    activationId: "activation-1",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    initializationMode: "initial_or_empty",
    initialEquityKrw: 1_000,
    initialUnits: 1_000,
    initialUnitNavKrw: 1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-01T00:00:00.000Z"
  });
}

async function withTemporaryDirectory(
  operation: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "bucket-equity-files-"));
  try {
    await operation(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function nonblankLineCount(value: string): number {
  return value.split(/\r?\n/).filter((line) => line.length > 0).length;
}
