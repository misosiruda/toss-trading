import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION } from "./candidateDailyLiquidity.js";
import { resolveStoredCandidateDailyLiquidity } from "./storedCandidateDailyLiquidity.js";
import { CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION } from "./candidateDailyCostBasis.js";
import { resolveStoredCandidateDailyCostBasis } from "./storedCandidateDailyCostBasis.js";
import { dailyCostBasisCandidate, executionOptions, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored daily cost basis binds actual liquidity evidence for BUY SELL and zero-reference diagnostics", async () => {
  for (const side of ["BUY", "SELL"] as const) for (const referenceNotionalKrw of [0, 200]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { execution: executionOptions(),
      liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, costBasisModelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
      hardGateRules: [{ ruleId: "daily", algorithm: "market_interval.v1", allowedIntervals: side === "BUY" ? ["1d"] : ["1h"] }],
      patch: (input) => dailyCostBasisCandidate(input, { side, referenceNotionalKrw, participationRate: referenceNotionalKrw / 2000 }) });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    const result = await resolveStoredCandidateDailyCostBasis(input);
    assert.deepEqual(result.calculation.costBasis, { referenceNotionalKrw, participationRate: referenceNotionalKrw / 2000,
      evidenceRefs: record.liquidityInput.evidenceRefs });
    assert.equal(result.assessment.costEvidenceBinding, "stored_daily_bar_proxy");
    assert.equal(result.assessment.referenceNotionalAuthority, "declared_within_liquidity_cap");
    assert.equal(result.assessment.costBasisModelSelection, "as_of_selection_policy_bound");
    assert.equal(result.assessment.sourceTrust, "not_evaluated");
    assert.equal(result.assessment.finalSizing, "not_performed");
    assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, side === "BUY");
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    frozen(result);
    assert.deepEqual(await resolveStoredCandidateDailyCostBasis(input), result);
  });
});


test("stored daily cost basis rejects incorrect participation or evidence despite correctly recomputed cost amounts", async () => {
  for (const patch of [{ participationRate: 0 }, { participationRate: 0.099 }, { participationRate: 0.101 },
    { evidenceRefs: ["unverified-cost"] }, { evidenceRefs: ["extra", "unverified-cost"] }]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { execution: executionOptions(),
      liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, costBasisModelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
      patch: (input) => dailyCostBasisCandidate(input, patch) });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateDailyLiquidity(input);
    await assert.rejects(resolveStoredCandidateDailyCostBasis(input), /cost basis differs/);
  });
});


test("stored daily cost basis refuses reference amounts beyond actual liquidity cap", async () => {
  for (const referenceNotionalKrw of [201, 500]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { execution: executionOptions(),
      liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, costBasisModelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
      patch: (input) => dailyCostBasisCandidate(input, { referenceNotionalKrw, participationRate: referenceNotionalKrw / 2000 }) });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateDailyLiquidity(input);
    await assert.rejects(resolveStoredCandidateDailyCostBasis(input), /exceeds daily liquidity cap/);
  });
});


test("stored daily cost basis cannot infer a basis model from independently selected liquidity and cost models", async () => {
  for (const costBasisModelVersion of [undefined, "unknown.v1"]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { execution: executionOptions(),
      liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION,
      ...(costBasisModelVersion === undefined ? {} : { costBasisModelVersion }), patch: dailyCostBasisCandidate });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateDailyLiquidity(input);
    await assert.rejects(resolveStoredCandidateDailyCostBasis(input), /model is not selected/);
  });
});


test("stored daily cost basis refuses injected parameters and corrupted actual source histories", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { execution: executionOptions(),
    liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, costBasisModelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
    patch: dailyCostBasisCandidate });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await assert.rejects(resolveStoredCandidateDailyCostBasis({ ...input, participationRate: 0.1 } as never));
  const path = join(baseDir, "historical-market-snapshots.jsonl");
  await appendFile(path, '{"corrupt":true}\n');
  const before = await readFile(path, "utf8");
  await assert.rejects(resolveStoredCandidateDailyCostBasis(input));
  assert.equal(await readFile(path, "utf8"), before);
}));
