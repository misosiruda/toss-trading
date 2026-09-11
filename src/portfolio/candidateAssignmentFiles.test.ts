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
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths, getDurableCandidateSizingInputObservation } from "./candidateSizingInputFiles.js";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { resolveStoredSelectorMandateAssignmentBinding, resolveStoredSelectorMandateAssignmentBindings } from "./storedSelectorMandateAssignmentBinding.js";
import { resolveStoredSelectorOpeningCapacityMandateOrigins } from "./storedSelectorOpeningCapacityMandateOrigins.js";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
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
    let heldInputs: Parameters<typeof getDurableCandidateSizingInputObservation>[0] | undefined;
    let heldRequests: Parameters<typeof getDurableBucketSelectionRequestObservation>[0] | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history, inputs, requests) => {
      captured = history; assert.ok(getDurableCandidateAssignmentObservation(history));
      heldInputs = inputs; heldRequests = requests;
      assert.ok(getDurableCandidateSizingInputObservation(inputs));
      assert.equal(getDurableBucketSelectionRequestObservation(requests).requestCount, 1);
      assert.throws(() => getDurableCandidateSizingInputObservation({ ...inputs }), /lease/);
      assert.throws(() => getDurableBucketSelectionRequestObservation({ ...requests }), /lease/);
      assert.throws(() => getDurableCandidateAssignmentObservation({ ...history }), /lease/);
      for (const store of [new BucketSelectionRequestFileRepository(dir, short), new PortfolioSizingSnapshotFileRepository(dir, short),
        new CandidateSizingInputFileRepository(dir, short), new CandidateAssignmentFileRepository(dir, short)]) await assert.rejects(store.readAll(), /lock is unavailable/);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.throws(() => getDurableCandidateAssignmentObservation(captured!), /lease/);
    assert.throws(() => getDurableCandidateSizingInputObservation(heldInputs!), /lease/);
    assert.throws(() => getDurableBucketSelectionRequestObservation(heldRequests!), /lease/);
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
test("stored selector mandate resolves actual sealed sources without modifying bytes or granting activation", async () => temporary(async (dir) => {
  const fixture = await seedStoredSelectorMandate(dir);
  const paths = [createCandidateAssignmentPaths(dir).recordsPath, createCandidateSizingInputPaths(dir).recordsPath,
    createBucketSelectionRequestPaths(dir).recordsPath, createInvestmentMandatePaths(dir).recordsPath];
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredSelectorMandateAssignmentBinding({ baseDir: dir, mandateId: fixture.mandate.mandateId });
  assert.equal(result.binding.assignment.assignmentId, fixture.candidate.assignmentId);
  assert.equal(result.binding.mandate.mandateId, fixture.mandate.mandateId);
  assert.equal(result.binding.assessment.maximumOpeningNotionalKrw, 30);
  assert.equal(result.setOrigin.commitHash, fixture.sealed.commitHash);
  assert.equal(result.assignmentOrigins.length, 2);
  assert.equal(result.assessment.mandateActivationAuthority, "not_verified");
  assert.equal(result.assessment.capacityReservationAuthority, "not_verified");
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  assert.equal(result.assessment.sourceBeforeCreationReceipt, "not_recorded");
  assert.ok(Object.isFrozen(result.binding.assignment));
  assert.ok(Object.isFrozen(result.assignmentOrigins));
  const restarted = await resolveStoredSelectorMandateAssignmentBinding({ baseDir: dir, mandateId: fixture.mandate.mandateId });
  assert.deepEqual(restarted.binding, result.binding);
  assert.deepEqual(restarted.setOrigin, result.setOrigin);
  assert.equal(restarted.assessmentHash, hashCanonicalPayload(restarted.assessment));
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
}));

test("stored selector mandate rejects foreign source refs rationale and creation before seal commit", async () => {
  for (const failure of ["hash", "reason", "early", "future"]) await temporary(async (dir) => {
    const fixture = await seedStoredSelectorMandate(dir, failure);
    await assert.rejects(resolveStoredSelectorMandateAssignmentBinding({ baseDir: dir, mandateId: fixture.mandate.mandateId }),
      failure === "future" ? /creation is after its durable observation/ : failure === "early" ? /predates assignment set commit/ :
        failure === "reason" ? /reason or evidence/ : /exact selected/);
  });
});

test("stored selector mandate fails on missing sets corrupt source histories and external source overrides", async () => temporary(async (dir) => {
  const fixture = await seedStoredSelectorMandate(dir), query = { baseDir: dir, mandateId: fixture.mandate.mandateId };
  await assert.rejects(resolveStoredSelectorMandateAssignmentBinding({ ...query, mandateId: "missing" }), /source is missing/);
  const override = { ...query, assignments: [] };
  await assert.rejects(resolveStoredSelectorMandateAssignmentBinding(override));
  for (const path of [createInvestmentMandatePaths(dir).recordsPath, createCandidateAssignmentPaths(dir).recordsPath,
    createCandidateSizingInputPaths(dir).recordsPath, createBucketSelectionRequestPaths(dir).recordsPath]) {
    const original = await readFile(path, "utf8");
    await writeFile(path, `${original}{corrupt}\n`);
    await assert.rejects(resolveStoredSelectorMandateAssignmentBinding(query));
    await writeFile(path, original);
  }
  const path = createCandidateAssignmentPaths(dir).recordsPath, original = await readFile(path, "utf8");
  await writeFile(path, original.trimEnd().split("\n").slice(0, -2).join("\n") + "\n");
  await assert.rejects(resolveStoredSelectorMandateAssignmentBinding(query), /set source is missing/);
}));

test("stored selector capacity bindings preserve global slot and actual root mandate candidate sources", async () => temporary(async (dir) => {
  const data = await seedSelectorCapacity(dir);
  const paths = [createOpeningCapacityReservationEventPaths(dir).eventsPath, createInvestmentMandatePaths(dir).recordsPath,
    createCandidateAssignmentPaths(dir).recordsPath];
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId });
  assert.equal(result.bindings.length, 1);
  assert.deepEqual(result.bindings[0]!.root, data.root);
  assert.deepEqual(result.bindings[0]!.event, data.bound);
  assert.equal(result.bindings[0]!.source.binding.mandate.selectedRank, 2);
  assert.equal(result.bindings[0]!.source.binding.mandate.reservedSlotOrdinal, 19);
  assert.deepEqual(result.assessment.unverifiedEventIds, []);
  assert.equal(result.assessment.rootAllocationAuthority, "not_verified");
  assert.equal(result.assessment.mandateActivationAuthority, "not_verified");
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  assert.equal(result.assessment.sourceBeforeCreationReceipt, "not_recorded");
  assert.ok(Object.isFrozen(result.bindings[0]!.source.binding.mandate));
  assert.ok(Object.isFrozen(result.bindings));
  const restarted = await resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId });
  assert.deepEqual(restarted.bindings[0]!.rootOrigin, result.bindings[0]!.rootOrigin);
  assert.deepEqual(restarted.bindings[0]!.source.binding, result.bindings[0]!.source.binding);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
  assert.equal((await new InvestmentMandateFileRepository(dir).readSnapshot()).states[0]!.status, "proposed");
}));

test("stored selector capacity bindings reject independently hashed root lineage mismatches and missing sources", async () => {
  for (const mode of ["slot", "id", "hash", "amount", "set", "candidate", "policy", "bound_hash", "early", "missing", "corrupt"]) await temporary(async (dir) => {
    const data = await seedSelectorCapacity(dir, mode);
    if (mode === "missing") await writeFile(createInvestmentMandatePaths(dir).recordsPath, "");
    if (mode === "corrupt") await writeFile(createCandidateAssignmentPaths(dir).recordsPath, "{corrupt}\n");
    await assert.rejects(resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId }),
      mode === "early" ? /chronology mismatch/ : mode === "missing" ? /source is missing/ : mode === "corrupt" ? () => true : /exact root reservation lineage/);
  });
});

test("stored selector capacity reads each source once and shares validated set context across multiple bindings", async (context) => temporary(async (dir) => {
  const data = await seedSelectorCapacity(dir);
  const assignments = await new CandidateAssignmentFileRepository(dir).withDurableVerifiedHistory(async (history) => history);
  const a = assignments.origins.find((origin) => origin.kind === "assignment" && origin.record.symbol === "A");
  if (!a || a.kind !== "assignment") throw new Error("missing fixture assignment");
  const now = new Date().toISOString(), events = new OpeningCapacityReservationEventFileRepository(dir);
  const root = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: a.record.portfolioId, policyHash: a.record.policyHash,
    bucket: a.record.bucket, reservationId: "second-reservation", reservationHash: OTHER, remainingReservedNotionalKrw: 70,
    occupiesNewPositionSlot: true, capacityLedgerVersion: 3, asOf: now, createdAt: now,
    reservationSource: { sourceKind: "selector", candidateAssignmentSetId: data.sealed.record.candidateAssignmentSetId,
      candidateAssignmentSetHash: data.sealed.record.candidateAssignmentSetHash, candidateAssignmentId: a.record.assignmentId, reservedSlotOrdinal: 20 } });
  await events.append(root);
  if (data.mandate.assignmentSource !== "deterministic_selector") throw new Error("missing selector fixture");
  const { mandateId: _id, mandateHash: _hash, ...payload } = data.mandate;
  const mandate = createInvestmentMandateRecord({ ...payload, symbol: a.record.symbol, candidateAssignmentId: a.record.assignmentId,
    selectedRank: 1, selectionScore: a.record.selectionScore, maximumOpeningNotionalKrw: 70, reservedMaximumNotionalKrw: 70,
    openingCapacityReservationId: root.reservationId, openingCapacityReservationHash: root.reservationHash, reservedSlotOrdinal: 20,
    createdAt: new Date().toISOString() });
  await new InvestmentMandateFileRepository(dir).appendRecord(mandate);
  const later = new Date().toISOString();
  await events.append(createOpeningCapacityReservationEvent({ eventType: "bound_to_mandate", portfolioId: root.portfolioId,
    policyHash: root.policyHash, bucket: root.bucket, reservationId: root.reservationId, reservationHash: root.reservationHash,
    previousCapacityReservationEventId: root.capacityReservationEventId, mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
    remainingReservedNotionalKrw: 70, occupiesNewPositionSlot: true, capacityLedgerVersion: 4, asOf: later, createdAt: later }));
  await assert.rejects(resolveStoredSelectorMandateAssignmentBindings({ baseDir: dir, mandateIds: [mandate.mandateId, mandate.mandateId] }), /unique IDs/);
  await assert.rejects(resolveStoredSelectorMandateAssignmentBindings({ baseDir: dir, mandateIds: ["missing"] }), /source is missing/);
  const spies = [InvestmentMandateFileRepository, CandidateAssignmentFileRepository, CandidateSizingInputFileRepository,
    BucketSelectionRequestFileRepository, PortfolioSizingSnapshotFileRepository].map((repository) =>
    context.mock.method(repository.prototype, "withDurableVerifiedHistory"));
  const eventSpy = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory");
  try {
    const result = await resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId });
    assert.equal(result.bindings.length, 2);
    assert.deepEqual(result.assessment.unverifiedEventIds, []);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 1);
    assert.equal(eventSpy.mock.callCount(), 2);
    assert.equal(result.bindings[0]!.source.binding.set, result.bindings[1]!.source.binding.set);
    assert.equal(result.bindings[0]!.source.assignmentOrigins, result.bindings[1]!.source.assignmentOrigins);
    assert.equal(result.bindings[0]!.source.assessment.mandateObservation, result.bindings[1]!.source.assessment.mandateObservation);
  } finally { context.mock.restoreAll(); }
}));

test("stored selector capacity bindings list unbound roots and reject event generation changes during source reads", async (context) => {
  await temporary(async (dir) => {
    const data = await seedSelectorCapacity(dir, "unbound");
    const result = await resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId });
    assert.equal(result.bindings.length, 0);
    assert.deepEqual(result.assessment.unverifiedEventIds, [data.root.capacityReservationEventId]);
    await assert.rejects(resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId, events: [] } as never));
  });
  await temporary(async (dir) => {
    const data = await seedSelectorCapacity(dir);
    const original = CandidateAssignmentFileRepository.prototype.withDurableVerifiedHistory;
    context.mock.method(CandidateAssignmentFileRepository.prototype, "withDurableVerifiedHistory", async function (
      this: CandidateAssignmentFileRepository, operation: Parameters<typeof original>[0]
    ) {
      const result = await original.call(this, operation);
      const now = new Date().toISOString();
      await new OpeningCapacityReservationEventFileRepository(dir).append(createOpeningCapacityReservationEvent({
        eventType: "reserved", portfolioId: data.candidate.portfolioId, policyHash: data.candidate.policyHash, bucket: data.candidate.bucket,
        reservationId: "unverified-manual", reservationHash: HASH,
        reservationSource: { sourceKind: "manual", manualCapacityReservationId: "unverified-manual", manualCapacityReservationHash: HASH },
        remainingReservedNotionalKrw: 1, occupiesNewPositionSlot: true, capacityLedgerVersion: 3, asOf: now, createdAt: now
      }));
      return result;
    });
    try {
      await assert.rejects(resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId }), /event generation changed/);
    } finally { context.mock.restoreAll(); }
    const journal = await new OpeningCapacityReservationEventFileRepository(dir).readAll();
    const result = await resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId });
    assert.equal(result.bindings.length, 1);
    assert.deepEqual(result.assessment.unverifiedEventIds, [journal[2]!.capacityReservationEventId]);
    const now = new Date().toISOString();
    const released = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: data.root.portfolioId,
      policyHash: data.root.policyHash, bucket: data.root.bucket, reservationId: data.root.reservationId, reservationHash: data.root.reservationHash,
      previousCapacityReservationEventId: data.bound.capacityReservationEventId, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
      capacityLedgerVersion: 4, asOf: now, createdAt: now, releaseReasonCode: "synthetic-terminal",
      releaseOrigin: { originKind: "mandate_terminal", mandateId: data.mandate.mandateId, mandateHash: data.mandate.mandateHash,
        mandateEventId: "unverified-terminal", mandateEventHash: HASH } });
    await new OpeningCapacityReservationEventFileRepository(dir).append(released);
    const terminal = await resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: data.candidate.portfolioId });
    assert.equal(terminal.bindings.length, 1);
    assert.deepEqual(terminal.assessment.unverifiedEventIds, [journal[2]!.capacityReservationEventId, released.capacityReservationEventId]);
  });
});

async function seedSelectorCapacity(dir: string, mode = "none") {
  let root!: OpeningCapacityReservationEvent;
  const events = new OpeningCapacityReservationEventFileRepository(dir);
  const fixture = await seedStoredSelectorMandate(dir, "none", async (candidate, sealed) => {
    const now = new Date().toISOString();
    root = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: candidate.portfolioId,
      policyHash: mode === "policy" ? OTHER : candidate.policyHash, bucket: candidate.bucket,
      reservationId: mode === "id" ? "different-reservation" : "synthetic-reservation", reservationHash: mode === "hash" ? OTHER : HASH,
      reservationSource: { sourceKind: "selector", candidateAssignmentSetId: sealed.record.candidateAssignmentSetId,
        candidateAssignmentSetHash: mode === "set" ? OTHER : sealed.record.candidateAssignmentSetHash,
        candidateAssignmentId: mode === "candidate" ? "different-candidate" : candidate.assignmentId, reservedSlotOrdinal: mode === "slot" ? 2 : 19 },
      remainingReservedNotionalKrw: mode === "amount" ? 29 : 30, occupiesNewPositionSlot: true,
      capacityLedgerVersion: 1, asOf: mode === "early" ? AT : now, createdAt: now });
    await events.append(root);
  });
  const now = new Date().toISOString();
  const bound = createOpeningCapacityReservationEvent({ eventType: "bound_to_mandate", portfolioId: root.portfolioId,
    policyHash: root.policyHash, bucket: root.bucket, reservationId: root.reservationId, reservationHash: root.reservationHash,
    previousCapacityReservationEventId: root.capacityReservationEventId, mandateId: fixture.mandate.mandateId,
    mandateHash: mode === "bound_hash" ? OTHER : fixture.mandate.mandateHash,
    remainingReservedNotionalKrw: root.remainingReservedNotionalKrw, occupiesNewPositionSlot: true, capacityLedgerVersion: 2, asOf: now, createdAt: now });
  if (mode !== "unbound") await events.append(bound);
  return { ...fixture, root, bound };
}

async function seedStoredSelectorMandate(dir: string, failure = "none", beforeMandate?: (candidate: CandidateAssignment,
  sealed: Awaited<ReturnType<CandidateAssignmentFileRepository["sealRequest"]>>) => Promise<void>) {
  const a = await seed(dir, "A", 0.9), candidate = await seed(dir, "B", 0.8), repo = new CandidateAssignmentFileRepository(dir);
  await repo.appendAssignment(a); await repo.appendAssignment(candidate);
  const sealed = await repo.sealRequest(candidate.requestId), selected = sealed.record.selectedAssignments[1]!;
  await beforeMandate?.(candidate, sealed);
  const mandate = createInvestmentMandateRecord({ portfolioId: candidate.portfolioId, market: candidate.market, symbol: candidate.symbol,
    bucket: candidate.bucket, policyHash: candidate.policyHash, asOf: AT, minWeightRatio: candidate.minWeightRatio,
    targetWeightRatio: candidate.targetWeightRatio, maxWeightRatio: candidate.maxWeightRatio, maximumOpeningNotionalKrw: selected.reservedMaximumNotionalKrw,
    reasonCodes: failure === "reason" ? ["fabricated"] : candidate.reasonCodes, evidenceRefs: candidate.evidenceRefs, evidenceAsOf: AT,
    reviewCadence: { mode: "every_tick" }, validFrom: AT, assignmentSource: "deterministic_selector", selectionRequestId: candidate.requestId,
    candidateAssignmentId: candidate.assignmentId, candidateAssignmentSetId: sealed.record.candidateAssignmentSetId,
    candidateAssignmentSetHash: failure === "hash" ? OTHER : sealed.record.candidateAssignmentSetHash, selectedRank: selected.selectedRank,
    openingCapacityReservationId: "synthetic-reservation", openingCapacityReservationHash: HASH, reservedSlotOrdinal: 19,
    reservedMaximumNotionalKrw: selected.reservedMaximumNotionalKrw, scoringModelVersion: candidate.scoringModelVersion, selectionScore: candidate.selectionScore,
    createdAt: failure === "early" ? new Date(Date.parse(sealed.committedAt) - 1).toISOString() :
      new Date(Date.now() + (failure === "future" ? 86_400_000 : 0)).toISOString() });
  await new InvestmentMandateFileRepository(dir).appendRecord(mandate);
  return { candidate, sealed, mandate };
}

function rebuild(value: CandidateAssignment, patch: Record<string, unknown>) {
  const { assignmentId: _id, assignmentHash: _hash, sizingOutputHash: _output, ...payload } = value;
  return createCandidateAssignment({ ...payload, ...patch } as Parameters<typeof createCandidateAssignment>[0]);
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "candidate-assignment-files-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
