import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInvestmentMandateRecord, createManualAssignmentEvent } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { ManualAssignmentFileRepository, createManualAssignmentPaths } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { resolveStoredManualOpeningCapacityMandateOrigins } from "./storedManualOpeningCapacityMandateOrigins.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T00:00:00.000Z";
const START = Date.parse(AT);
const PORTFOLIO = "paper-portfolio";

test("stored manual mandate bindings resolve actual new and increase lineage without promoting proposed mandates", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  for (const increase of [false, true]) await temporary(async (dir) => {
    const data = await seed(dir, (ms) => context.mock.timers.setTime(START + ms), increase);
    const result = await resolve(dir);
    assert.equal(result.bindings.length, 1);
    assert.deepEqual(result.bindings[0]!.mandate, data.mandate);
    assert.deepEqual(result.bindings[0]!.event, data.bound);
    assert.deepEqual(result.bindings[0]!.root.reservation, data.record);
    assert.equal(result.assessment.verifiedBoundMandateCount, 1);
    assert.deepEqual(result.assessment.unverifiedEventIds, []);
    assert.equal(result.assessment.mandateActivationAuthority, "not_verified");
    assert.equal(result.assessment.mandateAvailabilityAtBinding, "not_proven");
    assert.equal(result.assessment.sourceBeforeCreationReceipt, "not_recorded");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.deepEqual(await resolve(dir), result);
    for (const value of [result, result.bindings, result.bindings[0], result.assessment, result.assessment.mandateObservation]) assert.ok(Object.isFrozen(value));
    assert.equal((await new InvestmentMandateFileRepository(dir).readSnapshot()).states[0]!.status, "proposed");
  });
});

test("stored manual mandate bindings refuse missing hash-mismatched future or rehashed unrelated mandate records", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  for (const patch of [{}, { symbol: "000660" }, { policyHash: OTHER }, { targetWeightRatio: 0.15 },
    { createdAt: new Date(START + 50).toISOString() }, { capacityReservation: { invalid: true } }]) await temporary(async (dir) => {
    const data = await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const paths = createInvestmentMandatePaths(dir);
    if ("capacityReservation" in patch) {
      const changed = openingMandate(data.record, data.source, { capacityReservation: {
        ...data.mandate.capacityReservation, reservedSlotOrdinal: 5
      } });
      await writeFile(paths.recordsPath, `${JSON.stringify(changed)}\n`);
      await replaceBound(dir, data.root, changed);
      await assert.rejects(resolve(dir), /complete reservation lineage/);
    } else if (Object.keys(patch).length === 0) {
      await unlink(paths.recordsPath);
      await assert.rejects(resolve(dir), /source is missing/);
    } else {
      const changed = openingMandate(data.record, data.source, patch);
      await writeFile(paths.recordsPath, `${JSON.stringify(changed)}\n`);
      // A forged but correctly hashed binding must still agree with the actual manual reservation.
      await replaceBound(dir, data.root, changed);
      await assert.rejects(resolve(dir), /does not match|after its evaluation/);
    }
  });
  await temporary(async (dir) => {
    const data = await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    await writeFile(path, lines.slice(0, 2).join("\n") + "\n");
    await new OpeningCapacityReservationEventFileRepository(dir).append(bound(data.root, data.mandate, { mandateHash: OTHER }));
    await assert.rejects(resolve(dir), /source is missing or differs/);
  });
});

test("stored manual mandate bindings verify terminal and old-policy bindings and list unverified successors", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  const move = (ms: number) => context.mock.timers.setTime(START + ms);
  await temporary(async (dir) => {
    const first = await seed(dir, move);
    move(50);
    const released = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO,
      policyHash: HASH, bucket: first.record.bucket, reservationId: first.record.manualCapacityReservationId,
      reservationHash: first.record.manualCapacityReservationHash, capacityLedgerVersion: 3,
      previousCapacityReservationEventId: first.bound.capacityReservationEventId, remainingReservedNotionalKrw: 0,
      occupiesNewPositionSlot: false, asOf: new Date().toISOString(), createdAt: new Date().toISOString(), releaseReasonCode: "cancelled",
      releaseOrigin: { originKind: "mandate_terminal", mandateId: first.mandate.mandateId, mandateHash: first.mandate.mandateHash,
        mandateEventId: "unverified-terminal", mandateEventHash: HASH } });
    await new OpeningCapacityReservationEventFileRepository(dir).append(released);
    await seed(dir, (ms) => move(ms + 100), false, OTHER, "next-policy");
    const result = await resolve(dir);
    assert.equal(result.bindings.length, 2);
    assert.deepEqual(result.assessment.unverifiedEventIds, [released.capacityReservationEventId]);
    // A terminal capacity event cannot conceal a missing historical mandate.
    const paths = createInvestmentMandatePaths(dir);
    const lines = (await readFile(paths.recordsPath, "utf8")).trimEnd().split("\n");
    await writeFile(paths.recordsPath, lines.slice(1).join("\n") + "\n");
    await assert.rejects(resolve(dir), /source is missing/);
  });
});

test("stored manual mandate bindings do not promote selector chains reusing a manual identity in another scope", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const data = await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    for (const patch of [{ policyHash: OTHER }, { bucket: "swing" as const }]) {
      const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = data.root;
      const selector = createOpeningCapacityReservationEvent({ ...payload, ...patch, eventType: "reserved",
        reservationSource: { sourceKind: "selector", candidateAssignmentSetId: "set", candidateAssignmentSetHash: HASH,
          candidateAssignmentId: "assignment", reservedSlotOrdinal: 0 },
        asOf: new Date().toISOString(), createdAt: new Date().toISOString() });
      const selectorBound = bound(selector, data.mandate);
      const repo = new OpeningCapacityReservationEventFileRepository(dir);
      await repo.append(selector); await repo.append(selectorBound);
      const result = await resolve(dir);
      assert.equal(result.bindings.length, 1);
      assert.ok(result.assessment.unverifiedEventIds.includes(selector.capacityReservationEventId));
      assert.ok(result.assessment.unverifiedEventIds.includes(selectorBound.capacityReservationEventId));
    }
  });
});

test("stored manual mandate bindings reject every corrupt source suffix including empty selected scopes", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const paths = createInvestmentMandatePaths(dir);
    for (const path of [paths.recordsPath, paths.eventsPath, createManualAssignmentPaths(dir).eventsPath]) {
      const valid = await readFile(path, "utf8").catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
        throw error;
      });
      const corrupt = valid + "{broken}\n";
      await writeFile(path, corrupt);
      await assert.rejects(resolve(dir));
      await assert.rejects(resolveStoredManualOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: "foreign" }));
      assert.equal(await readFile(path, "utf8"), corrupt);
      await writeFile(path, valid);
    }
    assert.equal((await resolve(dir)).bindings.length, 1);
  });
});

test("stored manual mandate bindings reject event generations changing between source observations", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    const data = await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const path = createInvestmentMandatePaths(dir).recordsPath;
    const originalOpen = fs.open;
    let injected = false;
    const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+" && !injected) {
        injected = true;
        const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = data.root;
        await new OpeningCapacityReservationEventFileRepository(dir).append(createOpeningCapacityReservationEvent({
          ...payload, portfolioId: "foreign", asOf: new Date().toISOString(), createdAt: new Date().toISOString()
        }));
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(resolve(dir), /generation changed/); assert.ok(injected); }
    finally { opened.mock.restore(); syncBuiltinESMExports(); }
    assert.equal((await resolve(dir)).bindings.length, 1);
  });
});

test("stored manual mandate bindings capture input and fail on mandate fsync or backward observation", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await seed(dir, (ms) => context.mock.timers.setTime(START + ms));
    const input = { baseDir: dir, portfolioId: PORTFOLIO };
    const pending = resolveStoredManualOpeningCapacityMandateOrigins(input);
    input.baseDir = join(dir, "missing"); input.portfolioId = "other";
    assert.equal((await pending).bindings.length, 1);
    await assert.rejects(resolveStoredManualOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: PORTFOLIO, injected: true } as typeof input));
    for (const failure of ["sync", "clock"]) {
      context.mock.timers.setTime(START + 100);
      const path = createInvestmentMandatePaths(dir).recordsPath, originalOpen = fs.open;
      const opened = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (args[0] === path && args[1] === "r+") {
          if (failure === "sync") context.mock.method(handle, "sync", async () => { throw new Error("injected mandate fsync"); });
          else context.mock.timers.setTime(START + 60);
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(resolve(dir), /injected mandate fsync|clock moved backwards/); }
      finally { opened.mock.restore(); syncBuiltinESMExports(); }
    }
  });
});

function resolve(dir: string) { return resolveStoredManualOpeningCapacityMandateOrigins({ baseDir: dir, portfolioId: PORTFOLIO }); }
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

function openingMandate(record: ReturnType<typeof reservation>, source: ReturnType<typeof manual>, patch: Record<string, unknown> = {}) {
  if (source.authorizationScope !== "open_or_increase") throw new Error("fixture requires opening authorization");
  return createInvestmentMandateRecord({ portfolioId: source.portfolioId, policyHash: source.policyHash,
    bucket: source.bucket, market: source.market, symbol: source.symbol, asOf: source.asOf, evidenceAsOf: source.evidenceAsOf,
    reasonCodes: source.reasonCodes, evidenceRefs: source.evidenceRefs, minWeightRatio: source.minWeightRatio,
    targetWeightRatio: source.targetWeightRatio, maxWeightRatio: source.maxWeightRatio,
    maximumOpeningNotionalKrw: record.reservedMaximumNotionalKrw, reviewCadence: { mode: "every_tick" }, validFrom: source.asOf,
    assignmentSource: "manual_policy", manualAuthorizationScope: "open_or_increase", manualAssignmentEventId: source.manualAssignmentEventId,
    capacityReservation: { manualCapacityReservationId: record.manualCapacityReservationId, manualCapacityReservationHash: record.manualCapacityReservationHash,
      reservedMaximumNotionalKrw: record.reservedMaximumNotionalKrw, ...(record.reservationKind === "new_position"
        ? { reservationKind: record.reservationKind, reservedSlotOrdinal: record.reservedSlotOrdinal }
        : { reservationKind: record.reservationKind, existingPositionRef: record.existingPositionRef }) },
    createdAt: new Date().toISOString(), ...patch } as Parameters<typeof createInvestmentMandateRecord>[0]) as
      Extract<ReturnType<typeof createInvestmentMandateRecord>, { assignmentSource: "manual_policy"; manualAuthorizationScope: "open_or_increase" }>;
}
function bound(root: OpeningCapacityReservationEvent, mandate: ReturnType<typeof openingMandate>, patch: Record<string, unknown> = {}) {
  return createOpeningCapacityReservationEvent({ eventType: "bound_to_mandate", portfolioId: root.portfolioId, policyHash: root.policyHash,
    bucket: root.bucket, reservationId: root.reservationId, reservationHash: root.reservationHash,
    previousCapacityReservationEventId: root.capacityReservationEventId, capacityLedgerVersion: 2,
    remainingReservedNotionalKrw: root.remainingReservedNotionalKrw, occupiesNewPositionSlot: root.occupiesNewPositionSlot,
    mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, asOf: new Date().toISOString(), createdAt: new Date().toISOString(),
    ...patch } as Parameters<typeof createOpeningCapacityReservationEvent>[0]);
}
async function seed(dir: string, move: (ms: number) => void, increase = false, policyHash = HASH, id = "one") {
  move(10);
  const record = reservation(id, increase, policyHash), source = manual(id, policyHash);
  await storeReservation(dir, record, source);
  move(20);
  const root = event(record);
  await new OpeningCapacityReservationEventFileRepository(dir).append(root);
  move(30);
  const mandate = openingMandate(record, source);
  await new InvestmentMandateFileRepository(dir).appendRecord(mandate);
  move(40);
  const binding = bound(root, mandate);
  await new OpeningCapacityReservationEventFileRepository(dir).append(binding);
  return { record, source, root, mandate, bound: binding };
}
async function replaceBound(dir: string, root: OpeningCapacityReservationEvent, mandate: ReturnType<typeof openingMandate>) {
  const path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
  const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
  await writeFile(path, lines.slice(0, 2).join("\n") + "\n");
  await new OpeningCapacityReservationEventFileRepository(dir).append(bound(root, mandate));
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "stored-manual-capacity-mandates-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
