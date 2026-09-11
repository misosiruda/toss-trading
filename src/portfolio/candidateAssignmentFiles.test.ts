import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths, getDurableBucketSelectionRequestObservation } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignment, type CandidateAssignment } from "./candidateAssignment.js";
import { CandidateAssignmentFileRepository, createCandidateAssignmentPaths, getDurableCandidateAssignmentObservation,
  type VerifiedCandidateAssignmentHistory } from "./candidateAssignmentFiles.js";
import { createCandidateAssignmentSetRecord } from "./candidateAssignmentSet.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`, OTHER = `sha256:${"b".repeat(64)}`, AT = "2026-09-01T00:00:00.000Z";
const options = { lockTimeoutMs: 10000, lockRetryDelayMs: 5 };

test("assignment repository binds actual sources and seals all stored candidates once across restart and exact retries", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateAssignmentFileRepository(dir), a = await seed(dir, "A", 0.9), b = await seed(dir, "B", 0.8);
    const origin = await repo.appendAssignment(a);
    await repo.appendAssignment(b);
    const sealed = await repo.sealRequest(a.requestId);
    assert.equal(sealed.record.orderedAssignments.length, 2);
    assert.deepEqual(sealed.record.selectedAssignments.map((row) => [row.selectedRank, row.reservedMaximumNotionalKrw]), [[1, 70], [2, 30]]);
    assert.deepEqual(sealed.record, createCandidateAssignmentSetRecord({ request: request(), assignments: [b, a], createdAt: sealed.record.createdAt }));
    const before = await readFile(createCandidateAssignmentPaths(dir).recordsPath, "utf8");
    assert.equal(before.trim().split("\n").length, 6);
    const restarted = new CandidateAssignmentFileRepository(dir);
    assert.deepEqual(await restarted.appendAssignment(a), origin);
    assert.deepEqual(await restarted.sealRequest(a.requestId), sealed);
    await assert.rejects(restarted.appendAssignment(rebuild(a, { maximumNotionalKrw: 60 })), /ID collision/);
    await assert.rejects(restarted.appendAssignment({ ...a, createdAt: new Date(Date.parse(a.createdAt) + 1).toISOString() }), /ID collision/);
    await assert.rejects(restarted.appendAssignment(await seed(dir, "C")), /already sealed/);
    assert.equal(await readFile(createCandidateAssignmentPaths(dir).recordsPath, "utf8"), before);
    const all = await restarted.readAll();
    assert.equal(all.length, 3);
    assert.ok(Object.isFrozen(all[0]!.source.sizingInputObservation));
    assert.ok(Object.isFrozen(all[2]!.record));
    assert.equal(all[0]!.source.sizingInputObservation.originCount, 2);
  });
});

test("assignment repository seals an empty request and rejects missing requests without fabricating a source", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateAssignmentFileRepository(dir);
    await assert.rejects(repo.sealRequest(request().requestId), /request source is missing/);
    await new BucketSelectionRequestFileRepository(dir).append(request());
    const sealed = await repo.sealRequest(request().requestId);
    assert.deepEqual(sealed.record.orderedAssignments, []);
    assert.deepEqual(sealed.record.selectedAssignments, []);
    assert.equal(sealed.source.sizingInputObservation.generationHash, null);
    await assert.rejects(repo.appendAssignment(await seed(dir)), /already sealed/);
  });
});

test("assignment repository rejects missing mismatched and late sizing origins before any write", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateAssignmentFileRepository(dir), a = await seed(dir);
    const path = createCandidateAssignmentPaths(dir).recordsPath;
    for (const patch of [{ sizingInputRecordId: "missing" }, { sizingInputHash: OTHER }, { selectionScore: 0.1 },
      { symbol: "foreign" }, { createdAt: AT }, { createdAt: "9999-01-01T00:00:00.000Z" }]) {
      await assert.rejects(repo.appendAssignment(rebuild(a, patch)));
      await assert.rejects(readFile(path), { code: "ENOENT" });
      await assert.rejects(readFile(createCandidateAssignmentPaths(dir).pendingPath), { code: "ENOENT" });
    }
    await repo.appendAssignment(a);
  });
});

test("assignment replay rejects fully rehashed set omissions duplicate seals late assignments and source prefix forgery", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateAssignmentFileRepository(dir), a = await seed(dir, "A"), b = await seed(dir, "B");
    await repo.appendAssignment(a); await repo.appendAssignment(b); await repo.sealRequest(a.requestId);
    const path = createCandidateAssignmentPaths(dir).recordsPath, valid = await readFile(path, "utf8"), lines = valid.trim().split("\n").map((line) => JSON.parse(line));
    const rechain = (entries: typeof lines) => {
      let previous: string | null = null;
      return entries.flatMap((entry, ordinal) => {
        const { entryHash: _hash, ...payload } = { ...entry, previousCommitHash: previous,
          ...(ordinal > 2 ? { appendStartedAt: lines[5].committedAt } : {}) };
        const entryHash = hashCanonicalPayload(payload);
        const marker = { ...lines[Math.min(ordinal * 2 + 1, 5)], entryHash };
        const { commitHash: _commit, ...markerPayload } = marker;
        previous = hashCanonicalPayload(markerPayload);
        return [JSON.stringify({ ...payload, entryHash }), JSON.stringify({ ...markerPayload, commitHash: previous })];
      }).join("\n") + "\n";
    };
    const entries = [lines[0], lines[2], lines[4]];
    const alteredSet = createCandidateAssignmentSetRecord({ request: request(), assignments: [a], createdAt: lines[4].record.createdAt });
    const corrupted = [valid.trimEnd(), `${JSON.stringify(lines[0])}\n`, valid + "\n", "{broken}\n",
      rechain([entries[0], entries[1], { ...entries[2], record: alteredSet }]),
      rechain([...entries, entries[2]]), rechain([...entries, entries[0]]),
      rechain([{ ...entries[0], source: { ...entries[0].source, sizingInputObservation: { ...entries[0].source.sizingInputObservation, originCount: 0, generationHash: null } } }]),
      rechain([{ ...entries[0], source: { ...entries[0].source, sizingInputObservation: { ...entries[0].source.sizingInputObservation, generationHash: OTHER } } }]),
      rechain([{ ...entries[0], source: { ...entries[0].source, requestObservation: { ...entries[0].source.requestObservation, requestCount: 0, requestsHash: hashCanonicalPayload([]) } } }]),
      rechain([{ ...entries[0], extra: true }])];
    for (const corrupt of corrupted) {
      await writeFile(path, corrupt);
      await assert.rejects(new CandidateAssignmentFileRepository(dir).readAll(), /corrupt|torn/);
      await assert.rejects(repo.sealRequest(a.requestId), /corrupt|torn/);
      assert.equal(await readFile(path, "utf8"), corrupt);
    }
    await writeFile(path, valid);
    assert.equal((await repo.readAll()).length, 3);
  });
});

test("assignment reads and retries revalidate actual source logs including corrupt suffixes and missing sizing input", async () => {
  await temporary(async (dir) => {
    const repo = new CandidateAssignmentFileRepository(dir), a = await seed(dir);
    await repo.appendAssignment(a); await repo.sealRequest(a.requestId);
    for (const path of [createBucketSelectionRequestPaths(dir).recordsPath, createPortfolioSizingSnapshotPaths(dir).recordsPath, createCandidateSizingInputPaths(dir).recordsPath]) {
      const valid = await readFile(path);
      for (const bytes of [Buffer.from(""), Buffer.concat([valid, Buffer.from("{corrupt}\n")])]) {
        await writeFile(path, bytes);
        await assert.rejects(repo.readAll()); await assert.rejects(repo.sealRequest(a.requestId)); await assert.rejects(repo.appendAssignment(a));
        assert.deepEqual(await readFile(path), bytes);
      }
      await writeFile(path, valid);
    }
    assert.equal((await repo.readAll()).length, 2);
  });
});

test("assignment and seal writes serialize across processes and append versus seal has only complete outcomes", async () => {
  await temporary(async (dir) => {
    const a = await seed(dir), repo = new CandidateAssignmentFileRepository(dir, options);
    const run = async (method: "appendAssignment" | "sealRequest", value: unknown) => {
      const script = `import { CandidateAssignmentFileRepository } from ${JSON.stringify(new URL("./candidateAssignmentFiles.js", import.meta.url).href)}; console.log(JSON.stringify(await new CandidateAssignmentFileRepository(${JSON.stringify(dir)},${JSON.stringify(options)})[${JSON.stringify(method)}](${JSON.stringify(value)})));`;
      return JSON.parse((await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script])).stdout);
    };
    const origins = await Promise.all(Array.from({ length: 4 }, () => run("appendAssignment", a)));
    assert.ok(origins.every((origin) => origin.commitHash === origins[0].commitHash));
    const b = await seed(dir, "B");
    const outcomes = await Promise.allSettled([repo.appendAssignment(b), repo.sealRequest(a.requestId)]);
    assert.equal(outcomes[1]!.status, "fulfilled");
    const sets = await Promise.all(Array.from({ length: 4 }, () => run("sealRequest", a.requestId)));
    assert.ok(sets.every((origin) => origin.commitHash === sets[0].commitHash));
    assert.equal(sets[0].record.orderedAssignments.length, outcomes[0]!.status === "fulfilled" ? 2 : 1);
    if (outcomes[0]!.status === "rejected") assert.match(String(outcomes[0]!.reason), /already sealed/);
    const all = await repo.readAll();
    assert.equal(all.filter((origin) => origin.kind === "set").length, 1);
  });
});

test("assignment live observation holds all source locks and expires both assignment and shared request leases", async () => {
  await temporary(async (dir) => {
    const a = await seed(dir), repo = new CandidateAssignmentFileRepository(dir);
    await repo.appendAssignment(a);
    const short = { lockTimeoutMs: 30, lockRetryDelayMs: 5 };
    let captured: VerifiedCandidateAssignmentHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history; assert.ok(getDurableCandidateAssignmentObservation(history));
      assert.throws(() => getDurableCandidateAssignmentObservation({ ...history }), /lease/);
      for (const store of [new BucketSelectionRequestFileRepository(dir, short), new PortfolioSizingSnapshotFileRepository(dir, short),
        new CandidateSizingInputFileRepository(dir, short), new CandidateAssignmentFileRepository(dir, short)]) await assert.rejects(store.readAll(), /lock is unavailable/);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.throws(() => getDurableCandidateAssignmentObservation(captured!), /lease/);
    let requestHistory: Parameters<typeof getDurableBucketSelectionRequestObservation>[0] | undefined;
    await new CandidateSizingInputFileRepository(dir).withDurableVerifiedHistory(async (_inputs, requests) => {
      requestHistory = requests; assert.equal(getDurableBucketSelectionRequestObservation(requests).requestCount, 1);
    });
    assert.throws(() => getDurableBucketSelectionRequestObservation(requestHistory!), /lease/);
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("assignment and seal incomplete writes remain fail closed at entry marker and pending cleanup boundaries", async (context) => {
  for (const kind of ["assignment", "set"]) for (const failure of ["entry_write", "entry_sync", "marker_write", "marker_sync", "pending_remove"]) await temporary(async (dir) => {
    const a = await seed(dir), repo = new CandidateAssignmentFileRepository(dir), paths = createCandidateAssignmentPaths(dir);
    if (kind === "set") await repo.appendAssignment(a);
    const originalOpen = fs.open, originalUnlink = fs.unlink; let ordinal = 0, injected = false;
    const fail = () => { injected = true; throw new Error(`injected ${failure}`); };
    const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.recordsPath && args[1] === "a") {
        ordinal++;
        if ((ordinal === 1 && failure === "entry_write") || (ordinal === 2 && failure === "marker_write")) context.mock.method(handle, "writeFile", async () => fail());
        if ((ordinal === 1 && failure === "entry_sync") || (ordinal === 2 && failure === "marker_sync")) context.mock.method(handle, "sync", async () => fail());
      }
      return handle;
    });
    const removed = context.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
      if (args[0] === paths.pendingPath && failure === "pending_remove") fail();
      return originalUnlink(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(kind === "assignment" ? repo.appendAssignment(a) : repo.sealRequest(a.requestId), /injected/); assert.equal(injected, true); }
    finally { mocked.mock.restore(); removed.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(await readFile(paths.pendingPath));
    await assert.rejects(repo.readAll(), /pending append/); await assert.rejects(repo.appendAssignment(a), /pending append/);
    await assert.rejects(repo.sealRequest(a.requestId), /pending append/);
    await assert.rejects(readFile(paths.lockPath), { code: "ENOENT" });
  });
});

test("assignment abandoned and failed initialization locks remain intact with a bounded frozen-clock wait", async (context) => {
  await temporary(async (dir) => {
    await seed(dir);
    const repo = new CandidateAssignmentFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 }), paths = createCandidateAssignmentPaths(dir);
    const originalOpen = fs.open;
    const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.lockPath && args[1] === "wx") context.mock.method(handle, "sync", async () => { throw new Error("injected lock initialization"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.readAll(), /injected lock initialization/); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    const token = await readFile(paths.lockPath, "utf8");
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try { await assert.rejects(repo.readAll(), /candidate assignment repository lock is unavailable/); }
    finally { context.mock.timers.reset(); }
    assert.equal(await readFile(paths.lockPath, "utf8"), token);
  });
});

test("assignment durable observer rejects rewritten and invalid UTF-8 logs without mutating them", async (context) => {
  await temporary(async (dir) => {
    const a = rebuild(await seed(dir), { reasonCodes: ["\uFFFD"] }), repo = new CandidateAssignmentFileRepository(dir);
    await repo.appendAssignment(a);
    const path = createCandidateAssignmentPaths(dir).recordsPath, valid = await readFile(path), position = valid.indexOf(Buffer.from("\uFFFD"));
    assert.ok(position > 0);
    const corrupt = Buffer.concat([valid.subarray(0, position), Buffer.from([0xff]), valid.subarray(position + 3)]);
    await writeFile(path, corrupt); await assert.rejects(repo.readAll(), /invalid UTF-8/); assert.deepEqual(await readFile(path), corrupt);
    await writeFile(path, valid);
    const originalOpen = fs.open;
    const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") { const originalSync = handle.sync;
        context.mock.method(handle, "sync", async () => { await writeFile(path, ""); await originalSync.call(handle); }); }
      return handle;
    });
    syncBuiltinESMExports(); let called = false;
    try { await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }), /source changed/); assert.equal(called, false); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await readFile(path, "utf8"), "");
  });
});

function snapshot() {
  return createPortfolioSizingSnapshot({ portfolioId: "paper-portfolio", portfolioVersion: "v1", policyHash: HASH, asOf: AT,
    virtualPortfolio: { portfolioId: "paper-portfolio", cashKrw: 1000, positions: [], updatedAt: AT }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [], marketExposureKrw: { KR: 0, US: 0 },
      sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {}, pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
}
function request() {
  const source = snapshot();
  return createBucketSelectionRequest({ cycleId: "cycle", triggerIdentity: "scheduled:boundary", triggerRef: "slot", portfolioId: source.portfolioId,
    portfolioSnapshotId: source.portfolioSnapshotId, portfolioSnapshotHash: source.portfolioSnapshotHash, policyHash: HASH, asOf: AT,
    bucket: "intraday", gapBasis: "entry_floor", gapKrw: 100, availableSlots: 2, maximumAdditionalExposureKrw: 100, evidenceCutoffAt: AT, createdAt: AT });
}
async function seed(dir: string, symbol = "A", score = 0.8) {
  const source = request();
  await new BucketSelectionRequestFileRepository(dir).append(source);
  await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot());
  const input = createCandidateSizingInputRecord({ requestId: source.requestId, portfolioId: source.portfolioId, portfolioSnapshotId: source.portfolioSnapshotId,
    portfolioSnapshotHash: source.portfolioSnapshotHash, policyHash: HASH, asOf: AT, market: "KR", symbol, bucket: "intraday",
    scoringModelVersion: "score.v1", sizingAlgorithmVersion: "sizing.v1", selectionScore: score,
    exposureKeys: { sector: "Technology", country: "KR", currency: "KRW", classificationEvidenceRef: "classification" },
    featureInputs: [{ featureDefinitionRef: "feature", value: 1, evidenceRefs: ["evidence"] }],
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 1000, sectorRemainingKrw: 1000, countryRemainingKrw: 1000, currencyRemainingKrw: 1000, cashAvailableKrw: 1000 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 100, participationRate: 0.01, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 0, taxBps: 0, halfSpreadBps: 0, slippageBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0, evidenceRefs: ["cost"] }, createdAt: AT });
  await new CandidateSizingInputFileRepository(dir).append(input);
  return createCandidateAssignment({ requestId: source.requestId, portfolioId: source.portfolioId, portfolioSnapshotId: source.portfolioSnapshotId,
    portfolioSnapshotHash: source.portfolioSnapshotHash, policyHash: HASH, asOf: AT, market: "KR", symbol, bucket: "intraday", scoringModelVersion: "score.v1",
    selectionScore: score, sizingInputRecordId: input.sizingInputRecordId, sizingInputHash: input.sizingInputHash,
    minWeightRatio: 0.01, targetWeightRatio: 0.05, maxWeightRatio: 0.1, maximumNotionalKrw: 70,
    eligibility: "eligible", reasonCodes: ["synthetic"], evidenceRefs: ["evidence"], createdAt: new Date().toISOString() });
}
function rebuild(value: CandidateAssignment, patch: Record<string, unknown>) {
  const { assignmentId: _id, assignmentHash: _hash, sizingOutputHash: _output, ...payload } = value;
  return createCandidateAssignment({ ...payload, ...patch } as Parameters<typeof createCandidateAssignment>[0]);
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "candidate-assignment-files-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
