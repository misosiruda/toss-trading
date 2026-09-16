import assert from "node:assert/strict";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { calculateCandidateExecutionCost } from "./candidateExecutionCost.js";
import { calculateCandidateDailyLiquidity } from "./candidateDailyLiquidity.js";
import { calculateCandidateDailyCostBasis, CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION } from "./candidateDailyCostBasis.js";
import { resolveStoredCandidateBoundedNotional } from "./storedCandidateBoundedNotional.js";
import { calculateCandidateBoundedNotional } from "./candidateBoundedNotional.js";
import { CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION } from "./candidateNotionalSizingPolicy.js";
import { calculateCandidateInitialExecutionCost, parseCandidateInitialExecutionCost } from "./candidateInitialExecutionCost.js";
import { resolveStoredCandidateInitialExecutionCost } from "./storedCandidateInitialExecutionCost.js";
import { calculateCandidateCashAffordableNotional, parseCandidateCashAffordableNotional } from "./candidateCashAffordableNotional.js";
import { resolveStoredCandidateCashAffordableNotional } from "./storedCandidateCashAffordableNotional.js";
import { type Payload, repriceDeclaredCash, initialCostOptions, exposureBoundsOptions, executionParameters, costCandidate, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored bounded notional uses actual policy score and capped input without granting final sizing", async () => temporary(async (baseDir) => {
  const options = exposureBoundsOptions(), original = options.patch!;
  const fixture = await seed(baseDir, { ...options, notionalSizingPolicy: { modelVersion: CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION,
    minimumScoreMultiplier: 0.5, maximumScoreMultiplier: 1.5, minimumOrderNotionalKrw: 10 },
    patch: (input) => ({ ...original(input), sizingAlgorithmVersion: CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION }) });
  const result = await resolveStoredCandidateBoundedNotional({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  assert.equal(result.calculation.baseNotionalKrw, 500);
  assert.equal(result.calculation.initialMaximumNotionalKrw, 100);
  assert.equal(result.calculation.input.selectionPolicy.hash, fixture.selection.hash);
  assert.equal(result.assessment.finalSizing, "not_performed");
  assert.equal(result.assessment.exactCandidateCaps, "not_verified");
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  frozen(result);
}));


test("stored bounded notional refuses absent models overstated caps and corrupt actual source histories", async () => {
  for (const failure of ["legacy", "model", "caps", "source"]) await temporary(async (baseDir) => {
    const options = exposureBoundsOptions(), original = options.patch!;
    const fixture = await seed(baseDir, { ...options, ...(failure === "legacy" ? {} : { notionalSizingPolicy: {
      modelVersion: failure === "model" ? "unsupported.v1" : CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION,
      minimumScoreMultiplier: 0.5, maximumScoreMultiplier: 1.5, minimumOrderNotionalKrw: 10 } }),
      patch: (input) => { const value = original(input); return { ...value, sizingAlgorithmVersion: CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION,
        exposureCapInputs: { ...value.exposureCapInputs, symbolRemainingKrw: failure === "caps" ? 201 : 100 } }; } });
    if (failure === "source") await appendFile(createCandidateSizingInputPaths(baseDir).recordsPath, "{corrupt}\n");
    await assert.rejects(resolveStoredCandidateBoundedNotional({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }),
      failure === "caps" ? /exceed actual position bounds/ : failure === "source" ? /corrupt/ : /policy-selected model/);
  });
});


test("initial cost repricing binds actual sources and recomputes participation and fee for the new amount", async () => temporary(async (baseDir) => {
  const options = initialCostOptions(), original = options.patch!;
  const fixture = await seed(baseDir, { ...options, execution: { bucket: executionParameters({ feeBps: 100 }), legacy: executionParameters({ feeBps: 100 }) },
    patch: (input) => costCandidate(original(input), { feeBps: 100 }) });
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  assert.equal(fixture.record.executionCostInput.referenceNotionalKrw, 200);
  assert.equal(fixture.record.executionCostInput.participationRate, 0.1);
  assert.equal(fixture.record.executionCostInput.estimatedCostKrw, 5);
  assert.equal(result.calculation.cost.input.referenceNotionalKrw, 100);
  assert.equal(result.calculation.cost.input.participationRate, 0.05);
  assert.equal(result.calculation.cost.feeKrw, 1);
  assert.equal(result.calculation.cost.estimatedCostKrw, 4);
  assert.equal(result.calculation.requiredCashKrw, "104");
  assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, false);
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  assert.equal(result.assessment.finalSizing, "not_performed");
  assert.deepEqual(parseCandidateInitialExecutionCost(JSON.parse(JSON.stringify(result.calculation))), result.calculation);
  frozen(result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
}));


test("initial cost repricing includes costs in cash comparison and leaves zero amounts at zero", async () => {
  for (const [minimum, cash, amount, requiredCash, fits] of [[10, 100, 100, "104", false], [10, 104, 100, "104", true],
    [101, 100, 0, "0", true]] as const) await temporary(async (baseDir) => {
    const fixture = await seed(baseDir, initialCostOptions(minimum));
    const result = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
    // Pure arithmetic over a changed declaration; it is not an actual stored cash-capacity receipt.
    const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = fixture.record;
    const sizingInput = createCandidateSizingInputRecord({ ...payload, exposureCapInputs: { ...payload.exposureCapInputs, cashAvailableKrw: cash } });
    const boundedNotional = calculateCandidateBoundedNotional({ ...result.calculation.input.boundedNotional.input, sizingInput });
    const calculation = calculateCandidateInitialExecutionCost({ ...result.calculation.input, boundedNotional });
    assert.equal(calculation.cost.input.referenceNotionalKrw, amount);
    assert.equal(calculation.requiredCashKrw, requiredCash);
    assert.equal(calculation.fitsDeclaredCash, fits);
    assert.equal(calculation.amountAdjustment, "not_performed");
    if (amount === 0) {
      assert.equal(calculation.cost.input.participationRate, 0);
      assert.equal(calculation.cost.estimatedCostKrw, 0);
    }
  });
});


test("initial cost repricing rejects rehashed derived tampering foreign liquidity and corrupt stored history", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir, initialCostOptions());
  const result = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  const calculation = result.calculation;
  for (const patch of [{ requiredCashKrw: "100" }, { fitsDeclaredCash: false }, { priorCostOutputHash: "forged" },
    { finalSizing: "performed" }, { cost: { ...calculation.cost, estimatedCostKrw: 0 } },
    { costBasis: { ...calculation.costBasis, costBasis: { ...calculation.costBasis.costBasis, participationRate: 0.1 } } }]) {
    const { calculationHash: _hash, ...payload } = { ...calculation, ...patch };
    assert.throws(() => parseCandidateInitialExecutionCost({ ...payload, calculationHash: hashCanonicalPayload(payload) }), /complete replay/);
  }
  const foreignLiquidity = calculateCandidateDailyLiquidity({ ...calculation.input.dailyLiquidity.input, maximumParticipationRatio: 0.05 });
  assert.throws(() => calculateCandidateInitialExecutionCost({ ...calculation.input, dailyLiquidity: foreignLiquidity }), /liquidity input/);
  assert.throws(() => calculateCandidateInitialExecutionCost({ ...calculation.input, overrideNotionalKrw: 1 }));
  await appendFile(createCandidateSizingInputPaths(baseDir).recordsPath, "{corrupt}\n");
  await assert.rejects(resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }), /corrupt/);
}));


test("initial cost repricing refuses invalid prior cost declarations before replacing their amount", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir, initialCostOptions());
  const result = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = fixture.record;
  const cases: Array<[Partial<Payload["executionCostInput"]>, RegExp]> = [
    [{ estimatedCostKrw: 0 }, /estimated cost/],
    [{ participationRate: 0.09 }, /prior basis/],
    [{ evidenceRefs: ["foreign"] }, /prior basis/],
    [{ maxVolumeParticipationRate: 0.2 }, /participation cap/]
  ];
  for (const [patch, error] of cases) {
    const candidate = patch.estimatedCostKrw === 0 ? { ...payload, executionCostInput: { ...payload.executionCostInput, ...patch } }
      : costCandidate(payload, patch);
    const sizingInput = createCandidateSizingInputRecord(candidate);
    const boundedNotional = calculateCandidateBoundedNotional({ ...result.calculation.input.boundedNotional.input, sizingInput });
    assert.throws(() => calculateCandidateInitialExecutionCost({ ...result.calculation.input, boundedNotional }), error);
  }
}));


test("cash affordable notional preserves actual source assessments and read-only replay", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir, initialCostOptions());
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredCandidateCashAffordableNotional({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  assert.equal(result.calculation.maximumNotionalKrw, 100);
  assert.equal(result.calculation.pricing.requiredCashKrw, "104");
  assert.equal(result.calculation.nextRequiredCashKrw, null);
  assert.equal(result.calculation.reasonCode, "initial_notional_affordable");
  assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, false);
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  assert.equal(result.assessment.pendingCostAndReservationAuthority, "not_verified");
  assert.equal(result.assessment.finalSizing, "not_performed");
  frozen(result);
  assert.deepEqual(parseCandidateCashAffordableNotional(JSON.parse(JSON.stringify(result.calculation))), result.calculation);
  assert.deepEqual(await resolveStoredCandidateCashAffordableNotional({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }), result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
}));


test("cash affordable notional integer search matches exhaustive small-budget costs including zero and one KRW", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir, initialCostOptions(1));
  const stored = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  for (const cash of [0, 1, 4, 5, 50, 100, 104, 850]) {
    const costRepricing = repriceDeclaredCash(stored.calculation, cash);
    const result = calculateCandidateCashAffordableNotional({ costRepricing });
    let exhaustiveMaximum = 0;
    for (let amount = 0; amount <= costRepricing.input.boundedNotional.initialMaximumNotionalKrw; amount++) {
      const basis = calculateCandidateDailyCostBasis({ modelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
        liquidity: costRepricing.input.dailyLiquidity, referenceNotionalKrw: amount });
      const cost = calculateCandidateExecutionCost({ ...costRepricing.cost.input, ...basis.costBasis });
      if (amount + cost.estimatedCostKrw <= cash) exhaustiveMaximum = amount;
    }
    assert.equal(result.affordableBeforeMinimumKrw, exhaustiveMaximum, `cash ${cash}`);
    assert.equal(result.maximumNotionalKrw, exhaustiveMaximum);
    assert.ok(BigInt(result.pricing.requiredCashKrw) <= BigInt(cash));
    assert.ok(result.searchIterations <= 53);
    if (result.nextRequiredCashKrw !== null) assert.ok(BigInt(result.nextRequiredCashKrw) > BigInt(cash));
    if (cash === 100) { assert.equal(result.maximumNotionalKrw, 96); assert.equal(result.reasonCode, "cash_adjusted"); }
  }
}));


test("cash affordable notional reapplies minimum order after cost adjustment", async () => {
  for (const minimum of [96, 97, 101]) await temporary(async (baseDir) => {
    const fixture = await seed(baseDir, initialCostOptions(minimum));
    const stored = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
    const result = calculateCandidateCashAffordableNotional({ costRepricing: repriceDeclaredCash(stored.calculation, 100) });
    assert.equal(result.maximumNotionalKrw, minimum === 96 ? 96 : 0);
    assert.equal(result.reasonCode, minimum === 96 ? "cash_adjusted" : minimum === 97 ? "cash_budget_below_minimum_notional" : "initial_notional_zero");
    if (minimum !== 96) {
      assert.equal(result.pricing.cost.input.referenceNotionalKrw, 0);
      assert.equal(result.pricing.cost.estimatedCostKrw, 0);
    }
  });
});


test("cash affordable notional rejects rehashed search pricing and authority tampering and corrupt origins", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir, initialCostOptions());
  const stored = await resolveStoredCandidateInitialExecutionCost({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  const costRepricing = repriceDeclaredCash(stored.calculation, 100);
  const result = calculateCandidateCashAffordableNotional({ costRepricing });
  for (const patch of [{ maximumNotionalKrw: 97 }, { affordableBeforeMinimumKrw: 95 }, { cashBudgetKrw: 101 },
    { nextRequiredCashKrw: "100" }, { searchIterations: 0 }, { finalSizing: "performed" },
    { pricing: { ...result.pricing, requiredCashKrw: "96" } }]) {
    const { calculationHash: _hash, ...payload } = { ...result, ...patch };
    assert.throws(() => parseCandidateCashAffordableNotional({ ...payload, calculationHash: hashCanonicalPayload(payload) }), /complete replay/);
  }
  assert.throws(() => calculateCandidateCashAffordableNotional({ costRepricing, cashBudgetKrw: 1000 }));
  assert.throws(() => calculateCandidateCashAffordableNotional({ costRepricing: { ...costRepricing, fitsDeclaredCash: true } }));
  await appendFile(createCandidateSizingInputPaths(baseDir).recordsPath, "{corrupt}\n");
  await assert.rejects(resolveStoredCandidateCashAffordableNotional({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }), /corrupt/);
}));
