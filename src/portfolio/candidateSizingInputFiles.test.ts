import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { createCandidateSizingInputRecord, type CandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths,
  getDurableCandidateSizingInputObservation, type VerifiedCandidateSizingInputHistory } from "./candidateSizingInputFiles.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T00:00:00.000Z";

test("candidate sizing input files persist source-bound candidate tuples with exact retry and restart", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateSizingInputFileRepository(dir);
    assert.deepEqual(await repo.readAll(), []);
    const one = await seed(dir);
    const origin = await repo.append(one);
    const two = await seed(dir, "second", true);
    await repo.append(two);
    const path = createCandidateSizingInputPaths(dir).recordsPath;
    const raw = await readFile(path, "utf8");
    assert.equal(raw.trim().split("\n").length, 4);
    await new BucketSelectionRequestFileRepository(dir).append(selectionRequest("later"));
    await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot("v2"));
    assert.deepEqual(await new CandidateSizingInputFileRepository(dir).append(one), origin);
    assert.equal(await readFile(path, "utf8"), raw);
    const all = await repo.readAll();
    assert.deepEqual(all.map((item) => item.record), [one, two]);
    assert.equal(all[0]!.source.requestObservation.requestCount, 1);
    assert.equal(all[0]!.source.snapshotObservation.recordCount, 1);
    assert.ok(Object.isFrozen(all[0]!.source.requestObservation));
    assert.ok(Object.isFrozen(all[0]!.record));
    await assert.rejects(repo.append({ ...one, createdAt: "2026-09-02T00:00:00.000Z" }), /ID collision/);
    assert.equal(await readFile(path, "utf8"), raw);
  });
});

test("candidate sizing input stable candidate identity refuses changed score feature cap and model payloads", async () => {
  await temporary(async (dir) => {
    const one = await seed(dir);
    const repo = new CandidateSizingInputFileRepository(dir);
    await repo.append(one);
    const path = createCandidateSizingInputPaths(dir).recordsPath;
    const before = await readFile(path, "utf8");
    for (const patch of [{ selectionScore: 3 }, { scoringModelVersion: "score.v2" }, { sizingAlgorithmVersion: "sizing.v2" },
      { featureInputs: [{ ...one.featureInputs[0]!, value: 9 }] },
      { exposureCapInputs: { ...one.exposureCapInputs, cashAvailableKrw: 499 } },
      { executionCostInput: { ...one.executionCostInput, estimatedCostKrw: 1 } }]) {
      const changed = rebuild(one, patch);
      assert.equal(changed.sizingInputRecordId, one.sizingInputRecordId);
      assert.notEqual(changed.sizingInputHash, one.sizingInputHash);
      await assert.rejects(repo.append(changed), /ID collision/);
    }
    assert.equal(await readFile(path, "utf8"), before);
    const secondSymbol = rebuild(one, { symbol: "SYNTH-SECOND" });
    assert.notEqual(secondSymbol.sizingInputRecordId, one.sizingInputRecordId);
    await repo.append(secondSymbol);
    assert.deepEqual((await repo.readAll()).map((origin) => origin.record), [one, secondSymbol]);
  });
});

test("candidate sizing input compares the request claims with an actual independently resolved snapshot", async () => {
  await temporary(async (dir) => {
    const source = selectionRequest();
    const { requestId: _id, requestHash: _hash, ...payload } = source;
    const wrong = createBucketSelectionRequest({ ...payload, portfolioSnapshotHash: OTHER });
    await new BucketSelectionRequestFileRepository(dir).append(wrong);
    await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot());
    const input = rebuild(sizing(), { requestId: wrong.requestId, portfolioSnapshotHash: OTHER });
    await assert.rejects(new CandidateSizingInputFileRepository(dir).append(input), /snapshot source/);
    const paths = createCandidateSizingInputPaths(dir);
    await assert.rejects(readFile(paths.recordsPath), { code: "ENOENT" });
    await assert.rejects(readFile(paths.pendingPath), { code: "ENOENT" });
  });
});

test("candidate sizing input files resolve actual source identities and refuse missing mismatched or future claims before writing", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateSizingInputFileRepository(dir);
    const input = sizing();
    await assert.rejects(repo.append(input), /request source is missing/);
    await new BucketSelectionRequestFileRepository(dir).append(selectionRequest());
    await assert.rejects(repo.append(input), /snapshot source/);
    await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot());
    for (const patch of [{ requestId: "missing" }, { policyHash: OTHER },
      { portfolioSnapshotHash: OTHER }, { portfolioSnapshotId: "missing" },
      { bucket: "long_term" }, { createdAt: "9999-01-01T00:00:00.000Z" }]) {
      await assert.rejects(repo.append(rebuild(input, patch)));
    }
    const foreign = snapshot("foreign", "another-portfolio");
    await new PortfolioSizingSnapshotFileRepository(dir).append(foreign);
    await assert.rejects(repo.append(rebuild(input, { portfolioSnapshotId: foreign.portfolioSnapshotId,
      portfolioSnapshotHash: foreign.portfolioSnapshotHash })), /snapshot source|request scope/);
    await assert.rejects(readFile(createCandidateSizingInputPaths(dir).recordsPath), { code: "ENOENT" });
    await repo.append(input);
  });
});

test("candidate sizing input restart rejects rehashed receipt tampering hash and chain changes malformed pairs and duplicates", async () => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new CandidateSizingInputFileRepository(dir);
    await repo.append(record);
    const path = createCandidateSizingInputPaths(dir).recordsPath;
    const valid = await readFile(path, "utf8");
    const [entry, marker] = valid.trim().split("\n").map((line) => JSON.parse(line));
    const rehash = (patch: Record<string, unknown>) => {
      const { entryHash: _hash, ...payload } = { ...entry, ...patch };
      const changed = { ...payload, entryHash: hashCanonicalPayload(payload) };
      const { commitHash: _commit, ...commitPayload } = { ...marker, entryHash: changed.entryHash };
      return `${JSON.stringify(changed)}\n${JSON.stringify({ ...commitPayload, commitHash: hashCanonicalPayload(commitPayload) })}\n`;
    };
    for (const corrupt of [valid.trimEnd(), `${JSON.stringify(entry)}\n`, valid + "\n", valid + "{bad}\n",
      `${JSON.stringify({ ...entry, entryHash: OTHER })}\n${JSON.stringify(marker)}\n`,
      rehash({ previousCommitHash: OTHER }), rehash({ source: { ...entry.source, requestObservation: { ...entry.source.requestObservation, requestCount: 0, requestsHash: hashCanonicalPayload([]) } } }),
      rehash({ source: { ...entry.source, snapshotObservation: { ...entry.source.snapshotObservation, recordsHash: OTHER } } }),
      rehash({ source: { ...entry.source, requestObservation: { ...entry.source.requestObservation, observedAt: "2026-08-31T23:59:59.999Z" } } }),
      rehash({ source: { ...entry.source, snapshotObservation: { ...entry.source.snapshotObservation, observedAt: "2026-08-31T23:59:59.999Z" } } }),
      rehash({ record: { ...record, selectionScore: 999 } }), rehash({ unknown: true }),
      rehash({ appendStartedAt: "9999-01-01T00:00:00.000Z" }), valid + rehash({ previousCommitHash: marker.commitHash })]) {
      await writeFile(path, corrupt);
      await assert.rejects(new CandidateSizingInputFileRepository(dir).readAll(), /torn|corrupt/);
      await assert.rejects(repo.append(record), /torn|corrupt/);
      assert.equal(await readFile(path, "utf8"), corrupt);
    }
    await writeFile(path, valid);
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("candidate sizing input reads revalidate original source prefixes and do not hide corrupt suffixes", async () => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new CandidateSizingInputFileRepository(dir);
    await repo.append(record);
    for (const path of [createBucketSelectionRequestPaths(dir).recordsPath, createPortfolioSizingSnapshotPaths(dir).recordsPath]) {
      const valid = await readFile(path, "utf8");
      for (const invalid of ["", valid + "{broken}\n"]) {
        await writeFile(path, invalid);
        await assert.rejects(repo.readAll());
        await assert.rejects(repo.append(record));
      }
      await writeFile(path, valid);
    }
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
    const value = { ...selectionRequest(), createdAt: "2026-09-01T00:01:00.000Z" };
    await writeFile(path, `${JSON.stringify(value)}\n`);
    await assert.rejects(repo.readAll(), /corrupt entry/);
  });
});

test("candidate sizing input concurrent exact retries produce only one durable pair", async () => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const result = await Promise.all(Array.from({ length: 4 }, () => new CandidateSizingInputFileRepository(dir).append(record)));
    for (const origin of result) assert.deepEqual(origin, result[0]);
    assert.equal((await new CandidateSizingInputFileRepository(dir).readAll()).length, 1);
    assert.equal((await readFile(createCandidateSizingInputPaths(dir).recordsPath, "utf8")).trim().split("\n").length, 2);
  });
});

test("candidate sizing input append failures retain a pending barrier and never return or silently recover partial entries", async (context) => {
  for (const failure of ["pending_sync", "entry_write", "entry_sync", "marker_write", "marker_sync", "pending_remove"] as const) await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new CandidateSizingInputFileRepository(dir);
    const paths = createCandidateSizingInputPaths(dir);
    const originalOpen = fs.open;
    const originalUnlink = fs.unlink;
    let appendOrdinal = 0;
    let injected = false;
    const fail = () => { injected = true; throw new Error(`injected ${failure}`); };
    const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.pendingPath && args[1] === "wx" && failure === "pending_sync") context.mock.method(handle, "sync", async () => fail());
      if (args[0] === paths.recordsPath && args[1] === "a") {
        const ordinal = ++appendOrdinal;
        if ((ordinal === 1 && failure === "entry_write") || (ordinal === 2 && failure === "marker_write")) context.mock.method(handle, "writeFile", async () => fail());
        if ((ordinal === 1 && failure === "entry_sync") || (ordinal === 2 && failure === "marker_sync")) context.mock.method(handle, "sync", async () => fail());
      }
      return handle;
    });
    const unlinked = context.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
      if (args[0] === paths.pendingPath && failure === "pending_remove") fail();
      return originalUnlink(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.append(record), /injected/); assert.equal(injected, true); }
    finally { opened.mock.restore(); unlinked.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(await readFile(paths.pendingPath, "utf8"));
    await assert.rejects(new CandidateSizingInputFileRepository(dir).readAll(), /pending append requires explicit recovery/);
    await assert.rejects(repo.append(record), /pending append requires explicit recovery/);
    for (const lockPath of [paths.lockPath, createBucketSelectionRequestPaths(dir).lockPath, createPortfolioSizingSnapshotPaths(dir).lockPath]) {
      await assert.rejects(readFile(lockPath), { code: "ENOENT" });
    }
  });
});

test("candidate sizing input persistence and live consumer retain both source locks and expire observation on failure", async (context) => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new CandidateSizingInputFileRepository(dir);
    const paths = createCandidateSizingInputPaths(dir);
    const requestStore = new BucketSelectionRequestFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    const snapshotStore = new PortfolioSizingSnapshotFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    const originalOpen = fs.open;
    let checked = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.recordsPath && args[1] === "a" && !checked) {
        checked = true;
        const originalSync = handle.sync;
        context.mock.method(handle, "sync", async () => {
          await assert.rejects(requestStore.append(selectionRequest("other")), /lock is unavailable/);
          await assert.rejects(snapshotStore.append(snapshot("other")), /lock is unavailable/);
          await originalSync.call(handle);
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await repo.append(record); assert.equal(checked, true); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    let captured: VerifiedCandidateSizingInputHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history;
      assert.ok(Date.parse(getDurableCandidateSizingInputObservation(history)) >= Date.parse(history.origins[0]!.committedAt));
      assert.throws(() => getDurableCandidateSizingInputObservation({ ...history }), /durable observation lease/);
      await assert.rejects(requestStore.append(selectionRequest("other")), /lock is unavailable/);
      await assert.rejects(snapshotStore.append(snapshot("other")), /lock is unavailable/);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.throws(() => getDurableCandidateSizingInputObservation(captured!), /durable observation lease/);
    await requestStore.append(selectionRequest("other"));
    await snapshotStore.append(snapshot("other"));
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("candidate sizing input observer rejects a source log rewritten while it is flushed", async (context) => {
  await temporary(async (dir) => {
    const repo = new CandidateSizingInputFileRepository(dir);
    await repo.append(await seed(dir));
    const path = createCandidateSizingInputPaths(dir).recordsPath;
    const originalOpen = fs.open;
    let called = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") {
        const originalSync = handle.sync;
        context.mock.method(handle, "sync", async () => { await writeFile(path, ""); await originalSync.call(handle); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }), /source changed/); assert.equal(called, false); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await readFile(path, "utf8"), "");
  });
});

test("candidate sizing input abandoned locks time out with frozen wall clock and initialization failure retains ownership evidence", async (context) => {
  await temporary(async (dir) => {
    await seed(dir);
    const repo = new CandidateSizingInputFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    const paths = createCandidateSizingInputPaths(dir);
    const originalOpen = fs.open;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.lockPath && args[1] === "wx") context.mock.method(handle, "sync", async () => { throw new Error("injected lock sync failure"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.readAll(), /injected lock sync failure/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    const token = await readFile(paths.lockPath, "utf8");
    assert.ok(token.trim().length > 0);
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try { await assert.rejects(repo.readAll(), /candidate sizing input repository lock is unavailable/); }
    finally { context.mock.timers.reset(); }
    assert.equal(await readFile(paths.lockPath, "utf8"), token);
  });
});

test("candidate sizing input durable reader refuses invalid UTF-8 despite valid lossy-decoded hashes", async () => {
  await temporary(async (dir) => {
    const base = await seed(dir);
    const record = rebuild(base, { featureInputs: [{ ...base.featureInputs[0]!, value: "\uFFFD" }] });
    const repo = new CandidateSizingInputFileRepository(dir);
    await repo.append(record);
    const path = createCandidateSizingInputPaths(dir).recordsPath;
    const raw = await readFile(path);
    const index = raw.indexOf(Buffer.from("\uFFFD"));
    assert.ok(index > 0);
    const corrupt = Buffer.concat([raw.subarray(0, index), Buffer.from([0xff]), raw.subarray(index + 3)]);
    assert.equal(corrupt.toString("utf8"), raw.toString("utf8"));
    await writeFile(path, corrupt);
    await assert.rejects(repo.readAll(), /invalid UTF-8/);
    await assert.rejects(repo.append(record), /invalid UTF-8/);
    assert.deepEqual(await readFile(path), corrupt);
  });
});

function snapshot(version = "v1", portfolioId = "paper-portfolio") {
  return createPortfolioSizingSnapshot({ portfolioId, portfolioVersion: version, policyHash: HASH, asOf: AT,
    virtualPortfolio: { portfolioId, cashKrw: 1000, positions: [], updatedAt: AT }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
}
function selectionRequest(cycleId = "first") {
  const source = snapshot();
  return createBucketSelectionRequest({ cycleId, triggerIdentity: "scheduled:boundary", triggerRef: "slot",
    portfolioId: source.portfolioId, portfolioSnapshotId: source.portfolioSnapshotId, portfolioSnapshotHash: source.portfolioSnapshotHash,
    policyHash: HASH, asOf: AT, bucket: "intraday", gapBasis: "entry_floor", gapKrw: 1000,
    availableSlots: 2, maximumAdditionalExposureKrw: 1000, evidenceCutoffAt: AT, createdAt: AT });
}
function sizing(id = "first", alternateMarket = false) {
  const source = selectionRequest(id);
  return createCandidateSizingInputRecord({
    requestId: source.requestId, portfolioId: source.portfolioId, portfolioSnapshotId: source.portfolioSnapshotId,
    portfolioSnapshotHash: source.portfolioSnapshotHash, policyHash: HASH, asOf: AT,
    market: alternateMarket ? "US" : "KR", symbol: alternateMarket ? "SYNTH" : "005930", bucket: source.bucket,
    scoringModelVersion: "score.v1", sizingAlgorithmVersion: "sizing.v1", selectionScore: 2,
    exposureKeys: { sector: "Technology", country: alternateMarket ? "US" : "KR", currency: alternateMarket ? "USD" : "KRW", classificationEvidenceRef: "classification" },
    featureInputs: [{ featureDefinitionRef: "feature-a", value: 1.5, evidenceRefs: ["evidence"] }],
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 900, sectorRemainingKrw: 800,
      countryRemainingKrw: 700, currencyRemainingKrw: 600, cashAvailableKrw: 500 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 500,
      participationRate: 0.01, estimatedCostKrw: 0, fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2,
      halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true, maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5,
      evidenceRefs: ["cost"] }, createdAt: AT });
}
function rebuild(record: CandidateSizingInputRecord, patch: Record<string, unknown>) {
  const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = record;
  return createCandidateSizingInputRecord({ ...payload, ...patch } as Parameters<typeof createCandidateSizingInputRecord>[0]);
}
async function seed(dir: string, id = "first", alternateMarket = false) {
  await new BucketSelectionRequestFileRepository(dir).append(selectionRequest(id));
  await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot());
  return sizing(id, alternateMarket);
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "candidate-sizing-input-files-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
