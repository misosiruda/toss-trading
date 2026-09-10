import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { candidateScoringModelRefFor, calculateCandidateSelectionScore, CANDIDATE_SCORING_ALGORITHM, createCandidateScoringModel } from "./candidateScoringModel.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";
import { createMarketTechnicalEvidencePaths, MarketTechnicalEvidenceFileRepository } from "./marketTechnicalEvidenceFiles.js";
import { policyFixture, storePolicyFixture, type ExecutionFixtureOptions } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createBucketSelectionPolicyRecord, createPortfolioRiskRuleParameterRecord, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage, selectionPolicyRefFor } from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths, ImmutablePolicyDependencyFileLoader } from "./runtimePolicyDependencyFiles.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent } from "./runtimePortfolioPolicyActivation.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { createRuntimePortfolioPolicyPaths } from "./runtimePortfolioPolicyFiles.js";
import { resolveStoredCandidateSelectionScore } from "./storedCandidateSelectionScore.js";
import { assessStoredCandidateEvidenceRequirements } from "./storedCandidateEvidenceRequirements.js";
import { assessStoredCandidateHardGates } from "./storedCandidateHardGates.js";
import type { CandidateHardGateRule } from "./candidateHardGateRules.js";
import { calculateCandidateExecutionCost, CANDIDATE_EXECUTION_COST_MODEL_VERSION } from "./candidateExecutionCost.js";
import { resolveStoredCandidateExecutionCost } from "./storedCandidateExecutionCost.js";
import { resolveStoredPolicyCandidateExecutionCost } from "./storedPolicyCandidateExecutionCost.js";

const AT = "2026-09-04T00:00:00.000Z";
const CREATED = "2026-09-01T00:00:00.000Z";
type Payload = Parameters<typeof createCandidateSizingInputRecord>[0];
type Options = { patch?: (input: Payload) => Payload; market?: "KR" | "US"; portfolioId?: string;
  execution?: ExecutionFixtureOptions;
  costEstimationModelVersion?: string | null;
  policyHash?: string; legacy?: boolean; extraModelFeature?: boolean; upperBound?: number;
  requiredEvidence?: Parameters<typeof createBucketSelectionPolicyRecord>[0]["requiredEvidence"];
  hardGateRules?: CandidateHardGateRule[];
  evidenceCutoffAt?: string; sourceCreatedAt?: string };

test("stored candidate score replays actual policy model and committed features without granting eligibility", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir);
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  assert.equal(result.verificationScope, "stored_score_replay_only");
  assert.deepEqual(result.score, fixture.score);
  assert.deepEqual(result.activePolicy.policy, fixture.policy);
  assert.deepEqual(result.selectionPolicy, fixture.selection);
  assert.deepEqual(result.sizingInputOrigin.record, fixture.record);
  assert.deepEqual(result.evidenceOrigin, fixture.evidence);
  assert.equal("eligibility" in result, false); assert.equal("sizingRange" in result, false); assert.equal("approved" in result, false);
  frozen(result);
  assert.deepEqual(await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }), result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
  assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
}));

test("stored candidate score rejects a rehashed committed score with any numeric mismatch", async () => {
  for (const selectionScore of [-1, 999, 0, 0.75]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { patch: (input) => ({ ...input, selectionScore }) });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
    assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
  });
});

test("stored candidate score rejects an unselected model even when that model exists and reproduces the claimed score", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, scoringModelVersion: "alternate.v1" }) });
  await appendFile(createImmutablePolicyDependencyPaths(baseDir).scoringModels, `${JSON.stringify(model("alternate.v1"))}\n`);
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /policy-selected model version/);
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId, model: model() } as never));
}));

test("stored candidate score cannot consume forged extra features or a model requiring unverified features", async () => {
  for (const options of [
    { patch: (input: Payload): Payload => ({ ...input, featureInputs: [...input.featureInputs, { featureDefinitionRef: "extra.v1", value: 1, evidenceRefs: ["unverified"] }] }) },
    { extraModelFeature: true }
  ]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, options);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /exact verified market feature set|exact model feature set/);
  });
});

test("stored candidate score rejects changed real feature values despite valid candidate hashes", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, featureInputs: input.featureInputs.map((feature, index) =>
    index === 0 ? { ...feature, value: Number(feature.value) + 1 } : feature) }) });
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /value or evidence reference mismatch/);
}));

test("stored candidate score uses the exact policy parameters instead of a matching version label", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { upperBound: 20000 }); // Candidate still declares the score computed with 10000.
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
}));

test("stored candidate score fails closed for legacy policies missing models and unavailable candidate IDs", async () => {
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { legacy: true });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /lacks an exact/);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: "missing" }), /stored candidate sizing input is missing/);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: " " }));
    await writeFile(createImmutablePolicyDependencyPaths(baseDir).scoringModels, "");
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /ref does not resolve/);
  });
});

test("stored candidate score resolves policy at candidate asOf rather than using latest or a declared hash", async () => {
  for (const retiredAt of ["2026-09-03T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]) await temporary(async (baseDir) => {
    const { record, policy, dependencies, activation } = await seed(baseDir);
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [policy], dependencies).appendRetired({
      portfolioId: policy.portfolioId, retiredActivationId: activation.activationId, reasonCode: "synthetic_retirement", createdAt: retiredAt });
    const result = resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    if (retiredAt < AT) await assert.rejects(result, /active runtime portfolio policy is required/);
    else assert.deepEqual((await result).activePolicy.activation, activation);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { policyHash: `sha256:${"f".repeat(64)}` });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /active policy hash mismatch/);
  });
});

test("stored candidate score rejects another portfolio and a market disabled by the active bucket", async () => {
  for (const options of [{ portfolioId: "other-portfolio" }, { market: "US" as const }]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, options);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /active runtime portfolio policy is required|enabled market mismatch/);
  });
});

test("stored candidate score rejects corruption in every actual source instead of trusting its cached score", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir);
  const paths = [...Object.values(createImmutablePolicyDependencyPaths(baseDir)), createRuntimePortfolioPolicyPaths(baseDir).recordsPath,
    createRuntimePortfolioPolicyActivationPaths(baseDir).eventsPath, createBucketSelectionRequestPaths(baseDir).recordsPath,
    createPortfolioSizingSnapshotPaths(baseDir).recordsPath, createCandidateSizingInputPaths(baseDir).recordsPath,
    createMarketTechnicalEvidencePaths(baseDir).recordsPath, join(baseDir, "historical-market-snapshots.jsonl")];
  for (const path of paths) {
    const before = await readFile(path);
    await appendFile(path, "corrupt\n");
    try { await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId })); }
    finally { await writeFile(path, before); }
  }
  await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
}));

test("candidate evidence requirements use actual policy request and source timestamps without granting eligibility", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir);
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(result.assessment.conditionsSatisfied, true);
  assert.equal(result.assessment.ageSeconds, 86400);
  assert.equal(result.assessment.latestObservationAt, "2026-09-03T00:00:00.000Z");
  assert.deepEqual(result.assessment.requirements[0]!.reasonCodes, []);
  assert.deepEqual(result.assessment.unevaluatedHardGateRuleIds, ["not-yet-evaluated"]);
  assert.equal(result.assessment.sourceTrust, "not_evaluated");
  assert.equal(result.assessment.historicalDiskAvailability, "not_proven");
  assert.equal("eligibility" in result.assessment, false);
  assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
  frozen(result);
  assert.deepEqual(await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
}));

test("candidate evidence freshness uses last raw observation rather than recent calculation or capture time", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86399 }] });
  const result = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(result.assessment.conditionsSatisfied, false);
  assert.deepEqual(result.assessment.requirements[0]!.reasonCodes, ["stale_observation"]);
  assert.ok(Date.parse(result.scoreReplay.evidenceOrigin.binding.evidence.createdAt) > Date.parse(AT));
}));

test("candidate evidence minimum count comes from policy rather than the calculator query", async () => {
  for (const minimumObservationCount of [2, 3]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400, minimumObservationCount }] });
    const result = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(result.assessment.conditionsSatisfied, minimumObservationCount === 2);
    assert.deepEqual(result.assessment.requirements[0]!.reasonCodes, minimumObservationCount === 2 ? [] : ["insufficient_observations"]);
  });
});

test("candidate evidence cannot substitute market features for fundamental portfolio or execution evidence", async () => temporary(async (baseDir) => {
  const requiredEvidence = ["market_technical", "fundamental_quality", "portfolio_fit", "execution_fit"].map((evidenceClass) => ({
    evidenceClass: evidenceClass as "market_technical" | "fundamental_quality" | "portfolio_fit" | "execution_fit",
    sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400 }));
  const { record } = await seed(baseDir, { requiredEvidence });
  const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(assessment.conditionsSatisfied, false);
  for (const result of assessment.requirements) {
    const present = result.requirement.evidenceClass === "market_technical";
    assert.deepEqual(result.reasonCodes, present ? [] : ["required_evidence_missing"]);
    assert.equal(result.evidenceRefs.length, present ? 1 : 0);
  }
}));

test("candidate evidence source contracts match exactly and independent failures are all reported", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "different-source.v1", maximumAgeSeconds: 1, minimumObservationCount: 3 }] });
  const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.deepEqual(assessment.requirements[0]!.reasonCodes, ["insufficient_observations", "source_contract_mismatch", "stale_observation"]);
  assert.equal(assessment.conditionsSatisfied, false);
}));

test("candidate evidence rejects observations beyond request cutoff even when fresh at asOf", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { evidenceCutoffAt: "2026-09-02T00:00:00.000Z" });
  const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.deepEqual(assessment.requirements[0]!.reasonCodes, ["observation_after_cutoff", "source_materialized_after_cutoff"]);
  assert.equal(assessment.conditionsSatisfied, false);
}));

test("candidate evidence checks source materialization cutoff by instant including equality and offsets", async () => {
  for (const sourceCreatedAt of [AT, "2026-09-04T09:00:00.000+09:00", "2026-09-04T00:00:00.001Z"]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { sourceCreatedAt });
    const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    const allowed = Date.parse(sourceCreatedAt) === Date.parse(AT);
    assert.equal(assessment.conditionsSatisfied, allowed);
    assert.deepEqual(assessment.requirements[0]!.reasonCodes, allowed ? [] : ["source_materialized_after_cutoff"]);
  });
});

test("candidate evidence assessment rechecks the exact original request prefix after score replay", async (context) => {
  for (const change of ["append", "replace"] as const) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    const prototype = BucketSelectionRequestFileRepository.prototype, original = prototype.withDurableVerifiedHistory;
    const path = createBucketSelectionRequestPaths(baseDir).recordsPath;
    let reads = 0;
    const mock = context.mock.method(prototype, "withDurableVerifiedHistory", async function<T>(this: BucketSelectionRequestFileRepository,
      operation: Parameters<typeof original<T>>[0]) {
      if (++reads === 2) {
        const request = JSON.parse((await readFile(path, "utf8")).trim());
        if (change === "replace") await writeFile(path, `${JSON.stringify({ ...request, createdAt: "2026-09-04T00:00:00.001Z" })}\n`);
        else {
          const { requestId: ignoredId, requestHash: ignoredHash, ...payload } = request; void ignoredId; void ignoredHash;
          await appendFile(path, `${JSON.stringify(createBucketSelectionRequest({ ...payload, cycleId: "another-cycle" }))}\n`);
        }
      }
      return original.call(this, operation);
    });
    try {
      const promise = assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
      if (change === "replace") await assert.rejects(promise, /does not match durable source prefix/);
      else assert.equal((await promise).assessment.conditionsSatisfied, true);
      assert.equal(reads, 2);
    } finally { mock.mock.restore(); }
  });
});

test("candidate evidence assessment refuses corrupt original request prefixes and mismatched scores", async () => {
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    const path = createBucketSelectionRequestPaths(baseDir).recordsPath;
    await appendFile(path, "corrupt\n");
    await assert.rejects(assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId }));
    assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { patch: (input) => ({ ...input, selectionScore: 999 }) });
    await assert.rejects(assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
  });
});

test("stored hard gates execute exact policy parameters over actual numeric features and interval", async () => temporary(async (baseDir) => {
  const hardGateRules: CandidateHardGateRule[] = [
    { ruleId: "volume", algorithm: "numeric_feature_range.v1", featureDefinitionRef: MARKET_TECHNICAL_FEATURE_DEFINITIONS.averageBarVolume, minimum: 10, maximum: 10 },
    { ruleId: "interval", algorithm: "market_interval.v1", allowedIntervals: ["1d"] }
  ];
  const { record } = await seed(baseDir, { hardGateRules });
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  const result = await assessStoredCandidateHardGates(input);
  assert.equal(result.evaluation.allHardGatesPassed, true);
  assert.equal(result.evaluation.contentChecksPassed, true);
  assert.deepEqual(result.evaluation.ruleResults.map((rule) => [rule.ruleId, rule.observedValue, rule.reasonCodes]), [["interval", "1d", []], ["volume", 10, []]]);
  assert.equal("eligibility" in result.evaluation, false);
  assert.equal(result.evaluation.sourceTrust, "not_evaluated");
  assert.equal(result.evaluationHash, hashCanonicalPayload(result.evaluation));
  frozen(result);
  assert.deepEqual(await assessStoredCandidateHardGates(input), result);
}));

test("stored hard gates report exact bounds violations and reject daily-only input for intraday intervals", async () => temporary(async (baseDir) => {
  const hardGateRules: CandidateHardGateRule[] = [
    { ruleId: "minimum-volume", algorithm: "numeric_feature_range.v1", featureDefinitionRef: MARKET_TECHNICAL_FEATURE_DEFINITIONS.averageBarVolume, minimum: 11 },
    { ruleId: "maximum-volume", algorithm: "numeric_feature_range.v1", featureDefinitionRef: MARKET_TECHNICAL_FEATURE_DEFINITIONS.averageBarVolume, maximum: 9 },
    { ruleId: "intraday-interval", algorithm: "market_interval.v1", allowedIntervals: ["1m", "5m"] }
  ];
  const { record } = await seed(baseDir, { hardGateRules });
  const { evaluation } = await assessStoredCandidateHardGates({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(evaluation.evidenceConditionsSatisfied, true);
  assert.equal(evaluation.contentChecksPassed, false);
  assert.deepEqual(evaluation.ruleResults.map((rule) => rule.reasonCodes), [["interval_not_allowed"], ["above_maximum"], ["below_minimum"]]);
}));

test("stored hard gate legacy IDs never imply passed rules and evidence failures cannot be overridden by passing gates", async () => {
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    const { evaluation } = await assessStoredCandidateHardGates({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(evaluation.allHardGatesPassed, false);
    assert.equal(evaluation.contentChecksPassed, false);
    assert.deepEqual(evaluation.ruleResults[0]!.reasonCodes, ["missing_rule_definition"]);
    assert.equal(evaluation.ruleResults[0]!.rule, null);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { hardGateRules: [{ ruleId: "interval", algorithm: "market_interval.v1", allowedIntervals: ["1d"] }],
      requiredEvidence: [{ evidenceClass: "fundamental_quality", sourceContractId: "unavailable-fundamentals", maximumAgeSeconds: 86400 }] });
    const { evaluation } = await assessStoredCandidateHardGates({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(evaluation.allHardGatesPassed, true);
    assert.equal(evaluation.evidenceConditionsSatisfied, false);
    assert.equal(evaluation.contentChecksPassed, false);
  });
});

test("stored hard gates propagate corrupt actual policy parameters without rewriting source files", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { hardGateRules: [{ ruleId: "interval", algorithm: "market_interval.v1", allowedIntervals: ["1d"] }] });
  const path = createImmutablePolicyDependencyPaths(baseDir).selectionPolicies;
  const raw = await readFile(path, "utf8");
  const records = raw.trim().split("\n").map((line) => JSON.parse(line));
  records.find((item) => item.bucket === "swing").hardGateRules[0].allowedIntervals = ["1m"];
  const changed = `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
  await writeFile(path, changed);
  await assert.rejects(assessStoredCandidateHardGates({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /hash mismatch/);
  assert.equal(await readFile(path, "utf8"), changed);
}));

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

function executionParameters(patch: { feeBps?: number } = {}) {
  return { schemaVersion: "portfolio_execution_rule.v1", markets: { KR: { executionPolicy: {
    modelVersion: "execution_simulator.v4", fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2,
    halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true, maxVolumeParticipationRate: 0.1,
    minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5, ...patch },
    maximumPriceAgeSeconds: 60, allowedPriceSourceContractIds: ["synthetic-price"] } } };
}
function executionOptions(): ExecutionFixtureOptions { return { bucket: executionParameters(), legacy: executionParameters() }; }
function costCandidate(input: Payload, patch: Partial<Payload["executionCostInput"]> = {}): Payload {
  const { estimatedCostKrw: ignored, ...parameters } = { ...input.executionCostInput, modelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION, ...patch }; void ignored;
  return { ...input, executionCostInput: { ...parameters, estimatedCostKrw: calculateCandidateExecutionCost(parameters).estimatedCostKrw } };
}

function model(version = "synthetic-score.v1", upperBound = 10000, extra = false) {
  return createCandidateScoringModel({ algorithm: CANDIDATE_SCORING_ALGORITHM, version, createdAt: CREATED,
    terms: [...Object.values(MARKET_TECHNICAL_FEATURE_DEFINITIONS), ...(extra ? ["extra.v1"] : [])].map((featureDefinitionRef) =>
      ({ featureDefinitionRef, weight: 1, lowerBound: 0, upperBound, direction: "higher_is_better" })) });
}
async function seed(baseDir: string, options: Options = {}) {
  const original = policyFixture("v1", options.execution), scoringModel = model("synthetic-score.v1", options.upperBound, options.extraModelFeature);
  const selection = createBucketSelectionPolicyRecord({ bucket: "swing", version: "scored.v1", createdAt: CREATED,
    requiredEvidence: options.requiredEvidence ?? [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400 }],
    hardGateRuleIds: options.hardGateRules?.map((rule) => rule.ruleId) ?? ["not-yet-evaluated"],
    ...(options.hardGateRules === undefined ? {} : { hardGateRules: options.hardGateRules }), scoringModelVersion: scoringModel.version,
    ...(options.legacy ? {} : { scoringModelRef: candidateScoringModelRefFor(scoringModel) }),
    ...(options.costEstimationModelVersion === null ? {} : {
      costEstimationModelVersion: options.costEstimationModelVersion ?? CANDIDATE_EXECUTION_COST_MODEL_VERSION }),
    featureDefinitionRefs: scoringModel.terms.map((term) => term.featureDefinitionRef) });
  const records = { ...original.records, scoringModels: [scoringModel],
    selectionPolicies: original.records.selectionPolicies.map((item) => item.bucket === "swing" ? selection : item) };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const { policyHash: ignoredHash, lineageHash: ignoredLineage, runtimePolicyRecordId: ignoredId, createdAt, ...payload } = original.policy;
  void ignoredHash; void ignoredLineage; void ignoredId;
  const updated = { ...payload, strategyBuckets: payload.strategyBuckets.map((bucket) => bucket.bucket === "swing"
    ? { ...bucket, selectionPolicyRef: selectionPolicyRefFor(selection) } : bucket) };
  const policyHash = hashCanonicalPayload(updated), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...updated, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  const activation = createPortfolioPolicyActivatedEvent({ policy, activationSequence: 1, createdAt: CREATED });
  await storePolicyFixture(baseDir, { ...original, records, dependencies, policy, activation });
  const market = options.market ?? "KR", portfolioId = options.portfolioId ?? policy.portfolioId;
  await new FileHistoricalMarketSnapshotStore(join(baseDir, "historical-market-snapshots.jsonl")).replaceAll([1, 3].map((day) => ({
    snapshotId: `synthetic-${day}`, market, symbol: "SYNTH", interval: "1d" as const, observedAt: `2026-09-0${day}T00:00:00.000Z`,
    createdAt: options.sourceCreatedAt ?? AT, lastPriceKrw: 100 * day, volume: 10, sourceRefs: ["synthetic"] })));
  const evidence = await new MarketTechnicalEvidenceFileRepository(baseDir).capture({ sourceContractId: "synthetic-local.v1",
    query: { market, symbol: "SYNTH", interval: "1d", windowStart: CREATED, asOf: AT, minimumObservationCount: 2, maximumAgeSeconds: 86400 } });
  const score = calculateCandidateSelectionScore({ model: model(), features: evidence.binding.evidence.calculation.featureInputs });
  const snapshot = createPortfolioSizingSnapshot({ portfolioId, portfolioVersion: "v1", policyHash: options.policyHash ?? policyHash, asOf: AT,
    virtualPortfolio: { portfolioId, cashKrw: 1000, positions: [], updatedAt: AT }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {}, pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
  const request = createBucketSelectionRequest({ cycleId: "synthetic-cycle", triggerIdentity: "scheduled:boundary", triggerRef: "slot",
    portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash, asOf: AT, bucket: "swing", gapBasis: "entry_floor", gapKrw: 1000, availableSlots: 2,
    maximumAdditionalExposureKrw: 1000, evidenceCutoffAt: options.evidenceCutoffAt ?? AT, createdAt: AT });
  await new BucketSelectionRequestFileRepository(baseDir).append(request);
  await new PortfolioSizingSnapshotFileRepository(baseDir).append(snapshot);
  while (Date.now() <= Date.parse(evidence.completion!.observedAt)) await new Promise((done) => setTimeout(done, 1));
  const candidate: Payload = { requestId: request.requestId, portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash, policyHash: snapshot.policyHash, asOf: AT, market, symbol: "SYNTH", bucket: "swing",
    scoringModelVersion: scoringModel.version, sizingAlgorithmVersion: "unverified-sizing.v1", selectionScore: score.selectionScore,
    exposureKeys: { sector: "Synthetic", country: "KR", currency: "KRW", classificationEvidenceRef: "unverified-classification" },
    featureInputs: evidence.binding.evidence.calculation.featureInputs,
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 900, sectorRemainingKrw: 800, countryRemainingKrw: 700, currencyRemainingKrw: 600, cashAvailableKrw: 500 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["unverified-liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 500, participationRate: 0.01, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2, halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5, evidenceRefs: ["unverified-cost"] },
    createdAt: new Date().toISOString() };
  const record = createCandidateSizingInputRecord(options.patch ? options.patch(candidate) : candidate);
  await new CandidateSizingInputFileRepository(baseDir).append(record);
  return { record, evidence, score, policy, selection, dependencies, activation };
}
function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function temporary(run: (baseDir: string) => Promise<void>) {
  const baseDir = await realpath(await mkdtemp(join(tmpdir(), "toss-stored-score-")));
  try { await run(baseDir); } finally { await rm(baseDir, { recursive: true, force: true }); }
}
