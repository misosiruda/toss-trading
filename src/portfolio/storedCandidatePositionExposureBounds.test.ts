import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import test from "node:test";
import { createStoragePaths } from "../storage/repositories.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { deriveCandidatePacketClassification } from "./candidatePacketClassification.js";
import { classificationPacket } from "./candidatePacketClassificationTestFixtures.js";
import { resolveStoredCandidateClassification } from "./storedCandidateClassification.js";
import { calculateCandidatePositionExposureBounds, CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION, parseCandidatePositionExposureBounds } from "./candidatePositionExposureBounds.js";
import { resolveStoredCandidatePositionExposureBounds } from "./storedCandidatePositionExposureBounds.js";
import { AT, exposureBoundsOptions, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored position bounds replay all dimensions from actual policy snapshot and classification without granting exact caps", async () => {
  for (const market of ["KR", "US"] as const) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, exposureBoundsOptions(classificationPacket(market, { region: "GLOBAL" })));
    const lookup = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    const result = await resolveStoredCandidatePositionExposureBounds(lookup);
    assert.deepEqual(result.calculation.positionUpperBounds, { bucketRemainingKrw: 500, symbolRemainingKrw: 200,
      sectorRemainingKrw: 300, countryRemainingKrw: 800, currencyRemainingKrw: 800 });
    assert.equal(result.assessment.allDeclaredCapsWithinPositionBounds, true);
    assert.equal(result.assessment.exactCandidateCaps, "not_verified");
    assert.equal(result.assessment.pendingAndReservationAuthority, "not_verified");
    assert.equal(result.assessment.finalSizing, "not_performed");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.deepEqual(await resolveStoredCandidatePositionExposureBounds(lookup), result);
    frozen(result);
  });
});


test("stored position bounds include other buckets in symbol and classification exposure but not candidate bucket exposure", async () => temporary(async (baseDir) => {
  const options = exposureBoundsOptions(classificationPacket("KR", { symbol: "HELD" }), 790);
  const { record } = await seed(baseDir, { ...options, krHeldNotionalKrw: 400, heldBucket: "long_term" });
  const result = await resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.deepEqual(result.calculation.positionUpperBounds, { bucketRemainingKrw: 700, symbolRemainingKrw: 0,
    sectorRemainingKrw: 20, countryRemainingKrw: 720, currencyRemainingKrw: 720 });
  assert.deepEqual(result.calculation.dimensions.symbol, { limitKrw: 280, currentExposureKrw: 400, remainingKrw: 0 });
  assert.equal(result.assessment.declaredCapChecks.symbolRemainingKrw, false);
  assert.equal(result.assessment.declaredCapChecks.sectorRemainingKrw, false);
  assert.equal(result.assessment.allDeclaredCapsWithinPositionBounds, false);
}));


test("stored position bounds diagnose each overstated cap separately without accepting smaller caps as exact", async () => temporary(async (baseDir) => {
  const options = exposureBoundsOptions(), original = options.patch!;
  const { record } = await seed(baseDir, { ...options, patch: (input) => {
    const value = original(input);
    return { ...value, exposureCapInputs: { ...value.exposureCapInputs, bucketRemainingKrw: 501, symbolRemainingKrw: 201,
      sectorRemainingKrw: 301, countryRemainingKrw: 801, currencyRemainingKrw: 801 } };
  } });
  const result = await resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.deepEqual(Object.values(result.assessment.declaredCapChecks), [false, false, false, false, false]);
  assert.equal(result.assessment.exactCandidateCaps, "not_verified");
}));


test("stored position bounds keep pending buys and sells outside position-only ceilings", async () => temporary(async (baseDir) => {
  const common = { planId: "synthetic-plan", planHash: hashCanonicalPayload("plan"), planEventId: "synthetic-event",
    planEventHash: hashCanonicalPayload("event"), actionExecutionTargetHash: hashCanonicalPayload("target"),
    market: "KR" as const, symbol: "HELD", asOf: AT };
  const pendingActions: PendingPortfolioActionInput[] = [
    { ...common, actionId: "buy", side: "BUY", remainingNotionalKrw: 100,
      openingCapacityReservationId: "synthetic-reservation", openingCapacityReservationHash: hashCanonicalPayload("reservation") },
    { ...common, actionId: "sell", side: "SELL", remainingNotionalKrw: 400, remainingQuantity: 1, priceEvidenceRef: "synthetic-price" }];
  const { record } = await seed(baseDir, { ...exposureBoundsOptions(classificationPacket(), 690), krHeldNotionalKrw: 400, pendingActions });
  const result = await resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(result.calculation.positionUpperBounds.bucketRemainingKrw, 300);
  assert.equal(result.calculation.positionUpperBounds.sectorRemainingKrw, 20);
  assert.equal(result.calculation.pendingBuyExposureKrw, 100);
  assert.equal(result.calculation.pendingSellExposureKrw, 400);
  assert.equal(result.assessment.pendingAndReservationAuthority, "not_verified");
}));


test("stored position bounds require an explicit supported policy model and reject caller overrides", async () => {
  for (const modelVersion of [undefined, "unsupported.v1"]) await temporary(async (baseDir) => {
    const options = exposureBoundsOptions();
    if (modelVersion === undefined) delete options.exposureLimitPolicy;
    else options.exposureLimitPolicy!.modelVersion = modelVersion;
    const { record } = await seed(baseDir, options), lookup = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateClassification(lookup);
    await assert.rejects(resolveStoredCandidatePositionExposureBounds(lookup), /policy-selected/);
    await assert.rejects(resolveStoredCandidatePositionExposureBounds({ ...lookup, maximumSectorExposureRatio: 1 } as never));
  });
});


test("position bounds floor exact canonical ratio products and independently replay complete outputs", async () => temporary(async (baseDir) => {
  const options = exposureBoundsOptions(classificationPacket(), 757);
  const { record } = await seed(baseDir, { ...options, cashKrw: 891,
    exposureLimitPolicy: { modelVersion: CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION, maximumSectorExposureRatio: 0.3 } });
  const result = await resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(result.calculation.positionUpperBounds.sectorRemainingKrw, 267);
  assert.equal(result.calculation.positionUpperBounds.symbolRemainingKrw, 178);
  assert.deepEqual(parseCandidatePositionExposureBounds(JSON.parse(JSON.stringify(result.calculation))), result.calculation);
  const { calculationHash, ...payload } = result.calculation;
  assert.equal(calculationHash, hashCanonicalPayload(payload));
  for (const patch of [{ positionUpperBounds: { ...payload.positionUpperBounds, sectorRemainingKrw: 268 } },
    { dimensions: { ...payload.dimensions, sector: { ...payload.dimensions.sector, limitKrw: 268 } } },
    { pendingAndReservationAuthority: "verified" }, { finalSizing: "performed" }, { extra: true }]) {
    const wrong = { ...payload, ...patch };
    assert.throws(() => parseCandidatePositionExposureBounds({ ...wrong, calculationHash: hashCanonicalPayload(wrong) }), /replay mismatch/);
  }
  assert.throws(() => calculateCandidatePositionExposureBounds({ ...payload.input, bucket: "long_term" }), /policy-selected/);
  assert.throws(() => calculateCandidatePositionExposureBounds({ ...payload.input, modelVersion: "unknown" }));
  const path = createStoragePaths(baseDir).marketPacketsPath;
  await appendFile(path, '{"corrupt":true}\n');
  const before = await readFile(path, "utf8");
  await assert.rejects(resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /history is corrupt/);
  assert.equal(await readFile(path, "utf8"), before);
}));


test("position bounds handle zero NAV exact decimal boundaries and the largest safe NAV without overflow", async () => {
  for (const [cashKrw, ratio] of [[0, 0.29], [100, 0.29], [Number.MAX_SAFE_INTEGER, 0.29], [Number.MAX_SAFE_INTEGER, Number.MIN_VALUE]]) {
    await temporary(async (baseDir) => {
      const reserve = Math.max(100, Math.round(cashKrw! * 0.15));
      const options = exposureBoundsOptions(classificationPacket(), Math.max(0, cashKrw! - reserve));
      const { record } = await seed(baseDir, { ...options, cashKrw: cashKrw!,
        exposureLimitPolicy: { modelVersion: CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION, maximumSectorExposureRatio: ratio! } });
      const result = await resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
      const expected = ratio === Number.MIN_VALUE ? 0 : Number(BigInt(cashKrw!) * 29n / 100n);
      assert.equal(result.calculation.positionUpperBounds.sectorRemainingKrw, expected);
      assert.equal(result.calculation.positionUpperBounds.symbolRemainingKrw, Number(BigInt(cashKrw!) / 5n));
      assert.equal(result.calculation.positionUpperBounds.bucketRemainingKrw, Number(BigInt(cashKrw!) / 2n));
    });
  }
});


test("position bounds reject independently valid sources with different scope or as-of chronology", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, exposureBoundsOptions());
  const result = await resolveStoredCandidatePositionExposureBounds({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  const input = result.calculation.input;
  const wrongSnapshot = createPortfolioSizingSnapshot({ ...input.snapshot, policyHash: hashCanonicalPayload("different-policy") });
  assert.throws(() => calculateCandidatePositionExposureBounds({ ...input, snapshot: wrongSnapshot }), /scope or chronology/);
  for (const kind of ["foreign-portfolio", "future", "expired"]) {
    const packet = structuredClone(input.classification.input.packet);
    if (kind === "foreign-portfolio") packet.virtualPortfolio.portfolioId = "foreign";
    else if (kind === "future") packet.generatedAt = "2026-09-04T00:00:00.001Z";
    else packet.expiresAt = AT;
    const classification = deriveCandidatePacketClassification({ ...input.classification.input, packet });
    assert.throws(() => calculateCandidatePositionExposureBounds({ ...input, classification }), /scope or chronology/);
  }
}));
