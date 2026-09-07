import assert from "node:assert/strict";
import {
  appendFile,
  type FileHandle,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
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
  getDurableInvestmentMandateObservation,
  getVerifiedInvestmentMandateHistorySnapshot,
  InvestmentMandateFileRepository,
  resolveObservedInvestmentMandateHistory,
  type VerifiedInvestmentMandateHistory
} from "./investmentMandateFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

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
    const expiredLease = await repository.withVerifiedHistory((verified) => {
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
      return verified;
    });
    assert.throws(
      () => getVerifiedInvestmentMandateHistorySnapshot(expiredLease),
      /not repository verified/
    );
  });
});

test("durable mandate observations cover empty and complete generations and revoke copied or expired leases", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    await repository.withDurableVerifiedHistory((history) => {
      const observation = getDurableInvestmentMandateObservation(history);
      assert.equal(observation.recordCount, 0);
      assert.equal(observation.eventCount, 0);
      assert.equal(observation.recordsHash, hashCanonicalPayload([]));
      assert.deepEqual(resolveObservedInvestmentMandateHistory(history, observation).records, []);
    });
    const { record, activated } = await seedActiveMandate(repository);
    await repository.withVerifiedHistory((history) => {
      assert.throws(() => getDurableInvestmentMandateObservation(history), /durable observation lease/);
    });
    const result = await repository.withDurableVerifiedHistory((history) => {
      const observation = getDurableInvestmentMandateObservation(history);
      assert.deepEqual({ ...observation, observedAt: "omitted" }, {
        recordCount: 1, recordsHash: hashCanonicalPayload([record]), eventCount: 1,
        eventsHash: hashCanonicalPayload([activated]), observedAt: "omitted"
      });
      assert.ok(Object.isFrozen(observation));
      assert.throws(() => getDurableInvestmentMandateObservation({ ...history }), /not repository verified/);
      assert.throws(() => getDurableInvestmentMandateObservation(JSON.parse(JSON.stringify(history))), /not repository verified/);
      return { history, observation };
    });
    assert.throws(() => getDurableInvestmentMandateObservation(result.history), /not repository verified/);
    await new InvestmentMandateFileRepository(baseDir).withDurableVerifiedHistory((history) => {
      const prefix = resolveObservedInvestmentMandateHistory(history, JSON.parse(JSON.stringify(result.observation)));
      assert.deepEqual(prefix, result.history);
      assert.throws(() => getVerifiedInvestmentMandateHistorySnapshot(prefix), /not repository verified/);
    });
  });
});

test("durable mandate observation samples time only after both source file syncs", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    await seedActiveMandate(repository);
    const paths = createInvestmentMandatePaths(baseDir);
    const sources = await Promise.all([stat(paths.recordsPath), stat(paths.eventsPath)]);
    const probe = await open(paths.recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const now = Date.now();
    context.mock.timers.enable({ apis: ["Date"], now });
    const synced = new Set<number>();
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      const index = sources.findIndex((source) => own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev));
      const result = await originalSync.call(this);
      if (index >= 0) { synced.add(index); context.mock.timers.tick(10); }
      return result;
    });
    try {
      await repository.withDurableVerifiedHistory((history) => {
        assert.deepEqual([...synced].sort(), [0, 1]);
        assert.equal(getDurableInvestmentMandateObservation(history).observedAt, new Date(now + 20).toISOString());
      });
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  });
});

test("durable mandate sync failures never invoke consumers and release the shared lock", async (context) => {
  for (const sourceKind of ["recordsPath", "eventsPath"] as const) await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    await seedActiveMandate(repository);
    const paths = createInvestmentMandatePaths(baseDir);
    const before = await Promise.all([readFile(paths.recordsPath, "utf8"), readFile(paths.eventsPath, "utf8")]);
    const source = await stat(paths[sourceKind]);
    const probe = await open(paths[sourceKind], "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) throw new Error("injected mandate source sync failure");
      return originalSync.call(this);
    });
    let invoked = false;
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(() => { invoked = true; }), /injected mandate source sync failure/);
      assert.equal(invoked, false);
    } finally { mock.mock.restore(); }
    await repository.withDurableVerifiedHistory((history) => assert.equal(getDurableInvestmentMandateObservation(history).eventCount, 1));
    assert.deepEqual(await Promise.all([readFile(paths.recordsPath, "utf8"), readFile(paths.eventsPath, "utf8")]), before);
  });
});

test("durable mandate leases exclude competing appends and expire after consumer failure", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const { record, activated } = await seedActiveMandate(repository);
    const contender = new InvestmentMandateFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const retired = mandateEvent(record, { eventType: "retired", previousMandateEventId: activated.mandateEventId,
      asOf: "2026-09-02T00:00:00.000Z", createdAt: "2026-09-02T00:00:00.000Z" });
    let captured: VerifiedInvestmentMandateHistory | undefined;
    await assert.rejects(repository.withDurableVerifiedHistory(async (history) => {
      captured = history;
      await assert.rejects(contender.appendEvent(retired), /lock is unavailable/);
      assert.equal(getDurableInvestmentMandateObservation(history).eventCount, 1);
      throw new Error("injected mandate consumer failure");
    }), /injected mandate consumer failure/);
    assert.ok(captured);
    const expired = captured;
    assert.throws(() => getDurableInvestmentMandateObservation(expired), /not repository verified/);
    await contender.appendEvent(retired);
    assert.equal((await repository.readSnapshot()).states[0]!.status, "retired");
  });
});

test("durable observations reproduce earlier complete prefixes after append and reject inconsistent boundaries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const { record, activated } = await seedActiveMandate(repository);
    const observation = await repository.withDurableVerifiedHistory(getDurableInvestmentMandateObservation);
    await repository.appendRecord(mandateRecord("2026-09-02T00:00:00.000Z", "manual-event-2"));
    await repository.appendEvent(mandateEvent(record, { eventType: "retired", previousMandateEventId: activated.mandateEventId,
      asOf: "2026-09-02T00:00:00.000Z", createdAt: "2026-09-02T00:00:00.000Z" }));
    await repository.withDurableVerifiedHistory((history) => {
      assert.equal(history.states[0]!.status, "retired");
      const prefix = resolveObservedInvestmentMandateHistory(history, observation);
      assert.equal(prefix.states[0]!.status, "active");
      assert.deepEqual(prefix.records, [record]);
      for (const patch of [{ recordCount: -0 }, { recordCount: 0.5 }, { eventCount: -1 }, { eventCount: Number.MAX_SAFE_INTEGER + 1 },
        { trusted: true }, { recordsHash: HASH_A }, { eventsHash: HASH_A }, { eventCount: 3 },
        { observedAt: new Date(Date.now() + 3_600_000).toISOString() }]) {
        assert.throws(() => resolveObservedInvestmentMandateHistory(history, { ...observation, ...patch }));
      }
      assert.throws(() => resolveObservedInvestmentMandateHistory(history, { ...observation, recordCount: 0, recordsHash: hashCanonicalPayload([]) }), /unknown mandate/);
    });
  });
});

test("durable observations fail closed on valid source truncation or replacement and corrupt suffixes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new InvestmentMandateFileRepository(baseDir);
    const { record, activated } = await seedActiveMandate(repository);
    const extra = mandateRecord("2026-09-02T00:00:00.000Z", "manual-event-2");
    await repository.appendRecord(extra);
    const review = mandateEvent(record, { eventType: "review_required", previousMandateEventId: activated.mandateEventId,
      asOf: "2026-09-02T00:00:00.000Z", createdAt: "2026-09-02T00:00:00.000Z" });
    await repository.appendEvent(review);
    const observation = await repository.withDurableVerifiedHistory(getDurableInvestmentMandateObservation);
    const paths = createInvestmentMandatePaths(baseDir);
    for (const sourceKind of ["recordsPath", "eventsPath"] as const) {
      const path = paths[sourceKind];
      const original = await readFile(path, "utf8");
      const firstLine = `${original.split("\n")[0]}\n`;
      const replacement = sourceKind === "recordsPath" ? mandateRecord("2026-09-02T00:01:00.000Z", "manual-event-2")
        : mandateEvent(record, { eventType: "review_required", previousMandateEventId: activated.mandateEventId,
          asOf: "2026-09-02T00:01:00.000Z", createdAt: "2026-09-02T00:01:00.000Z" });
      for (const content of [firstLine, `${firstLine}${JSON.stringify(replacement)}\n`]) {
        await writeFile(path, content);
        await assert.rejects(repository.withDurableVerifiedHistory((history) => resolveObservedInvestmentMandateHistory(history, observation)), /source prefixes/);
      }
      for (const content of [`${original}{corrupt}\n`, original.trimEnd()]) {
        await writeFile(path, content);
        let invoked = false;
        await assert.rejects(repository.withDurableVerifiedHistory(() => { invoked = true; }), /corrupt line|torn final line/);
        assert.equal(invoked, false);
      }
      await writeFile(path, original);
    }
  });
});

async function seedActiveMandate(repository: InvestmentMandateFileRepository) {
  const record = await repository.appendRecord(mandateRecord("2026-09-01T01:00:00.000Z"));
  const activated = await repository.appendEvent(mandateEvent(record, { eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z", createdAt: "2026-09-01T01:00:00.000Z" }));
  return { record, activated };
}

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
