import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { ManualAssignmentFileRepository, createManualAssignmentPaths } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord, type ManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository, createManualOpeningCapacityReservationPaths,
  getDurableManualCapacityReservationObservation, type VerifiedManualCapacityReservationHistory } from "./manualOpeningCapacityReservationFiles.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T00:00:00.000Z";

test("manual capacity files persist source-bound new and increase records with exact retry and restart", async () => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    assert.deepEqual(await repo.readAll(), []);
    const one = await seed(dir);
    const origin = await repo.append(one);
    const two = await seed(dir, "second", true);
    await repo.append(two);
    const path = createManualOpeningCapacityReservationPaths(dir).recordsPath;
    const raw = await readFile(path, "utf8");
    assert.equal(raw.trim().split("\n").length, 4);
    await new ManualAssignmentFileRepository(dir).append(manual("later"));
    await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot("v2"));
    assert.deepEqual(await new ManualOpeningCapacityReservationFileRepository(dir).append(one), origin);
    assert.equal(await readFile(path, "utf8"), raw);
    const all = await repo.readAll();
    assert.deepEqual(all.map((item) => item.record), [one, two]);
    assert.equal(all[0]!.source.manualObservation.eventCount, 1);
    assert.equal(all[0]!.source.snapshotObservation.recordCount, 1);
    assert.ok(Object.isFrozen(all[0]!.source.manualObservation));
    assert.ok(Object.isFrozen(all[0]!.record));
    await assert.rejects(repo.append({ ...one, createdAt: "2026-09-02T00:00:00.000Z" }), /ID collision/);
    assert.equal(await readFile(path, "utf8"), raw);
  });
});

test("manual capacity files resolve actual source identities and refuse missing mismatched or future claims before writing", async () => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    const input = reservation();
    await assert.rejects(repo.append(input), /authorization source is missing/);
    await new ManualAssignmentFileRepository(dir).append(manual());
    await assert.rejects(repo.append(input), /snapshot source/);
    await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot());
    for (const patch of [{ manualAssignmentEventHash: OTHER }, { authorizationRef: "wrong" },
      { currentPortfolioSnapshotHash: OTHER }, { currentPortfolioSnapshotId: "missing" },
      { reservedMaximumNotionalKrw: 1001, resultingReservedNotionalKrw: 1001 }, { createdAt: "9999-01-01T00:00:00.000Z" }]) {
      await assert.rejects(repo.append(rebuild(input, patch)));
    }
    const foreign = snapshot("foreign", "another-portfolio");
    await new PortfolioSizingSnapshotFileRepository(dir).append(foreign);
    await assert.rejects(repo.append(rebuild(input, { currentPortfolioSnapshotId: foreign.portfolioSnapshotId,
      currentPortfolioSnapshotHash: foreign.portfolioSnapshotHash })), /snapshot source/);
    await assert.rejects(readFile(createManualOpeningCapacityReservationPaths(dir).recordsPath), { code: "ENOENT" });
    await repo.append(input);
  });
});

test("manual capacity restart rejects rehashed receipt tampering hash and chain changes malformed pairs and duplicates", async () => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    await repo.append(record);
    const path = createManualOpeningCapacityReservationPaths(dir).recordsPath;
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
      rehash({ previousCommitHash: OTHER }), rehash({ source: { ...entry.source, manualObservation: { ...entry.source.manualObservation, eventCount: 0, eventsHash: hashCanonicalPayload([]) } } }),
      rehash({ source: { ...entry.source, snapshotObservation: { ...entry.source.snapshotObservation, recordsHash: OTHER } } }),
      rehash({ appendStartedAt: "9999-01-01T00:00:00.000Z" }), valid + rehash({ previousCommitHash: marker.commitHash })]) {
      await writeFile(path, corrupt);
      await assert.rejects(new ManualOpeningCapacityReservationFileRepository(dir).readAll(), /torn|corrupt/);
      await assert.rejects(repo.append(record), /torn|corrupt/);
      assert.equal(await readFile(path, "utf8"), corrupt);
    }
    await writeFile(path, valid);
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("manual capacity reads revalidate original source prefixes and do not hide corrupt suffixes", async () => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    await repo.append(record);
    for (const path of [createManualAssignmentPaths(dir).eventsPath, createPortfolioSizingSnapshotPaths(dir).recordsPath]) {
      const valid = await readFile(path, "utf8");
      for (const invalid of ["", valid + "{broken}\n"]) {
        await writeFile(path, invalid);
        await assert.rejects(repo.readAll());
        await assert.rejects(repo.append(record));
      }
      await writeFile(path, valid);
    }
    const path = createManualAssignmentPaths(dir).eventsPath;
    const value = { ...manual(), createdAt: "2026-09-01T00:01:00.000Z" };
    await writeFile(path, `${JSON.stringify(value)}\n`);
    await assert.rejects(repo.readAll(), /corrupt entry/);
  });
});

test("manual capacity concurrent exact retries produce only one durable pair", async () => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const result = await Promise.all(Array.from({ length: 4 }, () => new ManualOpeningCapacityReservationFileRepository(dir).append(record)));
    for (const origin of result) assert.deepEqual(origin, result[0]);
    assert.equal((await new ManualOpeningCapacityReservationFileRepository(dir).readAll()).length, 1);
    assert.equal((await readFile(createManualOpeningCapacityReservationPaths(dir).recordsPath, "utf8")).trim().split("\n").length, 2);
  });
});

test("manual capacity append failures retain a pending barrier and never return or silently recover partial entries", async (context) => {
  for (const failure of ["pending_sync", "entry_write", "entry_sync", "marker_write", "marker_sync", "pending_remove"] as const) await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    const paths = createManualOpeningCapacityReservationPaths(dir);
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
    await assert.rejects(new ManualOpeningCapacityReservationFileRepository(dir).readAll(), /pending append requires explicit recovery/);
    await assert.rejects(repo.append(record), /pending append requires explicit recovery/);
    for (const lockPath of [paths.lockPath, createManualAssignmentPaths(dir).lockPath, createPortfolioSizingSnapshotPaths(dir).lockPath]) {
      await assert.rejects(readFile(lockPath), { code: "ENOENT" });
    }
  });
});

test("manual capacity persistence and live consumer retain both source locks and expire observation on failure", async (context) => {
  await temporary(async (dir) => {
    const record = await seed(dir);
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    const paths = createManualOpeningCapacityReservationPaths(dir);
    const manualStore = new ManualAssignmentFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    const snapshotStore = new PortfolioSizingSnapshotFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    const originalOpen = fs.open;
    let checked = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.recordsPath && args[1] === "a" && !checked) {
        checked = true;
        const originalSync = handle.sync;
        context.mock.method(handle, "sync", async () => {
          await assert.rejects(manualStore.append(manual("other")), /lock is unavailable/);
          await assert.rejects(snapshotStore.append(snapshot("other")), /lock is unavailable/);
          await originalSync.call(handle);
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await repo.append(record); assert.equal(checked, true); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    let captured: VerifiedManualCapacityReservationHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history;
      assert.ok(Date.parse(getDurableManualCapacityReservationObservation(history)) >= Date.parse(history.origins[0]!.committedAt));
      assert.throws(() => getDurableManualCapacityReservationObservation({ ...history }), /durable observation lease/);
      await assert.rejects(manualStore.append(manual("other")), /lock is unavailable/);
      await assert.rejects(snapshotStore.append(snapshot("other")), /lock is unavailable/);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.throws(() => getDurableManualCapacityReservationObservation(captured!), /durable observation lease/);
    await manualStore.append(manual("other"));
    await snapshotStore.append(snapshot("other"));
    assert.equal((await repo.readAll()).length, 1);
  });
});

test("manual capacity observer rejects a source log rewritten while it is flushed", async (context) => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir);
    await repo.append(await seed(dir));
    const path = createManualOpeningCapacityReservationPaths(dir).recordsPath;
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

test("manual capacity abandoned locks time out with frozen wall clock and initialization failure retains ownership evidence", async (context) => {
  await temporary(async (dir) => {
    await seed(dir);
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    const paths = createManualOpeningCapacityReservationPaths(dir);
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
    try { await assert.rejects(repo.readAll(), /manual capacity repository lock is unavailable/); }
    finally { context.mock.timers.reset(); }
    assert.equal(await readFile(paths.lockPath, "utf8"), token);
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
function manual(authorizationRef = "first") {
  const origin = snapshot();
  return createManualAssignmentEvent({ portfolioId: "paper-portfolio", policyHash: HASH, market: "KR", symbol: "005930", bucket: "intraday",
    asOf: AT, selectionPolicyRecordId: "selection", selectionPolicyHash: HASH, reasonCodes: ["manual"], evidenceRefs: ["evidence"],
    evidenceAsOf: AT, evidenceValidationHash: HASH, authorizationRef, createdAt: AT,
    authorizationScope: "open_or_increase", evidenceEligibility: "eligible", portfolioSnapshotId: origin.portfolioSnapshotId,
    portfolioSnapshotHash: origin.portfolioSnapshotHash, sizingInputRecordId: "sizing", minWeightRatio: 0, targetWeightRatio: 0.1,
    maxWeightRatio: 0.2, maximumNotionalKrw: 1000, sizingInputHash: HASH, sizingOutputHash: HASH });
}
function reservation(id = "first", increase = false) {
  const source = manual(id);
  const current = snapshot();
  const common = { manualAssignmentEventId: source.manualAssignmentEventId, manualAssignmentEventHash: source.manualAssignmentEventHash,
    portfolioId: source.portfolioId, policyHash: HASH, bucket: source.bucket, market: source.market, symbol: source.symbol,
    currentPortfolioSnapshotId: current.portfolioSnapshotId, currentPortfolioSnapshotHash: current.portfolioSnapshotHash,
    capacityLedgerVersion: increase ? 2 : 1, reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: increase ? 200 : 100,
    authorizationRef: id, createdAt: AT };
  return createManualOpeningCapacityReservationRecord(increase ? { ...common, reservationKind: "increase_existing", existingPositionRef: "position" }
    : { ...common, reservationKind: "new_position", reservedSlotOrdinal: 0 });
}
function rebuild(record: ManualOpeningCapacityReservationRecord, patch: Record<string, unknown>) {
  const { manualCapacityReservationId: _id, manualCapacityReservationHash: _hash, ...payload } = record;
  return createManualOpeningCapacityReservationRecord({ ...payload, ...patch } as Parameters<typeof createManualOpeningCapacityReservationRecord>[0]);
}
async function seed(dir: string, id = "first", increase = false) {
  await new ManualAssignmentFileRepository(dir).append(manual(id));
  await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot());
  return reservation(id, increase);
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "manual-capacity-files-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
