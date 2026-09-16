import assert from "node:assert/strict";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createMarketTechnicalEvidencePaths } from "./marketTechnicalEvidenceFiles.js";
import { createPortfolioRiskRuleParameterRecord, hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths, ImmutablePolicyDependencyFileLoader } from "./runtimePolicyDependencyFiles.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { CANDIDATE_EXECUTION_COST_MODEL_VERSION } from "./candidateExecutionCost.js";
import { resolveStoredCandidateExecutionCost } from "./storedCandidateExecutionCost.js";
import { resolveStoredPolicyCandidateExecutionCost } from "./storedPolicyCandidateExecutionCost.js";
import { AT, CREATED, type Payload, executionParameters, executionOptions, costCandidate, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored candidate cost replays actual input without granting cost source trust or overriding blocked hard gates", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, executionCostInput: {
    ...input.executionCostInput, modelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION, estimatedCostKrw: 4 } }) });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  const result = await resolveStoredCandidateExecutionCost(input);
  assert.equal(result.calculation.estimatedCostKrw, 4);
  assert.equal(result.assessment.sizingInputHash, record.sizingInputHash);
  assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, false);
  assert.equal(result.assessment.costParameterAuthority, "not_verified");
  assert.equal(result.assessment.costEvidenceAuthority, "not_verified");
  assert.equal(result.assessment.fillSimulation, "not_performed");
  assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
  assert.equal("eligibility" in result.assessment, false);
  frozen(result);
  assert.deepEqual(await resolveStoredCandidateExecutionCost(input), result);
}));


test("stored candidate cost refuses unknown models and rehashed wrong estimates from actual storage", async () => {
  for (const patch of [undefined, (input: Payload) => ({ ...input, executionCostInput: {
    ...input.executionCostInput, modelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION, estimatedCostKrw: 0 } })]) {
    await temporary(async (baseDir) => {
      const { record } = await seed(baseDir, patch ? { patch } : {});
      await assert.rejects(resolveStoredCandidateExecutionCost({ baseDir, sizingInputRecordId: record.sizingInputRecordId }));
    });
  }
});


test("stored candidate cost cannot accept caller cost parameters or hide corrupt actual evidence", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, executionCostInput: {
    ...input.executionCostInput, modelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION, estimatedCostKrw: 4 } }) });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await assert.rejects(resolveStoredCandidateExecutionCost({ ...input, estimatedCostKrw: 0 } as typeof input));
  const path = createMarketTechnicalEvidencePaths(baseDir).recordsPath;
  await appendFile(path, '{"corrupt":true}\n');
  const before = await readFile(path, "utf8");
  await assert.rejects(resolveStoredCandidateExecutionCost(input));
  assert.equal(await readFile(path, "utf8"), before);
}));


test("stored cost model and parameters bind exact as-of bucket policy without promoting cost evidence authority", async () => {
  for (const side of ["BUY", "SELL"] as const) await temporary(async (baseDir) => {
    const { record, dependencies } = await seed(baseDir, { execution: executionOptions(), patch: (input) => costCandidate(input, { side }) });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    const result = await resolveStoredPolicyCandidateExecutionCost(input);
    assert.equal(result.assessment.side, side);
    assert.equal(result.assessment.costParameterAuthority, "as_of_policy_bound");
    assert.equal(result.assessment.costEstimationModelSelection, "as_of_selection_policy_bound");
    assert.equal(result.assessment.costEvidenceAuthority, "not_verified");
    assert.equal(result.assessment.executionModelVersion, "execution_simulator.v4");
    assert.equal(result.assessment.estimationModelVersion, CANDIDATE_EXECUTION_COST_MODEL_VERSION);
    assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, false);
    assert.equal(result.assessment.policyHash, record.policyHash);
    const selected = dependencies.resolveRiskRuleSetDependencies(result.costReplay.hardGateAssessment.evidenceAssessment.scoreReplay.bucketPolicy.riskRuleSetRef);
    assert.equal(result.assessment.executionParameterRef.hash, selected.riskRules.find(({ rule }) => rule.ruleId === "paper_execution")!.parameter.hash);
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    frozen(result);
    assert.deepEqual(await resolveStoredPolicyCandidateExecutionCost(input), result);
  });
});


test("stored cost model selection refuses absent or unsupported policy versions despite valid arithmetic and execution parameters", async () => {
  for (const costEstimationModelVersion of [null, "candidate_reference_notional_cost.v2", "paper_cost_model.v5"]) {
    await temporary(async (baseDir) => {
      const { record } = await seed(baseDir, { execution: executionOptions(), costEstimationModelVersion, patch: costCandidate });
      const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
      await resolveStoredCandidateExecutionCost(input); // The weaker arithmetic-only API remains usable.
      await assert.rejects(resolveStoredPolicyCandidateExecutionCost(input), /model is not selected/);
    });
  }
});


test("stored cost parameters reject every changed shared execution setting even with correctly recomputed costs", async () => {
  for (const patch of [{ feeBps: 10 }, { taxBps: 20 }, { slippageBps: 40 }, { halfSpreadBps: 30 },
    { fillRatio: 0.5 }, { allowFractionalShares: false }, { maxVolumeParticipationRate: 0.2 },
    { minLiquidityFillRatio: 0.2 }, { rejectStaleLiquidity: false }, { marketImpactBpsPerParticipationRate: 50 }]) {
    await temporary(async (baseDir) => {
      const { record } = await seed(baseDir, { execution: executionOptions(), patch: (input) => costCandidate(input, patch) });
      const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
      await resolveStoredCandidateExecutionCost(input); // Arithmetic is valid; policy correspondence is not.
      await assert.rejects(resolveStoredPolicyCandidateExecutionCost(input), /parameters differ from as-of bucket policy/);
    });
  }
});


test("stored cost parameters never substitute legacy-scope parameters for the selected bucket", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { execution: { ...executionOptions(), legacy: executionParameters({ feeBps: 10 }) },
    patch: (input) => costCandidate(input, { feeBps: 10 }) });
  await assert.rejects(resolveStoredPolicyCandidateExecutionCost({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /parameters differ/);
}));


test("stored cost parameters require a supported applicable rule and exact canonical market settings", async () => {
  const base = executionOptions();
  for (const execution of [undefined, { ...base, ruleVersion: "v2" }, { ...base, appliesTo: ["SELL"] as Array<"BUY" | "SELL"> },
    { ...base, bucket: { schemaVersion: "portfolio_execution_rule.v1", markets: { US: executionParameters().markets.KR } } },
    { ...base, bucket: { ...executionParameters(), extra: true } },
    { ...base, bucket: { schemaVersion: "unknown.v1", markets: executionParameters().markets } }]) {
    await temporary(async (baseDir) => {
      const { record } = await seed(baseDir, { ...(execution ? { execution } : {}), patch: costCandidate });
      await assert.rejects(resolveStoredPolicyCandidateExecutionCost({ baseDir, sizingInputRecordId: record.sizingInputRecordId }));
    });
  }
});


test("stored cost parameters use historical activation and never mistake later retirement for current execution authority", async () => {
  for (const retiredAt of ["2026-09-03T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]) await temporary(async (baseDir) => {
    const { record, policy, dependencies, activation } = await seed(baseDir, { execution: executionOptions(), patch: costCandidate });
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [policy], dependencies).appendRetired({ portfolioId: policy.portfolioId,
      retiredActivationId: activation.activationId, reasonCode: "synthetic_retirement", createdAt: retiredAt });
    const promise = resolveStoredPolicyCandidateExecutionCost({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    if (retiredAt < AT) await assert.rejects(promise, /active runtime portfolio policy is required/);
    else assert.equal((await promise).assessment.activationId, activation.activationId);
  });
});


test("stored cost policy refuses mixed generations and permits a complete retry after an unrelated append", async (context) => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { execution: executionOptions(), patch: costCandidate });
  const prototype = ImmutablePolicyDependencyFileLoader.prototype, original = prototype.load;
  let reads = 0;
  const mock = context.mock.method(prototype, "load", async function(this: ImmutablePolicyDependencyFileLoader) {
    if (++reads === 2) {
      const extra = createPortfolioRiskRuleParameterRecord({ ruleId: "unrelated", ruleVersion: "v1", version: "v1",
        parameters: { synthetic: true }, createdAt: CREATED });
      await appendFile(createImmutablePolicyDependencyPaths(baseDir).riskParameters, `${JSON.stringify(extra)}\n`);
    }
    return original.call(this);
  });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  try {
    await assert.rejects(resolveStoredPolicyCandidateExecutionCost(input), /policy snapshot changed/);
    assert.equal(reads, 2);
  } finally { mock.mock.restore(); }
  assert.equal((await resolveStoredPolicyCandidateExecutionCost(input)).assessment.costParameterAuthority, "as_of_policy_bound");
}));


test("stored cost policy rejects caller policy overrides and corrupt or missing real parameter records", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { execution: executionOptions(), patch: costCandidate });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await assert.rejects(resolveStoredPolicyCandidateExecutionCost({ ...input, policy: {} } as typeof input));
  const path = createImmutablePolicyDependencyPaths(baseDir).riskParameters, original = await readFile(path, "utf8");
  for (const data of [original + "corrupt\n", original.trim().split("\n").filter((line) => JSON.parse(line).ruleId !== "paper_execution").join("\n") + "\n"]) {
    await writeFile(path, data);
    await assert.rejects(resolveStoredPolicyCandidateExecutionCost(input));
    assert.equal(await readFile(path, "utf8"), data);
    await writeFile(path, original);
  }
}));
