import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  InvestmentMandateFileRepository
} from "./investmentMandateFiles.js";
import {
  createAssignedPositionStrategyState,
  createUnassignedLegacyPositionStrategyState,
  type AssignedPositionStrategyState,
  type PositionStrategyState
} from "./positionStrategyState.js";
import {
  createPositionStrategyStatePaths,
  PositionStrategyStateFileRepository
} from "./positionStrategyStateFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;
const HASH_D = `sha256:${"d".repeat(64)}` as const;
const HASH_E = `sha256:${"e".repeat(64)}` as const;
const HASH_F = `sha256:${"f".repeat(64)}` as const;

test("position state repository persists and revalidates assigned lineage after restart", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const mandates = new InvestmentMandateFileRepository(baseDir);
    const repository = new PositionStrategyStateFileRepository(
      baseDir,
      mandates
    );
    assert.deepEqual(await repository.readSnapshot(), []);

    const { record, activated } = await storeActiveMandate(mandates);
    const state = assignedState(record, activated);
    assert.deepEqual(
      await repository.compareAndSwap({
        expectedPositionStrategyStateHash: null,
        value: state
      }),
      state
    );

    const restarted = new PositionStrategyStateFileRepository(
      baseDir,
      new InvestmentMandateFileRepository(baseDir)
    );
    assert.deepEqual(await restarted.readSnapshot(), [state]);
    assert.deepEqual(
      await restarted.readCurrent(scope(state)),
      state
    );
    const raw = await readFile(
      createPositionStrategyStatePaths(baseDir).statePath,
      "utf8"
    );
    assert.equal(raw.endsWith("\n"), true);
    assert.equal(JSON.parse(raw).schemaVersion, 1);
  });
});

test("position state repository converges exact retries and rejects stale CAS writers", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const mandates = new InvestmentMandateFileRepository(baseDir);
    const { record, activated } = await storeActiveMandate(mandates);
    const first = new PositionStrategyStateFileRepository(baseDir, mandates);
    const initial = assignedState(record, activated);
    await first.compareAndSwap({
      expectedPositionStrategyStateHash: null,
      value: initial
    });

    const exact = updateAssignedState(initial, {
      lastReviewedAt: "2026-09-01T02:00:00.000Z",
      lastReviewedTriggerRef: HASH_D,
      peakPriceKrw: 110
    });
    const second = new PositionStrategyStateFileRepository(
      baseDir,
      new InvestmentMandateFileRepository(baseDir)
    );
    const exactResults = await Promise.all([
      first.compareAndSwap({
        expectedPositionStrategyStateHash:
          initial.positionStrategyStateHash,
        value: exact
      }),
      second.compareAndSwap({
        expectedPositionStrategyStateHash:
          initial.positionStrategyStateHash,
        value: exact
      })
    ]);
    assert.deepEqual(exactResults, [exact, exact]);

    const left = updateAssignedState(exact, {
      lastReviewedAt: "2026-09-01T03:00:00.000Z",
      lastReviewedTriggerRef: HASH_E,
      peakPriceKrw: 120
    });
    const right = updateAssignedState(exact, {
      lastReviewedAt: "2026-09-01T03:00:00.000Z",
      lastReviewedTriggerRef: HASH_F,
      peakPriceKrw: 130
    });
    const competing = await Promise.allSettled([
      first.compareAndSwap({
        expectedPositionStrategyStateHash: exact.positionStrategyStateHash,
        value: left
      }),
      second.compareAndSwap({
        expectedPositionStrategyStateHash: exact.positionStrategyStateHash,
        value: right
      })
    ]);
    assert.equal(
      competing.filter((result) => result.status === "fulfilled").length,
      1
    );
    const rejected = competing.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.match(String(rejected?.reason), /compare-and-swap conflict/);
    assert.equal((await first.readSnapshot()).length, 1);
  });
});

test("position state restart fails closed after mandate head drift", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const mandates = new InvestmentMandateFileRepository(baseDir);
    const repository = new PositionStrategyStateFileRepository(
      baseDir,
      mandates
    );
    const { record, activated } = await storeActiveMandate(mandates);
    const state = assignedState(record, activated);
    await repository.compareAndSwap({
      expectedPositionStrategyStateHash: null,
      value: state
    });

    await mandates.appendEvent(
      mandateEvent(record, {
        eventType: "review_required",
        previousMandateEventId: activated.mandateEventId,
        asOf: "2026-09-01T02:00:00.000Z",
        createdAt: "2026-09-01T02:00:00.000Z"
      })
    );
    await assert.rejects(
      () => repository.readSnapshot(),
      /does not match its mandate lineage/
    );
  });
});

test("position state repository rejects assigned state regression without mutation", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const mandates = new InvestmentMandateFileRepository(baseDir);
    const repository = new PositionStrategyStateFileRepository(
      baseDir,
      mandates
    );
    const { record, activated } = await storeActiveMandate(mandates);
    const initial = assignedState(record, activated);
    await repository.compareAndSwap({
      expectedPositionStrategyStateHash: null,
      value: initial
    });
    const advanced = updateAssignedState(initial, {
      lastIncreasedAt: "2026-09-01T02:00:00.000Z",
      lastReducedAt: "2026-09-01T02:30:00.000Z",
      lastReviewedAt: "2026-09-01T03:00:00.000Z",
      lastReviewedTriggerRef: HASH_D,
      peakPriceKrw: 130,
      partialTakeProfitExecuted: true
    });
    await repository.compareAndSwap({
      expectedPositionStrategyStateHash:
        initial.positionStrategyStateHash,
      value: advanced
    });
    const statePath = createPositionStrategyStatePaths(baseDir).statePath;
    const before = await readFile(statePath, "utf8");

    const regressions: Array<{
      value: PositionStrategyState;
      pattern: RegExp;
    }> = [
      {
        value: updateAssignedState(advanced, { peakPriceKrw: 129 }),
        pattern: /peakPriceKrw cannot decrease/
      },
      {
        value: updateAssignedState(advanced, {
          lastIncreasedAt: undefined
        }),
        pattern: /lastIncreasedAt cannot decrease/
      },
      {
        value: updateAssignedState(advanced, {
          lastReviewedAt: "2026-09-01T02:59:00.000Z"
        }),
        pattern: /lastReviewedAt cannot decrease/
      },
      {
        value: updateAssignedState(advanced, {
          partialTakeProfitExecuted: false
        }),
        pattern: /partialTakeProfitExecuted cannot reset/
      },
      {
        value: legacyState(advanced.symbol),
        pattern: /cannot return to legacy/
      }
    ];
    for (const regression of regressions) {
      await assert.rejects(
        () =>
          repository.compareAndSwap({
            expectedPositionStrategyStateHash:
              advanced.positionStrategyStateHash,
            value: regression.value
          }),
        regression.pattern
      );
      assert.equal(await readFile(statePath, "utf8"), before);
    }
  });
});

test("position state repository rejects corrupt, torn, duplicate, and unordered snapshots", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const mandates = new InvestmentMandateFileRepository(baseDir);
    const repository = new PositionStrategyStateFileRepository(
      baseDir,
      mandates
    );
    const state = legacyState("005930");
    await repository.compareAndSwap({
      expectedPositionStrategyStateHash: null,
      value: state
    });
    const statePath = createPositionStrategyStatePaths(baseDir).statePath;
    const valid = await readFile(statePath, "utf8");

    await writeFile(statePath, valid.trimEnd(), "utf8");
    await assert.rejects(() => repository.readSnapshot(), /torn final write/);

    await writeFile(statePath, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readSnapshot(), /corrupt JSON/);

    await writeDocument(statePath, [state, state]);
    await assert.rejects(() => repository.readSnapshot(), /duplicate scope/);

    const earlier = legacyState("000660");
    await writeDocument(statePath, [state, earlier]);
    await assert.rejects(
      () => repository.readSnapshot(),
      /non-canonical ordering/
    );

    await writeDocument(statePath, [
      { ...state, detectedAt: "2026-09-02T00:00:00.000Z" }
    ]);
    await assert.rejects(
      () => repository.readSnapshot(),
      /hash does not match its payload/
    );
  });
});

test("position state repository leaves an abandoned lock fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const mandates = new InvestmentMandateFileRepository(baseDir);
    const paths = createPositionStrategyStatePaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PositionStrategyStateFileRepository(
      baseDir,
      mandates,
      { lockTimeoutMs: 20, lockRetryDelayMs: 500 }
    );

    const startedAt = Date.now();
    await assert.rejects(
      () => repository.readSnapshot(),
      /repository lock is unavailable/
    );
    assert.ok(Date.now() - startedAt < 250);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

async function storeActiveMandate(
  repository: InvestmentMandateFileRepository
): Promise<{
  record: InvestmentMandateRecord;
  activated: InvestmentMandateEvent;
}> {
  const record = mandateRecord();
  await repository.appendRecord(record);
  const activated = await repository.appendEvent(
    mandateEvent(record, {
      eventType: "activated",
      asOf: "2026-09-01T01:00:00.000Z",
      createdAt: "2026-09-01T01:00:00.000Z"
    })
  );
  return { record, activated };
}

function mandateRecord(): InvestmentMandateRecord {
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
    validFrom: "2026-09-01T00:30:00.000Z",
    expiresAt: "2026-10-01T00:30:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-event-1",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
}

function mandateEvent(
  record: InvestmentMandateRecord,
  transition:
    | {
        eventType: "activated";
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "review_required";
        previousMandateEventId: string;
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

function assignedState(
  record: InvestmentMandateRecord,
  activated: InvestmentMandateEvent
): AssignedPositionStrategyState {
  return createAssignedPositionStrategyState({
    stateKind: "assigned",
    portfolioId: record.portfolioId,
    market: record.market,
    symbol: record.symbol,
    mandateId: record.mandateId,
    mandateHash: record.mandateHash,
    lastMandateEventId: activated.mandateEventId,
    lastMandateEventHash: activated.mandateEventHash,
    policyHash: record.policyHash,
    openedAt: "2026-09-01T01:00:00.000Z",
    lastReviewedAt: "2026-09-01T01:00:00.000Z",
    lastReviewedTriggerRef: HASH_C,
    peakPriceKrw: 100,
    partialTakeProfitExecuted: false,
    thesisStatus: "intact"
  });
}

function updateAssignedState(
  state: AssignedPositionStrategyState,
  updates: Partial<Parameters<typeof createAssignedPositionStrategyState>[0]>
): AssignedPositionStrategyState {
  const { positionStrategyStateHash: _hash, ...payload } = state;
  return createAssignedPositionStrategyState({ ...payload, ...updates });
}

function legacyState(symbol: string): PositionStrategyState {
  return createUnassignedLegacyPositionStrategyState({
    stateKind: "unassigned_legacy",
    portfolioId: "portfolio-1",
    market: "KR",
    symbol,
    observedPositionRef: `position-${symbol}`,
    reasonCodes: ["missing_mandate", "missing_opened_at"],
    detectedAt: "2026-09-01T01:00:00.000Z",
    status: "review_required"
  });
}

function scope(state: PositionStrategyState): {
  portfolioId: string;
  market: PositionStrategyState["market"];
  symbol: string;
} {
  return {
    portfolioId: state.portfolioId,
    market: state.market,
    symbol: state.symbol
  };
}

async function writeDocument(
  path: string,
  states: readonly unknown[]
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({ schemaVersion: 1, states }, null, 2)}\n`,
    "utf8"
  );
}

async function withTemporaryDirectory(
  operation: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "position-strategy-state-"));
  try {
    await operation(baseDir);
  } finally {
    const mandateLock = createInvestmentMandatePaths(baseDir).lockPath;
    await rm(mandateLock, { force: true });
    await rm(baseDir, { recursive: true, force: true });
  }
}
