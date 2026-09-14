import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { readFile, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignmentPaths } from "./candidateAssignmentFiles.js";
import { createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSelectorOpeningCapacityReservationRecord as create, type SelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";
import { SelectorOpeningCapacityReservationFileRepository as Repository, createSelectorOpeningCapacityReservationPaths as paths,
  getDurableSelectorCapacityReservationObservation as observation, type VerifiedSelectorCapacityReservationHistory } from "./selectorOpeningCapacityReservationFiles.js";
import { HASH, OTHER, START, at, snapshot } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as storedFixture } from "./storedSelectorOpeningCapacityTestFixtures.js";

test("selector issuance files preserve actual source receipts exact retry and restart after later source append", async (context) => {
  await fixture(context, async ({ dir, record, request }) => {
    const repo = new Repository(dir);
    assert.deepEqual(await repo.readAll(), []);
    const origin = await repo.append(record), raw = await readFile(paths(dir).recordsPath, "utf8");
    assert.equal(raw.trim().split("\n").length, 2);
    assert.equal(origin.source.requestObservation.requestCount, 1);
    assert.equal(origin.source.assignmentObservation.originCount, 2);
    assert.equal(origin.source.sizingInputObservation.originCount, 1);
    assert.equal(origin.source.snapshotObservation.recordCount, 1);
    context.mock.timers.setTime(START + 70);
    const { requestId: _id, requestHash: _hash, ...payload } = request;
    await new BucketSelectionRequestFileRepository(dir).append(createBucketSelectionRequest({ ...payload, cycleId: "later", createdAt: at(70) }));
    await new PortfolioSizingSnapshotFileRepository(dir).append(createPortfolioSizingSnapshot({ ...snapshot(), portfolioVersion: "later" }));
    assert.deepEqual(await new Repository(dir).readAll(), [origin]);
    assert.deepEqual(await repo.append(record), origin);
    assert.equal(await readFile(paths(dir).recordsPath, "utf8"), raw);
    assertFrozen(origin);
    await assert.rejects(repo.append({ ...record, createdAt: at(51) }), /ID collision/);
    await assert.rejects(repo.append(rebuild(record, { reservedSlotOrdinal: 20 })), /already has an issuance/);
    assert.equal(await readFile(paths(dir).recordsPath, "utf8"), raw);
  });
});

test("selector issuance files reject missing rehashed mismatched and future actual sources before writing", async (context) => {
  await fixture(context, async ({ dir, record }) => {
    const repo = new Repository(dir);
    for (const patch of [{ selectionRequestId: "missing" }, { selectionRequestHash: OTHER }, { candidateAssignmentId: "missing" },
      { candidateAssignmentHash: OTHER }, { candidateAssignmentSetId: "missing" }, { candidateAssignmentSetHash: OTHER }, { selectedRank: 2 },
      { portfolioId: "other" }, { policyHash: OTHER }, { bucket: "swing" }, { market: "US" }, { symbol: "other" },
      { currentPortfolioSnapshotId: "missing" }, { currentPortfolioSnapshotHash: OTHER }, { reservedMaximumNotionalKrw: 99 },
      { createdAt: at(9) }, { createdAt: at(51) }]) await assert.rejects(repo.append(rebuild(record, patch)));
    await assert.rejects(repo.append({ ...record, trusted: true }));
    await assert.rejects(readFile(paths(dir).recordsPath), { code: "ENOENT" });
    await repo.append(record);
  });
});

test("selector issuance restart rejects rehashed receipts chains pairs and duplicate assignment identities", async (context) => {
  await fixture(context, async ({ dir, record }) => {
    const repo = new Repository(dir);
    await repo.append(record);
    const path = paths(dir).recordsPath, valid = await readFile(path, "utf8");
    const [entry, marker] = valid.trim().split("\n").map((line) => JSON.parse(line));
    const rehash = (patch: Record<string, unknown>, markerPatch: Record<string, unknown> = {}) => {
      const { entryHash: _hash, ...payload } = { ...entry, ...patch };
      const changed = { ...payload, entryHash: hashCanonicalPayload(payload) };
      const { commitHash: _commit, ...commitPayload } = { ...marker, ...markerPatch, entryHash: changed.entryHash };
      return `${JSON.stringify(changed)}\n${JSON.stringify({ ...commitPayload, commitHash: hashCanonicalPayload(commitPayload) })}\n`;
    };
    const sourceChanges = [
      { requestObservation: { ...entry.source.requestObservation, requestCount: 0, requestsHash: hashCanonicalPayload([]) } },
      { snapshotObservation: { ...entry.source.snapshotObservation, recordCount: 0, recordsHash: hashCanonicalPayload([]) } },
      { assignmentObservation: { ...entry.source.assignmentObservation, originCount: 0, generationHash: null } },
      { assignmentObservation: { ...entry.source.assignmentObservation, generationHash: OTHER } },
      { sizingInputObservation: { ...entry.source.sizingInputObservation, originCount: 0, generationHash: null } },
      { sizingInputObservation: { ...entry.source.sizingInputObservation, observedAt: at(49) } },
      { sizingInputObservation: { ...entry.source.sizingInputObservation, observedAt: at(51) } }
    ];
    const corruptions = [valid.trimEnd(), `${JSON.stringify(entry)}\n`, valid + "\n", valid + "{bad}\n",
      `${JSON.stringify({ ...entry, entryHash: OTHER })}\n${JSON.stringify(marker)}\n`, rehash({ previousCommitHash: OTHER }),
      rehash({ appendStartedAt: at(51) }), rehash({}, { committedAt: at(49) }), rehash({}, { committedAt: at(51) }),
      valid + rehash({ previousCommitHash: marker.commitHash }),
      valid + rehash({ previousCommitHash: marker.commitHash, record: rebuild(record, { reservedSlotOrdinal: 20 }) }),
      ...sourceChanges.map((patch) => rehash({ source: { ...entry.source, ...patch } }))];
    for (const corrupt of corruptions) {
      await writeFile(path, corrupt);
      await assert.rejects(new Repository(dir).readAll(), /torn|corrupt/);
      await assert.rejects(repo.append(record), /torn|corrupt/);
      assert.equal(await readFile(path, "utf8"), corrupt);
    }
    await writeFile(path, valid);
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("selector issuance reads revalidate all four actual source histories and preserve corrupt suffixes", async (context) => {
  await fixture(context, async ({ dir, record }) => {
    const repo = new Repository(dir); await repo.append(record);
    for (const path of [createBucketSelectionRequestPaths(dir).recordsPath, createPortfolioSizingSnapshotPaths(dir).recordsPath,
      createCandidateSizingInputPaths(dir).recordsPath, createCandidateAssignmentPaths(dir).recordsPath]) {
      const valid = await readFile(path, "utf8");
      for (const corrupt of ["", valid + "{broken}\n"]) {
        await writeFile(path, corrupt); await assert.rejects(repo.readAll()); await assert.rejects(repo.append(record));
        assert.equal(await readFile(path, "utf8"), corrupt);
      }
      await writeFile(path, valid);
    }
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("selector issuance concurrent exact retries converge and competing issuance cannot reuse an assignment", async (context) => {
  await fixture(context, async ({ dir, record }) => {
    const results = await Promise.all(Array.from({ length: 4 }, () => new Repository(dir).append(record)));
    for (const result of results) assert.deepEqual(result, results[0]);
    const outcomes = await Promise.allSettled([new Repository(dir).append(record), new Repository(dir).append(rebuild(record, { reservedSlotOrdinal: 20 }))]);
    assert.equal(outcomes[0]!.status, "fulfilled"); assert.equal(outcomes[1]!.status, "rejected");
    assert.equal((await readFile(paths(dir).recordsPath, "utf8")).trim().split("\n").length, 2);
  });
});

test("selector issuance exact retries converge across independent Node processes", async (context) => {
  const realNow = Date.now.bind(Date);
  await fixture(context, async ({ dir, record }) => {
    context.mock.timers.setTime(realNow());
    const moduleUrl = new URL("./selectorOpeningCapacityReservationFiles.js", import.meta.url).href;
    const script = `import { SelectorOpeningCapacityReservationFileRepository } from ${JSON.stringify(moduleUrl)};
      await new SelectorOpeningCapacityReservationFileRepository(${JSON.stringify(dir)}).append(${JSON.stringify(record)});`;
    await Promise.all(Array.from({ length: 2 }, () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "ignore", "pipe"] });
      let error = "";
      child.stderr.on("data", (chunk) => { error += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${error}`)));
    })));
    // Child processes use the real wall clock, unlike the parent fixture.
    context.mock.timers.setTime(realNow());
    assert.equal((await new Repository(dir).readAll()).length, 1);
    assert.equal((await readFile(paths(dir).recordsPath, "utf8")).trim().split("\n").length, 2);
  });
});

test("selector issuance retries only transient lock acquisition and propagates access denial", async (context) => {
  for (const code of ["EPERM", "EACCES"] as const) await fixture(context, async ({ dir }) => {
    const originalOpen = fs.open, path = paths(dir).lockPath;
    let attempts = 0;
    const injected = Object.assign(new Error(`injected ${code}`), { code });
    const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === path && args[1] === "wx" && ++attempts === 1) throw injected;
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      if (code === "EPERM" && process.platform === "win32") {
        assert.deepEqual(await new Repository(dir).readAll(), []); assert.equal(attempts, 2);
      } else {
        await assert.rejects(new Repository(dir).readAll(), (error) => error === injected); assert.equal(attempts, 1);
      }
    } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("selector issuance partial writes retain pending barriers and never silently recover", async (context) => {
  for (const failure of ["pending_sync", "entry_write", "entry_sync", "marker_write", "marker_sync", "pending_remove"] as const) {
    await fixture(context, async ({ dir, record }) => {
      const repo = new Repository(dir), path = paths(dir), originalOpen = fs.open, originalUnlink = fs.unlink;
      let ordinal = 0, injected = false;
      const fail = () => { injected = true; throw new Error(`injected ${failure}`); };
      const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (args[0] === path.pendingPath && args[1] === "wx" && failure === "pending_sync") context.mock.method(handle, "sync", async () => fail());
        if (args[0] === path.recordsPath && args[1] === "a") {
          const current = ++ordinal;
          if ((current === 1 && failure === "entry_write") || (current === 2 && failure === "marker_write")) context.mock.method(handle, "writeFile", async () => fail());
          if ((current === 1 && failure === "entry_sync") || (current === 2 && failure === "marker_sync")) context.mock.method(handle, "sync", async () => fail());
        }
        return handle;
      });
      const unlinked = context.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
        if (args[0] === path.pendingPath && failure === "pending_remove") fail();
        return originalUnlink(...args);
      });
      syncBuiltinESMExports();
      try { await assert.rejects(repo.append(record), /injected/); assert.equal(injected, true); }
      finally { opened.mock.restore(); unlinked.mock.restore(); syncBuiltinESMExports(); }
      assert.ok(await readFile(path.pendingPath, "utf8"));
      await assert.rejects(new Repository(dir).readAll(), /pending append requires explicit recovery/);
      await assert.rejects(repo.append(record), /pending append requires explicit recovery/);
      for (const lock of locks(dir)) await assert.rejects(readFile(lock), { code: "ENOENT" });
    });
  }
});

test("selector issuance holds all source locks during persistence and expires consumer leases on failure", async (context) => {
  await fixture(context, async ({ dir, record }) => {
    const repo = new Repository(dir), originalOpen = fs.open;
    let checked = false;
    const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths(dir).recordsPath && args[1] === "a" && !checked) {
        checked = true; for (const lock of locks(dir)) assert.ok((await readFile(lock, "utf8")).trim());
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await repo.append(record); assert.equal(checked, true); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    let captured: VerifiedSelectorCapacityReservationHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history; assert.equal(observation(history), at(50));
      assert.throws(() => observation({ ...history }), /durable observation lease/);
      for (const lock of locks(dir)) assert.ok((await readFile(lock, "utf8")).trim());
      await assert.rejects(new Repository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 }).readAll(), /lock is unavailable/);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.throws(() => observation(captured!), /durable observation lease/);
    assert.equal((await repo.readAll()).length, 1);
    for (const lock of locks(dir)) await assert.rejects(readFile(lock), { code: "ENOENT" });
  });
});

test("selector issuance rejects source rewrites during durable observation and retains failed lock initialization", async (context) => {
  await fixture(context, async ({ dir, record }) => {
    const repo = new Repository(dir), path = paths(dir); await repo.append(record);
    const originalOpen = fs.open;
    const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path.recordsPath && args[1] === "r+") {
        const sync = handle.sync;
        context.mock.method(handle, "sync", async () => { await writeFile(path.recordsPath, ""); await sync.call(handle); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    let called = false;
    try { await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }), /source changed/); assert.equal(called, false); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    const init = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path.lockPath && args[1] === "wx") context.mock.method(handle, "sync", async () => { throw new Error("injected lock sync"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.readAll(), /injected lock sync/); }
    finally { init.mock.restore(); syncBuiltinESMExports(); }
    const token = await readFile(path.lockPath, "utf8");
    await assert.rejects(new Repository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 }).readAll(), /selector capacity repository lock is unavailable/);
    assert.equal(await readFile(path.lockPath, "utf8"), token);
  });
});

async function fixture(context: TestContext, operation: (input: { dir: string; record: SelectorOpeningCapacityReservationRecord;
  request: Awaited<ReturnType<BucketSelectionRequestFileRepository["resolveById"]>> }) => Promise<void>) {
  await storedFixture(context, { count: 0 }, async (state) => {
    context.mock.timers.setTime(START + 50);
    const mandate = state.manual.mandate;
    if (mandate.assignmentSource !== "deterministic_selector") throw new Error("wrong fixture mandate");
    const request = await new BucketSelectionRequestFileRepository(state.dir).resolveById(mandate.selectionRequestId), current = snapshot();
    const record = create({ selectionRequestId: request.requestId, selectionRequestHash: request.requestHash,
      candidateAssignmentSetId: mandate.candidateAssignmentSetId, candidateAssignmentSetHash: mandate.candidateAssignmentSetHash,
      candidateAssignmentId: mandate.candidateAssignmentId, candidateAssignmentHash: state.manual.assignment.assignmentHash, selectedRank: mandate.selectedRank,
      portfolioId: mandate.portfolioId, policyHash: HASH, bucket: mandate.bucket, market: mandate.market, symbol: mandate.symbol,
      currentPortfolioSnapshotId: current.portfolioSnapshotId, currentPortfolioSnapshotHash: current.portfolioSnapshotHash,
      capacityLedgerVersion: 1, reservedSlotOrdinal: 19, reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: 100, createdAt: at(50) });
    await operation({ dir: state.dir, record, request });
  });
}
function rebuild(record: SelectorOpeningCapacityReservationRecord, patch: Record<string, unknown>) {
  const { selectorCapacityReservationId: _id, selectorCapacityReservationHash: _hash, ...payload } = record;
  return create({ ...payload, ...patch } as Parameters<typeof create>[0]);
}
function locks(dir: string) { return [createBucketSelectionRequestPaths(dir).lockPath, createPortfolioSizingSnapshotPaths(dir).lockPath,
  createCandidateSizingInputPaths(dir).lockPath, createCandidateAssignmentPaths(dir).lockPath, paths(dir).lockPath]; }
function assertFrozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); }
}
