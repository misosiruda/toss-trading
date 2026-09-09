// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateRiskDecisionTurnoverCapacity } from "./portfolioActionRiskDecisionTurnoverCapacity.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPolicy } from "./portfolioActionRiskDecisionPolicyResolver.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { RuntimePortfolioPolicyFileRepository, createRuntimePortfolioPolicyPaths } from "./runtimePortfolioPolicyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { HASH, turnoverCapacityCandidate, withPlanFixture, withDecision, storePolicyFixture, decisionInput, rehashTurnoverFillPair, withRiskExecutionFixture, policyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


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
  for (const patch of [{ policyHash: HASH }, { market: "US" as const, symbol: "US:AAPL" }]) {
    await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
      const repository = new PortfolioActionRiskDecisionFileRepository(input.baseDir);
      const candidate = { ...decisionInput(fixture, "BUY"), ...patch };
      const { decidedAt: _time, ...creationInput } = candidate;
      const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
      const original = await readFile(path, "utf8");
      await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /scope does not match|bucket or market mismatch/);
      assert.equal(await readFile(path, "utf8"), original);
      // Historical read still independently rejects a self-consistently rehashed invalid claim.
      const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
      const record = createPortfolioActionRiskDecision({ ...candidate, decidedAt: entry.record.decidedAt });
      await writeFile(path, rehashTurnoverFillPair({ ...entry, record }, marker));
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: record.riskDecisionId }), /mismatch/);
    });
  }
  for (const overrides of [
    { riskRuleSetRecordId: "unrelated" },
    { riskRuleSetVersion: "other" }, { riskRuleSetHash: HASH },
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


test("turnover policy capacity uses exact decimal limits and safe integer cumulative amounts", () => {
  const fixture = policyFixture("v1", undefined, 0.29);
  const atLimit = createPortfolioActionRiskDecision(turnoverCapacityCandidate(fixture, "BUY", 190));
  assert.equal(validateRiskDecisionTurnoverCapacity({ decision: atLimit, policy: fixture.policy })!.maximumCumulativeTurnoverNotionalKrw, 290);
  assert.equal(validateRiskDecisionTurnoverCapacity({ decision: atLimit, policy: fixture.policy })!.remainingTurnoverNotionalKrw, 0);
  for (const side of ["BUY", "SELL"] as const) {
    const belowLimit = createPortfolioActionRiskDecision(turnoverCapacityCandidate(fixture, side, 189));
    assert.equal(validateRiskDecisionTurnoverCapacity({ decision: belowLimit, policy: fixture.policy })!.remainingTurnoverNotionalKrw, 1);
  }
  assert.throws(() => validateRiskDecisionTurnoverCapacity({
    decision: createPortfolioActionRiskDecision(turnoverCapacityCandidate(fixture, "BUY", 191)), policy: fixture.policy }), /exceeds policy turnover/);
  for (const max of [0, Number.MIN_VALUE, 0.3333333333333333]) {
    const limited = policyFixture("v1", undefined, max);
    // The canonical decimal 0.3333333333333333 is strictly below 1/3, despite equal rounded division.
    assert.throws(() => validateRiskDecisionTurnoverCapacity({ policy: limited.policy,
      decision: createPortfolioActionRiskDecision(turnoverCapacityCandidate(limited, "SELL", 0, 3, 1)) }), /exceeds policy turnover/);
  }
  const all = policyFixture("v1", undefined, 1);
  assert.equal(validateRiskDecisionTurnoverCapacity({ policy: all.policy,
    decision: createPortfolioActionRiskDecision(turnoverCapacityCandidate(all, "SELL", 0, 100, 100)) })!.withinTurnoverLimit, true);
  for (const candidate of [turnoverCapacityCandidate(all, "BUY", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1),
    turnoverCapacityCandidate(all, "BUY", 0, 1000.5, 100), turnoverCapacityCandidate(all, "BUY", 0.5)]) {
    assert.throws(() => validateRiskDecisionTurnoverCapacity({ policy: all.policy,
      decision: createPortfolioActionRiskDecision(candidate) }), /safe integer/);
  }
  assert.throws(() => validateRiskDecisionTurnoverCapacity({ decision: atLimit, policy: all.policy }), /scope does not match/);
  const legacy = createPortfolioActionRiskDecision(decisionInput(fixture, "SELL", true));
  assert.equal(validateRiskDecisionTurnoverCapacity({ decision: legacy, policy: fixture.policy }), null);
});


test("policy and plan Risk creation reject approvals above the bucket turnover cap before persistence", async () => {
  for (const side of ["BUY", "SELL"] as const) {
    const fixture = policyFixture();
    await withDecision(fixture, turnoverCapacityCandidate(fixture, side, 400), async (input) => {
      const resolved = await resolvePortfolioActionRiskDecisionPolicy(input);
      assert.equal(resolved.turnoverCapacity!.resultingCumulativeTurnoverNotionalKrw, 500);
      assert.equal(resolved.turnoverCapacity!.remainingTurnoverNotionalKrw, 0);
      assert.equal(resolved.turnoverCapacity!.withinTurnoverLimit, true);
      const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
      const bytes = await readFile(path, "utf8");
      const { decidedAt: _time, ...creation } = turnoverCapacityCandidate(fixture, side, 401);
      await assert.rejects(new PortfolioActionRiskDecisionFileRepository(input.baseDir).createAndAppendWithPolicyOrigin(creation), /exceeds policy turnover/);
      assert.equal(await readFile(path, "utf8"), bytes);
    });
    await withPlanFixture(side, false, async ({ repository, candidate }) => {
      if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
      await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...candidate, turnoverAssessment: {
        ...candidate.turnoverAssessment, priorBucketTurnoverNotionalKrw: 401, resultingBucketTurnoverRatio: 0.501 } }), /exceeds policy turnover/);
      assert.deepEqual(await repository.readAll(), []);
    });
  }
  await withRiskExecutionFixture(async ({ repository, candidate, selection }) => {
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
    const prior = candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw / 2;
    await assert.rejects(repository.createAndAppendWithExecutionOrigin({ ...candidate, turnoverAssessment: {
      ...candidate.turnoverAssessment, priorBucketTurnoverNotionalKrw: prior,
      resultingBucketTurnoverRatio: (prior + candidate.worstCaseFillNotionalKrw) / candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw } }, selection), /exceeds policy turnover/);
    assert.deepEqual(await repository.readAll(), []);
  });
});


test("turnover cap explains rejected decisions but rejects rehashed historical approvals over the limit", async () => {
  const fixture = policyFixture();
  const over = turnoverCapacityCandidate(fixture, "BUY", 401);
  await withDecision(fixture, { ...over, decision: "rejected", ruleResults: over.ruleResults.map((rule) => ({ ...rule, result: "fail" })) }, async (input) => {
    const capacity = (await resolvePortfolioActionRiskDecisionPolicy(input)).turnoverCapacity!;
    assert.equal(capacity.withinTurnoverLimit, false);
    assert.equal(capacity.remainingTurnoverNotionalKrw, 0);
    const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const record = createPortfolioActionRiskDecision({ ...over, decidedAt: entry.record.decidedAt });
    const bytes = rehashTurnoverFillPair({ ...entry, record }, marker);
    await writeFile(path, bytes);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: record.riskDecisionId }), /exceeds policy turnover/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});


test("replacement policy applies its lower turnover cap without resetting the supplied prior cumulative", async (context) => {
  const fixture = policyFixture();
  await withDecision(fixture, turnoverCapacityCandidate(fixture, "BUY", 300), async (input) => {
    const original = await resolvePortfolioActionRiskDecisionPolicy(input);
    const replacement = policyFixture("v2", undefined, 0.2);
    await new RuntimePortfolioPolicyFileRepository(input.baseDir, fixture.dependencies).append(replacement.policy);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(original.decision.decidedAt) + 2000 });
    try {
      await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy, replacement.policy], fixture.dependencies)
        .appendActivated({ policy: replacement.policy, supersedesActivationId: fixture.activation.activationId, createdAt: new Date().toISOString() });
      const { decidedAt: _time, ...candidate } = turnoverCapacityCandidate(replacement, "BUY", 300);
      await assert.rejects(new PortfolioActionRiskDecisionFileRepository(input.baseDir).createAndAppendWithPolicyOrigin(candidate), /exceeds policy turnover/);
      assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).turnoverCapacity!.maxTurnoverRatio, 0.5);
    } finally { context.mock.timers.reset(); }
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
    const eventStat = await stat(eventPath, { bigint: true });
    const probe = await open(eventPath, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let syncedAt: number | null = null;
    let successfulSourceSyncs = 0;
    let failSync = true;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const metadata = await this.stat({ bigint: true });
      if (metadata.isFile() && metadata.ino === eventStat.ino &&
        (process.platform === "win32" || metadata.dev === eventStat.dev)) {
        if (failSync) throw new Error("injected activation fsync failure");
        await originalSync.call(this);
        context.mock.timers.setTime(Date.now() + 20);
        syncedAt = Date.now();
        successfulSourceSyncs++;
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
      assert.equal(successfulSourceSyncs, 1);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), record.riskDecisionId);
      assert.ok(syncedAt !== null);
      assert.ok(Date.parse(origin.policyOrigin!.observedAt) >= syncedAt);
      assert.ok(Date.parse(record.decidedAt) >= syncedAt);
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
