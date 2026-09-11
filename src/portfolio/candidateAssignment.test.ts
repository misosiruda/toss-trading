import assert from "node:assert/strict";
import test from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { createCandidateAssignment, parseCandidateAssignment, resolveCandidateAssignmentSizingBinding } from "./candidateAssignment.js";
import { createCandidateAssignmentSetRecord, parseCandidateAssignmentSetRecord, resolveCandidateAssignmentSetBinding } from "./candidateAssignmentSet.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";
import { createInvestmentMandateRecord, parseInvestmentMandateRecord } from "./investmentMandate.js";
import { resolveSelectorMandateAssignmentBinding } from "./selectorMandateAssignmentBinding.js";

const HASH = `sha256:${"a".repeat(64)}`, OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T00:00:00.000Z", LATER = "2026-09-01T00:00:01.000Z";
type AssignmentInput = Parameters<typeof createCandidateAssignment>[0];
type Assignment = ReturnType<typeof createCandidateAssignment>;

test("candidate assignment canonicalizes refs and independently hashes full content and sizing output", () => {
  const input = assignmentInput(), record = createCandidateAssignment({ ...input, evidenceRefs: ["z", "a"], reasonCodes: ["z", "a"] });
  assert.deepEqual(record.reasonCodes, ["a", "z"]);
  assert.deepEqual(record.evidenceRefs, ["a", "z"]);
  assert.deepEqual(parseCandidateAssignment(JSON.parse(JSON.stringify(record))), record);
  assert.equal(record.sizingOutputHash, hashCanonicalPayload({ minWeightRatio: 0.01, targetWeightRatio: 0.05, maxWeightRatio: 0.1, maximumNotionalKrw: 70 }));
  const later = createCandidateAssignment({ ...input, createdAt: LATER });
  const first = createCandidateAssignment(input);
  assert.equal(later.assignmentHash, first.assignmentHash);
  assert.equal(later.assignmentId, first.assignmentId);
  assert.equal(createCandidateAssignment({ ...input, maximumNotionalKrw: 60 }).assignmentId, first.assignmentId);
  assert.notEqual(createCandidateAssignment({ ...input, maximumNotionalKrw: 60 }).assignmentHash, first.assignmentHash);
  assertFrozen(record);
  for (const [key, value] of Object.entries(first)) {
    if (key === "createdAt") continue;
    const changed = { ...first, [key]: typeof value === "number" ? value + 0.001 : Array.isArray(value) ? [...value, "extra"] : `${value}-changed` };
    assert.throws(() => parseCandidateAssignment(changed), key);
  }
  assert.throws(() => parseCandidateAssignment({ ...record, reasonCodes: ["z", "a"] }));
  assert.throws(() => parseCandidateAssignment({ ...record, extra: true }));
});

test("candidate assignment rejects malformed ranges amounts chronology unicode duplicate refs and unknown fields", () => {
  for (const value of [-1, -0, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => createCandidateAssignment({ ...assignmentInput(), maximumNotionalKrw: value }));
  }
  for (const value of [-1, -0, 1.1, Infinity, NaN]) assert.throws(() => createCandidateAssignment({ ...assignmentInput(), minWeightRatio: value }));
  assert.throws(() => createCandidateAssignment({ ...assignmentInput(), targetWeightRatio: 0.2 }));
  for (const refs of [[], ["same", "same"], [" padded"], ["bad\ud800"]]) {
    assert.throws(() => createCandidateAssignment({ ...assignmentInput(), reasonCodes: refs }));
    assert.throws(() => createCandidateAssignment({ ...assignmentInput(), evidenceRefs: refs }));
  }
  for (const createdAt of ["2026-08-31T00:00:00.000Z", "2026-02-30T00:00:00.000Z", "2026-09-01T00:00:00"]) {
    assert.throws(() => createCandidateAssignment({ ...assignmentInput(), createdAt }));
  }
  assert.throws(() => createCandidateAssignment({ ...assignmentInput(), extra: undefined } as AssignmentInput));
});

test("candidate assignment binds exact supplied request and sizing identity without promoting declared eligibility", () => {
  const request = selectionRequest(), sizingInput = sizing(request), input = assignmentInput(request, sizingInput);
  const result = resolveCandidateAssignmentSizingBinding({ request, sizingInput, assignment: createCandidateAssignment(input) });
  assert.equal(result.eligibilityAndExactSizing, "not_verified");
  assert.equal(result.currentExecutionAuthority, "not_granted");
  for (const patch of [{ requestId: "other" }, { portfolioId: "other" }, { portfolioSnapshotId: "other" }, { portfolioSnapshotHash: OTHER },
    { policyHash: OTHER }, { bucket: "swing" }, { asOf: LATER, createdAt: LATER }, { sizingInputRecordId: "other" },
    { sizingInputHash: OTHER }, { market: "US" }, { symbol: "other" }, { selectionScore: 0.7 }, { scoringModelVersion: "other" }]) {
    assert.throws(() => resolveCandidateAssignmentSizingBinding({ request, sizingInput,
      assignment: createCandidateAssignment({ ...input, ...patch } as AssignmentInput) }));
  }
  const newerInput = { ...sizingInput, createdAt: LATER };
  assert.throws(() => resolveCandidateAssignmentSizingBinding({ request, sizingInput: newerInput, assignment: createCandidateAssignment(input) }));
});

test("assignment sets order eligibility then score and canonical instrument and reserve rank-local remaining budget", () => {
  const request = selectionRequest(3, 100);
  const values = [assignment(request, "KR", "Z", 0.9, "watch"), assignment(request, "US", "A", 0.8),
    assignment(request, "KR", "B", 0.8), assignment(request, "KR", "A", 0.8), assignment(request, "US", "Z", 1, "blocked")];
  const set = createCandidateAssignmentSetRecord({ request, assignments: values, createdAt: LATER });
  assert.deepEqual(set.orderedAssignments.map((row) => [row.market, row.symbol]), [["KR", "A"], ["KR", "B"], ["US", "A"], ["US", "Z"], ["KR", "Z"]]);
  assert.deepEqual(set.selectedAssignments.map((row) => [row.selectedRank, row.reservedMaximumNotionalKrw]), [[1, 70], [2, 30]]);
  assert.equal(set.requestAllocationBudgetKrw, 100);
  assert.equal(set.totalReservedMaximumNotionalKrw, 100);
  assert.deepEqual(createCandidateAssignmentSetRecord({ request, assignments: [...values].reverse(), createdAt: LATER }), set);
  assert.deepEqual(parseCandidateAssignmentSetRecord(JSON.parse(JSON.stringify(set))), set);
  assert.equal(resolveCandidateAssignmentSetBinding({ set, request, assignments: values }).sharedCapacityReservation, "not_performed");
  assertFrozen(set);
});

test("assignment sets omit zero reservations without backfilling beyond top N and accept empty eligibility", () => {
  const request = selectionRequest(2, 100), zero = assignment(request, "KR", "A", 0.9, "eligible", 0);
  const values = [zero, assignment(request, "KR", "B", 0.8), assignment(request, "KR", "C", 0.7)];
  const set = createCandidateAssignmentSetRecord({ request, assignments: values, createdAt: LATER });
  assert.deepEqual(set.selectedAssignments.map((row) => [row.selectedRank, row.reservedMaximumNotionalKrw]), [[2, 70]]);
  assert.equal(set.totalReservedMaximumNotionalKrw, 70);
  for (const assignments of [[], [assignment(request, "KR", "A", 1, "watch")], [assignment(request, "KR", "A", 1, "blocked")], [zero]]) {
    const empty = createCandidateAssignmentSetRecord({ request, assignments, createdAt: LATER });
    assert.deepEqual(empty.selectedAssignments, []);
    assert.equal(empty.totalReservedMaximumNotionalKrw, 0);
  }
});

test("selected ranks preserve the existing selector mandate contract including a sole candidate and rank gaps", () => {
  for (const zeroFirst of [false, true]) {
    const request = selectionRequest(zeroFirst ? 2 : 1), candidate = assignment(request, "KR", "B", 0.8);
    const assignments = zeroFirst ? [assignment(request, "KR", "A", 1, "eligible", 0), candidate] : [candidate];
    const set = createCandidateAssignmentSetRecord({ request, assignments, createdAt: LATER });
    assert.equal(set.selectedAssignments.length, 1);
    const selected = set.selectedAssignments[0]!;
    assert.equal(selected.selectedRank, zeroFirst ? 2 : 1);
    const mandate = createInvestmentMandateRecord({
      portfolioId: candidate.portfolioId, market: candidate.market, symbol: candidate.symbol, bucket: candidate.bucket,
      policyHash: candidate.policyHash, asOf: candidate.asOf, minWeightRatio: candidate.minWeightRatio,
      targetWeightRatio: candidate.targetWeightRatio, maxWeightRatio: candidate.maxWeightRatio,
      maximumOpeningNotionalKrw: selected.reservedMaximumNotionalKrw, reasonCodes: candidate.reasonCodes,
      evidenceRefs: candidate.evidenceRefs, evidenceAsOf: AT, reviewCadence: { mode: "every_tick" }, validFrom: AT,
      assignmentSource: "deterministic_selector", selectionRequestId: request.requestId,
      candidateAssignmentId: candidate.assignmentId, candidateAssignmentSetId: set.candidateAssignmentSetId,
      candidateAssignmentSetHash: set.candidateAssignmentSetHash, selectedRank: selected.selectedRank,
      openingCapacityReservationId: "synthetic-reservation", openingCapacityReservationHash: HASH,
      reservedSlotOrdinal: 0, reservedMaximumNotionalKrw: selected.reservedMaximumNotionalKrw,
      scoringModelVersion: candidate.scoringModelVersion, selectionScore: candidate.selectionScore, createdAt: LATER
    });
    const parsed = parseInvestmentMandateRecord(mandate);
    assert.equal(parsed.assignmentSource, "deterministic_selector");
    if (parsed.assignmentSource !== "deterministic_selector") throw new Error("unexpected mandate variant");
    assert.equal(parsed.selectedRank, selected.selectedRank);
    assert.equal(parsed.reservedSlotOrdinal, 0); // A rank is not a shared-ledger slot ordinal.
    for (const selectedRank of [0, -0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => parseCandidateAssignmentSetRecord(rehashSet({ ...set,
        selectedAssignments: [{ ...selected, selectedRank }] })));
    }
  }
});

test("assignment sets reject duplicate identities scopes future source and strict schema violations", () => {
  const request = selectionRequest(), first = assignment(request, "KR", "A", 1);
  assert.throws(() => createCandidateAssignmentSetRecord({ request, assignments: [first, first], createdAt: LATER }));
  assert.throws(() => createCandidateAssignmentSetRecord({ request, assignments: [first, assignment(request, "KR", "A", 0.5)], createdAt: LATER }));
  assert.throws(() => createCandidateAssignmentSetRecord({ request, assignments: [assignment(selectionRequest(1), "KR", "A", 1)], createdAt: LATER }));
  assert.throws(() => createCandidateAssignmentSetRecord({ request, assignments: [{ ...first, createdAt: LATER }], createdAt: AT }));
  assert.throws(() => createCandidateAssignmentSetRecord({ request: { ...request, createdAt: LATER }, assignments: [], createdAt: AT }));
  const set = createCandidateAssignmentSetRecord({ request, assignments: [first], createdAt: LATER });
  for (const patch of [{ extra: true }, { availableSlots: -0 }, { requestAllocationBudgetKrw: -0 }, { totalReservedMaximumNotionalKrw: -0 },
    { createdAt: "2026-02-30T00:00:00.000Z" }, { candidateAssignmentSetHash: OTHER }]) assert.throws(() => parseCandidateAssignmentSetRecord({ ...set, ...patch }));
});

test("assignment set binding independently replays rehashed allocation omissions individual caps ranks and source list", () => {
  const request = selectionRequest(2, 100), values = [assignment(request, "KR", "A", 1, "eligible", 40), assignment(request, "KR", "B", 0.5)];
  const set = createCandidateAssignmentSetRecord({ request, assignments: values, createdAt: LATER });
  const altered = rehashSet({ ...set, selectedAssignments: set.selectedAssignments.map((row, index) => ({ ...row, reservedMaximumNotionalKrw: index === 0 ? 50 : 50 })) });
  assert.ok(parseCandidateAssignmentSetRecord(altered)); // Structural equality cannot establish each individual cap.
  assert.throws(() => resolveCandidateAssignmentSetBinding({ set: altered, request, assignments: values }), /complete supplied assignment allocation/);
  const omitted = rehashSet({ ...set, selectedAssignments: [], totalReservedMaximumNotionalKrw: 0 });
  assert.throws(() => resolveCandidateAssignmentSetBinding({ set: omitted, request, assignments: values }));
  assert.throws(() => resolveCandidateAssignmentSetBinding({ set, request, assignments: values.slice(1) }));
  assert.throws(() => parseCandidateAssignmentSetRecord(rehashSet({ ...set, orderedAssignments: [...set.orderedAssignments].reverse() })));
  assert.throws(() => parseCandidateAssignmentSetRecord(rehashSet({ ...set, selectedAssignments: [...set.selectedAssignments].reverse() })));
  assert.throws(() => parseCandidateAssignmentSetRecord(rehashSet({ ...set, orderedAssignments: set.orderedAssignments.map((row) => ({ ...row, assignmentId: "forged" })) })));
  assert.throws(() => parseCandidateAssignmentSetRecord(rehashSet({ ...set, totalReservedMaximumNotionalKrw: 99 })));
});

test("assignment allocation uses safe integer budget arithmetic and finite score comparison without subtraction overflow", () => {
  const request = selectionRequest(2, Number.MAX_SAFE_INTEGER), assignments = [assignment(request, "KR", "B", -Number.MAX_VALUE, "eligible", Number.MAX_SAFE_INTEGER),
    assignment(request, "KR", "A", Number.MAX_VALUE, "eligible", Number.MAX_SAFE_INTEGER - 1)];
  const set = createCandidateAssignmentSetRecord({ request, assignments, createdAt: LATER });
  assert.equal(set.totalReservedMaximumNotionalKrw, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(set.selectedAssignments.map((row) => row.reservedMaximumNotionalKrw), [Number.MAX_SAFE_INTEGER - 1, 1]);
});

function selectionRequest(availableSlots = 2, budget = 100) {
  return createBucketSelectionRequest({ cycleId: "cycle", triggerIdentity: "trigger", triggerRef: "ref", portfolioId: "portfolio",
    portfolioSnapshotId: "snapshot", portfolioSnapshotHash: HASH, policyHash: HASH, asOf: AT, bucket: "intraday", gapBasis: "entry_floor",
    gapKrw: budget, availableSlots, maximumAdditionalExposureKrw: budget, evidenceCutoffAt: AT, createdAt: AT });
}
function sizing(request: ReturnType<typeof selectionRequest>, market: "KR" | "US" = "KR", symbol = "A", score = 0.8) {
  return createCandidateSizingInputRecord({ requestId: request.requestId, portfolioId: request.portfolioId, portfolioSnapshotId: request.portfolioSnapshotId,
    portfolioSnapshotHash: HASH, policyHash: HASH, asOf: AT, market, symbol, bucket: "intraday", scoringModelVersion: "score.v1", sizingAlgorithmVersion: "sizing.v1",
    selectionScore: score, exposureKeys: { sector: "Technology", country: "KR", currency: "KRW", classificationEvidenceRef: "classification" },
    featureInputs: [{ featureDefinitionRef: "feature", value: 1, evidenceRefs: ["evidence"] }],
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 1000, sectorRemainingKrw: 1000, countryRemainingKrw: 1000, currencyRemainingKrw: 1000, cashAvailableKrw: 1000 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 100, participationRate: 0.01, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 0, taxBps: 0, halfSpreadBps: 0, slippageBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0, evidenceRefs: ["cost"] }, createdAt: AT });
}
function assignmentInput(request = selectionRequest(), input = sizing(request)): AssignmentInput {
  return { requestId: request.requestId, portfolioId: request.portfolioId, portfolioSnapshotId: request.portfolioSnapshotId, portfolioSnapshotHash: request.portfolioSnapshotHash,
    policyHash: request.policyHash, asOf: request.asOf, market: input.market, symbol: input.symbol, bucket: request.bucket, scoringModelVersion: input.scoringModelVersion,
    selectionScore: input.selectionScore, sizingInputRecordId: input.sizingInputRecordId, sizingInputHash: input.sizingInputHash,
    minWeightRatio: 0.01, targetWeightRatio: 0.05, maxWeightRatio: 0.1, maximumNotionalKrw: 70,
    eligibility: "eligible", reasonCodes: ["synthetic"], evidenceRefs: ["evidence"], createdAt: AT };
}
function assignment(request: ReturnType<typeof selectionRequest>, market: "KR" | "US", symbol: string, score: number,
  eligibility: Assignment["eligibility"] = "eligible", maximumNotionalKrw = 70) {
  return createCandidateAssignment({ ...assignmentInput(request, sizing(request, market, symbol, score)), eligibility, maximumNotionalKrw });
}
function rehashSet(value: ReturnType<typeof createCandidateAssignmentSetRecord>) {
  const { candidateAssignmentSetId: _id, candidateAssignmentSetHash: _hash, createdAt, ...payload } = value;
  const hash = hashCanonicalPayload(payload);
  return { ...payload, createdAt, candidateAssignmentSetHash: hash, candidateAssignmentSetId: hashDerivedId("candidate_assignment_set", hash) };
}
test("selector mandate binding matches actual supplied selected rank range and remaining request allocation", () => {
  const input = selectorBindingFixture(), result = resolveSelectorMandateAssignmentBinding(input);
  assert.equal(result.assignment.maximumNotionalKrw, 70);
  assert.equal(result.assessment.maximumOpeningNotionalKrw, 30);
  assert.equal(result.assessment.selectedRank, 2);
  assert.equal(result.mandate.reservedSlotOrdinal, 19);
  assert.equal(result.assessment.capacityReservationAuthority, "not_verified");
  assert.equal(result.assessment.candidateEligibilityAndSizing, "not_verified");
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  assert.deepEqual(resolveSelectorMandateAssignmentBinding({ ...input, assignments: [...input.assignments].reverse() }), result);
  assertFrozen(result);
  // Content binding does not infer a shared slot ordinal from the request-local rank.
  assert.equal(resolveSelectorMandateAssignmentBinding({ ...input, mandate: rebuildSelectorMandate(input.mandate, { reservedSlotOrdinal: 2 }) })
    .assessment.capacityReservationAuthority, "not_verified");
});

test("selector mandate binding rejects independently rehashed scope rank score range and amount mismatches", () => {
  const input = selectorBindingFixture();
  for (const patch of [{ portfolioId: "other" }, { policyHash: OTHER }, { market: "US" }, { symbol: "other" },
    { selectionRequestId: "other" }, { candidateAssignmentId: input.assignments[0]!.assignmentId },
    { candidateAssignmentSetId: "other" }, { candidateAssignmentSetHash: OTHER }, { selectedRank: 1 },
    { scoringModelVersion: "other" }, { selectionScore: 0.7 }, { minWeightRatio: 0.02 }, { targetWeightRatio: 0.06 },
    { reasonCodes: ["fabricated"] }, { evidenceRefs: ["fabricated"] },
    { reasonCodes: ["extra", "synthetic"] }, { evidenceRefs: ["evidence", "extra"] },
    { maxWeightRatio: 0.11 }, { maximumOpeningNotionalKrw: 29, reservedMaximumNotionalKrw: 29 },
    { maximumOpeningNotionalKrw: 31, reservedMaximumNotionalKrw: 31 }, { createdAt: AT }]) {
    const mandate = rebuildSelectorMandate(input.mandate, patch);
    assert.throws(() => resolveSelectorMandateAssignmentBinding({ ...input, mandate }));
  }
  assert.throws(() => resolveSelectorMandateAssignmentBinding({ ...input, extra: true }));
});

test("selector mandate binding requires full supplied set replay and the exact sizing source", () => {
  const input = selectorBindingFixture();
  assert.throws(() => resolveSelectorMandateAssignmentBinding({ ...input, assignments: input.assignments.slice(1) }), /complete supplied/);
  const set = rehashSet({ ...input.set, selectedAssignments: input.set.selectedAssignments.map((row) => ({ ...row, reservedMaximumNotionalKrw: 50 })) });
  assert.ok(parseCandidateAssignmentSetRecord(set));
  assert.throws(() => resolveSelectorMandateAssignmentBinding({ ...input, set,
    mandate: rebuildSelectorMandate(input.mandate, { candidateAssignmentSetId: set.candidateAssignmentSetId, candidateAssignmentSetHash: set.candidateAssignmentSetHash }) }), /complete supplied/);
  assert.throws(() => resolveSelectorMandateAssignmentBinding({ ...input, sizingInput: sizing(input.request, "KR", "B", 0.7) }), /sizing input binding/);
  assert.throws(() => resolveSelectorMandateAssignmentBinding({ ...input, sizingInput: { ...input.sizingInput, createdAt: LATER } }), /sizing input binding/);
  assert.throws(() => resolveSelectorMandateAssignmentBinding(selectorBindingFixture(true)), /BUY sizing/);
});

function selectorBindingFixture(sell = false) {
  const request = selectionRequest(2, 100), source = sizing(request, "KR", "B", 0.8);
  const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = source;
  const sizingInput = createCandidateSizingInputRecord({ ...payload, executionCostInput: { ...payload.executionCostInput, side: sell ? "SELL" : "BUY" } });
  const candidate = createCandidateAssignment(assignmentInput(request, sizingInput));
  const assignments = [assignment(request, "KR", "A", 0.9), candidate];
  const set = createCandidateAssignmentSetRecord({ request, assignments, createdAt: LATER });
  const selected = set.selectedAssignments[1]!;
  const mandate = createInvestmentMandateRecord({ portfolioId: candidate.portfolioId, market: candidate.market, symbol: candidate.symbol,
    bucket: candidate.bucket, policyHash: candidate.policyHash, asOf: AT, minWeightRatio: candidate.minWeightRatio,
    targetWeightRatio: candidate.targetWeightRatio, maxWeightRatio: candidate.maxWeightRatio, maximumOpeningNotionalKrw: selected.reservedMaximumNotionalKrw,
    reasonCodes: candidate.reasonCodes, evidenceRefs: candidate.evidenceRefs, evidenceAsOf: AT, reviewCadence: { mode: "every_tick" }, validFrom: AT,
    assignmentSource: "deterministic_selector", selectionRequestId: request.requestId, candidateAssignmentId: candidate.assignmentId,
    candidateAssignmentSetId: set.candidateAssignmentSetId, candidateAssignmentSetHash: set.candidateAssignmentSetHash, selectedRank: selected.selectedRank,
    openingCapacityReservationId: "synthetic-reservation", openingCapacityReservationHash: HASH, reservedSlotOrdinal: 19,
    reservedMaximumNotionalKrw: selected.reservedMaximumNotionalKrw, scoringModelVersion: candidate.scoringModelVersion,
    selectionScore: candidate.selectionScore, createdAt: LATER });
  if (mandate.assignmentSource !== "deterministic_selector") throw new Error("unexpected fixture mandate");
  return { request, sizingInput, assignments, set, mandate };
}
function rebuildSelectorMandate(record: ReturnType<typeof selectorBindingFixture>["mandate"], patch: Record<string, unknown>) {
  const { mandateId: _id, mandateHash: _hash, ...payload } = record;
  return createInvestmentMandateRecord({ ...payload, ...patch } as Parameters<typeof createInvestmentMandateRecord>[0]);
}

function assertFrozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); }
}
