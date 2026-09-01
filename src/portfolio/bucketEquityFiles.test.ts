import assert from "node:assert/strict";
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
  createBucketEquityEvent,
  createBucketRiskState,
  parseBucketRiskState
} from "./bucketEquity.js";
import {
  BucketEquityFileRepository,
  createBucketEquityPaths
} from "./bucketEquityFiles.js";
import { foldBucketEquityHistory } from "./bucketEquityState.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

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
    const stateDocument = JSON.parse(
      await readFile(createBucketEquityPaths(nestedBaseDir).statePath, "utf8")
    ) as { schemaVersion: number; states: unknown[] };
    assert.equal(stateDocument.schemaVersion, 1);
    assert.deepEqual(stateDocument.states, snapshot.states);
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

test("bucket equity repository fails closed for missing, corrupt, torn, and mismatched risk snapshots", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    await repository.append(initialization());
    const paths = createBucketEquityPaths(baseDir);
    const valid = await readFile(paths.statePath, "utf8");

    await unlink(paths.statePath);
    await assert.rejects(() => repository.readSnapshot(), /snapshot is missing/);

    await writeFile(paths.statePath, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt JSON/);

    await writeFile(paths.statePath, valid.trimEnd(), "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final write/);

    const stored = JSON.parse(valid) as { schemaVersion: 1; states: unknown[] };
    const current = (await repositoryStateFromDocument(valid))[0];
    assert.ok(current);
    const mismatched = createBucketRiskState({
      riskStateEpochId: current.riskStateEpochId,
      portfolioId: current.portfolioId,
      bucket: current.bucket,
      policyHash: current.policyHash,
      drawdownSemanticsHash: current.drawdownSemanticsHash,
      units: current.units,
      unitNavKrw: current.unitNavKrw,
      highWaterMarkUnitNavKrw: current.highWaterMarkUnitNavKrw,
      equityKrw: current.equityKrw,
      drawdownRatio: current.drawdownRatio,
      lastBucketEquityEventId: "different-event",
      asOf: "2026-09-01T00:01:00.000Z"
    });
    await writeFile(
      paths.statePath,
      `${JSON.stringify({ ...stored, states: [mismatched] }, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readSnapshot(), /does not match event replay/);
  });
});

test("bucket equity repository rejects duplicate and non-canonical risk snapshot scopes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const intraday = initialization();
    const hedge = initialization({
      riskStateEpochId: "epoch-hedge",
      activationId: "activation-hedge",
      bucket: "hedge"
    });
    await repository.append(intraday);
    await repository.append(hedge);
    const paths = createBucketEquityPaths(baseDir);
    const stored = JSON.parse(await readFile(paths.statePath, "utf8")) as {
      schemaVersion: 1;
      states: unknown[];
    };

    await writeFile(
      paths.statePath,
      `${JSON.stringify({ ...stored, states: [...stored.states].reverse() })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readSnapshot(), /non-canonical ordering/);

    await writeFile(
      paths.statePath,
      `${JSON.stringify({ ...stored, states: [stored.states[0], stored.states[0]] })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readSnapshot(), /duplicate scope/);
  });
});

test("bucket equity repository completes a journaled event after restart", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const initialized = initialization();
    await repository.append(initialized);
    const valuation = valuationEvent(initialized, -100);
    const paths = createBucketEquityPaths(baseDir);
    const previousRaw = await readFile(paths.eventsPath);
    const resulting = foldBucketEquityHistory([initialized, valuation]);
    await writePendingTransaction(
      paths.transactionPath,
      previousRaw,
      valuation,
      resulting.states
    );
    await appendFile(
      paths.eventsPath,
      `${JSON.stringify(valuation)}\n`,
      "utf8"
    );

    const recovered = await new BucketEquityFileRepository(baseDir).readSnapshot();
    assert.equal(recovered.events.length, 2);
    assert.equal(recovered.states[0]?.equityKrw, 900);
    await assert.rejects(() => readFile(paths.transactionPath), isMissingFile);
    const stored = JSON.parse(await readFile(paths.statePath, "utf8")) as {
      states: unknown[];
    };
    assert.deepEqual(stored.states, recovered.states);
  });
});

test("bucket equity repository rolls back a partial journaled event and projected state", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const initialized = initialization();
    await repository.append(initialized);
    const valuation = valuationEvent(initialized, -100);
    const paths = createBucketEquityPaths(baseDir);
    const previousRaw = await readFile(paths.eventsPath);
    const resulting = foldBucketEquityHistory([initialized, valuation]);
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

    const recovered = await new BucketEquityFileRepository(baseDir).readSnapshot();
    assert.equal(recovered.events.length, 1);
    assert.equal(recovered.states[0]?.equityKrw, 1_000);
    assert.deepEqual(await readFile(paths.eventsPath), previousRaw);
    await assert.rejects(() => readFile(paths.transactionPath), isMissingFile);
  });
});

test("bucket equity repository fails closed for corrupt transaction journals", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new BucketEquityFileRepository(baseDir);
    const initialized = initialization();
    await repository.append(initialized);
    const paths = createBucketEquityPaths(baseDir);
    const previousRaw = await readFile(paths.eventsPath);
    const previousSnapshot = await repository.readSnapshot();
    await writePendingTransaction(
      paths.transactionPath,
      previousRaw,
      valuationEvent(initialized, -100),
      previousSnapshot.states
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /resulting states do not match replay/
    );

    const candidate = valuationEvent(initialized, -100);
    const resulting = foldBucketEquityHistory([initialized, candidate]);
    await writePendingTransaction(
      paths.transactionPath,
      Buffer.alloc(previousRaw.length),
      candidate,
      resulting.states
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /event-log prefix hash mismatch/
    );

    await writeFile(paths.transactionPath, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /contains corrupt JSON/);

    await writeFile(paths.transactionPath, "{}", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final write/);
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

function initialization(
  overrides: {
    riskStateEpochId?: string;
    activationId?: string;
    bucket?: "intraday" | "hedge";
  } = {}
) {
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
    asOf: "2026-09-01T00:00:00.000Z",
    ...overrides
  });
}

function valuationEvent(
  previous: ReturnType<typeof initialization>,
  equityDeltaKrw: number
) {
  return createBucketEquityEvent({
    previousBucketEquityEventId: previous.bucketEquityEventId,
    riskStateEpochId: previous.riskStateEpochId,
    portfolioId: previous.portfolioId,
    bucket: previous.bucket,
    policyHash: previous.policyHash,
    asOf: "2026-09-01T01:00:00.000Z",
    eventType: "valuation",
    equityDeltaKrw,
    bucketValuationMarkRecordId: "mark-recovery",
    valuationMarkHash: HASH_B,
    evidenceRefs: ["price-a"]
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

async function repositoryStateFromDocument(raw: string) {
  const stored = JSON.parse(raw) as { states: unknown[] };
  return stored.states.map((state) => parseBucketRiskState(state));
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
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
