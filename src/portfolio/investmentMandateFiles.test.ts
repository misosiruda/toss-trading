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

import {
  createInvestmentMandateEvent,
  createInvestmentMandateRecord,
  type InvestmentMandateEvent,
  type InvestmentMandateRecord
} from "./investmentMandate.js";
import {
  createInvestmentMandatePaths,
  getVerifiedInvestmentMandateHistorySnapshot,
  InvestmentMandateFileRepository,
  type VerifiedInvestmentMandateHistory
} from "./investmentMandateFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}`;

test("mandate repository atomically converges concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const nestedBaseDir = join(baseDir, "portfolio", "mandates");
    const left = new InvestmentMandateFileRepository(nestedBaseDir);
    const right = new InvestmentMandateFileRepository(nestedBaseDir);
    const record = mandateRecord("2026-09-01T01:00:00.000Z");

    const [leftRecord, rightRecord] = await Promise.all([
      left.appendRecord(record),
      right.appendRecord(record)
    ]);
    assert.deepEqual(rightRecord, leftRecord);

    const activated = mandateEvent(record, {
      eventType: "activated",
      asOf: "2026-09-01T01:00:00.000Z",
      createdAt: "2026-09-01T01:00:00.000Z"
    });
    const [leftEvent, rightEvent] = await Promise.all([
      left.appendEvent(activated),
      right.appendEvent(activated)
    ]);
    assert.deepEqual(rightEvent, leftEvent);
    assert.equal((await left.resolveCurrent(scope(record))).record.mandateId, record.mandateId);

    const paths = createInvestmentMandatePaths(nestedBaseDir);
    assert.equal(nonblankLineCount(await readFile(paths.recordsPath, "utf8")), 1);
    assert.equal(nonblankLineCount(await readFile(paths.eventsPath, "utf8")), 1);
  });
});

test("mandate repository rejects ID collisions and conflicting transitions without writes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const record = mandateRecord("2026-09-01T01:00:00.000Z");
    await repository.appendRecord(record);
    await assert.rejects(
      () => repository.appendRecord(mandateRecord("2026-09-01T01:01:00.000Z")),
      /record ID collision/
    );

    const activated = mandateEvent(record, {
      eventType: "activated",
      asOf: "2026-09-01T01:00:00.000Z",
      createdAt: "2026-09-01T01:00:00.000Z"
    });
    await repository.appendEvent(activated);
    await assert.rejects(
      () =>
        repository.appendEvent(
          mandateEvent(record, {
            eventType: "activated",
            asOf: "2026-09-01T01:00:00.000Z",
            createdAt: "2026-09-01T01:01:00.000Z"
          })
        ),
      /event ID collision/
    );

    const branch = mandateRecord("2026-09-01T01:10:00.000Z", "manual-event-2");
    await repository.appendRecord(branch);
    const paths = createInvestmentMandatePaths(baseDir);
    const before = await readFile(paths.eventsPath, "utf8");
    await assert.rejects(
      () =>
        repository.appendEvent(
          mandateEvent(branch, {
            eventType: "activated",
            previousMandateEventId: activated.mandateEventId,
            asOf: "2026-09-01T01:30:00.000Z",
            createdAt: "2026-09-01T01:30:00.000Z"
          })
        ),
      /not authorized/
    );
    assert.equal(await readFile(paths.eventsPath, "utf8"), before);
  });
});

test("mandate repository persists the declared retirement and successor activation order", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const first = mandateRecord("2026-09-01T01:00:00.000Z", "manual-event-1");
    const successor = mandateRecord(
      "2026-09-01T01:10:00.000Z",
      "manual-event-2",
      "2026-09-01T03:00:00.000Z"
    );
    await repository.appendRecord(first);
    const activated = await repository.appendEvent(
      mandateEvent(first, {
        eventType: "activated",
        asOf: "2026-09-01T01:00:00.000Z",
        createdAt: "2026-09-01T01:00:00.000Z"
      })
    );
    await assert.rejects(
      () =>
        repository.appendEvent(
          mandateEvent(first, {
            eventType: "retired",
            previousMandateEventId: activated.mandateEventId,
            supersededByMandateId: successor.mandateId,
            asOf: "2026-09-01T02:00:00.000Z",
            createdAt: "2026-09-01T02:00:00.000Z"
          })
        ),
      /unknown successor/
    );

    await repository.appendRecord(successor);
    const retired = await repository.appendEvent(
      mandateEvent(first, {
        eventType: "retired",
        previousMandateEventId: activated.mandateEventId,
        supersededByMandateId: successor.mandateId,
        asOf: "2026-09-01T02:00:00.000Z",
        createdAt: "2026-09-01T02:00:00.000Z"
      })
    );
    await repository.appendEvent(
      mandateEvent(successor, {
        eventType: "activated",
        previousMandateEventId: retired.mandateEventId,
        asOf: "2026-09-01T03:00:00.000Z",
        createdAt: "2026-09-01T03:00:00.000Z"
      })
    );

    const snapshot = await repository.readSnapshot();
    assert.deepEqual(
      snapshot.states.map((state) => state.status),
      ["retired", "active"]
    );
    assert.equal((await repository.resolveCurrent(scope(first))).record.mandateId, successor.mandateId);
  });
});

test("mandate repository fails closed for torn, corrupt, blank, and duplicate lines", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const record = mandateRecord("2026-09-01T01:00:00.000Z");
    await repository.appendRecord(record);
    const paths = createInvestmentMandatePaths(baseDir);
    const validRecordLine = await readFile(paths.recordsPath, "utf8");

    await appendFile(paths.recordsPath, "{corrupt}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt line 2/);

    await writeFile(paths.recordsPath, validRecordLine.trimEnd(), "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final line/);

    await writeFile(paths.recordsPath, `${validRecordLine}\n`, "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt line 2/);

    await writeFile(paths.recordsPath, `${validRecordLine}${validRecordLine}`, "utf8");
    await assert.rejects(() => repository.readSnapshot(), /duplicate ID/);
  });
});

test("mandate repository leaves an abandoned shared lock fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createInvestmentMandatePaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new InvestmentMandateFileRepository(baseDir, {
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

test("mandate repository issues opaque verified histories", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const record = mandateRecord("2026-09-01T01:00:00.000Z");
    await repository.appendRecord(record);
    const verified = await repository.readVerifiedHistory();

    assert.deepEqual(
      getVerifiedInvestmentMandateHistorySnapshot(verified).records,
      [record]
    );
    assert.throws(
      () =>
        getVerifiedInvestmentMandateHistorySnapshot({
          records: verified.records,
          events: verified.events,
          states: verified.states
        } as VerifiedInvestmentMandateHistory),
      /not repository verified/
    );
  });
});

function mandateRecord(
  createdAt: string,
  manualAssignmentEventId = "manual-event-1",
  validFrom = "2026-09-01T00:30:00.000Z"
): InvestmentMandateRecord {
  return createInvestmentMandateRecord({
    portfolioId: "portfolio-1",
    market: "KR",
    symbol: "005930",
    bucket: "intraday",
    policyHash: HASH_A,
    asOf: "2026-09-01T00:30:00.000Z",
    targetWeightRatio: 0.2,
    minWeightRatio: 0.1,
    maxWeightRatio: 0.3,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: ["reason-a"],
    evidenceRefs: ["evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    reviewCadence: { mode: "every_tick" },
    validFrom,
    expiresAt: "2026-10-01T00:30:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId,
    createdAt
  });
}

function mandateEvent(
  record: InvestmentMandateRecord,
  transition:
    | {
        eventType: "activated";
        previousMandateEventId?: string;
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "review_required";
        previousMandateEventId: string;
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "retired";
        previousMandateEventId: string;
        supersededByMandateId?: string;
        asOf: string;
        createdAt: string;
      }
): InvestmentMandateEvent {
  return createInvestmentMandateEvent({
    mandateId: record.mandateId,
    mandateHash: record.mandateHash,
    portfolioId: record.portfolioId,
    market: record.market,
    symbol: record.symbol,
    bucket: record.bucket,
    policyHash: record.policyHash,
    reasonCodes: ["lifecycle"],
    ...transition
  });
}

function scope(record: InvestmentMandateRecord): {
  portfolioId: string;
  market: InvestmentMandateRecord["market"];
  symbol: string;
} {
  return {
    portfolioId: record.portfolioId,
    market: record.market,
    symbol: record.symbol
  };
}

function nonblankLineCount(value: string): number {
  return value.split("\n").filter(Boolean).length;
}

async function withTemporaryDirectory(
  operation: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "investment-mandate-"));
  try {
    await operation(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}
