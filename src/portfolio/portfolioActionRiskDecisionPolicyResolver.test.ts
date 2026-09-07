import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type StrategyBucket } from "../domain/schemas.js";

import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPolicy } from "./portfolioActionRiskDecisionPolicyResolver.js";
import { resolvePortfolioActionRiskDecisionPlan } from "./portfolioActionRiskDecisionPlanResolver.js";
import { resolvePortfolioActionRiskDecisionMandate } from "./portfolioActionRiskDecisionMandateResolver.js";
import { resolvePortfolioActionRiskDecisionSnapshot } from "./portfolioActionRiskDecisionSnapshotResolver.js";
import { validateRiskDecisionCashCapacity } from "./portfolioActionRiskDecisionCashCapacity.js";
import { pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createInvestmentMandateEvent, createInvestmentMandateRecord, type InvestmentMandateRecord } from "./investmentMandate.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { readStoredRiskDecisionPlanContext } from "./portfolioActionRiskDecisionPlanContext.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalancePlanRecord } from "./rebalancePlan.js";
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
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent } from "./runtimePortfolioPolicyActivation.js";

const CREATED_AT = "2026-09-01T00:00:00.000Z";
const DECIDED_AT = "2026-09-03T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
type DecisionInput = Parameters<typeof createPortfolioActionRiskDecision>[0];

test("risk policy resolver selects exact bucket rules and parameter lineage by side", async () => {
  for (const side of ["BUY", "SELL"] as const) {
    const fixture = policyFixture();
    await withDecision(fixture, decisionInput(fixture, side), async (input) => {
      const result = await resolvePortfolioActionRiskDecisionPolicy(input);
      assert.equal(result.activePolicy.policy.policyHash, fixture.policy.policyHash);
      assert.equal(result.bucketPolicy?.bucket, "swing");
      assert.deepEqual(result.applicableRules.map(({ rule }) => rule.ruleId), side === "BUY" ? ["cash", "exposure"] : ["exposure", "sell"]);
      for (const { rule, parameter } of result.applicableRules) {
        assert.equal(parameter.hash, rule.parameterRef.hash);
        assert.equal(parameter.lineageHash, rule.parameterRef.lineageHash);
      }
      assert.ok(Object.isFrozen(result.applicableRules));
      assert.ok(Object.isFrozen(result.decision));
    });
  }
});

test("risk policy resolver uses only the root legacy SELL rule set and full legacy policy hash", async () => {
  const fixture = policyFixture();
  const candidate = decisionInput(fixture, "SELL", true);
  await withDecision(fixture, candidate, async (input) => {
    const result = await resolvePortfolioActionRiskDecisionPolicy(input);
    assert.equal(result.bucketPolicy, null);
    assert.equal(result.riskRuleSet.hash, fixture.legacySet.hash);
    assert.deepEqual(result.applicableRules.map(({ rule }) => rule.ruleId), ["legacy"]);
  });
  await withDecision(fixture, { ...candidate, riskRuleScope: { scopeKind: "legacy_reduce_only", legacyPolicyHash: HASH } }, async (input) => {
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /legacy reduce-only policy mismatch/);
  });
});

test("risk policy resolver rejects a claimed rule set or policy that differs from activation", async () => {
  const fixture = policyFixture();
  for (const overrides of [
    { policyHash: HASH }, { riskRuleSetRecordId: "unrelated" },
    { riskRuleSetVersion: "other" }, { riskRuleSetHash: HASH },
    { market: "US" as const, symbol: "US:AAPL" },
    { riskRuleSetRecordId: fixture.legacySet.riskRuleSetRecordId, riskRuleSetVersion: fixture.legacySet.version, riskRuleSetHash: fixture.legacySet.hash }
  ]) {
    await withDecision(fixture, { ...decisionInput(fixture, "BUY"), ...overrides }, async (input) => {
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /mismatch/);
    });
  }
});

test("risk policy resolver independently derives required side rules rather than trusting self-consistent claims", async () => {
  const fixture = policyFixture();
  for (const requiredRuleIds of [["cash"], ["cash", "exposure", "extra"], ["exposure", "sell"]]) {
    await withDecision(fixture, {
      ...decisionInput(fixture, "BUY"), requiredRuleIds,
      ruleResults: requiredRuleIds.map((ruleId) => ({ ruleId, result: "pass", reasonCode: "fixture" }))
    }, async (input) => {
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /policy-selected side rules/);
    });
  }
});

test("risk policy resolver reloads complete stored activation history and rejects retired policy", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const repository = new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy], fixture.dependencies);
    assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).activePolicy.activation.activationId, fixture.activation.activationId);
    await repository.appendRetired({
      portfolioId: fixture.policy.portfolioId,
      retiredActivationId: fixture.activation.activationId, reasonCode: "fixture",
      createdAt: "2026-09-02T00:00:00.000Z"
    });
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /active runtime portfolio policy is required/);
    // Even a valid contiguous prefix cannot be substituted for the disk history.
    const truncated = { ...input, activationEvents: [fixture.activation], policies: [fixture.policy], dependencies: fixture.dependencies };
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(truncated), /unrecognized_keys/);
  });
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const stored = await new PortfolioActionRiskDecisionFileRepository(input.baseDir).resolveById(input.riskDecisionId);
    await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy], fixture.dependencies).appendRetired({
      portfolioId: fixture.policy.portfolioId,
      retiredActivationId: fixture.activation.activationId, reasonCode: "fixture",
      createdAt: new Date(Date.parse(stored.decidedAt) + 60_000).toISOString()
    });
    assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).activePolicy.activation.activationId, fixture.activation.activationId);
    const path = createRuntimePortfolioPolicyActivationPaths(input.baseDir).eventsPath;
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const event = JSON.parse(lines[0]!);
    await writeFile(path, `${JSON.stringify({ ...event, activationEventHash: HASH })}\n`, "utf8");
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /corrupt line/);
    await writeFile(path, "", "utf8");
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /active runtime portfolio policy is required/);
  });
});

test("risk policy resolver reloads a replacement activation before decision time", async () => {
  const fixture = policyFixture();
  const replacement = policyFixture("v2").policy;
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    await new RuntimePortfolioPolicyFileRepository(input.baseDir, fixture.dependencies).append(replacement);
    await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy, replacement], fixture.dependencies)
      .appendActivated({ policy: replacement, supersedesActivationId: fixture.activation.activationId, createdAt: "2026-09-02T00:00:00.000Z" });
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /policy origin does not match active policy/);
  });
});

test("risk policy resolver rejects fabricated histories and incomplete parameter dependencies", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const fabricated = { ...input, riskDecisionHistory: { records: [] } };
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(fabricated), /unrecognized_keys/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: "missing" }), /does not resolve exactly once/);
    await writeFile(createImmutablePolicyDependencyPaths(input.baseDir).riskParameters, "", "utf8");
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /corrupt line/);
  });
});

test("risk policy resolver can explain a rejected record without promoting it to approval", async () => {
  const fixture = policyFixture();
  const candidate = decisionInput(fixture, "BUY");
  await withDecision(fixture, { ...candidate, decision: "rejected", ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) }, async (input) => {
    assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).decision.decision, "rejected");
  });
});

test("risk policy binding cannot backfill an already-created or stored decision", async () => {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-backfill-"));
  try {
    const repository = new PortfolioActionRiskDecisionFileRepository(directory);
    const candidate = decisionInput(fixture, "BUY");
    const precreated = createPortfolioActionRiskDecision(candidate);
    const { decidedAt: _decidedAt, ...creationInput } = candidate;
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /active runtime portfolio policy is required/);
    assert.deepEqual(await repository.readAll(), []);
    await repository.append(precreated);
    // All activation timestamps predate the decision, but the bytes are appended later.
    await storePolicyFixture(directory, fixture);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ baseDir: directory, riskDecisionId: precreated.riskDecisionId }), /policy-before-creation provenance/);
    const before = await readFile(createPortfolioActionRiskDecisionPaths(directory).recordsPath, "utf8");
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(precreated), /cannot accept a record or timestamp/);
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(candidate), /cannot accept a record or timestamp/);
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /cannot be added or replaced/);
    assert.equal(await readFile(createPortfolioActionRiskDecisionPaths(directory).recordsPath, "utf8"), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("policy-bound risk origin survives restart and idempotent retries without timestamp rebinding", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(input.baseDir);
    const record = await repository.resolveById(input.riskDecisionId);
    const history = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, input.riskDecisionId);
    assert.ok(origin.policyOrigin);
    assert.equal(origin.policyOrigin.activationId, fixture.activation.activationId);
    assert.ok(Date.parse(origin.policyOrigin.observedAt) <= Date.parse(record.decidedAt));
    assert.ok(Object.isFrozen(origin.policyOrigin));
    const { decidedAt: _decidedAt, ...creationInput } = decisionInput(fixture, "BUY");
    const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
    const before = await readFile(path, "utf8");
    const results = await Promise.all([repository.createAndAppendWithPolicyOrigin(creationInput), repository.createAndAppendWithPolicyOrigin(creationInput)]);
    assert.deepEqual(results, [record, record]);
    assert.deepEqual(await repository.append(record), record);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), input.riskDecisionId), origin);
    assert.equal(JSON.parse(before.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v3");
  });
});

test("risk policy origin rejects tampered receipts and rehashed future observations", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    await writeFile(path, `${JSON.stringify({ ...entry, policyOrigin: { ...entry.policyOrigin, activationId: "other" } })}\n${JSON.stringify(marker)}\n`);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /corrupt line/);
    for (const [policyOrigin, error] of [
      [{ ...entry.policyOrigin, observedAt: new Date(Date.parse(entry.record.decidedAt) + 1).toISOString() }, /corrupt line/],
      [{ ...entry.policyOrigin, activationId: "other" }, /policy origin does not match/]
    ] as const) {
      const { entryHash: _entryHash, ...payload } = { ...entry, policyOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), error);
    }
  });
});

test("policy-bound risk creation waits for activation fsync and fails without a decision on sync error", async (context) => {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-sync-"));
  try {
    await storePolicyFixture(directory, fixture);
    const eventPath = createRuntimePortfolioPolicyActivationPaths(directory).eventsPath;
    const eventStat = await stat(eventPath);
    const probe = await open(eventPath, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let syncedAt: number | null = null;
    let failSync = true;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const metadata = await this.stat();
      if (metadata.isFile() && metadata.ino === eventStat.ino &&
        (process.platform === "win32" || metadata.dev === eventStat.dev)) {
        if (failSync) throw new Error("injected activation fsync failure");
        await new Promise((resolve) => setTimeout(resolve, 20));
        await originalSync.call(this);
        syncedAt = Date.now();
        return;
      }
      return originalSync.call(this);
    });
    try {
      const repository = new PortfolioActionRiskDecisionFileRepository(directory);
      const { decidedAt: _decidedAt, ...creationInput } = decisionInput(fixture, "BUY");
      await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /injected activation fsync failure/);
      assert.deepEqual(await repository.readAll(), []);
      failSync = false;
      const record = await repository.createAndAppendWithPolicyOrigin(creationInput);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), record.riskDecisionId);
      assert.ok(syncedAt !== null);
      assert.ok(Date.parse(origin.policyOrigin!.observedAt) >= syncedAt);
      assert.ok(Date.parse(record.decidedAt) >= syncedAt);
    } finally { mock.mock.restore(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
    const sourceStat = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let failSync = true;
    let syncedAt = 0;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
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
      const own = await this.stat();
      const source = await stat(path).catch(() => undefined);
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

test("mandate-bound risk factory persists exact source and restart resolver verifies both sides", async () => {
  for (const side of ["BUY", "SELL"] as const) await withMandateFixture(side, async ({ directory, repository, candidate, mandate }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const resolved = await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.equal(resolved.mandate.record.mandateId, mandate.mandateId);
    assert.equal(resolved.mandateOrigin.mandateHash, mandate.mandateHash);
    assert.equal(resolved.mandateOrigin.observation.recordCount, 1);
    assert.equal(resolved.mandateOrigin.observation.eventCount, 1);
    assert.ok(Date.parse(decision.decidedAt) >= Date.parse(resolved.mandateOrigin.observation.observedAt));
    assert.ok(Object.isFrozen(resolved.mandateOrigin.observation));
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    assert.equal(JSON.parse(before.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v5");
    assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithMandateOrigin(candidate), decision);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("mandate-bound risk rejects missing source, legacy actions and receipt upgrades", async () => {
  for (const legacy of [false, true]) await withPlanFixture(legacy ? "SELL" : "BUY", legacy, async ({ repository, candidate }) => {
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate|requires a mandate action/);
    assert.equal((await repository.readAll()).length, 0);
  });
  await withMandateFixture("BUY", async ({ directory, repository, candidate }) => {
    const old = await repository.createAndAppendWithPlanOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    await assert.rejects(() => resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: old.riskDecisionId }), /lacks mandate-before-creation/);
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /cannot be added or replaced/);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("mandate-bound risk rejects scope and validity mismatches without persisting", async () => {
  for (const overrides of [
    { bucket: "long_term" as const }, { portfolioId: "other-portfolio" }, { market: "US" as const, symbol: "US:TEST" },
    { symbol: "KR:000660" }, { policyHash: HASH }, { validFrom: "2099-01-01T00:00:00.000Z", reviewAfter: "2099-02-01T00:00:00.000Z" },
    { expiresAt: DECIDED_AT, reviewAfter: "2026-09-02T00:00:00.000Z" }
  ]) await withMandateFixture("BUY", async ({ repository, candidate }) => {
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate|mandate bucket/);
    assert.equal((await repository.readAll()).length, 0);
  }, { overrides });
});

test("mandate risk approval obeys lifecycle and manual reduce-only authority", async () => {
  for (const state of ["proposed", "retired", "review_required"] as const) {
    await withMandateFixture("BUY", async ({ repository, candidate }) => {
      await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate|active open-or-increase/);
      assert.equal((await repository.readAll()).length, 0);
    }, { state });
  }
  await withMandateFixture("BUY", async ({ repository, candidate }) => {
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active open-or-increase/);
    assert.equal((await repository.readAll()).length, 0);
  }, { reduceOnly: true });
  await withMandateFixture("SELL", async ({ directory, repository, candidate }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    assert.equal((await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).mandate.status, "review_required");
  }, { state: "review_required", reduceOnly: true });
});

test("mandate historical receipt survives later backdated retirement but new creation fails", async () => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate, mandate, mandates }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const activation = (await mandates.readSnapshot()).events[0]!;
    await mandates.appendEvent(mandateTransition(mandate, "retired", activation.mandateEventId));
    const result = await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.equal(result.mandate.status, "active");
    assert.equal(result.mandateOrigin.observation.eventCount, 1);
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate/);
    assert.equal((await repository.readAll()).length, 1);
  });
});

test("mandate retry preserves original generation and rejects lost or replaced observed suffix", async () => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate, mandate, mandates }) => {
    const activation = (await mandates.readSnapshot()).events[0]!;
    const { mandateEventId: _id, mandateEventHash: _hash, ...retiredPayload } = mandateTransition(mandate, "retired", activation.mandateEventId);
    const futurePayload = { ...retiredPayload, asOf: "2099-01-01T00:00:00.000Z", createdAt: "2099-01-01T00:00:00.000Z" };
    const canonicalFuture = createInvestmentMandateEvent(futurePayload);
    await mandates.appendEvent(canonicalFuture);
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(riskPath, "utf8");
    const extra = createInvestmentMandateRecord({ ...mandatePayload(candidate), symbol: "KR:000660" });
    await mandates.appendRecord(extra);
    assert.deepEqual(await repository.createAndAppendWithMandateOrigin(candidate), decision);
    assert.equal(await readFile(riskPath, "utf8"), before);
    const eventsPath = createInvestmentMandatePaths(directory).eventsPath;
    const original = await readFile(eventsPath, "utf8");
    for (const replacement of ["", `${JSON.stringify(createInvestmentMandateEvent({ ...futurePayload, reasonCodes: ["changed"] }))}\n`]) {
      await writeFile(eventsPath, `${JSON.stringify(activation)}\n${replacement}`, "utf8");
      await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /source prefixes/);
      await assert.rejects(() => resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /source prefixes/);
      assert.equal(await readFile(riskPath, "utf8"), before);
    }
    await writeFile(eventsPath, original, "utf8");
  });
});

test("mandate-bound creation waits for both source syncs and holds source lock through Risk commit", async (context) => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate, mandate, mandates }) => {
    const paths = createInvestmentMandatePaths(directory);
    const metadata = await Promise.all([stat(paths.recordsPath), stat(paths.eventsPath)]);
    const probe = await open(paths.recordsPath, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    const activation = (await mandates.readSnapshot()).events[0]!;
    const retirement = mandateTransition(mandate, "retired", activation.mandateEventId);
    let failingIndex = 0;
    const synced = new Map<number, number>();
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      const sourceIndex = metadata.findIndex((source) => own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev));
      if (sourceIndex >= 0) {
        if (failingIndex === sourceIndex) throw new Error("injected mandate fsync failure");
        await originalSync.call(this);
        synced.set(sourceIndex, Date.now());
        return;
      }
      return originalSync.call(this);
    });
    const writeMock = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].includes('"schemaVersion":"portfolio_action_risk_decision_commit.v1"')) {
        await assert.rejects(new InvestmentMandateFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).appendEvent(retirement), /lock is unavailable/);
        commitProbed = true;
      }
      return originalWrite.apply(this, args);
    });
    try {
      for (failingIndex of [0, 1]) {
        await assert.rejects(repository.createAndAppendWithMandateOrigin(candidate), /injected mandate fsync failure/);
        assert.equal((await repository.readAll()).length, 0);
      }
      failingIndex = -1;
      const decision = await repository.createAndAppendWithMandateOrigin(candidate);
      assert.equal(commitProbed, true);
      assert.equal(synced.size, 2);
      for (const at of synced.values()) assert.ok(Date.parse(decision.decidedAt) >= at);
      await mandates.appendEvent(retirement);
    } finally { writeMock.mock.restore(); syncMock.mock.restore(); }
  });
});

test("mandate receipts reject rehashed identity, prefix, future time and unknown field mutations", async () => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    const receipt = entry.mandateOrigin;
    for (const [mandateOrigin, error] of [
      [{ ...receipt, mandateId: "other" }, /mandate origin does not match/],
      [{ ...receipt, mandateEventHash: HASH }, /mandate origin does not match/],
      [{ ...receipt, observation: { ...receipt.observation, eventsHash: HASH } }, /source prefixes/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: "2099-01-01T00:00:00.000Z" } }, /corrupt line/],
      [{ ...receipt, unexpected: true }, /corrupt line/]
    ] as const) {
      const { entryHash: _hash, ...payload } = { ...entry, mandateOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), error);
    }
  });
});

test("mandate validity expiry is exclusive and rejected BUY can explain review-required state", async (context) => {
  const expiresAt = "2026-09-10T00:00:00.000Z";
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse(expiresAt) });
  try {
    await withMandateFixture("SELL", async ({ repository, candidate }) => {
      await assert.rejects(repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate/);
      assert.equal((await repository.readAll()).length, 0);
    }, { overrides: { expiresAt } });
    await withMandateFixture("BUY", async ({ directory, repository, candidate }) => {
      const decision = await repository.createAndAppendWithMandateOrigin({ ...candidate, decision: "rejected",
        ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
      assert.equal((await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).mandate.status, "review_required");
    }, { state: "review_required" });
  } finally { context.mock.timers.reset(); }
});

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
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    let failSync = true;
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
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

function pendingCashFixture(side: "BUY" | "SELL", remainingNotionalKrw: number): PendingPortfolioActionInput {
  const common = { planId: "pending-plan", planHash: HASH, planEventId: "pending-event", planEventHash: HASH,
    actionId: "action-1", actionExecutionTargetHash: HASH, market: "KR" as const, symbol: "KR:005930", remainingNotionalKrw, asOf: CREATED_AT };
  return side === "BUY" ? { ...common, side, openingCapacityReservationId: "pending-reservation", openingCapacityReservationHash: HASH }
    : { ...common, side, remainingQuantity: 2, priceEvidenceRef: "snapshot-price" };
}

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

function snapshotFixture(candidate: Omit<DecisionInput, "decidedAt">, legacy: boolean,
  overrides: Partial<{ portfolioId: string; portfolioVersion: string; policyHash: string; asOf: string; unassigned: boolean; quantity: number; cashKrw: number; pendingActionInputs: PendingPortfolioActionInput[]; holdingLots: Array<{ bucket?: StrategyBucket; quantity: number }> }> = {}) {
  const portfolioId = overrides.portfolioId ?? candidate.portfolioId;
  const { unassigned = legacy, quantity = 2, cashKrw = 1_000, pendingActionInputs = [], holdingLots, ...scopeOverrides } = overrides;
  const lots = holdingLots ?? [{ quantity, ...(unassigned ? {} : { bucket: "swing" as const }) }];
  const bucketExposureKrw = { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 };
  let positionValue = 0;
  let unassignedExposureKrw = 0;
  for (const lot of lots) {
    const value = Math.round(lot.quantity * 100);
    positionValue += value;
    if (lot.bucket === undefined) unassignedExposureKrw += value;
    else bucketExposureKrw[lot.bucket] += value;
  }
  return createPortfolioSizingSnapshot({
    portfolioId, portfolioVersion: "v1", policyHash: candidate.policyHash, asOf: CREATED_AT, ...scopeOverrides,
    virtualPortfolio: { portfolioId, cashKrw, updatedAt: CREATED_AT,
      positions: lots.map((lot) => ({ market: candidate.market, symbol: candidate.symbol, quantity: lot.quantity, averagePriceKrw: 100,
        ...(lot.bucket === undefined ? {} : { strategyBucket: lot.bucket }), sector: "Electronics", region: "KR", updatedAt: CREATED_AT })) },
    valuationInputs: lots.length === 0 ? [] : [{ kind: "mark_price", market: candidate.market, symbol: candidate.symbol, priceKrw: 100,
      evidenceRef: "snapshot-price", evidenceAsOf: CREATED_AT }], pendingActionInputs,
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw + positionValue, cashKrw,
      bucketExposureKrw,
      symbolExposureKrw: lots.length === 0 ? [] : [{ market: candidate.market, symbol: candidate.symbol, exposureKrw: positionValue }],
      ...(unassignedExposureKrw === 0 ? {} : { unassignedExposureKrw }),
      marketExposureKrw: { KR: positionValue, US: 0 }, sectorExposureKrw: positionValue === 0 ? {} : { Electronics: positionValue },
      countryExposureKrw: positionValue === 0 ? {} : { KR: positionValue }, currencyExposureKrw: positionValue === 0 ? {} : { KRW: positionValue },
      ...pendingActionExposureTotals(pendingActionInputs) })
  });
}

async function withSnapshotFixture(side: "BUY" | "SELL", legacy: boolean,
  run: (input: Parameters<Parameters<typeof withPlanFixture>[2]>[0] & { snapshot: ReturnType<typeof snapshotFixture> }) => Promise<void>,
  overrides: Parameters<typeof snapshotFixture>[2] = {}) {
  let snapshot: ReturnType<typeof snapshotFixture>;
  await withPlanFixture(side, legacy, async (input) => run({ ...input, snapshot }), false,
    legacy ? undefined : async (directory, candidate) => {
      const mandate = createInvestmentMandateRecord(mandatePayload(candidate));
      const store = new InvestmentMandateFileRepository(directory);
      await store.appendRecord(mandate);
      const { eventType: _type, previousMandateEventId: _previous, mandateEventId: _id, mandateEventHash: _hash, ...scope } = mandateTransition(mandate, "retired", "placeholder");
      await store.appendEvent(createInvestmentMandateEvent({ ...scope, eventType: "activated" }));
      return mandate.mandateId;
    }, async (directory, candidate) => {
      snapshot = snapshotFixture(candidate, legacy, overrides);
      await new PortfolioSizingSnapshotFileRepository(directory).append(snapshot);
      return snapshot.portfolioSnapshotHash;
    });
}

function mandatePayload(candidate: Omit<DecisionInput, "decidedAt">) {
  return { portfolioId: candidate.portfolioId, policyHash: candidate.policyHash, market: candidate.market, symbol: candidate.symbol,
    bucket: "swing" as const, asOf: CREATED_AT, createdAt: CREATED_AT, targetWeightRatio: 0.1, minWeightRatio: 0.05, maxWeightRatio: 0.2,
    maximumOpeningNotionalKrw: 100, reasonCodes: ["fixture"], evidenceRefs: ["fixture"], evidenceAsOf: CREATED_AT,
    reviewCadence: { mode: "scheduled" as const, boundaryRefs: [scheduleBoundaryRefFor(policyFixture().records.scheduleBoundaries[0]!)] },
    validFrom: CREATED_AT, reviewAfter: "2099-01-01T00:00:00.000Z",
    assignmentSource: "manual_policy" as const, manualAuthorizationScope: "open_or_increase" as const, manualAssignmentEventId: "manual-1",
    capacityReservation: { manualCapacityReservationId: "reservation-1", manualCapacityReservationHash: HASH, reservedMaximumNotionalKrw: 100, reservationKind: "new_position" as const, reservedSlotOrdinal: 0 }
  };
}

function mandateTransition(mandate: InvestmentMandateRecord, eventType: "review_required" | "retired", previousMandateEventId: string) {
  return createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
    portfolioId: mandate.portfolioId, policyHash: mandate.policyHash, market: mandate.market, symbol: mandate.symbol, bucket: mandate.bucket,
    eventType, previousMandateEventId, asOf: CREATED_AT, createdAt: CREATED_AT, reasonCodes: ["fixture"] });
}

async function withMandateFixture(side: "BUY" | "SELL", run: (input: Parameters<Parameters<typeof withPlanFixture>[2]>[0] & {
  mandate: InvestmentMandateRecord; mandates: InvestmentMandateFileRepository
}) => Promise<void>, options: { reduceOnly?: boolean; state?: "proposed" | "retired" | "review_required";
  overrides?: Partial<Pick<InvestmentMandateRecord, "bucket" | "portfolioId" | "market" | "symbol" | "policyHash" | "validFrom" | "reviewAfter" | "expiresAt">> } = {}) {
  let mandate: InvestmentMandateRecord;
  let mandates: InvestmentMandateFileRepository;
  await withPlanFixture(side, false, async (input) => run({ ...input, mandate, mandates }), false, async (directory, candidate) => {
    const { capacityReservation, ...payload } = mandatePayload(candidate);
    mandate = createInvestmentMandateRecord({ ...payload, ...options.overrides, ...(options.reduceOnly
      ? { manualAuthorizationScope: "classify_existing_reduce_only" as const, maximumOpeningNotionalKrw: 0 }
      : { capacityReservation }) });
    mandates = new InvestmentMandateFileRepository(directory);
    await mandates.appendRecord(mandate);
    if (options.state !== "proposed") {
      const { eventType: _type, previousMandateEventId: _previous, ...activationPayload } = mandateTransition(mandate, "retired", "placeholder");
      const { mandateEventId: _id, mandateEventHash: _hash, ...scope } = activationPayload;
      const activation = createInvestmentMandateEvent({ ...scope, eventType: "activated", asOf: mandate.validFrom, createdAt: mandate.validFrom });
      await mandates.appendEvent(activation);
      if (options.state !== undefined) await mandates.appendEvent(mandateTransition(mandate, options.state, activation.mandateEventId));
    }
    return mandate.mandateId;
  });
}

function planScope(plan: RebalancePlanRecord) {
  return { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash };
}
function planEvent(plan: RebalancePlanRecord, kind: "previewed" | "approved" | "rejected", previous?: RebalancePlanEvent) {
  const common = { ...planScope(plan), asOf: new Date().toISOString() };
  return kind === "previewed" ? createRebalancePlanEvent({ ...common, eventType: kind })
    : createRebalancePlanEvent({ ...common, eventType: kind, previousPlanEventId: previous!.planEventId, reasonCodes: ["fixture"] });
}
async function withPlanFixture(side: "BUY" | "SELL", legacy: boolean, run: (input: {
  directory: string; repository: PortfolioActionRiskDecisionFileRepository; plan: RebalancePlanRecord;
  events: RebalancePlanEventFileRepository; candidate: Omit<DecisionInput, "decidedAt">;
}) => Promise<void>, wholeShares = false, setupMandate?: (directory: string, candidate: Omit<DecisionInput, "decidedAt">) => Promise<string>,
setupSnapshot?: (directory: string, candidate: Omit<DecisionInput, "decidedAt">) => Promise<string>) {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-plan-"));
  try {
    await storePolicyFixture(directory, fixture);
    const { decidedAt: _time, ...original } = decisionInput(fixture, side, legacy);
    if (setupSnapshot !== undefined) original.expectedPortfolioSnapshotHash = await setupSnapshot(directory, original);
    const mandateId = await setupMandate?.(directory, original) ?? "mandate-1";
    const target = wholeShares ? { targetKind: "whole_share_quantity" as const, targetQuantity: 1, referencePriceKrw: 100, plannedNotionalKrw: 100, residualNotionalKrw: 0, priceEvidenceRef: "price-1" }
      : side === "BUY" ? { targetKind: "fractional_buy_notional" as const, targetNotionalKrw: 100 }
      : { targetKind: "fractional_sell_quantity" as const, targetQuantity: 0.3, referencePriceKrw: 100, markedTargetNotionalKrw: 30, priceEvidenceRef: "price-1" };
    const plan = createRebalancePlanRecord({ cycleId: "cycle-1", portfolioId: original.portfolioId, portfolioVersion: "v1", portfolioSnapshotHash: original.expectedPortfolioSnapshotHash,
      policyHash: fixture.policy.policyHash, evidenceCutoffAt: CREATED_AT, createdAt: CREATED_AT, triggerRef: "trigger-1", phase: side === "BUY" ? "buy" : "sell",
      actions: [{ actionId: "action-1", actionSequence: 0, market: "KR", symbol: original.symbol, maximumNotionalKrw: 100, reasonCodes: ["fixture"], executionTarget: target,
        ...(legacy ? { lineageKind: "unassigned_legacy_reduce_only" as const, side: "SELL" as const, observedPositionRef: "legacy-1", legacyStateDetectedAt: CREATED_AT }
          : { lineageKind: "mandate" as const, side, mandateId }) }] });
    const plans = new RebalancePlanFileRepository(directory);
    await plans.append(plan);
    const events = new RebalancePlanEventFileRepository(directory, plans);
    const preview = await events.append(planEvent(plan, "previewed"));
    await events.append(planEvent(plan, "approved", preview));
    const candidate = { ...original, planId: plan.planId, actionExecutionTargetHash: hashRebalanceExecutionTarget(target),
      requestedQuantity: side === "BUY" ? 1 : 0.3, approvedMaximumFillNotionalKrw: 100 };
    await run({ directory, repository: new PortfolioActionRiskDecisionFileRepository(directory), plan, events, candidate });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function withDecision(
  fixture: ReturnType<typeof policyFixture>, candidate: DecisionInput,
  run: (input: Parameters<typeof resolvePortfolioActionRiskDecisionPolicy>[0]) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-"));
  try {
    await storePolicyFixture(directory, fixture);
    const repository = new PortfolioActionRiskDecisionFileRepository(directory);
    const { decidedAt: _decidedAt, ...creationInput } = candidate;
    const decision = await repository.createAndAppendWithPolicyOrigin(creationInput);
    await run({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function storePolicyFixture(directory: string, fixture: ReturnType<typeof policyFixture>) {
  const paths = createImmutablePolicyDependencyPaths(directory);
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    await writeFile(paths[key], `${fixture.records[key].map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  await new RuntimePortfolioPolicyFileRepository(directory, fixture.dependencies).append(fixture.policy);
  await new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies)
    .appendActivated({ policy: fixture.policy, createdAt: CREATED_AT });
}

function decisionInput(fixture: ReturnType<typeof policyFixture>, side: "BUY" | "SELL", legacy = false): DecisionInput {
  const set = legacy ? fixture.legacySet : fixture.bucketSet;
  const requiredRuleIds = set.rules.filter((rule) => rule.appliesTo.includes(side)).map((rule) => rule.ruleId);
  return {
    riskRuleSetRecordId: set.riskRuleSetRecordId, riskRuleSetVersion: set.version, riskRuleSetHash: set.hash,
    planId: "plan-1", actionId: "action-1", portfolioId: fixture.policy.portfolioId, policyHash: fixture.policy.policyHash,
    expectedPortfolioVersion: "v1", expectedPortfolioSnapshotHash: HASH,
    market: "KR", symbol: "KR:005930", side,
    riskRuleScope: legacy ? { scopeKind: "legacy_reduce_only", legacyPolicyHash: hashCanonicalPayload(fixture.policy.legacyReduceOnlyPolicy) } : { scopeKind: "bucket", bucket: "swing" },
    actionExecutionTargetHash: HASH,
    turnoverAssessment: legacy ? { scopeKind: "legacy_reduce_only", countedInBucketTurnover: false } : {
      scopeKind: "bucket", turnoverStateId: "turnover-1", turnoverStateHash: HASH,
      turnoverWindowOpenPortfolioNetWorthKrw: 1_000, priorBucketTurnoverNotionalKrw: 0,
      requestedBucketTurnoverNotionalKrw: 100, resultingBucketTurnoverRatio: 0.1
    },
    priorCumulativeFilledNotionalKrw: 0, priorCumulativeFilledQuantity: 0,
    requestedNotionalKrw: 100, requestedQuantity: 1, worstCaseFillNotionalKrw: 100, approvedMaximumFillNotionalKrw: 110,
    cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: 100, approvedMaximumNetCashDebitKrw: 110 } : { side, expectedMinimumNetCashCreditKrw: 90 },
    decision: "approved", requiredRuleIds,
    ruleResults: requiredRuleIds.map((ruleId) => ({ ruleId, result: "pass", reasonCode: "fixture" })),
    riskEvidenceRefs: ["fixture-evidence"], decidedAt: DECIDED_AT
  };
}

function policyFixture(version = "v1") {
  const buckets = ["long_term", "swing", "short_term", "intraday", "hedge"] as const;
  const parameters = ["cash", "exposure", "sell", "legacy"].map((ruleId) => createPortfolioRiskRuleParameterRecord({
    ruleId, ruleVersion: "v1", version: "v1", parameters: { fixtureLimit: 1 }, createdAt: CREATED_AT
  }));
  const rule = (index: number, appliesTo: Array<"BUY" | "SELL">) => ({
    ruleId: parameters[index]!.ruleId, ruleVersion: "v1", appliesTo, parameterRef: riskRuleParameterRefFor(parameters[index]!)
  });
  const bucketSet = createPortfolioRiskRuleSetRecord({ version: "bucket.v1", rules: [rule(0, ["BUY"]), rule(1, ["BUY", "SELL"]), rule(2, ["SELL"])], createdAt: CREATED_AT });
  // The shared rule-set contract covers both sides; legacy scope only uses SELL.
  const legacySet = createPortfolioRiskRuleSetRecord({ version: "legacy.v1", rules: [rule(0, ["BUY"]), rule(3, ["SELL"])], createdAt: CREATED_AT });
  const selections = buckets.map((bucket) => createBucketSelectionPolicyRecord({
    bucket, version: "v1", requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "fixture", maximumAgeSeconds: 60 }],
    everyTickSourceRequirement: { sourceContractId: "fixture", eventType: "verified_market_packet", maximumAgeSeconds: 60, dedupeKey: "packet_hash" },
    hardGateRuleIds: ["fixture"], scoringModelVersion: "v1", featureDefinitionRefs: ["fixture"], createdAt: CREATED_AT
  }));
  const drawdown = createBucketDrawdownSemanticsRecord({
    version: "v1", equityBasis: "bucket_assets_plus_cash", unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only", highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark", emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches", createdAt: CREATED_AT
  });
  const calendar = createSessionCalendarRecord({
    market: "KR", version: "v1", timeZone: "Asia/Seoul", validFromExchangeDate: "2026-09-01", validThroughExchangeDate: "2026-09-01",
    sessions: [{ exchangeDate: "2026-09-01", sessionKind: "regular", opensAt: "2026-09-01T09:00:00+09:00", closesAt: "2026-09-01T15:30:00+09:00", sourceEvidenceRefs: ["fixture"] }],
    createdAt: CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR", version: "v1", timeZone: "Asia/Seoul", sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version, sessionCalendarHash: calendar.hash, sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily", anchorLocalTime: "15:30:00", nonSessionDayRule: "previous_session", createdAt: CREATED_AT
  });
  const records: ImmutablePolicyDependencyRecords = { selectionPolicies: selections, riskParameters: parameters, riskRuleSets: [bucketSet, legacySet],
    drawdownSemantics: [drawdown], sessionCalendars: [calendar], scheduleBoundaries: [boundary] };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const targets = [0.35, 0.2, 0.15, 0.1, 0.05];
  const payload = {
    mode: "paper_only", recordType: "runtime_portfolio_policy_record", portfolioId: "paper-main",
    sourcePolicyRecordId: "fixture-source", sourcePolicyRecordHash: HASH, sourcePolicyHash: "b".repeat(64),
    policyId: "fixture", version, name: "Fixture policy",
    strategyBuckets: buckets.map((bucket, index) => ({
      bucket, targetWeightRatio: targets[index]!, minWeightRatio: 0, maxWeightRatio: 0.5, maxTurnoverRatio: 0.5, maxDrawdownRatio: 0.1,
      turnoverWindow: { mode: "fixed_utc", durationSeconds: 86_400, anchor: "unix_epoch", denominator: "window_open_portfolio_net_worth_krw" },
      drawdownSemanticsRef: drawdownSemanticsRefFor(drawdown),
      reviewCadence: bucket === "intraday" ? { mode: "every_tick" } : { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(boundary)] }, eventTriggers: [],
      selectionTrigger: { mode: "entry_floor_on_due_cycle", entryWeightRatio: 0.02 },
      exitPolicy: { takeProfit: { mode: "disabled" }, timeExpiryAction: "review_required" },
      enabledMarkets: ["KR"], enabledAssetClasses: ["equity"], selectionPolicyRef: selectionPolicyRefFor(selections[index]!), riskRuleSetRef: riskRuleSetRefFor(bucketSet)
    })),
    cashPolicy: { targetCashRatio: 0.15, minimumCashReserveKrw: 100, ruleSource: "static" },
    hedgePolicy: { hedgeEnabled: true, hedgeTargetRatio: 0.05, maxCostRatio: 0.02 },
    exposurePolicy: { maxSymbolExposureRatio: 0.2, maxCountryExposureRatio: 0.8, maxCurrencyExposureRatio: 0.8 },
    legacyReduceOnlyPolicy: { allowBuyOrIncrease: false, maximumParticipationRatio: 0.1, riskRuleSetRef: riskRuleSetRefFor(legacySet) }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt: CREATED_AT,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt: CREATED_AT }) });
  const activation = createPortfolioPolicyActivatedEvent({ policy, activationSequence: 1, createdAt: CREATED_AT });
  return { policy, activation, dependencies, records, bucketSet, legacySet };
}
