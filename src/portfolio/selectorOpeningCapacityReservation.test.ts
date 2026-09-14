import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignment } from "./candidateAssignment.js";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { createCandidateAssignmentSetRecord } from "./candidateAssignmentSet.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository } from "./candidateSizingInputFiles.js";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { HASH, OTHER, at, snapshot } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as storedFixture } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { createSelectorOpeningCapacityReservationRecord as create, parseSelectorOpeningCapacityReservationRecord as parse,
  resolveSelectorOpeningCapacityReservationBinding as bind, resolveSelectorOpeningCapacityReservedEventBinding as bindEvent,
  resolveSelectorOpeningCapacityMandateBinding as bindMandate, type SelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";

test("selector issuance independently hashes every payload field and excludes only identity and creation time", async (context) => {
  await fixture(context, (input) => {
    const record = input.reservation;
    assert.deepEqual(parse(JSON.parse(JSON.stringify(record))), record);
    assert.equal(rebuild(record, { createdAt: at(21) }).selectorCapacityReservationHash, record.selectorCapacityReservationHash);
    const changes = { selectionRequestId: "other", selectionRequestHash: OTHER, candidateAssignmentSetId: "other",
      candidateAssignmentSetHash: OTHER, candidateAssignmentId: "other", candidateAssignmentHash: OTHER, selectedRank: 2,
      portfolioId: "other", policyHash: OTHER, bucket: "swing", market: "US", symbol: "other", currentPortfolioSnapshotId: "other",
      currentPortfolioSnapshotHash: OTHER, capacityLedgerVersion: 2, reservedSlotOrdinal: 20, reservedMaximumNotionalKrw: 99,
      resultingReservedNotionalKrw: 101 };
    for (const [key, value] of Object.entries(changes)) {
      assert.throws(() => parse({ ...record, [key]: value }), /complete payload/);
      assert.notEqual(rebuild(record, { [key]: value }).selectorCapacityReservationHash, record.selectorCapacityReservationHash);
    }
    assert.throws(() => parse({ ...record, selectorCapacityReservationId: "wrong" }));
    assert.throws(() => parse({ ...record, selectorCapacityReservationHash: OTHER }));
    assert.ok(Object.isFrozen(record));
  });
});

test("selector issuance rejects unknown noncanonical unsafe and inconsistent payloads", async (context) => {
  await fixture(context, (input) => {
    for (const patch of [{ extra: true }, { symbol: " A" }, { symbol: "\ud800" }, { symbol: "" }, { symbol: "x".repeat(161) },
      { selectedRank: 0 }, { reservedSlotOrdinal: -0 }, { reservedSlotOrdinal: -1 }, { capacityLedgerVersion: 0 },
      { capacityLedgerVersion: 1.5 }, { capacityLedgerVersion: Number.MAX_SAFE_INTEGER + 1 }, { reservedMaximumNotionalKrw: 0 },
      { reservedMaximumNotionalKrw: NaN }, { resultingReservedNotionalKrw: 99 }, { createdAt: "2026-09-01T09:00:00+09:00" }]) {
      assert.throws(() => rebuild(input.reservation, patch));
    }
    assert.throws(() => parse({ ...input.reservation, extra: true }));
    assert.throws(() => bind({ ...input, trusted: true } as never));
  });
});

test("selector issuance binds exact sources and a later transaction snapshot without granting allocation authority", async (context) => {
  await fixture(context, (input) => {
    const result = bind(input);
    assert.notEqual(result.currentSnapshot.portfolioSnapshotId, result.request.portfolioSnapshotId);
    assert.equal(result.reservation.selectedRank, 1); assert.equal(result.reservation.reservedSlotOrdinal, 19);
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.equal(result.assessment.currentSnapshotAuthority, "not_verified");
    assert.equal(result.assessment.slotAndBudgetAllocationAuthority, "not_verified");
    assert.equal(result.assessment.sourceCompleteness, "not_verified");
    assert.equal(result.assessment.candidateEligibilityAndSizing, "not_verified");
    assert.deepEqual(bind(JSON.parse(JSON.stringify(input))), result);
    assertFrozen(result);
  });
});

test("selector issuance rejects rehashed selection scope snapshot amount and chronology mismatches", async (context) => {
  await fixture(context, (input) => {
    for (const patch of [{ selectionRequestId: "wrong" }, { selectionRequestHash: OTHER }, { candidateAssignmentId: "wrong" },
      { candidateAssignmentHash: OTHER }, { candidateAssignmentSetId: "wrong" }, { candidateAssignmentSetHash: OTHER }, { selectedRank: 2 },
      { portfolioId: "wrong" }, { policyHash: OTHER }, { bucket: "swing" }, { market: "US" }, { symbol: "wrong" },
      { currentPortfolioSnapshotId: "wrong" }, { currentPortfolioSnapshotHash: OTHER },
      { reservedMaximumNotionalKrw: 99 }, { reservedMaximumNotionalKrw: 101, resultingReservedNotionalKrw: 101 }, { createdAt: at(9) }]) {
      assert.throws(() => bind({ ...input, reservation: rebuild(input.reservation, patch) }));
    }
    const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = input.currentSnapshot;
    for (const patch of [{ policyHash: OTHER }, { portfolioId: "other" }, { asOf: at(21) }, { asOf: at(-1) }]) {
      const currentSnapshot = createPortfolioSizingSnapshot({ ...payload, ...patch,
        virtualPortfolio: { ...payload.virtualPortfolio, portfolioId: patch.portfolioId ?? payload.portfolioId,
          updatedAt: patch.asOf ?? payload.virtualPortfolio.updatedAt } });
      const reservation = rebuild(input.reservation, { currentPortfolioSnapshotId: currentSnapshot.portfolioSnapshotId,
        currentPortfolioSnapshotHash: currentSnapshot.portfolioSnapshotHash });
      assert.throws(() => bind({ ...input, reservation, currentSnapshot }));
    }
    assert.throws(() => bind({ ...input, currentSnapshot: { ...input.currentSnapshot, policyHash: OTHER } }));
  });
});

test("selector issuance requires complete set replay and exact BUY sizing source", async (context) => {
  await fixture(context, (input) => {
    assert.throws(() => bind({ ...input, assignments: [] }), /complete supplied/);
    assert.throws(() => bind({ ...input, assignments: [...input.assignments, ...input.assignments] }), /duplicate/);
    assert.throws(() => bind({ ...input, sizingInput: { ...input.sizingInput, sizingInputHash: OTHER } }));
    const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = input.sizingInput;
    const sizingInput = createCandidateSizingInputRecord({ ...payload, executionCostInput: { ...payload.executionCostInput, side: "SELL" } });
    const { assignmentId: _aid, assignmentHash: _ahash, sizingOutputHash: _output, ...assignmentPayload } = input.assignments[0]!;
    const assignment = createCandidateAssignment({ ...assignmentPayload, sizingInputRecordId: sizingInput.sizingInputRecordId, sizingInputHash: sizingInput.sizingInputHash });
    const assignments = [assignment], set = createCandidateAssignmentSetRecord({ request: input.request, assignments, createdAt: input.set.createdAt });
    const reservation = rebuild(input.reservation, { candidateAssignmentHash: assignment.assignmentHash,
      candidateAssignmentSetId: set.candidateAssignmentSetId, candidateAssignmentSetHash: set.candidateAssignmentSetHash });
    assert.throws(() => bind({ ...input, assignments, set, sizingInput, reservation }), /BUY sizing/);
  });
});

test("selector issuance preserves the second selected candidate's remaining request allocation", async (context) => {
  await fixture(context, (input) => {
    const { requestId: _rid, requestHash: _rh, ...requestPayload } = input.request;
    const request = createBucketSelectionRequest({ ...requestPayload, availableSlots: 2 });
    const { sizingInputRecordId: _sid, sizingInputHash: _sh, ...sizingPayload } = input.sizingInput;
    const sizingInput = createCandidateSizingInputRecord({ ...sizingPayload, requestId: request.requestId });
    const higherSizing = createCandidateSizingInputRecord({ ...sizingPayload, requestId: request.requestId, symbol: "000660", selectionScore: 0.9 });
    const { assignmentId: _aid, assignmentHash: _ah, sizingOutputHash: _oh, ...assignmentPayload } = input.assignments[0]!;
    const assignment = createCandidateAssignment({ ...assignmentPayload, requestId: request.requestId, maximumNotionalKrw: 70,
      sizingInputRecordId: sizingInput.sizingInputRecordId, sizingInputHash: sizingInput.sizingInputHash });
    const higher = createCandidateAssignment({ ...assignmentPayload, requestId: request.requestId, maximumNotionalKrw: 70, symbol: "000660", selectionScore: 0.9,
      sizingInputRecordId: higherSizing.sizingInputRecordId, sizingInputHash: higherSizing.sizingInputHash });
    const assignments = [assignment, higher], set = createCandidateAssignmentSetRecord({ request, assignments, createdAt: input.set.createdAt });
    const reservation = rebuild(input.reservation, { selectionRequestId: request.requestId, selectionRequestHash: request.requestHash,
      candidateAssignmentId: assignment.assignmentId, candidateAssignmentHash: assignment.assignmentHash,
      candidateAssignmentSetId: set.candidateAssignmentSetId, candidateAssignmentSetHash: set.candidateAssignmentSetHash,
      selectedRank: 2, reservedMaximumNotionalKrw: 30 });
    const changed = { ...input, request, assignments, set, sizingInput, reservation };
    const result = bind(changed);
    assert.equal(result.assignment.maximumNotionalKrw, 70);
    assert.equal(result.reservation.reservedMaximumNotionalKrw, 30);
    assert.equal(result.reservation.selectedRank, 2); assert.equal(result.reservation.reservedSlotOrdinal, 19);
    for (const amount of [29, 31, 70]) assert.throws(() => bind({ ...changed,
      reservation: rebuild(reservation, { reservedMaximumNotionalKrw: amount }) }), /exact selected allocation/);
    assert.deepEqual(bind({ ...changed, assignments: [...assignments].reverse() }), result);
  });
});

test("selector issuance root event preserves identity version global slot allocation and chronology", async (context) => {
  await fixture(context, (input, original) => {
    const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = original.root;
    if (payload.eventType !== "reserved" || payload.reservationSource.sourceKind !== "selector") throw new Error("wrong fixture root");
    const eventInput = { ...payload, reservationId: input.reservation.selectorCapacityReservationId, reservationHash: input.reservation.selectorCapacityReservationHash };
    const event = createOpeningCapacityReservationEvent(eventInput);
    const bound = bindEvent({ ...input, event });
    assert.equal(bound.event.reservationSource.sourceKind, "selector");
    if (bound.event.reservationSource.sourceKind !== "selector") throw new Error("wrong bound source");
    assert.equal(bound.event.reservationSource.reservedSlotOrdinal, 19);
    for (const patch of [{ reservationId: "wrong" }, { reservationHash: OTHER }, { portfolioId: "other" }, { policyHash: OTHER }, { bucket: "swing" },
      { capacityLedgerVersion: 2 }, { remainingReservedNotionalKrw: 99 }, { occupiesNewPositionSlot: false }, { asOf: at(19) },
      { reservationSource: { ...eventInput.reservationSource, reservedSlotOrdinal: 1 } },
      { reservationSource: { ...eventInput.reservationSource, candidateAssignmentId: "wrong" } },
      { reservationSource: { ...eventInput.reservationSource, candidateAssignmentSetHash: OTHER } }]) {
      assert.throws(() => bindEvent({ ...input, event: createOpeningCapacityReservationEvent({ ...eventInput, ...patch } as never) }), /complete issuance lineage|allocated new-position slot/);
    }
    assert.throws(() => bindEvent({ ...input, event: original.bound }));
    assert.throws(() => bindEvent({ ...input, event, extra: true } as never));
  });
});

test("selector issuance mandate preserves source allocation global slot identity and creation order", async (context) => {
  await fixture(context, (input, original) => {
    const { mandateId: _id, mandateHash: _hash, ...payload } = original.mandate;
    const mandateInput = { ...payload, openingCapacityReservationId: input.reservation.selectorCapacityReservationId,
      openingCapacityReservationHash: input.reservation.selectorCapacityReservationHash };
    const mandate = createInvestmentMandateRecord(mandateInput);
    assert.equal(bindMandate({ ...input, mandate }).mandate.reservedSlotOrdinal, 19);
    for (const patch of [{ openingCapacityReservationId: "wrong" }, { openingCapacityReservationHash: OTHER }, { reservedSlotOrdinal: 1 },
      { createdAt: at(19) }, { selectedRank: 2 }, { maximumOpeningNotionalKrw: 99, reservedMaximumNotionalKrw: 99 }, { evidenceRefs: ["wrong"] }]) {
      assert.throws(() => bindMandate({ ...input, mandate: createInvestmentMandateRecord({ ...mandateInput, ...patch } as never) }));
    }
    assert.throws(() => bindMandate({ ...input, mandate, extra: true } as never));
  });
});

async function fixture(context: TestContext, operation: (input: Awaited<ReturnType<typeof sources>>, original: Parameters<Parameters<typeof storedFixture>[2]>[0]["manual"]) => void) {
  await storedFixture(context, { count: 0 }, async (state) => operation(await sources(state.dir), state.manual));
}
async function sources(dir: string) {
  const request = (await new BucketSelectionRequestFileRepository(dir).readAll())[0]!;
  const history = await new CandidateAssignmentFileRepository(dir).readAll();
  const assignments = history.filter((item) => item.kind === "assignment").map((item) => item.record);
  const set = history.find((item) => item.kind === "set")!.record;
  const sizingInput = (await new CandidateSizingInputFileRepository(dir).readAll())[0]!.record;
  const base = snapshot(), currentSnapshot = createPortfolioSizingSnapshot({ ...base, portfolioVersion: "transaction-snapshot", asOf: at(20) });
  const assignment = assignments[0]!, selected = set.selectedAssignments[0]!;
  const reservation = create({ selectionRequestId: request.requestId, selectionRequestHash: request.requestHash,
    candidateAssignmentSetId: set.candidateAssignmentSetId, candidateAssignmentSetHash: set.candidateAssignmentSetHash,
    candidateAssignmentId: assignment.assignmentId, candidateAssignmentHash: assignment.assignmentHash, selectedRank: selected.selectedRank,
    portfolioId: request.portfolioId, policyHash: HASH, bucket: request.bucket, market: assignment.market, symbol: assignment.symbol,
    currentPortfolioSnapshotId: currentSnapshot.portfolioSnapshotId, currentPortfolioSnapshotHash: currentSnapshot.portfolioSnapshotHash,
    capacityLedgerVersion: 1, reservedSlotOrdinal: 19, reservedMaximumNotionalKrw: selected.reservedMaximumNotionalKrw,
    resultingReservedNotionalKrw: selected.reservedMaximumNotionalKrw, createdAt: at(20) });
  return { reservation, request, set, assignments, sizingInput, currentSnapshot };
}
function rebuild(record: SelectorOpeningCapacityReservationRecord, patch: Record<string, unknown>) {
  const { selectorCapacityReservationId: _id, selectorCapacityReservationHash: _hash, ...payload } = record;
  return create({ ...payload, ...patch } as Parameters<typeof create>[0]);
}
function assertFrozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); }
}
