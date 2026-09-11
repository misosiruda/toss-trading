import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { ManualAssignmentFileRepository, createManualAssignmentPaths } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository, createManualOpeningCapacityReservationPaths } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { resolveStoredManualOpeningCapacityEventOrigins } from "./storedManualOpeningCapacityEventOrigins.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T00:00:00.000Z";
const START = Date.parse(AT);
const PORTFOLIO = "paper-portfolio";

test("stored manual roots bind actual new and increase origins across restart and preserve old observations", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  const move = (ms: number) => context.mock.timers.setTime(START + ms);
  await temporary(async (dir) => {
    const one = await seed(dir, move);
    const first = await resolve(dir);
    assert.equal(first.bindings.length, 1);
    assert.deepEqual(first.bindings[0]!.reservation, one.reservation);
    assert.deepEqual(first.bindings[0]!.manualAssignmentEvent, one.manual);
    assert.deepEqual(first.bindings[0]!.event, one.event);
    assert.deepEqual(first.bindings[0]!.reservationOrigin, one.reservationOrigin);
    assert.deepEqual(first.bindings[0]!.eventOrigin, one.eventOrigin);
    const again = await resolve(dir);
    assert.deepEqual(again, first);
    const two = await seed(dir, (ms) => move(ms + 100), "two", true, HASH, 2);
    const later = await resolve(dir);
    assert.equal(later.bindings.length, 2);
    assert.deepEqual(later.bindings[1]!.reservation, two.reservation);
    assert.deepEqual(later.bindings[0], first.bindings[0]);
    assert.notEqual(later.assessmentHash, first.assessmentHash);
    assert.equal(first.bindings.length, 1);
    for (const value of [later, later.bindings, later.bindings[0], later.assessment,
      later.assessment.manualObservation, later.assessment.unverifiedSelectorEventIds]) assert.ok(Object.isFrozen(value));
    assert.equal(later.assessment.verificationScope, "stored_manual_reserved_event_origins_only");
    assert.equal(later.assessment.slotAndBudgetAllocationAuthority, "not_verified");
    assert.equal(later.assessment.currentExecutionAuthority, "not_granted");
    assert.equal(later.assessment.sourceBeforeCreationReceipt, "not_recorded");
  });
});

test("stored manual roots refuse missing or damaged reservation authorization snapshot and event bytes", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    for (const path of [createManualOpeningCapacityReservationPaths(dir).recordsPath, createManualAssignmentPaths(dir).eventsPath,
      createPortfolioSizingSnapshotPaths(dir).recordsPath, createOpeningCapacityReservationEventPaths(dir).eventsPath]) {
      const valid = await readFile(path, "utf8");
      for (const raw of [valid.trimEnd(), valid + "{bad}\n"]) {
        await writeFile(path, raw);
        await assert.rejects(resolve(dir));
        assert.equal(await readFile(path, "utf8"), raw);
      }
      await writeFile(path, valid);
      if (path !== createOpeningCapacityReservationEventPaths(dir).eventsPath) {
        await unlink(path);
        await assert.rejects(resolve(dir));
        await writeFile(path, valid);
      }
    }
    assert.equal((await resolve(dir)).bindings.length, 1);
  });
});

test("stored manual roots reject rehashed event source scope version amount and slot claims", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  for (const patch of [{ policyHash: OTHER }, { bucket: "swing" }, { remainingReservedNotionalKrw: 99 },
    { occupiesNewPositionSlot: false }]) await temporary(async (dir) => {
    const data = await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
    // Replace only this synthetic fixture's event journal to exercise a structurally valid but unbound root.
    await unlink(path);
    await new OpeningCapacityReservationEventFileRepository(dir).append(rebuild(data.event, patch));
    await assert.rejects(resolve(dir), /does not match/);
  });
  await temporary(async (dir) => {
    context.mock.timers.setTime(START);
    const record = reservation("one", false, HASH, 2);
    await storeReservation(dir, record, manual());
    context.mock.timers.setTime(START + 20);
    await new OpeningCapacityReservationEventFileRepository(dir).append(rebuild(event(record), { capacityLedgerVersion: 1 }));
    await assert.rejects(resolve(dir), /does not match/);
  });
});

test("stored manual roots reject forged identity and same-time or later persisted reservation origins", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  for (const eventAt of [START, START - 1]) await temporary(async (dir) => {
    context.mock.timers.setTime(START);
    const record = reservation();
    await storeReservation(dir, record, manual());
    const candidate = event(record);
    await new OpeningCapacityReservationEventFileRepository(dir).append(rebuild(candidate, { asOf: new Date(eventAt).toISOString() }));
    await assert.rejects(resolve(dir), /did not precede|does not match/);
  });
  await temporary(async (dir) => {
    context.mock.timers.setTime(START);
    const record = reservation();
    context.mock.timers.setTime(START + 20);
    const candidate = event(record);
    await new OpeningCapacityReservationEventFileRepository(dir).append(candidate);
    context.mock.timers.setTime(START + 30);
    await storeReservation(dir, record, manual());
    await assert.rejects(resolve(dir), /did not precede/);
  });
  await temporary(async (dir) => {
    context.mock.timers.setTime(START);
    const candidate = event(reservation());
    await new OpeningCapacityReservationEventFileRepository(dir).append(candidate);
    await assert.rejects(resolve(dir), /source is missing/);
  });
});

test("stored manual roots include terminal reservations and older policies without claiming selector or successor verification", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  const move = (ms: number) => context.mock.timers.setTime(START + ms);
  await temporary(async (dir) => {
    const old = await seed(dir, move);
    move(30);
    const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, reservationSource: _source, ...payload } = old.event as Extract<OpeningCapacityReservationEvent, { eventType: "reserved" }>;
    const released = createOpeningCapacityReservationEvent({ ...payload, eventType: "released", capacityLedgerVersion: 2,
      previousCapacityReservationEventId: old.event.capacityReservationEventId, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
      asOf: new Date().toISOString(), createdAt: new Date().toISOString(), releaseReasonCode: "cancelled",
      releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "request" } });
    await new OpeningCapacityReservationEventFileRepository(dir).append(released);
    const latest = await seed(dir, (ms) => move(ms + 100), "other-policy", false, OTHER);
    move(150);
    const selector = rebuild(latest.event, { capacityLedgerVersion: 2, reservationId: "selector", reservationHash: HASH,
      asOf: new Date().toISOString(), createdAt: new Date().toISOString(), reservationSource: { sourceKind: "selector",
        candidateAssignmentSetId: "set", candidateAssignmentSetHash: HASH, candidateAssignmentId: "assignment", reservedSlotOrdinal: 0 } });
    await new OpeningCapacityReservationEventFileRepository(dir).append(selector);
    const result = await resolve(dir);
    assert.equal(result.bindings.length, 2);
    assert.deepEqual(result.assessment.unverifiedSuccessorEventIds, [released.capacityReservationEventId]);
    assert.deepEqual(result.assessment.unverifiedSelectorEventIds, [selector.capacityReservationEventId]);
    await unlink(createManualOpeningCapacityReservationPaths(dir).recordsPath);
    await assert.rejects(resolve(dir), /source is missing/);
  });
});

test("stored manual roots capture the portfolio input and report empty scope without manufacturing bindings", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const input = { baseDir: dir, portfolioId: PORTFOLIO };
    const pending = resolveStoredManualOpeningCapacityEventOrigins(input);
    input.baseDir = join(dir, "missing"); input.portfolioId = "foreign";
    assert.equal((await pending).bindings.length, 1);
    await assert.rejects(resolveStoredManualOpeningCapacityEventOrigins({ baseDir: dir, portfolioId: PORTFOLIO, extra: true } as typeof input));
    const empty = await resolveStoredManualOpeningCapacityEventOrigins({ baseDir: dir, portfolioId: "foreign" });
    assert.equal(empty.bindings.length, 0);
    assert.equal(empty.assessment.verifiedManualRootCount, 0);
    assert.equal(empty.assessment.slotAndBudgetAllocationAuthority, "not_verified");
  });
});

test("stored manual root resolution fails closed on source fsync errors and observation clock rollback", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const path = createManualOpeningCapacityReservationPaths(dir).recordsPath;
    const originalOpen = fs.open;
    for (const failure of ["sync", "clock"]) {
      context.mock.timers.setTime(START + 100);
      const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (args[0] === path && args[1] === "r+") {
          if (failure === "sync") context.mock.method(handle, "sync", async () => { throw new Error("injected reservation fsync"); });
          else context.mock.timers.setTime(START + 50);
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(resolve(dir), /injected reservation fsync|clock moved backwards/); }
      finally { opened.mock.restore(); syncBuiltinESMExports(); }
    }
    context.mock.timers.setTime(START + 200);
    assert.equal((await resolve(dir)).bindings.length, 1);
  });
});

function resolve(dir: string) { return resolveStoredManualOpeningCapacityEventOrigins({ baseDir: dir, portfolioId: PORTFOLIO }); }
function snapshot(policyHash = HASH) {
  return createPortfolioSizingSnapshot({ portfolioId: PORTFOLIO, portfolioVersion: "v1", policyHash, asOf: AT,
    virtualPortfolio: { portfolioId: PORTFOLIO, cashKrw: 1000, positions: [], updatedAt: AT }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
}
function manual(id = "one", policyHash = HASH) {
  const origin = snapshot(policyHash);
  return createManualAssignmentEvent({ portfolioId: PORTFOLIO, policyHash, market: "KR", symbol: "005930", bucket: "intraday",
    asOf: AT, selectionPolicyRecordId: "selection", selectionPolicyHash: HASH, reasonCodes: ["manual"], evidenceRefs: ["evidence"],
    evidenceAsOf: AT, evidenceValidationHash: HASH, authorizationRef: id, createdAt: AT,
    authorizationScope: "open_or_increase", evidenceEligibility: "eligible", portfolioSnapshotId: origin.portfolioSnapshotId,
    portfolioSnapshotHash: origin.portfolioSnapshotHash, sizingInputRecordId: "sizing", minWeightRatio: 0, targetWeightRatio: 0.1,
    maxWeightRatio: 0.2, maximumNotionalKrw: 1000, sizingInputHash: HASH, sizingOutputHash: HASH });
}
function reservation(id = "one", increase = false, policyHash = HASH, version = 1) {
  const source = manual(id, policyHash), current = snapshot(policyHash);
  const common = { manualAssignmentEventId: source.manualAssignmentEventId, manualAssignmentEventHash: source.manualAssignmentEventHash,
    portfolioId: source.portfolioId, policyHash, bucket: source.bucket, market: source.market, symbol: source.symbol,
    currentPortfolioSnapshotId: current.portfolioSnapshotId, currentPortfolioSnapshotHash: current.portfolioSnapshotHash,
    capacityLedgerVersion: version, reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: increase ? 200 : 100,
    authorizationRef: id, createdAt: AT };
  return createManualOpeningCapacityReservationRecord(increase ? { ...common, reservationKind: "increase_existing", existingPositionRef: "position" }
    : { ...common, reservationKind: "new_position", reservedSlotOrdinal: 0 });
}
function event(record: ReturnType<typeof reservation>) {
  return createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: record.portfolioId, policyHash: record.policyHash,
    bucket: record.bucket, reservationId: record.manualCapacityReservationId, reservationHash: record.manualCapacityReservationHash,
    reservationSource: { sourceKind: "manual", manualCapacityReservationId: record.manualCapacityReservationId, manualCapacityReservationHash: record.manualCapacityReservationHash },
    capacityLedgerVersion: record.capacityLedgerVersion, remainingReservedNotionalKrw: record.reservedMaximumNotionalKrw,
    occupiesNewPositionSlot: record.reservationKind === "new_position", asOf: new Date().toISOString(), createdAt: new Date().toISOString() });
}
async function storeReservation(dir: string, record: ReturnType<typeof reservation>, source: ReturnType<typeof manual>) {
  await new ManualAssignmentFileRepository(dir).append(source);
  await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot(record.policyHash));
  return new ManualOpeningCapacityReservationFileRepository(dir).append(record);
}
async function seed(dir: string, move: (ms: number) => void, id = "one", increase = false, policyHash = HASH, version = 1) {
  move(10);
  const record = reservation(id, increase, policyHash, version), source = manual(id, policyHash);
  const reservationOrigin = await storeReservation(dir, record, source);
  move(20);
  const root = event(record);
  const eventOrigin = await new OpeningCapacityReservationEventFileRepository(dir).append(root);
  return { reservation: record, manual: source, event: root, reservationOrigin, eventOrigin };
}
function rebuild(value: OpeningCapacityReservationEvent, patch: Record<string, unknown>) {
  const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...input } = value;
  return createOpeningCapacityReservationEvent({ ...input, ...patch } as Parameters<typeof createOpeningCapacityReservationEvent>[0]);
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "stored-manual-capacity-origins-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
