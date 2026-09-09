// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPlan } from "./portfolioActionRiskDecisionPlanResolver.js";
import { readStoredRiskDecisionPlanContext } from "./portfolioActionRiskDecisionPlanContext.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths, RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { HASH, planScope, planEvent, withPlanFixture, policyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("plan-bound risk decision preserves causal sources through restart and exact retries", async () => {
  for (const side of ["BUY", "SELL"] as const) await withPlanFixture(side, false, async ({ directory, repository, candidate, plan, events }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    const restarted = new PortfolioActionRiskDecisionFileRepository(directory);
    const results = await Promise.all([restarted.createAndAppendWithPlanOrigin(candidate), restarted.createAndAppendWithPlanOrigin(candidate)]);
    assert.deepEqual(results, [record, record]);
    assert.deepEqual(await restarted.append(record), record);
    assert.equal(await readFile(path, "utf8"), before);
    const resolved = await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId });
    assert.equal(resolved.plan.planId, plan.planId);
    assert.equal(resolved.priorState.status, "approved");
    assert.ok(Object.isFrozen(resolved.planOrigin));
    assert.ok(Date.parse(record.decidedAt) >= Date.parse(resolved.planOrigin.observedAt));
    assert.equal(JSON.parse(before.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v4");
    const prior = (await events.readAll()).at(-1)!;
    await events.append(planEvent(plan, "rejected", prior));
    // Historical explanation remains bound to the pre-decision prefix.
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).priorState.status, "approved");
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /approved unfinished/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId, predecessorEventId: prior.planEventId } as Parameters<typeof resolvePortfolioActionRiskDecisionPlan>[0]), /unrecognized_keys/);
  });
});


test("plan-bound risk rejects mismatched action, prior state, lineage and approved target caps before persistence", async () => {
  await withPlanFixture("BUY", false, async ({ repository, candidate }) => {
    for (const patch of [
      { actionId: "other" }, { expectedPortfolioVersion: "other" }, { expectedPortfolioSnapshotHash: hashCanonicalPayload({ other: true }) },
      { priorCumulativeFilledNotionalKrw: 1 }, { priorCumulativeFilledQuantity: 0.1 },
      { actionExecutionTargetHash: HASH }, { symbol: "KR:other" },
      { approvedMaximumFillNotionalKrw: 101 }, { requestedNotionalKrw: 101 },
      { riskRuleScope: { scopeKind: "legacy_reduce_only", legacyPolicyHash: HASH }, turnoverAssessment: { scopeKind: "legacy_reduce_only", countedInBucketTurnover: false } }
    ]) await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...candidate, ...patch } as typeof candidate));
    assert.deepEqual(await repository.readAll(), []);
  });
  await withPlanFixture("SELL", true, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).action.lineageKind, "unassigned_legacy_reduce_only");
  });
});


test("plan-bound quantity approvals reject requested notional above cap even when approved maxima fit", async () => {
  for (const { side, wholeShares } of [
    { side: "SELL", wholeShares: false }, { side: "SELL", wholeShares: true }, { side: "BUY", wholeShares: true }
  ] as const) await withPlanFixture(side, false, async ({ directory, repository, candidate }) => {
    const request = { ...candidate, requestedQuantity: wholeShares ? 1 : 0.3 };
    for (const requestedNotionalKrw of [101, 1000]) {
      await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...request, requestedNotionalKrw }), /remaining action notional cap/);
      assert.deepEqual(await repository.readAll(), []);
    }
    const record = await repository.createAndAppendWithPlanOrigin(request);
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).decision.requestedNotionalKrw, 100);
  }, wholeShares);
});


test("plan-bound risk derives fractional remaining quantities from stored partial fills", async () => {
  await withPlanFixture("SELL", false, async ({ directory, repository, candidate, plan, events }) => {
    const approval = (await events.readAll()).at(-1)!;
    await events.append(createRebalancePlanEvent({
      ...planScope(plan), asOf: new Date().toISOString(), eventType: "execution_applied", previousPlanEventId: approval.planEventId,
      actionId: "action-1", actionSequence: 0, fillSequence: 0, fillId: "fill-1", paperFillRecordId: "paper-1", paperFillHash: HASH,
      riskDecisionId: "prior-risk", requestedNotionalKrw: 10, requestedQuantity: 0.1, filledNotionalKrw: 10, filledQuantity: 0.1,
      cumulativeFilledNotionalKrw: 10, cumulativeFilledQuantity: 0.1, expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: HASH,
      resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 })
    }));
    const remaining = { ...candidate, expectedPortfolioVersion: "v2", expectedPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 }),
      priorCumulativeFilledNotionalKrw: 10, priorCumulativeFilledQuantity: 0.1, requestedQuantity: 0.2,
      requestedNotionalKrw: 20, worstCaseFillNotionalKrw: 20, approvedMaximumFillNotionalKrw: 20,
      cashAssessment: { side: "SELL" as const, expectedMinimumNetCashCreditKrw: 19 },
      turnoverAssessment: { scopeKind: "bucket" as const, turnoverStateId: "turnover-2", turnoverStateHash: HASH,
        turnoverWindowOpenPortfolioNetWorthKrw: 1000, priorBucketTurnoverNotionalKrw: 10, requestedBucketTurnoverNotionalKrw: 20, resultingBucketTurnoverRatio: 0.03 }
    };
    await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...remaining, requestedNotionalKrw: 91 }), /remaining action notional cap/);
    assert.deepEqual(await repository.readAll(), []);
    const record = await repository.createAndAppendWithPlanOrigin(remaining);
    const resolved = await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId });
    assert.equal(resolved.progress.cumulativeFilledQuantity, 0.1);
    await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...remaining, requestedQuantity: 0.20000000000000004 }), /remaining quantity/);
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /pre-state/);
  });
});


test("plan-bound risk cannot add a plan receipt to preexisting policy-only or raw decisions", async () => {
  for (const policyOnly of [true, false]) await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = policyOnly ? await repository.createAndAppendWithPolicyOrigin(candidate)
      : await repository.append(createPortfolioActionRiskDecision({ ...candidate, decidedAt: new Date().toISOString() }));
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /cannot be added or replaced|original activation history boundary/);
    await assert.rejects(repository.createAndAppendWithPlanOrigin(record), /cannot accept a record or timestamp/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId }), /before-creation provenance/);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(await repository.readAll(), [record]);
  });
});


test("plan-bound risk resolver rejects rehashed receipts and missing stored plan or events", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const patch of [{ planCommitHash: HASH }, { predecessorCommitHash: HASH }, { predecessorEventId: "missing" },
      { planHash: HASH }, { observedAt: new Date(Date.parse(record.decidedAt) + 1000).toISOString() }]) {
      const { entryHash: _oldHash, ...payload } = { ...entry, planOrigin: { ...entry.planOrigin, ...patch } };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input), /origin does not match|does not belong|corrupt line/);
    }
    await writeFile(path, raw);
    for (const source of [createRebalancePlanPaths(directory).recordsPath, createRebalancePlanEventPaths(directory).eventsPath]) {
      const content = await readFile(source, "utf8");
      await writeFile(source, "");
      await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input));
      await writeFile(source, content);
    }
  });
});


test("plan-bound risk waits for plan and event sync and preserves failures without a decision", async (context) => {
  for (const sourceKind of ["plan", "events"] as const) await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const path = sourceKind === "plan" ? createRebalancePlanPaths(directory).recordsPath : createRebalancePlanEventPaths(directory).eventsPath;
    const sourceStat = await stat(path, { bigint: true });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let failSync = true;
    let syncedAt = 0;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      if (own.isFile() && own.ino === sourceStat.ino && (process.platform === "win32" || own.dev === sourceStat.dev)) {
        if (failSync) throw new Error("injected plan source fsync failure");
        await new Promise((resolve) => setTimeout(resolve, 10));
        await originalSync.call(this); syncedAt = Date.now(); return;
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /injected plan source fsync failure/);
      assert.deepEqual(await repository.readAll(), []);
      failSync = false;
      const record = await repository.createAndAppendWithPlanOrigin(candidate);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), record.riskDecisionId);
      assert.ok(syncedAt > 0);
      assert.ok(Date.parse(origin.planOrigin!.observedAt) >= syncedAt);
      assert.ok(Date.parse(record.decidedAt) >= syncedAt);
    } finally { mock.mock.restore(); }
  });
});


test("plan-bound rejected decisions preserve an over-cap request for explanation", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin({ ...candidate, requestedNotionalKrw: 1000, decision: "rejected",
      ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).decision.decision, "rejected");
  });
});


test("plan-bound whole-share approvals reject fractional requests and completed actions", async () => {
  await withPlanFixture("BUY", false, async ({ repository, candidate, plan, events }) => {
    await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...candidate, requestedQuantity: 0.5 }), /whole-share quantity/);
    await repository.createAndAppendWithPlanOrigin(candidate);
    const approval = (await events.readAll()).at(-1)!;
    await events.append(createRebalancePlanEvent({ ...planScope(plan), asOf: new Date().toISOString(), eventType: "execution_applied", previousPlanEventId: approval.planEventId,
      actionId: "action-1", actionSequence: 0, fillSequence: 0, fillId: "fill-1", paperFillRecordId: "paper-1", paperFillHash: HASH, riskDecisionId: "prior-risk",
      requestedNotionalKrw: 100, requestedQuantity: 1, filledNotionalKrw: 100, filledQuantity: 1, cumulativeFilledNotionalKrw: 100, cumulativeFilledQuantity: 1,
      expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: HASH, resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 }) }));
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /next unfinished action/);
  }, true);
});


test("plan-bound creation observes retirement committed during the plan read before deciding", async (context) => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
    const mock = context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (this: RebalancePlanEventFileRepository) {
      const history = await original.call(this);
      await new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies).appendRetired({
        portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId, reasonCode: "retired_during_plan_read", createdAt: new Date().toISOString()
      });
      return history;
    });
    try {
      await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /active runtime portfolio policy is required/);
      assert.deepEqual(await repository.readAll(), []);
    } finally { mock.mock.restore(); }
  });
});


test("plan-bound historical resolution preserves its durable generation after a backdated retirement", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const before = await resolvePortfolioActionRiskDecisionPlan(input);
    const fixture = policyFixture();
    const store = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies);
    await store.appendRetired({ portfolioId: record.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "timestamp_captured_before_lock", createdAt: record.decidedAt });
    // Current policy sees the retirement, but it was not in the decision's durable generation.
    await assert.rejects(store.resolveActiveAsOf(record.portfolioId, record.decidedAt), /active runtime portfolio policy is required/);
    assert.deepEqual(await resolvePortfolioActionRiskDecisionPlan(input), before);
    await assert.rejects(new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithPlanOrigin(candidate), /active runtime portfolio policy is required/);
  });
});


test("plan-bound retries preserve the original generation and new decisions include future-effective events", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const before = await resolvePortfolioActionRiskDecisionPlan(input);
    const fixture = policyFixture();
    const store = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies);
    await store.appendRetired({ portfolioId: record.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "future_retirement", createdAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.deepEqual(await repository.createAndAppendWithPlanOrigin(candidate), record);
    assert.deepEqual(await resolvePortfolioActionRiskDecisionPlan(input), before);
    const next = await repository.createAndAppendWithPlanOrigin({ ...candidate, requestedNotionalKrw: 99 });
    const resolved = await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: next.riskDecisionId });
    assert.deepEqual(resolved.origin.policyOrigin!.activationHistory, { eventCount: 2, eventsHash: hashCanonicalPayload(await store.readAll()) });
    assert.equal(before.origin.policyOrigin!.activationHistory!.eventCount, 1);
  });
});


test("plan-bound retry rejects truncated or replaced activation generations despite the same active policy", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const store = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies);
    const path = createRuntimePortfolioPolicyActivationPaths(directory).eventsPath;
    const prefix = await readFile(path, "utf8");
    const retirement = { portfolioId: candidate.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "future_retirement", createdAt: new Date(Date.now() + 3_600_000).toISOString() };
    await store.appendRetired(retirement);
    const original = await readFile(path, "utf8");
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    const restarted = new PortfolioActionRiskDecisionFileRepository(directory);
    for (const replaced of [false, true]) {
      await writeFile(path, prefix);
      if (replaced) await store.appendRetired({ ...retirement, reasonCode: "replacement_retirement" });
      assert.equal((await store.resolveActiveAsOf(candidate.portfolioId, new Date().toISOString())).policy.policyHash, candidate.policyHash);
      await assert.rejects(restarted.createAndAppendWithPlanOrigin(candidate), /activation history boundary/);
      assert.equal(await readFile(riskPath, "utf8"), riskBytes);
    }
    await writeFile(path, original);
    assert.deepEqual(await restarted.createAndAppendWithPlanOrigin(candidate), record);
    assert.equal(await readFile(riskPath, "utf8"), riskBytes);
  });
});


test("plan-bound policy generation boundaries reject missing, altered and truncated evidence", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const activationHistory of [undefined, { ...entry.policyOrigin.activationHistory, eventCount: 0 },
      { ...entry.policyOrigin.activationHistory, eventCount: 2 }, { ...entry.policyOrigin.activationHistory, eventsHash: HASH }]) {
      const { entryHash: _oldHash, ...payload } = { ...entry, policyOrigin: { ...entry.policyOrigin, activationHistory } };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input), /history boundary|corrupt line/);
    }
    await writeFile(path, raw);
    const source = createRuntimePortfolioPolicyActivationPaths(directory).eventsPath;
    await writeFile(source, "");
    await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input), /history boundary/);
  });
});


test("plan-bound creation rechecks retirement after the initial activation snapshot unlocks", async (context) => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const original = RuntimePortfolioPolicyActivationFileRepository.prototype.readDurableGeneration;
    let retired = false;
    const mock = context.mock.method(RuntimePortfolioPolicyActivationFileRepository.prototype, "readDurableGeneration", async function (this: RuntimePortfolioPolicyActivationFileRepository) {
      const generation = await original.call(this);
      if (!retired) {
        retired = true;
        await this.appendRetired({ portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId,
          reasonCode: "retired_after_snapshot_unlock", createdAt: new Date().toISOString() });
      }
      return generation;
    });
    try {
      await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /active runtime portfolio policy is required/);
      assert.ok(retired);
      assert.deepEqual(await repository.readAll(), []);
    } finally { mock.mock.restore(); }
  });
});


test("plan-bound persistence holds the activation lock through Risk fsync and releases it on failure", async (context) => {
  for (const failSync of [false, true]) await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const activationStore = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies,
      { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const retire = () => activationStore.appendRetired({ portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "concurrent_retirement", createdAt: new Date().toISOString() });
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const probe = await open(join(directory, "sync-probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let checked = false;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const source = await stat(path, { bigint: true }).catch(() => undefined);
      if (!checked && source !== undefined && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        checked = true;
        await assert.rejects(retire(), /lock is unavailable/);
        if (failSync) throw new Error("injected Risk commit failure");
      }
      return originalSync.call(this);
    });
    try {
      if (failSync) await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /injected Risk commit failure/);
      else await repository.createAndAppendWithPlanOrigin(candidate);
      assert.ok(checked);
    } finally { mock.mock.restore(); }
    assert.equal((await retire()).eventType, "retired");
  });
});


test("risk plan observation retains the locked read time when a new event arrives before return", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withPlanFixture("BUY", false, async ({ directory, plan, events }) => {
      const ordinary = await events.readVerifiedHistory();
      assert.throws(() => resolveDurableRebalancePlanEventObservation(ordinary, plan.planId), /no durable observation/);
      const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
      const mock = context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (this: RebalancePlanEventFileRepository) {
        const history = await original.call(this);
        context.mock.timers.setTime(now + 10);
        await events.append(planEvent(plan, "rejected", history.events.at(-1)!));
        return history;
      });
      try {
        const result = await readStoredRiskDecisionPlanContext({ baseDir: directory, planId: plan.planId });
        assert.equal(result.state.status, "approved");
        assert.equal(result.origin.observedAt, new Date(now).toISOString());
        assert.equal((await events.readPlanState(plan.planId)).status, "rejected");
      } finally { mock.mock.restore(); }
    });
  } finally { context.mock.timers.reset(); }
});
