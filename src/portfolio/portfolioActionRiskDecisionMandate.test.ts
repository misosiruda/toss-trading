// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionMandate } from "./portfolioActionRiskDecisionMandateResolver.js";
import { createInvestmentMandateEvent, createInvestmentMandateRecord, type InvestmentMandateRecord } from "./investmentMandate.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { DECIDED_AT, HASH, mandatePayload, mandateTransition, withMandateFixture, withPlanFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


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
    const metadata = await Promise.all([stat(paths.recordsPath, { bigint: true }), stat(paths.eventsPath, { bigint: true })]);
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
      const own = await this.stat({ bigint: true });
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
