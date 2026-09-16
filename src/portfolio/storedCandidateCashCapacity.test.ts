import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import test from "node:test";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateDailyCostBasis } from "./storedCandidateDailyCostBasis.js";
import { resolveStoredCandidateCashCapacity } from "./storedCandidateCashCapacity.js";
import { type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { AT, cashOptions, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored candidate cash capacity binds actual policy snapshot and replayed cost without granting execution", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, cashOptions(850));
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath, before = await readFile(path, "utf8");
  const result = await resolveStoredCandidateCashCapacity(input);
  assert.equal(result.assessment.requiredCashReserveKrw, 150);
  assert.equal(result.assessment.maximumNetCashDebitKrw, 850);
  assert.equal(result.assessment.estimatedCostKrw, 4);
  assert.equal(result.assessment.referenceNotionalKrw, 200);
  assert.equal(result.assessment.cashConditionSatisfied, true);
  assert.equal(result.assessment.cashAvailableMeaning, "after_reserve_and_pending_gross_before_candidate_cost");
  assert.equal(result.assessment.pendingCostAndReservationAuthority, "not_verified");
  assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
  assert.equal(result.assessment.finalSizing, "not_performed");
  assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, result.costBasisReplay.assessment.evidenceAndHardGateConditionsSatisfied);
  assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
  assert.deepEqual(await resolveStoredCandidateCashCapacity(input), result);
  assert.equal(await readFile(path, "utf8"), before);
  frozen(result);
}));


test("stored candidate cash capacity includes own estimated costs at exact affordable boundaries", async () => {
  for (const [cashKrw, cashAvailableKrw, expected] of [[304, 204, true], [303, 203, false], [300, 200, false]] as const) {
    await temporary(async (baseDir) => {
      const { record } = await seed(baseDir, { ...cashOptions(cashAvailableKrw), cashKrw });
      const result = await resolveStoredCandidateCashCapacity({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
      assert.equal(result.assessment.requiredCashReserveKrw, 100);
      assert.equal(result.assessment.cashConditionSatisfied, expected);
    });
  }
});


test("stored candidate cash capacity rejects declared cash even when all earlier cost checks pass", async () => {
  for (const cashAvailableKrw of [0, 500, 849, 851]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, cashOptions(cashAvailableKrw));
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateDailyCostBasis(input);
    await assert.rejects(resolveStoredCandidateCashCapacity(input), /cash available differs/);
  });
});


test("stored candidate cash capacity subtracts every pending BUY and never anticipates pending SELL proceeds", async () => {
  for (const remainingNotionalKrw of [100, 900]) await temporary(async (baseDir) => {
    const common = { planId: "synthetic-plan", planHash: hashCanonicalPayload("plan"), planEventId: "synthetic-event",
      planEventHash: hashCanonicalPayload("event"), actionExecutionTargetHash: hashCanonicalPayload("target"),
      market: "KR" as const, symbol: "HELD", asOf: AT };
    const pendingActions: PendingPortfolioActionInput[] = [
      { ...common, actionId: "buy", side: "BUY", remainingNotionalKrw,
        openingCapacityReservationId: "synthetic-reservation", openingCapacityReservationHash: hashCanonicalPayload("reservation") },
      { ...common, actionId: "sell", side: "SELL", remainingNotionalKrw: 400, remainingQuantity: 1, priceEvidenceRef: "synthetic-price" }];
    const { record } = await seed(baseDir, { ...cashOptions(Math.max(0, 790 - remainingNotionalKrw)), pendingActions, krHeldNotionalKrw: 400 });
    const result = await resolveStoredCandidateCashCapacity({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(result.assessment.pendingBuyExposureKrw, remainingNotionalKrw);
    assert.equal(result.assessment.requiredCashReserveKrw, 210);
    assert.equal(result.assessment.maximumNetCashDebitKrw, Math.max(0, 790 - remainingNotionalKrw));
    assert.equal(result.assessment.cashConditionSatisfied, remainingNotionalKrw === 100);
    assert.equal(result.assessment.pendingCostAndReservationAuthority, "not_verified");
  });
});


test("stored candidate cash capacity matches reserve rounding and saturates zero and safe-integer boundaries", async () => {
  for (const cashKrw of [0, 99, 100, 1003, 1004, Number.MAX_SAFE_INTEGER]) await temporary(async (baseDir) => {
    const reserve = Math.max(100, Math.round(cashKrw * 0.15)), available = Math.max(0, cashKrw - reserve);
    const { record } = await seed(baseDir, { ...cashOptions(available), cashKrw });
    const result = await resolveStoredCandidateCashCapacity({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(result.assessment.maximumNetCashDebitKrw, available);
    assert.equal(result.assessment.requiredCashReserveKrw, reserve);
    assert.equal(Object.is(result.assessment.maximumNetCashDebitKrw, -0), false);
    assert.equal(result.assessment.cashConditionSatisfied, available >= 204);
  });
});


test("stored candidate cash capacity preserves original snapshot after a later valid append", async () => temporary(async (baseDir) => {
  const { record, snapshot } = await seed(baseDir, cashOptions(850));
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  const original = await resolveStoredCandidateCashCapacity(input);
  await new PortfolioSizingSnapshotFileRepository(baseDir).append(createPortfolioSizingSnapshot({ ...snapshot, portfolioVersion: "later" }));
  assert.deepEqual(await resolveStoredCandidateCashCapacity(input), original);
}));


test("stored candidate cash capacity refuses SELL reinterpretation and caller override", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, cashOptions(850, { side: "SELL" }));
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await resolveStoredCandidateDailyCostBasis(input);
  await assert.rejects(resolveStoredCandidateCashCapacity(input), /requires a BUY reference/);
  await assert.rejects(resolveStoredCandidateCashCapacity({ ...input, cashAvailableKrw: 850 } as never));
}));


test("stored candidate cash capacity refuses corrupt snapshot suffix without modifying evidence", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, cashOptions(850));
  const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
  await appendFile(path, '{"corrupt":true}\n');
  const before = await readFile(path, "utf8");
  await assert.rejects(resolveStoredCandidateCashCapacity({ baseDir, sizingInputRecordId: record.sizingInputRecordId }));
  assert.equal(await readFile(path, "utf8"), before);
}));
