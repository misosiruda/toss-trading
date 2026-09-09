// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { createBucketTurnoverEvent, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, createBucketTurnoverEventPaths, resolveVerifiedBucketTurnoverEventOrigin } from "./bucketTurnoverEventFiles.js";
import { BUCKET_TURNOVER_STATE_FILE_NAME, BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation, getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import { resolveCurrentPortfolioActionRiskDecisionTurnover } from "./portfolioActionRiskDecisionTurnoverResolver.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionExecution } from "./portfolioActionRiskDecisionExecutionResolver.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths, getDurablePortfolioSizingSnapshotObservation } from "./portfolioSizingSnapshotFiles.js";
import { HASH, rehashTurnoverFillPair, withCompletedTurnoverFillFixture, withTurnoverCreationFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("turnover-bound Risk creation persists actual source observations and preserves exact retries", async () => {
  for (const side of ["BUY", "SELL"] as const) await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection, root }) => {
    const states = new BucketTurnoverStateFileRepository(baseDir);
    const projection = await states.refresh({ expectedProjectionHash: null });
    const statePath = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const stateBytes = await readFile(statePath, "utf8");
    const decision = await repository.createAndAppendWithTurnoverOrigin(candidate, selection);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    assert.equal(JSON.parse(bytes.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v9");
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId);
    assert.equal(origin.turnoverOrigin!.observation.projectionHash, projection.projectionHash);
    assert.equal(origin.turnoverOrigin!.windowCompletionHash, root.completion!.completionHash);
    assert.equal(origin.turnoverOrigin!.observation.sourceEventCount, 0);
    assert.ok(Object.isFrozen(origin.turnoverOrigin!.observation));
    await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId });
    await resolveCurrentPortfolioActionRiskDecisionTurnover({ baseDir, riskDecisionId: decision.riskDecisionId });
    assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(baseDir).createAndAppendWithTurnoverOrigin(candidate, selection), decision);
    assert.equal(await readFile(path, "utf8"), bytes);
    assert.equal(await readFile(statePath, "utf8"), stateBytes);
  }, { side });
});


test("turnover-bound Risk creation requires an explicit current projection and completed root before writing", async () => {
  for (const completion of [true, false]) await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    const read = () => repository.createAndAppendWithTurnoverOrigin(candidate, selection);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    await assert.rejects(read(), /projection is missing/);
    await assert.rejects(readFile(path), { code: "ENOENT" });
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    if (!completion) {
      await assert.rejects(read(), /lacks post-fsync completion/);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    } else {
      if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
      await assert.rejects(repository.createAndAppendWithTurnoverOrigin({ ...candidate,
        turnoverAssessment: { ...candidate.turnoverAssessment, turnoverStateHash: HASH } }, selection), /differs from actual source state/);
      await assert.rejects(readFile(path), { code: "ENOENT" });
      await read();
    }
  }, { completion });
});


test("turnover-bound Risk never retrofits an existing execution-only decision", async () => {
  await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const old = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithTurnoverOrigin(candidate, selection), /cannot be added after persistence/);
    assert.equal(await readFile(path, "utf8"), bytes);
    const historical = await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: old.riskDecisionId });
    assert.equal(historical.origin.turnoverOrigin, undefined);
  });
});


test("turnover-bound Risk replays preceding event prefixes without recursion after two actual fills", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill, createNextRisk, createNextFill }) => {
    const risks = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const original = (await risks.readAll())[0]!;
    const states = new BucketTurnoverStateFileRepository(baseDir);
    const firstProjection = await states.readVerifiedSnapshot();
    const events = new BucketTurnoverEventFileRepository(baseDir);
    await events.appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const current = await states.refresh({ expectedProjectionHash: firstProjection.projectionHash });
    assert.deepEqual(await createNextRisk(root.snapshotOrigin.initialState), original);
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover({ baseDir, riskDecisionId: original.riskDecisionId }), /differs from actual state/);
    const nextFill = await createNextFill(current.states[0]!, "turnover-bound-second-fill");
    const next = (await risks.readAll()).at(-1)!;
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await risks.readVerifiedHistory(), next.riskDecisionId);
    assert.equal(origin.turnoverOrigin!.observation.sourceEventCount, 1);
    await events.appendFillWithCompletion({ paperFillRecordId: nextFill.paperFillRecordId, expectedTurnoverStateHash: current.states[0]!.turnoverStateHash });
    assert.equal((await new BucketTurnoverEventFileRepository(baseDir).readVerifiedHistory()).events.length, 2);
    await rm(join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME));
    // Historical origins replay their source prefixes even if the current projection cache is absent.
    await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: original.riskDecisionId });
    await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: next.riskDecisionId });
  }, { turnoverBound: true });
});


test("turnover-bound Risk concurrent creators converge to one persisted observation", async () => {
  await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const results = await Promise.all(Array.from({ length: 3 }, () => repository.createAndAppendWithTurnoverOrigin(candidate, selection)));
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal((await repository.readAll()).length, 1);
    assert.equal((await readFile(createPortfolioActionRiskDecisionPaths(baseDir).recordsPath, "utf8")).trimEnd().split("\n").length, 2);
  });
});


test("turnover-bound Risk replay cannot omit already completed events or include future events", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    const risks = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const risk = (await risks.readAll())[0]!;
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await risks.readVerifiedHistory(), risk.riskDecisionId).turnoverOrigin!;
    const states = new BucketTurnoverStateFileRepository(baseDir);
    const projection = await states.readVerifiedSnapshot();
    await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const current = await states.refresh({ expectedProjectionHash: projection.projectionHash });
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    try {
      await assert.rejects(states.resolveObservedState({ ...origin.observation, observedAt: new Date().toISOString() }, origin.turnoverStateId), /omits an already available event/);
      const { states: _states, schemaVersion: _schema, ...identity } = current;
      await assert.rejects(states.resolveObservedState({ ...identity, observedAt: origin.observation.observedAt }, origin.turnoverStateId), /prefix was unavailable at observation/);
      await states.resolveObservedState(origin.observation, origin.turnoverStateId);
    } finally { context.mock.timers.reset(); }
  }, { turnoverBound: true });
});


test("turnover-bound Risk parser rejects noncanonical receipts and ambiguous availability", async () => {
  await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const decision = await repository.createAndAppendWithTurnoverOrigin(candidate, selection);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
    const origin = entry.turnoverOrigin;
    for (const turnoverOrigin of [
      { ...origin, availableAt: decision.decidedAt },
      { ...origin, extra: true },
      { ...origin, observation: { ...origin.observation, sourceEventCount: -1 } },
      { ...origin, observation: { ...origin.observation, sourceEventCount: 0.5 } },
      { ...origin, observation: { ...origin.observation, observedAt: origin.observation.observedAt.replace("Z", "+00:00") } },
      { ...origin, observation: { ...origin.observation, observedAt: new Date(Date.parse(decision.decidedAt) + 1).toISOString() } }
    ]) {
      const forged = rehashTurnoverFillPair({ ...entry, turnoverOrigin }, marker);
      await writeFile(path, forged);
      await assert.rejects(repository.readVerifiedHistory());
      assert.equal(await readFile(path, "utf8"), forged);
    }
    await writeFile(path, bytes);
    await repository.readVerifiedHistory();
  });
});


test("turnover-bound Risk rejects independently rehashed false source receipts", async () => {
  await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const decision = await repository.createAndAppendWithTurnoverOrigin(candidate, selection);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
    const origin = entry.turnoverOrigin;
    const alternatives = [
      { ...origin, windowCommitHash: HASH },
      { ...origin, windowCompletionHash: HASH },
      { ...origin, lastEventCommitHash: HASH },
      { ...origin, lastEventCompletionHash: HASH },
      { ...origin, observation: { ...origin.observation, sourceWindowGenerationHash: HASH } },
      { ...origin, observation: { ...origin.observation, projectionHash: HASH } },
      { ...origin, observation: { ...origin.observation, sourceWindowCount: origin.observation.sourceWindowCount + 1 } },
      { ...origin, observation: { ...origin.observation, sourceEventCount: 1 } }
    ];
    for (const turnoverOrigin of alternatives) {
      const forged = rehashTurnoverFillPair({ ...entry, turnoverOrigin }, marker);
      await writeFile(path, forged);
      // The pair is structurally canonical: independent source replay must reject it.
      assert.equal((await repository.readAll()).length, 1);
      await assert.rejects(resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId }),
        /actual stored sources|actual source prefix|source prefix is unavailable/);
      await assert.rejects(repository.createAndAppendWithTurnoverOrigin(candidate, selection));
      assert.equal(await readFile(path, "utf8"), forged);
    }
    await writeFile(path, bytes);
    await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId });
  });
});


test("turnover-bound Risk historical replay rejects cached cloned and foreign event prefixes", async () => {
  await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    const states = new BucketTurnoverStateFileRepository(baseDir);
    await states.refresh({ expectedProjectionHash: null });
    const decision = await repository.createAndAppendWithTurnoverOrigin(candidate, selection);
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId).turnoverOrigin!;
    const cached = await new BucketTurnoverEventFileRepository(baseDir).readVerifiedHistory();
    await assert.rejects(states.resolveObservedState(origin.observation, origin.turnoverStateId, cached), /no active replay context/);
    await assert.rejects(states.resolveObservedState(origin.observation, origin.turnoverStateId, structuredClone(cached)), /not repository-verified/);
    const foreignDir = await mkdtemp(join(tmpdir(), "turnover-foreign-prefix-"));
    try {
      const foreign = await new BucketTurnoverEventFileRepository(foreignDir).readVerifiedHistory();
      await assert.rejects(states.resolveObservedState(origin.observation, origin.turnoverStateId, foreign), /another storage root/);
    } finally { await rm(foreignDir, { recursive: true, force: true }); }
    const historical = await states.resolveObservedState(origin.observation, origin.turnoverStateId);
    assert.throws(() => getDurableBucketTurnoverStateObservation(historical.projection), /no active durable observation/);
    await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId });
  });
});


test("turnover-bound Risk holds all source locks through persistence and releases them on fsync failure", async (context) => {
  for (const fail of [false, true]) await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    const states = new BucketTurnoverStateFileRepository(baseDir);
    await states.refresh({ expectedProjectionHash: null });
    const sourcePaths = [createBucketTurnoverWindowPaths(baseDir), createSourcePriceEvidencePaths(baseDir),
      createPortfolioSizingSnapshotPaths(baseDir)];
    const sourceBytes = await Promise.all(sourcePaths.map(({ recordsPath }) => readFile(recordsPath, "utf8")));
    const riskPath = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const probe = await open(sourcePaths[0]!.recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const original = prototype.sync;
    await probe.close();
    let matched = 0;
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      const target = await stat(riskPath, { bigint: true }).catch(() => undefined);
      if (target !== undefined && actual.isFile() && actual.ino === target.ino && (process.platform === "win32" || actual.dev === target.dev)) {
        matched += 1;
        for (const { lockPath } of [...sourcePaths, createBucketTurnoverEventPaths(baseDir)]) await stat(lockPath);
        if (matched === 1) await assert.rejects(new BucketTurnoverEventFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readVerifiedHistory(), /repository lock is unavailable/);
        if (fail) throw new Error("injected turnover-bound Risk fsync failure");
      }
      await original.call(this);
    });
    try {
      const creation = repository.createAndAppendWithTurnoverOrigin(candidate, selection);
      if (fail) await assert.rejects(creation, /injected turnover-bound Risk fsync failure/);
      else await creation;
    } finally { sync.mock.restore(); }
    assert.ok(matched >= (fail ? 1 : 2));
    assert.deepEqual(await Promise.all(sourcePaths.map(({ recordsPath }) => readFile(recordsPath, "utf8"))), sourceBytes);
    assert.deepEqual((await readdir(baseDir)).filter((name) => name.endsWith(".lock")), []);
    await states.withDurableRiskSources(async () => undefined);
    if (fail) {
      const partial = await readFile(riskPath, "utf8");
      await assert.rejects(repository.readAll());
      await assert.rejects(repository.createAndAppendWithTurnoverOrigin(candidate, selection));
      assert.equal(await readFile(riskPath, "utf8"), partial);
    } else assert.equal((await repository.readAll()).length, 1);
  });
});


test("turnover-bound Risk requires refresh after a fill and rejects self-consistent false denominators", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill, createNextRisk }) => {
    const states = new BucketTurnoverStateFileRepository(baseDir);
    const projection = await states.readVerifiedSnapshot();
    const event = await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    // A changed input must not be mistaken for an exact historical retry.
    const prior = replayBucketTurnoverEvents({ initialState: root.snapshotOrigin.initialState, events: [event] });
    await assert.rejects(createNextRisk(prior), /projection is stale/);
    assert.equal(await readFile(path, "utf8"), bytes);
    await states.refresh({ expectedProjectionHash: projection.projectionHash });
    await createNextRisk(prior);
  }, { turnoverBound: true });
  await withTurnoverCreationFixture(async ({ baseDir, repository, candidate, selection }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    const assessment = candidate.turnoverAssessment;
    const denominator = assessment.turnoverWindowOpenPortfolioNetWorthKrw * 2;
    await assert.rejects(repository.createAndAppendWithTurnoverOrigin({ ...candidate, turnoverAssessment: { ...assessment,
      turnoverWindowOpenPortfolioNetWorthKrw: denominator,
      resultingBucketTurnoverRatio: assessment.requestedBucketTurnoverNotionalKrw / denominator } }, selection), /differs from actual source state/);
    await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(baseDir).recordsPath), { code: "ENOENT" });
  });
});
