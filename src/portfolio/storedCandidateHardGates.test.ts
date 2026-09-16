import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { assessStoredCandidateHardGates } from "./storedCandidateHardGates.js";
import type { CandidateHardGateRule } from "./candidateHardGateRules.js";
import { seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

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
