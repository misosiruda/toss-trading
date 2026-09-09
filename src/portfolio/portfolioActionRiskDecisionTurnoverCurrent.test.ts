// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { createBucketTurnoverEvent, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, createBucketTurnoverEventPaths, resolveVerifiedBucketTurnoverEventOrigin } from "./bucketTurnoverEventFiles.js";
import { BUCKET_TURNOVER_STATE_FILE_NAME, BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation, getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import { resolveCurrentPortfolioActionRiskDecisionTurnover } from "./portfolioActionRiskDecisionTurnoverResolver.js";
import { createBucketTurnoverCompletion } from "./bucketTurnoverCompletion.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionExecution } from "./portfolioActionRiskDecisionExecutionResolver.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths, getDurablePortfolioSizingSnapshotObservation } from "./portfolioSizingSnapshotFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { HASH, rehashTurnoverFillPair, withCompletedTurnoverFillFixture, withTurnoverFillFixture, withRiskExecutionFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("current turnover Risk resolver binds BUY and SELL to actual current state without writing or refreshing", async () => {
  for (const side of ["BUY", "SELL"] as const) await withCompletedTurnoverFillFixture(async ({ baseDir, root }) => {
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    const input = { baseDir, riskDecisionId: decision.riskDecisionId };
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /projection is missing/);
    const projection = await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const bytes = await readFile(path, "utf8");
    const result = await resolveCurrentPortfolioActionRiskDecisionTurnover(input);
    assert.deepEqual(result.turnoverObservation.state, root.snapshotOrigin.initialState);
    assert.equal(result.turnoverObservation.availableAt, root.completion!.completedAt);
    assert.equal(result.turnoverObservation.windowCommitHash, root.commitHash);
    assert.equal(result.turnoverObservation.lastEventCommitHash, null);
    assert.equal(result.turnoverObservation.projectionHash, projection.projectionHash);
    assert.equal(result.turnoverCapacity!.withinTurnoverLimit, true);
    assert.ok(Object.isFrozen(result.turnoverObservation));
    assert.ok(Date.parse(result.turnoverObservation.observedAt) >= Date.parse(decision.decidedAt));
    assert.equal(await readFile(path, "utf8"), bytes);
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover({ ...input, state: result.turnoverObservation.state } as typeof input));
  }, { side });
});


test("current turnover rejects window completion equality and accepts a decision one millisecond later", async (context) => {
  for (const decisionDelay of [0, 1]) await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    try {
      const root = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolveWithCompletion({
        portfolioId: candidate.portfolioId, bucket: "swing", expectedPolicyHash: candidate.policyHash });
      const initial = root.snapshotOrigin.initialState;
      if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
      context.mock.timers.tick(decisionDelay);
      const decision = await repository.createAndAppendWithExecutionOrigin({ ...candidate,
        turnoverAssessment: { ...candidate.turnoverAssessment, turnoverStateId: initial.turnoverStateId,
          turnoverStateHash: initial.turnoverStateHash, turnoverWindowOpenPortfolioNetWorthKrw: initial.windowOpenPortfolioNetWorthKrw,
          resultingBucketTurnoverRatio: candidate.worstCaseFillNotionalKrw / initial.windowOpenPortfolioNetWorthKrw } }, selection);
      assert.equal(Date.parse(decision.decidedAt), Date.parse(root.completion!.completedAt) + decisionDelay);
      await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
      const input = { baseDir, riskDecisionId: decision.riskDecisionId };
      await resolvePortfolioActionRiskDecisionExecution(input);
      if (decisionDelay === 0) await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /source availability/);
      else assert.equal((await resolveCurrentPortfolioActionRiskDecisionTurnover(input)).decision.riskDecisionId, decision.riskDecisionId);
    } finally { context.mock.timers.reset(); }
  });
});


test("current turnover Risk resolver rejects stale projections and superseded Risk assessments after a fill", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill, createNextFill }) => {
    const risks = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const original = (await risks.readAll())[0]!;
    const input = { baseDir, riskDecisionId: original.riskDecisionId };
    const states = new BucketTurnoverStateFileRepository(baseDir);
    const empty = await states.refresh({ expectedProjectionHash: null });
    await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /projection is stale/);
    const latest = await states.refresh({ expectedProjectionHash: empty.projectionHash });
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /differs from actual state/);
    await createNextFill(latest.states[0]!, "current-turnover-next-fill");
    const next = (await risks.readAll()).at(-1)!;
    const result = await resolveCurrentPortfolioActionRiskDecisionTurnover({ baseDir, riskDecisionId: next.riskDecisionId });
    assert.equal(result.turnoverObservation.state.cumulativeAbsoluteFilledNotionalKrw, fill.filledNotionalKrw);
    assert.equal(result.turnoverObservation.lastEventCompletionHash, latest.sourceEventGenerationHash);
    assert.ok(Date.parse(result.turnoverObservation.availableAt) < Date.parse(next.decidedAt));
    // Historical replay still explains the old decision; the current check is deliberately stricter.
    assert.equal((await resolvePortfolioActionRiskDecisionExecution(input)).decision.riskDecisionId, original.riskDecisionId);
  });
});


test("current turnover Risk resolver rejects self-consistent rehashed hash, prior and denominator claims", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _input, ...candidate } = entry.record as ReturnType<typeof createPortfolioActionRiskDecision>;
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    for (const patch of [{ turnoverStateHash: HASH }, { priorBucketTurnoverNotionalKrw: 1 },
      { turnoverWindowOpenPortfolioNetWorthKrw: candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw * 2 }]) {
      const assessment = { ...candidate.turnoverAssessment, ...patch };
      assessment.resultingBucketTurnoverRatio = (assessment.priorBucketTurnoverNotionalKrw + assessment.requestedBucketTurnoverNotionalKrw) /
        assessment.turnoverWindowOpenPortfolioNetWorthKrw;
      const record = createPortfolioActionRiskDecision({ ...candidate, turnoverAssessment: assessment });
      const tampered = rehashTurnoverFillPair({ ...entry, record }, marker);
      await writeFile(path, tampered);
      const input = { baseDir, riskDecisionId: record.riskDecisionId };
      await resolvePortfolioActionRiskDecisionExecution(input);
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /differs from actual state/);
      assert.equal(await readFile(path, "utf8"), tampered);
    }
    await writeFile(path, bytes);
  });
});


test("current turnover Risk resolver rejects a state that became durable after the decision", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const latest = await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const state = latest.states[0]!;
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _input, ...candidate } = entry.record as ReturnType<typeof createPortfolioActionRiskDecision>;
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    const record = createPortfolioActionRiskDecision({ ...candidate, turnoverAssessment: { ...candidate.turnoverAssessment,
      turnoverStateHash: state.turnoverStateHash, priorBucketTurnoverNotionalKrw: state.cumulativeAbsoluteFilledNotionalKrw,
      resultingBucketTurnoverRatio: (state.cumulativeAbsoluteFilledNotionalKrw + candidate.worstCaseFillNotionalKrw) / state.windowOpenPortfolioNetWorthKrw } });
    const now = new Date().toISOString();
    await writeFile(path, bytes + rehashTurnoverFillPair({ ...entry, record, appendStartedAt: now, previousEntryHash: marker.commitHash },
      { ...marker, committedAt: now }));
    const input = { baseDir, riskDecisionId: record.riskDecisionId };
    await resolvePortfolioActionRiskDecisionExecution(input);
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /source availability/);
  });
});


test("current turnover Risk resolver rejects expired windows and retirement or same-policy reactivation", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root }) => {
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    const input = { baseDir, riskDecisionId: decision.riskDecisionId };
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(root.snapshotOrigin.initialState.windowEndsAt) });
    try { await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /window expired or mismatched/); }
    finally { context.mock.timers.reset(); }
    const original = await resolvePortfolioActionRiskDecisionExecution(input);
    const policies = await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir);
    const store = new RuntimePortfolioPolicyActivationFileRepository(baseDir, policies.policies, policies.dependencies.repository);
    const now = Date.now() + 100;
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      await store.appendRetired({ portfolioId: decision.portfolioId, retiredActivationId: original.activePolicy.activation.activationId,
        reasonCode: "current-turnover-test", createdAt: new Date().toISOString() });
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /active runtime portfolio policy is required/);
      context.mock.timers.tick(1);
      await store.appendActivated({ policy: original.activePolicy.policy, createdAt: new Date().toISOString() });
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /activation drift/);
      await resolvePortfolioActionRiskDecisionExecution(input);
    } finally { context.mock.timers.reset(); }
  });
});


test("current turnover observation cannot predate the durable Risk commit after clock rollback", async (context) => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const root = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolveWithCompletion({ portfolioId: candidate.portfolioId,
      bucket: "swing", expectedPolicyHash: candidate.policyHash });
    const initial = root.snapshotOrigin.initialState;
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    const bound = { ...candidate, turnoverAssessment: { ...candidate.turnoverAssessment,
      turnoverStateId: initial.turnoverStateId, turnoverStateHash: initial.turnoverStateHash,
      turnoverWindowOpenPortfolioNetWorthKrw: initial.windowOpenPortfolioNetWorthKrw,
      resultingBucketTurnoverRatio: candidate.worstCaseFillNotionalKrw / initial.windowOpenPortfolioNetWorthKrw } };
    const probe = await open(createPortfolioSizingSnapshotPaths(baseDir).recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const riskPath = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    let riskSyncs = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      const target = await stat(riskPath, { bigint: true }).catch(() => undefined);
      await originalSync.call(this);
      if (actual.isFile() && target !== undefined && actual.ino === target.ino &&
        (process.platform === "win32" || actual.dev === target.dev)) {
        riskSyncs += 1; context.mock.timers.tick(20);
      }
    });
    try {
      const decision = await repository.createAndAppendWithExecutionOrigin(bound, selection);
      sync.mock.restore();
      assert.ok(riskSyncs >= 2);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId);
      const rollbackAt = Date.parse(origin.appendedAt) - 1;
      assert.ok(rollbackAt > Date.parse(decision.decidedAt));
      await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
      const input = { baseDir, riskDecisionId: decision.riskDecisionId };
      context.mock.timers.setTime(rollbackAt);
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /observation chronology/);
      context.mock.timers.setTime(Date.parse(origin.appendedAt));
      const result = await resolveCurrentPortfolioActionRiskDecisionTurnover(input);
      assert.equal(result.turnoverObservation.observedAt, origin.appendedAt);
    } finally { sync.mock.restore(); context.mock.timers.reset(); }
  });
});


test("current turnover Risk resolver fails on projection fsync without returning a current observation", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir }) => {
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    const input = { baseDir, riskDecisionId: decision.riskDecisionId };
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const bytes = await readFile(path, "utf8");
    const identity = await stat(path, { bigint: true });
    const handle = await open(path, "r+");
    const prototype = Object.getPrototypeOf(handle) as FileHandle;
    const original = prototype.sync;
    await handle.close();
    let matched = 0;
    context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      if (actual.isFile() && actual.ino === identity.ino && (process.platform === "win32" || actual.dev === identity.dev)) {
        matched += 1; throw new Error("injected current turnover sync failure");
      }
      await original.call(this);
    });
    try {
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /injected current turnover sync failure/);
      assert.equal(matched, 1);
      assert.equal(await readFile(path, "utf8"), bytes);
    } finally { context.mock.restoreAll(); }
    await resolveCurrentPortfolioActionRiskDecisionTurnover(input);
  });
});


test("turnover completion cannot be retrofitted to legacy window or event pairs", async () => {
  await withTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    const windows = new BucketTurnoverWindowFileRepository(baseDir);
    const request = { portfolioId: root.snapshotOrigin.initialState.portfolioId, bucket: root.snapshotOrigin.initialState.bucket,
      expectedPolicyHash: root.policyOrigin.policyHash };
    const windowPath = createBucketTurnoverWindowPaths(baseDir).recordsPath;
    const before = await readFile(windowPath, "utf8");
    await assert.rejects(windows.createOrResolveWithCompletion(request), /cannot be added/);
    assert.equal(await readFile(windowPath, "utf8"), before);
    const states = new BucketTurnoverStateFileRepository(baseDir);
    await states.refresh({ expectedProjectionHash: null });
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover({ baseDir, riskDecisionId: decision.riskDecisionId }), /post-fsync source completion/);
    const events = new BucketTurnoverEventFileRepository(baseDir);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    await assert.rejects(events.appendFillWithCompletion(input), /completed window root/);
    assert.deepEqual((await events.readVerifiedHistory()).events, []);
    await events.appendFill(input);
    const eventPath = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const bytes = await readFile(eventPath, "utf8");
    await assert.rejects(events.appendFillWithCompletion(input), /cannot be added/);
    assert.equal(await readFile(eventPath, "utf8"), bytes);
  });
});


test("completed turnover sources retain exact retries and reject missing or rehashed completion receipts", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    const windows = new BucketTurnoverWindowFileRepository(baseDir);
    const events = new BucketTurnoverEventFileRepository(baseDir);
    const rootRequest = { portfolioId: root.snapshotOrigin.initialState.portfolioId, bucket: root.snapshotOrigin.initialState.bucket,
      expectedPolicyHash: root.policyOrigin.policyHash };
    const eventRequest = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    assert.deepEqual(await windows.createOrResolveWithCompletion(rootRequest), root);
    const event = await events.appendFillWithCompletion(eventRequest);
    assert.deepEqual(await events.appendFillWithCompletion(eventRequest), event);
    const eventOrigin = resolveVerifiedBucketTurnoverEventOrigin(await events.readVerifiedHistory(), event.turnoverEventId);
    assert.ok(root.completion);
    assert.ok(eventOrigin.completion);
    const projection = await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    assert.equal(projection.sourceWindowGenerationHash, root.completion.completionHash);
    assert.equal(projection.sourceEventGenerationHash, eventOrigin.completion.completionHash);
    for (const kind of ["window", "event"] as const) {
      const path = kind === "window" ? createBucketTurnoverWindowPaths(baseDir).recordsPath : createBucketTurnoverEventPaths(baseDir).eventsPath;
      const bytes = await readFile(path, "utf8");
      const [entry, marker, completion] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
      assert.equal(bytes.trimEnd().split("\n").length, 3);
      const prefix = `${JSON.stringify(entry)}\n${JSON.stringify(marker)}\n`;
      const variants = [prefix, prefix + JSON.stringify({ ...completion, completionHash: HASH }) + "\n",
        ...[{ sourceKind: kind === "window" ? "event" as const : "window" as const }, { commitHash: HASH },
          { completedAt: new Date(Date.parse(marker.committedAt) - 1).toISOString() },
          { completedAt: root.snapshotOrigin.initialState.windowEndsAt }].map((patch) =>
          prefix + JSON.stringify(createBucketTurnoverCompletion({ sourceKind: kind, commitHash: marker.commitHash,
            completedAt: completion.completedAt, ...patch })) + "\n")];
      for (const altered of variants) {
        await writeFile(path, altered);
        await assert.rejects(kind === "window" ? windows.readVerifiedHistory() : events.readVerifiedHistory(), /corrupt/);
        await assert.rejects(kind === "window" ? windows.createOrResolveWithCompletion(rootRequest) : events.appendFillWithCompletion(eventRequest), /corrupt/);
        assert.equal(await readFile(path, "utf8"), altered);
      }
      await writeFile(path, bytes);
    }
    assert.deepEqual(await events.appendFillWithCompletion(eventRequest), event);
  });
});


test("window completion follows marker fsync and pending barrier removal", async (context) => {
  await withRiskExecutionFixture(async ({ baseDir, candidate }) => {
    const paths = createBucketTurnoverWindowPaths(baseDir);
    const probe = await open(createPortfolioSizingSnapshotPaths(baseDir).recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let afterMarker = 0;
    let completionSyncs = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      const target = await stat(paths.recordsPath, { bigint: true }).catch(() => undefined);
      await originalSync.call(this);
      if (actual.isFile() && target !== undefined && actual.ino === target.ino && (process.platform === "win32" || actual.dev === target.dev)) {
        const count = (await readFile(paths.recordsPath, "utf8")).trimEnd().split("\n").length;
        if (count === 2) { context.mock.timers.tick(20); afterMarker = Date.now(); assert.ok((await stat(paths.pendingPath)).isFile()); }
        if (count === 3) { completionSyncs += 1; await assert.rejects(stat(paths.pendingPath), { code: "ENOENT" }); }
      }
    });
    try {
      const root = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolveWithCompletion({ portfolioId: candidate.portfolioId,
        bucket: "swing", expectedPolicyHash: candidate.policyHash });
      assert.ok(afterMarker > Date.parse(root.appendedAt));
      assert.equal(Date.parse(root.completion!.completedAt), afterMarker);
      assert.equal(completionSyncs, 1);
      assert.deepEqual((await new BucketTurnoverWindowFileRepository(baseDir).readVerifiedHistory()).windows[0], root);
    } finally { sync.mock.restore(); context.mock.timers.reset(); }
  });
});


test("current Risk cannot use an event still finalizing when its decision was created", async (context) => {
  for (const completionDelay of [0, 20]) await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill, createNextRisk }) => {
    const paths = createBucketTurnoverEventPaths(baseDir);
    const probe = await open(createBucketTurnoverWindowPaths(baseDir).recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let entered = false;
    let concurrentRiskId: string | undefined;
    let decisionTime = 0;
    let mockedTime = false;
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      const target = await stat(paths.eventsPath, { bigint: true }).catch(() => undefined);
      if (!entered && actual.isFile() && target !== undefined && actual.ino === target.ino && (process.platform === "win32" || actual.dev === target.dev)) {
        const lines = (await readFile(paths.eventsPath, "utf8")).trimEnd().split("\n");
        if (lines.length === 2) {
          entered = true;
          context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
          mockedTime = true;
          const state = replayBucketTurnoverEvents({ initialState: root.snapshotOrigin.initialState, events: [JSON.parse(lines[0]!).event] });
          concurrentRiskId = (await createNextRisk(state)).riskDecisionId;
          decisionTime = Date.parse((await new PortfolioActionRiskDecisionFileRepository(baseDir).resolveById(concurrentRiskId)).decidedAt);
          assert.ok(decisionTime >= Date.parse(JSON.parse(lines[1]!).committedAt));
          assert.ok((await stat(paths.pendingPath)).isFile());
          context.mock.timers.tick(completionDelay);
        }
      }
      await originalSync.call(this);
    });
    try {
      const events = new BucketTurnoverEventFileRepository(baseDir);
      const event = await events.appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
        expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
      sync.mock.restore();
      assert.ok(entered && concurrentRiskId !== undefined);
      const origin = resolveVerifiedBucketTurnoverEventOrigin(await events.readVerifiedHistory(), event.turnoverEventId);
      assert.equal(Date.parse(origin.completion!.completedAt), decisionTime + completionDelay);
      await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
      const input = { baseDir, riskDecisionId: concurrentRiskId };
      await resolvePortfolioActionRiskDecisionExecution(input);
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /source availability/);
    } finally { sync.mock.restore(); if (mockedTime) context.mock.timers.reset(); }
  });
});


test("turnover completion write failure leaves an incomplete v2 history that retries cannot repair", async (context) => {
  const run = async (baseDir: string, path: string, pendingPath: string, attempt: () => Promise<unknown>, read: () => Promise<unknown>) => {
    const probe = await open(createPortfolioSizingSnapshotPaths(baseDir).recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const original = prototype.writeFile;
    await probe.close();
    const writer = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].startsWith('{"schemaVersion":"bucket_turnover_completion.v1",')) {
        throw new Error("injected turnover completion write failure");
      }
      return original.call(this, ...args);
    });
    try { await assert.rejects(attempt(), /injected turnover completion write failure/); }
    finally { writer.mock.restore(); }
    await assert.rejects(stat(pendingPath), { code: "ENOENT" });
    const bytes = await readFile(path, "utf8");
    assert.equal(bytes.trimEnd().split("\n").length, 2);
    await assert.rejects(read(), /corrupt/);
    await assert.rejects(attempt(), /corrupt/);
    assert.equal(await readFile(path, "utf8"), bytes);
  };
  await withRiskExecutionFixture(async ({ baseDir, candidate }) => {
    const windows = new BucketTurnoverWindowFileRepository(baseDir);
    const paths = createBucketTurnoverWindowPaths(baseDir);
    await run(baseDir, paths.recordsPath, paths.pendingPath, () => windows.createOrResolveWithCompletion({ portfolioId: candidate.portfolioId,
      bucket: "swing", expectedPolicyHash: candidate.policyHash }), () => windows.readVerifiedHistory());
  });
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    const events = new BucketTurnoverEventFileRepository(baseDir);
    const paths = createBucketTurnoverEventPaths(baseDir);
    await run(baseDir, paths.eventsPath, paths.pendingPath, () => events.appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash }), () => events.readVerifiedHistory());
  });
});


test("completed turnover history supports legacy successors without promoting their completion", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill, createNextFill }) => {
    const events = new BucketTurnoverEventFileRepository(baseDir);
    const first = await events.appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const firstOrigin = resolveVerifiedBucketTurnoverEventOrigin(await events.readVerifiedHistory(), first.turnoverEventId);
    const state = replayBucketTurnoverEvents({ initialState: root.snapshotOrigin.initialState, events: [first] });
    const nextFill = await createNextFill(state, "legacy-after-completed-event");
    const next = await events.appendFill({ paperFillRecordId: nextFill.paperFillRecordId, expectedTurnoverStateHash: state.turnoverStateHash });
    const history = await events.readVerifiedHistory();
    const nextOrigin = resolveVerifiedBucketTurnoverEventOrigin(history, next.turnoverEventId);
    assert.equal(nextOrigin.completion, undefined);
    assert.equal(history.generationHash, nextOrigin.commitHash);
    const rows = (await readFile(createBucketTurnoverEventPaths(baseDir).eventsPath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 5);
    assert.equal(rows[3].previousEntryHash, firstOrigin.completion!.completionHash);
    const states = new BucketTurnoverStateFileRepository(baseDir);
    await states.refresh({ expectedProjectionHash: null });
    await states.withDurableSnapshot(async (snapshot) => {
      assert.equal(getDurableBucketTurnoverStateSource(snapshot, state.turnoverStateId).availableAt, null);
    });
    const windows = new BucketTurnoverWindowFileRepository(baseDir);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(root.snapshotOrigin.initialState.windowEndsAt) + 1 });
    try {
      const later = await windows.createOrResolve({ portfolioId: state.portfolioId, bucket: state.bucket, expectedPolicyHash: root.policyOrigin.policyHash });
      const roots = await windows.readVerifiedHistory();
      assert.equal(roots.windows.length, 2);
      assert.equal(later.completion, undefined);
      assert.equal(roots.generationHash, later.commitHash);
      const lines = (await readFile(createBucketTurnoverWindowPaths(baseDir).recordsPath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
      assert.equal(lines.length, 5);
      assert.equal(lines[3].previousEntryHash, root.completion!.completionHash);
    } finally { context.mock.timers.reset(); }
  });
});
