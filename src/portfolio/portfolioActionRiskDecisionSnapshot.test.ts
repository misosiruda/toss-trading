// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { type StrategyBucket } from "../domain/schemas.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionSnapshot } from "./portfolioActionRiskDecisionSnapshotResolver.js";
import { validateRiskDecisionCashCapacity } from "./portfolioActionRiskDecisionCashCapacity.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths, getDurablePortfolioSizingSnapshotObservation } from "./portfolioSizingSnapshotFiles.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { HASH, pendingCashFixture, snapshotFixture, withSnapshotFixture, planScope, decisionInput, policyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("snapshot-bound Risk replays actual valuation inputs for mandate BUY/SELL and legacy SELL", async () => {
  for (const [side, legacy] of [["BUY", false], ["SELL", false], ["SELL", true]] as const) {
    await withSnapshotFixture(side, legacy, async ({ directory, repository, candidate, snapshot }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
      assert.deepEqual(result.sizing.snapshot, snapshot);
      assert.equal(result.sizing.verifiedExposure.exposureSnapshot.cashKrw, 1_000);
      assert.equal(result.sizing.snapshot.virtualPortfolio.positions[0]!.quantity, 2);
      assert.equal(result.sizing.verifiedExposure.exposureSnapshot.marketExposureKrw.KR, 200);
      assert.equal(result.mandate === null, legacy);
      assert.ok(Date.parse(result.snapshotOrigin.observation.observedAt) <= Date.parse(decision.decidedAt));
      const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
      const raw = await readFile(path, "utf8");
      assert.equal(JSON.parse(raw.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v6");
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithSnapshotOrigin(candidate), decision);
      assert.equal(await readFile(path, "utf8"), raw);
    });
  }
});


test("snapshot-bound Risk rejects unavailable, wrong-scope and future pre-states without writes", async () => {
  for (const patch of [{ portfolioId: "other" }, { portfolioVersion: "v2" }, { policyHash: HASH }, { asOf: "2099-01-01T00:00:00.000Z" }]) {
    await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot scope or as-of mismatch/);
      assert.equal((await repository.readAll()).length, 0);
    }, patch);
  }
  await withSnapshotFixture("SELL", true, async ({ directory, repository, candidate }) => {
    await writeFile(createPortfolioSizingSnapshotPaths(directory).recordsPath, "");
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot source does not resolve/);
    assert.equal((await repository.readAll()).length, 0);
  });
});


test("snapshot-bound Risk blocks approved BUY with any unassigned holdings but preserves rejected explanations", async () => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate }) => {
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /without unassigned exposure/);
    assert.equal((await repository.readAll()).length, 0);
    const rejected = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, decision: "rejected",
      ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
    const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: rejected.riskDecisionId });
    assert.equal(result.decision.decision, "rejected");
    assert.equal(result.sizing.verifiedExposure.exposureSnapshot.unassignedExposureKrw, 200);
  }, { unassigned: true });
});


test("snapshot-bound creation freezes caller input before source acquisition and rejects injected record fields", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin({ ...candidate, [key]: undefined } as typeof candidate), /cannot accept a record or timestamp/);
    }
    const mutable = { ...candidate };
    const pending = repository.createAndAppendWithSnapshotOrigin(mutable);
    mutable.expectedPortfolioVersion = "mutated";
    mutable.planId = "mutated";
    const decision = await pending;
    assert.equal(decision.expectedPortfolioVersion, candidate.expectedPortfolioVersion);
    assert.equal(decision.planId, candidate.planId);
  });
});


test("snapshot-bound Risk preserves original prefixes after append and rejects source loss on replay or retry", async () => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate, snapshot }) => {
    const snapshots = new PortfolioSizingSnapshotFileRepository(directory);
    const extra = snapshotFixture(candidate, false, { portfolioVersion: "v2" });
    await snapshots.append(extra);
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    await snapshots.append(snapshotFixture(candidate, false, { portfolioVersion: "v3" }));
    assert.deepEqual(await repository.createAndAppendWithSnapshotOrigin(candidate), decision);
    assert.deepEqual((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).sizing.snapshot, snapshot);
    const path = createPortfolioSizingSnapshotPaths(directory).recordsPath;
    for (const records of [[snapshot], [snapshot, snapshotFixture(candidate, false, { portfolioVersion: "v2", asOf: "2026-09-02T00:00:00.000Z" })]]) {
      await writeFile(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /source prefix/);
      await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /source prefix/);
      assert.equal(await readFile(riskPath, "utf8"), riskBytes);
    }
    await writeFile(path, `${JSON.stringify(snapshot)}\n{corrupt}\n`);
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /corrupt line/);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /corrupt line/);
  });
});


test("snapshot-bound Risk resolves the resulting pre-state after a partial SELL instead of the preview snapshot", async () => {
  await withSnapshotFixture("SELL", false, async ({ directory, repository, candidate, plan, events, snapshot }) => {
    const resulting = snapshotFixture(candidate, false, { portfolioVersion: "v2", quantity: 0.2, cashKrw: 1_010 });
    await new PortfolioSizingSnapshotFileRepository(directory).append(resulting);
    const approval = (await events.readAll()).at(-1)!;
    await events.append(createRebalancePlanEvent({ ...planScope(plan), asOf: new Date().toISOString(), eventType: "execution_applied",
      previousPlanEventId: approval.planEventId, actionId: "action-1", actionSequence: 0, fillSequence: 0,
      fillId: "fill-1", paperFillRecordId: "paper-1", paperFillHash: HASH, riskDecisionId: "prior-risk",
      requestedNotionalKrw: 10, requestedQuantity: 0.1, filledNotionalKrw: 10, filledQuantity: 0.1,
      cumulativeFilledNotionalKrw: 10, cumulativeFilledQuantity: 0.1,
      expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: snapshot.portfolioSnapshotHash,
      resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: resulting.portfolioSnapshotHash }));
    const remaining = { ...candidate, expectedPortfolioVersion: "v2", expectedPortfolioSnapshotHash: resulting.portfolioSnapshotHash,
      priorCumulativeFilledNotionalKrw: 10, priorCumulativeFilledQuantity: 0.1, requestedQuantity: 0.2,
      requestedNotionalKrw: 20, worstCaseFillNotionalKrw: 20, approvedMaximumFillNotionalKrw: 20,
      cashAssessment: { side: "SELL" as const, expectedMinimumNetCashCreditKrw: 19 },
      turnoverAssessment: { scopeKind: "bucket" as const, turnoverStateId: "turnover-2", turnoverStateHash: HASH,
        turnoverWindowOpenPortfolioNetWorthKrw: 1_000, priorBucketTurnoverNotionalKrw: 10,
        requestedBucketTurnoverNotionalKrw: 20, resultingBucketTurnoverRatio: 0.03 } };
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /pre-state/);
    const decision = await repository.createAndAppendWithSnapshotOrigin(remaining);
    const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.deepEqual(result.sizing.snapshot, resulting);
    assert.equal(result.sizing.verifiedExposure.exposureSnapshot.cashKrw, 1_010);
    assert.equal(result.sizing.snapshot.virtualPortfolio.positions[0]!.quantity, 0.2);
  }, { quantity: 0.3 });
});


test("snapshot provenance cannot be synthesized on older Risk records or accepted with rehashed receipt mutations", async () => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const old = await repository.createAndAppendWithMandateOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot origin cannot be added/);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: old.riskDecisionId }), /lacks snapshot-before-creation/);
    assert.equal(await readFile(path, "utf8"), raw);
  });
  await withSnapshotFixture("SELL", true, async ({ directory, repository, candidate }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const receipt = entry.snapshotOrigin;
    for (const [snapshotOrigin, error] of [
      [{ ...receipt, portfolioSnapshotId: "other" }, /snapshot origin does not match/],
      [{ ...receipt, exposureSnapshotHash: HASH }, /snapshot origin does not match/],
      [{ ...receipt, portfolioSnapshotHash: HASH }, /corrupt line/],
      [{ ...receipt, observation: { ...receipt.observation, recordsHash: HASH } }, /source prefix/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: "2099-01-01T00:00:00.000Z" } }, /corrupt line/],
      [{ ...receipt, unexpected: true }, /corrupt line/]
    ] as const) {
      const { entryHash: _hash, ...payload } = { ...entry, snapshotOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), error);
    }
  });
});


test("snapshot-bound Risk fails closed on source fsync and holds the Snapshot lease through commit", async (context) => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const snapshots = new PortfolioSizingSnapshotFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const extra = snapshotFixture(candidate, false, { portfolioVersion: "v2" });
    const path = createPortfolioSizingSnapshotPaths(directory).recordsPath;
    const source = await stat(path, { bigint: true });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    let failSync = true;
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      if (failSync && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) throw new Error("injected snapshot fsync failure");
      return originalSync.call(this);
    });
    const writeMock = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].includes('"schemaVersion":"portfolio_action_risk_decision_commit.v1"')) {
        await assert.rejects(snapshots.append(extra), /lock is unavailable/);
        commitProbed = true;
      }
      return originalWrite.apply(this, args);
    });
    try {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot fsync failure/);
      assert.equal((await repository.readAll()).length, 0);
      failSync = false;
      await repository.createAndAppendWithSnapshotOrigin(candidate);
      assert.equal(commitProbed, true);
    } finally { writeMock.mock.restore(); syncMock.mock.restore(); }
    await snapshots.append(extra);
  });
});


test("snapshot cash capacity applies the larger absolute or target-ratio reserve before BUY approval", async () => {
  for (const [cashKrw, quantity, reserve, capacity, approved] of [
    [0, 2, 100, 0, false], [99, 2, 100, 0, false], [100, 2, 100, 0, false],
    [209, 2, 100, 109, false], [210, 2, 100, 110, true],
    [1_000, 50, 900, 100, false], [1_012, 50, 902, 110, true]
  ] as const) {
    await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
      if (!approved) {
        await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
        assert.deepEqual(await repository.readAll(), []);
        return;
      }
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      const resolved = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
      assert.deepEqual(resolved.cashCapacity, { cashKrw, requiredCashReserveKrw: reserve, pendingBuyExposureKrw: 0, maximumNetCashDebitKrw: capacity });
      assert.ok(Object.isFrozen(resolved.cashCapacity));
      const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
      const raw = await readFile(path, "utf8");
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithSnapshotOrigin(candidate), decision);
      assert.equal(await readFile(path, "utf8"), raw);
    }, { cashKrw, quantity });
  }
});


test("snapshot cash capacity bounds net debit including costs and the full approved cap", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    // Gross 100 fits, but the requested net approval cap 110 exceeds cash capacity 105.
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin({ ...candidate,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 106, approvedMaximumNetCashDebitKrw: 106 }
    }), /exceeds snapshot cash capacity/);
    const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 105, approvedMaximumNetCashDebitKrw: 105 }
    });
    assert.equal(decision.decision, "approved");
  }, { cashKrw: 205 });
});


test("snapshot cash capacity subtracts pending BUY and never credits pending SELL proceeds", async () => {
  for (const [side, pending, approved] of [["BUY", 20, true], ["BUY", 21, false], ["SELL", 200, true]] as const) {
    await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
      if (!approved) {
        await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
        assert.deepEqual(await repository.readAll(), []);
        return;
      }
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
      assert.equal(result.cashCapacity?.maximumNetCashDebitKrw, side === "BUY" ? 110 : 130);
    }, { cashKrw: 230, pendingActionInputs: [pendingCashFixture(side, pending)] });
  }
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
  }, { cashKrw: 209, pendingActionInputs: [pendingCashFixture("SELL", 200)] });
});


test("snapshot cash capacity preserves rejected BUY explanations and reduce-only SELL at zero cash", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, decision: "rejected",
      ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
    const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.equal(result.cashCapacity?.maximumNetCashDebitKrw, 0);
    assert.equal(result.decision.decision, "rejected");
  }, { cashKrw: 0 });
  for (const legacy of [false, true]) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      assert.equal((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).cashCapacity, null);
    }, { cashKrw: 0 });
  }
});


test("snapshot cash capacity rejects fractional or unsafe approved net amounts", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    for (const amount of [100.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin({ ...candidate,
        cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: amount, approvedMaximumNetCashDebitKrw: amount }
      }), /requires safe integer net cash amounts/);
      assert.deepEqual(await repository.readAll(), []);
    }
  });
});


test("snapshot cash capacity historical replay rejects fully rehashed over-cash approval without rewriting bytes", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _inputHash, ...payload } = decision;
    const altered = createPortfolioActionRiskDecision({ ...payload,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 100, approvedMaximumNetCashDebitKrw: 111 } });
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _entryHash, ...entryPayload } = entry;
    const entryHash = hashCanonicalPayload({ ...entryPayload, record: altered });
    const { commitHash: _commitHash, ...markerPayload } = marker;
    const updatedMarker = { ...markerPayload, entryHash };
    const raw = `${JSON.stringify({ ...entryPayload, record: altered, entryHash })}\n${JSON.stringify({ ...updatedMarker, commitHash: hashCanonicalPayload(updatedMarker) })}\n`;
    await writeFile(path, raw);
    assert.deepEqual(await repository.readAll(), [altered]);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: altered.riskDecisionId }), /exceeds snapshot cash capacity/);
    assert.equal(await readFile(path, "utf8"), raw);
  }, { cashKrw: 210 });
});


test("cash capacity independently replays source hashes and safely saturates large pending commitments", () => {
  const { policy } = policyFixture();
  const candidate = decisionInput(policyFixture(), "BUY");
  const snapshot = snapshotFixture(candidate, false, { cashKrw: 100, pendingActionInputs: [pendingCashFixture("BUY", Number.MAX_SAFE_INTEGER)] });
  const decision = createPortfolioActionRiskDecision({ ...candidate, expectedPortfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    decision: "rejected", ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
  assert.equal(validateRiskDecisionCashCapacity({ decision, snapshot, policy })?.maximumNetCashDebitKrw, 0);
  assert.throws(() => validateRiskDecisionCashCapacity({ decision, snapshot: { ...snapshot, portfolioSnapshotHash: HASH }, policy }), /identity|hash/);
  assert.throws(() => validateRiskDecisionCashCapacity({ decision, snapshot, policy: policyFixture("v2").policy }), /scope/);
});


test("snapshot SELL approval requires the exact owned quantity without an epsilon", async () => {
  for (const legacy of [false, true]) {
    for (const quantity of [0.2, 0.29999999999999993, 0.3]) {
      await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
        if (quantity < 0.3) {
          await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds owned snapshot quantity/);
          assert.deepEqual(await repository.readAll(), []);
          return;
        }
        const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
        const resolved = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
        assert.equal(resolved.sizing.snapshot.virtualPortfolio.positions[0]!.quantity, 0.3);
        const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
        const bytes = await readFile(path, "utf8");
        assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithSnapshotOrigin(candidate), decision);
        assert.equal(await readFile(path, "utf8"), bytes);
      }, { quantity });
    }
  }
});


test("snapshot SELL cannot borrow another bucket or legacy lot even when total symbol holdings cover the request", async () => {
  for (const [legacy, holdingLots] of [
    [false, [{ bucket: "swing", quantity: 0.2 }, { bucket: "long_term", quantity: 5 }, { quantity: 5 }]],
    [true, [{ bucket: "swing", quantity: 5 }, { quantity: 0.2 }]],
    [false, [{ bucket: "long_term", quantity: 5 }]],
    [false, [{ quantity: 5 }]],
    [true, [{ bucket: "swing", quantity: 5 }]],
    [false, []], [true, []]
  ] as Array<[boolean, Array<{ bucket?: StrategyBucket; quantity: number }> ]>) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate }) => {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds owned snapshot quantity/);
      assert.deepEqual(await repository.readAll(), []);
    }, { holdingLots });
  }
  for (const legacy of [false, true]) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      assert.equal((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).decision.decision, "approved");
    }, { holdingLots: [{ bucket: "long_term", quantity: 5 }, { bucket: "swing", quantity: 0.3 }, { quantity: 0.3 }] });
  }
});


test("snapshot SELL rejection remains inspectable when its owned lot is missing", async () => {
  for (const legacy of [false, true]) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, decision: "rejected",
        ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
      assert.equal((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).decision.decision, "rejected");
    }, { holdingLots: [] });
  }
});


test("snapshot SELL historical replay rejects a rehashed over-owned request", async () => {
  await withSnapshotFixture("SELL", false, async ({ repository, candidate, directory }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, requestedQuantity: 0.2 });
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _inputHash, ...payload } = decision;
    const altered = createPortfolioActionRiskDecision({ ...payload, requestedQuantity: 0.3 });
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _entryHash, ...entryPayload } = entry;
    const entryHash = hashCanonicalPayload({ ...entryPayload, record: altered });
    const { commitHash: _commitHash, ...markerPayload } = marker;
    const updatedMarker = { ...markerPayload, entryHash };
    const bytes = `${JSON.stringify({ ...entryPayload, record: altered, entryHash })}\n${JSON.stringify({ ...updatedMarker, commitHash: hashCanonicalPayload(updatedMarker) })}\n`;
    await writeFile(path, bytes);
    assert.deepEqual(await repository.readAll(), [altered]);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: altered.riskDecisionId }), /exceeds owned snapshot quantity/);
    assert.equal(await readFile(path, "utf8"), bytes);
  }, { quantity: 0.2 });
});
