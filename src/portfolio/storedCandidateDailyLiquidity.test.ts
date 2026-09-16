import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import test from "node:test";
import { createMarketTechnicalEvidencePaths } from "./marketTechnicalEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredPolicyCandidateExecutionCost } from "./storedPolicyCandidateExecutionCost.js";
import { CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION } from "./candidateDailyLiquidity.js";
import { resolveStoredCandidateDailyLiquidity } from "./storedCandidateDailyLiquidity.js";
import { liquidityCandidate, executionParameters, executionOptions, costCandidate, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored daily liquidity replays actual evidence and policy participation without granting eligibility", async () => {
  for (const gatesPass of [false, true]) await temporary(async (baseDir) => {
    const { record, evidence } = await seed(baseDir, { execution: executionOptions(),
      liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, patch: liquidityCandidate,
      ...(gatesPass ? { hardGateRules: [{ ruleId: "daily", algorithm: "market_interval.v1" as const, allowedIntervals: ["1d" as const] }] } : {}) });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    const result = await resolveStoredCandidateDailyLiquidity(input);
    assert.equal(result.calculation.liquidityInput.averageDailyNotionalKrw, 2000);
    assert.equal(result.calculation.liquidityInput.maximumLiquidityNotionalKrw, 200);
    assert.deepEqual(result.calculation.liquidityInput.evidenceRefs, [evidence.binding.evidence.evidenceRef]);
    assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, gatesPass);
    assert.equal(result.assessment.sourceTrust, "not_evaluated");
    assert.equal(result.assessment.historicalDiskAvailability, "not_proven");
    assert.equal(result.assessment.liquidityParameterAuthority, "as_of_policy_bound");
    assert.equal(result.assessment.liquidityModelSelection, "as_of_selection_policy_bound");
    assert.equal("eligibility" in result, false); assert.equal("sizingRange" in result, false);
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    frozen(result);
    assert.deepEqual(await resolveStoredCandidateDailyLiquidity(input), result);
  });
});


test("stored daily liquidity rejects every rehashed declared input mismatch including evidence substitutions", async () => {
  for (const patch of [{ averageDailyNotionalKrw: 2001 }, { maximumLiquidityNotionalKrw: 201 },
    { maximumParticipationRatio: 0.2 }, { evidenceRefs: ["unverified"] }, { evidenceRefs: ["extra", "unverified"] }]) {
    await temporary(async (baseDir) => {
      const { record } = await seed(baseDir, { execution: executionOptions(),
        liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION,
        patch: (input) => { const candidate = liquidityCandidate(input); return { ...candidate, liquidityInput: { ...candidate.liquidityInput, ...patch } }; } });
      const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
      await resolveStoredPolicyCandidateExecutionCost(input); // Correct costs do not authenticate liquidity declarations.
      await assert.rejects(resolveStoredCandidateDailyLiquidity(input), /liquidity differs/);
    });
  }
});


test("stored daily liquidity refuses absent or unsupported model choices and intraday evidence", async () => {
  for (const liquidityEstimationModelVersion of [undefined, "unknown.v1", CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION]) {
    await temporary(async (baseDir) => {
      const interval = liquidityEstimationModelVersion === CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION ? "1h" : "1d";
      const { record } = await seed(baseDir, { execution: executionOptions(), interval, patch: liquidityCandidate,
        ...(liquidityEstimationModelVersion === undefined ? {} : { liquidityEstimationModelVersion }) });
      await assert.rejects(resolveStoredCandidateDailyLiquidity({ baseDir, sizingInputRecordId: record.sizingInputRecordId }),
        interval === "1h" ? /requires daily bars/ : /model is not selected/);
    });
  }
});


test("stored daily liquidity derives participation from actual policy instead of a self-consistent candidate cap", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { execution: { bucket: executionParameters({ maxVolumeParticipationRate: 0.2 }), legacy: executionParameters() },
    liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION,
    patch: (input) => costCandidate(liquidityCandidate(input), { maxVolumeParticipationRate: 0.2 }) });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await resolveStoredPolicyCandidateExecutionCost(input);
  await assert.rejects(resolveStoredCandidateDailyLiquidity(input), /liquidity differs/);
}));


test("stored daily liquidity refuses caller overrides and corrupted actual evidence without repairing bytes", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { execution: executionOptions(),
    liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, patch: liquidityCandidate });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await assert.rejects(resolveStoredCandidateDailyLiquidity({ ...input, maximumParticipationRatio: 0.1 } as never));
  const path = createMarketTechnicalEvidencePaths(baseDir).recordsPath;
  await appendFile(path, '{"corrupt":true}\n');
  const before = await readFile(path, "utf8");
  await assert.rejects(resolveStoredCandidateDailyLiquidity(input));
  assert.equal(await readFile(path, "utf8"), before);
}));
