import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths, resolveVerifiedBucketTurnoverWindowOrigin } from "./bucketTurnoverWindowFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createInitialBucketTurnoverState } from "./bucketTurnover.js";
import { createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord, createPortfolioRiskRuleParameterRecord,
  createPortfolioRiskRuleSetRecord, createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage, riskRuleParameterRefFor,
  riskRuleSetRefFor, selectionPolicyRefFor, type ImmutablePolicyDependencyRecords } from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";

const CREATED_AT = "2026-09-01T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;

test("turnover window stores the first policy-selected root and converges concurrent retries across reopen and policy change", async () => {
  await withFixture(async ({ baseDir, fixture, snapshots, repository, input }) => {
    const root = await repository.createOrResolve(input);
    const path = createBucketTurnoverWindowPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    assert.equal(bytes.trim().split("\n").length, 2);
    assert.equal(root.snapshotOrigin.initialState.windowOpenPortfolioNetWorthKrw, 300);
    assert.equal(root.policyOrigin.policyHash, fixture.policy.policyHash);
    assert.ok(Object.isFrozen(root) && Object.isFrozen(root.policyOrigin.activationHistory));
    const results = await Promise.all(Array.from({ length: 6 }, () => new BucketTurnoverWindowFileRepository(baseDir).createOrResolve(input)));
    assert.deepEqual(results, Array.from({ length: 6 }, () => root));
    const start = Date.parse(root.snapshotOrigin.initialState.windowStartedAt);
    await snapshots.append(snapshot(fixture.policy.policyHash, "late", new Date(start - 1).toISOString(), 400));
    const next = policyFixture("v2");
    await new RuntimePortfolioPolicyFileRepository(baseDir, fixture.dependencies).append(next.policy);
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [fixture.policy, next.policy], fixture.dependencies)
      .appendActivated({ policy: next.policy, supersedesActivationId: root.policyOrigin.activationId, createdAt: new Date().toISOString() });
    const reopened = new BucketTurnoverWindowFileRepository(baseDir);
    assert.deepEqual(await reopened.createOrResolve({ ...input, expectedPolicyHash: next.policy.policyHash }), root);
    assert.equal(await readFile(path, "utf8"), bytes);
    const history = await reopened.readVerifiedHistory();
    assert.deepEqual(resolveVerifiedBucketTurnoverWindowOrigin(history, root.snapshotOrigin.initialState.turnoverStateId), root);
    assert.throws(() => resolveVerifiedBucketTurnoverWindowOrigin({ ...history }, root.snapshotOrigin.initialState.turnoverStateId), /repository-verified/);
    await assert.rejects(reopened.createOrResolve(input), /active policy drift/);
  });
});

test("turnover window concurrent first creation across processes persists exactly one root", async () => {
  await withFixture(async ({ baseDir, repository, input }) => {
    const script = `import { BucketTurnoverWindowFileRepository } from './dist/portfolio/bucketTurnoverWindowFiles.js';
      const value = await new BucketTurnoverWindowFileRepository(process.argv[1]).createOrResolve(JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify(value));`;
    const results = await Promise.all(Array.from({ length: 4 }, () => new Promise<unknown>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir, JSON.stringify(input)],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) { reject(new Error(stderr || `child exited with code ${code}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    })));
    const history = await repository.readVerifiedHistory();
    assert.equal(history.windows.length, 1);
    assert.deepEqual(results, Array.from({ length: 4 }, () => history.windows[0]));
    assert.equal((await readFile(createBucketTurnoverWindowPaths(baseDir).recordsPath, "utf8")).trim().split("\n").length, 2);
  });
});

test("turnover window rejects caller origins and missing denominator without appending a root", async () => {
  await withFixture(async ({ baseDir, repository, input }) => {
    const paths = createBucketTurnoverWindowPaths(baseDir);
    await assert.rejects(repository.createOrResolve({ ...input, expectedPolicyHash: HASH }), /active policy drift/);
    for (const extra of [{ asOf: CREATED_AT }, { durationSeconds: 1 }, { windowOpenPortfolioNetWorthKrw: 1 }, { policyOrigin: {} }]) {
      await assert.rejects(repository.createOrResolve({ ...input, ...extra }));
    }
    await writeFile(createPortfolioSizingSnapshotPaths(baseDir).recordsPath, "", "utf8");
    await assert.rejects(repository.createOrResolve(input), /missing or ambiguous/);
    await assert.rejects(stat(paths.recordsPath), { code: "ENOENT" });
  });
});

test("turnover window reader rejects rehashed origin, chronology, chain and duplicate-root changes", async () => {
  await withFixture(async ({ baseDir, repository, input }) => {
    const root = await repository.createOrResolve(input);
    const path = createBucketTurnoverWindowPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trim().split("\n").map((line) => JSON.parse(line));
    const changedDenominator = createInitialBucketTurnoverState({ portfolioId: input.portfolioId, bucket: input.bucket,
      policyHash: input.expectedPolicyHash, asOf: entry.policyOrigin.observedAt, durationSeconds: 86_400, windowOpenPortfolioNetWorthKrw: 900 });
    const cases = [
      rehash({ ...entry, snapshotOrigin: { ...entry.snapshotOrigin, initialState: changedDenominator } }, marker),
      rehash({ ...entry, policyOrigin: { ...entry.policyOrigin, activationEventHash: HASH } }, marker),
      rehash({ ...entry, previousEntryHash: HASH }, marker),
      rehash({ ...entry, appendStartedAt: CREATED_AT }, marker),
      rehash(entry, { ...marker, committedAt: CREATED_AT }),
      rehash(entry, { ...marker, committedAt: "9999-01-01T00:00:00Z" }),
      bytes + rehash({ ...entry, previousEntryHash: marker.commitHash, appendStartedAt: root.appendedAt }, marker),
      JSON.stringify(entry) + "\n", bytes + "{", bytes + "{}\n", bytes + "\n"
    ];
    for (const raw of cases) {
      await writeFile(path, raw, "utf8");
      await assert.rejects(repository.readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(repository.createOrResolve(input), /corrupt|torn/);
      assert.equal(await readFile(path, "utf8"), raw);
    }
  });
});

test("turnover window retries fail closed when the original snapshot prefix is replaced or the root lock is abandoned", async () => {
  await withFixture(async ({ baseDir, repository, input }) => {
    await repository.createOrResolve(input);
    const paths = createBucketTurnoverWindowPaths(baseDir);
    const bytes = await readFile(paths.recordsPath, "utf8");
    await writeFile(paths.lockPath, "abandoned-synthetic-lock\n", "utf8");
    await assert.rejects(new BucketTurnoverWindowFileRepository(baseDir, { lockTimeoutMs: 50, lockRetryDelayMs: 5 }).createOrResolve(input), /lock is unavailable/);
    await rm(paths.lockPath);
    await writeFile(createPortfolioSizingSnapshotPaths(baseDir).recordsPath, "", "utf8");
    await assert.rejects(repository.createOrResolve(input), /corrupt/);
    assert.equal(await readFile(paths.recordsPath, "utf8"), bytes);
  });
});

test("turnover window commits only after entry fsync and preserves incomplete pairs on failure", async (context) => {
  for (const failSync of [false, true]) await withFixture(async ({ baseDir, repository, input }) => {
    const path = createBucketTurnoverWindowPaths(baseDir).recordsPath;
    const probe = await open(join(baseDir, "probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let afterSync = 0;
    let duringSync = 0;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      const target = await stat(path).catch(() => undefined);
      const matches = afterSync === 0 && target !== undefined && own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev);
      if (matches) { duringSync = Date.now(); await new Promise((resolve) => setTimeout(resolve, 20)); if (failSync) throw new Error("injected window fsync failure"); }
      await originalSync.call(this);
      if (matches) afterSync = Date.now();
    });
    try {
      if (failSync) await assert.rejects(repository.createOrResolve(input), /injected window fsync failure/);
      else assert.ok(Date.parse((await repository.createOrResolve(input)).appendedAt) >= afterSync);
    } finally { mock.mock.restore(); }
    assert.ok(duringSync > 0);
    if (failSync) {
      const incomplete = await readFile(path, "utf8");
      assert.equal(incomplete.trimEnd().split("\n").length, 1);
      await assert.rejects(repository.readVerifiedHistory(), /corrupt/);
      await assert.rejects(repository.createOrResolve(input), /corrupt/);
      assert.equal(await readFile(path, "utf8"), incomplete);
    } else assert.ok(afterSync > duringSync);
  });
});

test("turnover windows roll forward at UTC boundary and reject a clock behind stored observations", async (context) => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withFixture(async ({ repository, input, snapshots, fixture }) => {
      const first = await repository.createOrResolve(input);
      context.mock.timers.setTime(now - 1);
      await assert.rejects(repository.createOrResolve(input), /corrupt/);
      context.mock.timers.setTime(Date.parse("2026-09-09T00:00:00.000Z"));
      await snapshots.append(snapshot(fixture.policy.policyHash, "next-opening", "2026-09-08T23:59:59.999Z", 600));
      const second = await repository.createOrResolve(input);
      assert.notEqual(second.snapshotOrigin.initialState.turnoverStateId, first.snapshotOrigin.initialState.turnoverStateId);
      assert.equal(second.snapshotOrigin.initialState.windowOpenPortfolioNetWorthKrw, 600);
      assert.deepEqual((await repository.readVerifiedHistory()).windows, [first, second]);
    });
  } finally { context.mock.timers.reset(); }
});

function rehash(entry: Record<string, unknown>, marker: Record<string, unknown>): string {
  const { entryHash: _entryHash, ...payload } = entry;
  const entryHash = hashCanonicalPayload(payload);
  const reboundMarker: Record<string, unknown> = { ...marker, entryHash };
  const { commitHash: _commitHash, ...markerPayload } = reboundMarker;
  return `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
}

async function withFixture(run: (value: { baseDir: string; fixture: ReturnType<typeof policyFixture>; snapshots: PortfolioSizingSnapshotFileRepository;
  repository: BucketTurnoverWindowFileRepository; input: { portfolioId: string; bucket: "swing"; expectedPolicyHash: string } }) => Promise<void>) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-turnover-window-"));
  try {
    const fixture = policyFixture();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
      await writeFile(paths[key], `${fixture.records[key].map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    }
    await new RuntimePortfolioPolicyFileRepository(baseDir, fixture.dependencies).append(fixture.policy);
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [fixture.policy], fixture.dependencies).appendActivated({ policy: fixture.policy, createdAt: CREATED_AT });
    const snapshots = new PortfolioSizingSnapshotFileRepository(baseDir);
    const start = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    await snapshots.append(snapshot(fixture.policy.policyHash, "v1", new Date(start - 3_600_000).toISOString(), 300));
    await run({ baseDir, fixture, snapshots, repository: new BucketTurnoverWindowFileRepository(baseDir),
      input: { portfolioId: fixture.policy.portfolioId, bucket: "swing", expectedPolicyHash: fixture.policy.policyHash } });
  } finally { await rm(baseDir, { recursive: true, force: true }); }
}

function snapshot(policyHash: string, version: string, asOf: string, cashKrw: number) {
  const portfolioId = "paper-main";
  const exposure = createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw, cashKrw,
    bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
    marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
    pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 });
  return createPortfolioSizingSnapshot({ portfolioId, portfolioVersion: version, policyHash, asOf,
    virtualPortfolio: { portfolioId, cashKrw, positions: [], updatedAt: asOf }, valuationInputs: [], pendingActionInputs: [], ...exposure });
}

function policyFixture(version = "v1") {
  const buckets = ["long_term", "swing", "short_term", "intraday", "hedge"] as const;
  const parameter = createPortfolioRiskRuleParameterRecord({ ruleId: "synthetic", ruleVersion: "v1", version: "v1", parameters: { limit: 1 }, createdAt: CREATED_AT });
  const rules = createPortfolioRiskRuleSetRecord({ version: "v1", rules: [{ ruleId: "synthetic", ruleVersion: "v1", appliesTo: ["BUY", "SELL"], parameterRef: riskRuleParameterRefFor(parameter) }], createdAt: CREATED_AT });
  const selections = buckets.map((bucket) => createBucketSelectionPolicyRecord({ bucket, version: "v1",
    requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "fixture", maximumAgeSeconds: 60 }],
    everyTickSourceRequirement: { sourceContractId: "fixture", eventType: "verified_market_packet", maximumAgeSeconds: 60, dedupeKey: "packet_hash" },
    hardGateRuleIds: ["fixture"], scoringModelVersion: "v1", featureDefinitionRefs: ["fixture"], createdAt: CREATED_AT }));
  const drawdown = createBucketDrawdownSemanticsRecord({ version: "v1", equityBasis: "bucket_assets_plus_cash", unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only", highWaterMarkRule: "max_previous_and_resulting_unit_nav", drawdownFormula: "one_minus_unit_nav_over_high_water_mark",
    emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch", activationCarryRule: "carry_when_semantics_hash_matches", createdAt: CREATED_AT });
  const calendar = createSessionCalendarRecord({ market: "KR", version: "v1", timeZone: "Asia/Seoul", validFromExchangeDate: "2026-09-01", validThroughExchangeDate: "2026-09-01",
    sessions: [{ exchangeDate: "2026-09-01", sessionKind: "regular", opensAt: "2026-09-01T09:00:00+09:00", closesAt: "2026-09-01T15:30:00+09:00", sourceEvidenceRefs: ["fixture"] }], createdAt: CREATED_AT });
  const boundary = createScheduleBoundaryRecord({ market: "KR", version: "v1", timeZone: "Asia/Seoul", sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version, sessionCalendarHash: calendar.hash, sessionCalendarLineageHash: calendar.lineageHash, interval: "daily", anchorLocalTime: "15:30:00", nonSessionDayRule: "previous_session", createdAt: CREATED_AT });
  const records: ImmutablePolicyDependencyRecords = { selectionPolicies: selections, riskParameters: [parameter], riskRuleSets: [rules],
    drawdownSemantics: [drawdown], sessionCalendars: [calendar], scheduleBoundaries: [boundary] };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const targets = [0.35, 0.2, 0.15, 0.1, 0.05];
  const payload = { mode: "paper_only", recordType: "runtime_portfolio_policy_record", portfolioId: "paper-main",
    sourcePolicyRecordId: "fixture-source", sourcePolicyRecordHash: HASH, sourcePolicyHash: "b".repeat(64), policyId: "fixture", version, name: "Fixture policy",
    strategyBuckets: buckets.map((bucket, index) => ({ bucket, targetWeightRatio: targets[index]!, minWeightRatio: 0, maxWeightRatio: 0.5, maxTurnoverRatio: 0.5, maxDrawdownRatio: 0.1,
      turnoverWindow: { mode: "fixed_utc", durationSeconds: 86_400, anchor: "unix_epoch", denominator: "window_open_portfolio_net_worth_krw" }, drawdownSemanticsRef: drawdownSemanticsRefFor(drawdown),
      reviewCadence: bucket === "intraday" ? { mode: "every_tick" } : { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(boundary)] }, eventTriggers: [],
      selectionTrigger: { mode: "entry_floor_on_due_cycle", entryWeightRatio: 0.02 }, exitPolicy: { takeProfit: { mode: "disabled" }, timeExpiryAction: "review_required" },
      enabledMarkets: ["KR"], enabledAssetClasses: ["equity"], selectionPolicyRef: selectionPolicyRefFor(selections[index]!), riskRuleSetRef: riskRuleSetRefFor(rules) })),
    cashPolicy: { targetCashRatio: 0.15, minimumCashReserveKrw: 100, ruleSource: "static" }, hedgePolicy: { hedgeEnabled: true, hedgeTargetRatio: 0.05, maxCostRatio: 0.02 },
    exposurePolicy: { maxSymbolExposureRatio: 0.2, maxCountryExposureRatio: 0.8, maxCurrencyExposureRatio: 0.8 },
    legacyReduceOnlyPolicy: { allowBuyOrIncrease: false, maximumParticipationRatio: 0.1, riskRuleSetRef: riskRuleSetRefFor(rules) } };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt: CREATED_AT,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt: CREATED_AT }) });
  return { policy, dependencies, records };
}
