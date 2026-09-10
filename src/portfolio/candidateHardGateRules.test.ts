import assert from "node:assert/strict";
import test from "node:test";
import { createBucketSelectionPolicyRecord, parseBucketSelectionPolicyRecord, hashCanonicalPayload,
  hashDerivedId, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import type { CandidateHardGateRule } from "./candidateHardGateRules.js";

const AT = "2026-09-01T00:00:00.000Z";
const range: CandidateHardGateRule = { ruleId: "range", algorithm: "numeric_feature_range.v1", featureDefinitionRef: "metric.v1", minimum: 0, maximum: 10 };
const interval: CandidateHardGateRule = { ruleId: "interval", algorithm: "market_interval.v1", allowedIntervals: ["1h", "1d"] };
function policy(rules: CandidateHardGateRule[] = [range, interval]) {
  return createBucketSelectionPolicyRecord({ bucket: "swing", version: "v1", createdAt: AT,
    requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic", maximumAgeSeconds: 60 }],
    hardGateRuleIds: rules.map((rule) => rule.ruleId), hardGateRules: rules,
    scoringModelVersion: "v1", featureDefinitionRefs: ["metric.v1"] });
}

test("hard gate parameters are canonical policy content with versioned algorithms and immutable identity", () => {
  const first = policy();
  assert.deepEqual(first, policy([interval, range]));
  assert.deepEqual(first.hardGateRules![0], { ...interval, allowedIntervals: ["1d", "1h"] });
  assert.deepEqual(parseBucketSelectionPolicyRecord(JSON.parse(JSON.stringify(first))), first);
  assert.notEqual(policy([{ ...range, minimum: 1 }, interval]).hash, first.hash);
  assert.ok(Object.isFrozen(first.hardGateRules));
  assert.ok(Object.isFrozen(first.hardGateRules![0]));
  const firstRule = first.hardGateRules![0]!;
  assert.equal(firstRule.algorithm, "market_interval.v1");
  if (firstRule.algorithm === "market_interval.v1") assert.ok(Object.isFrozen(firstRule.allowedIntervals));
});

test("hard gate legacy policy bytes and hash are preserved without synthesizing rule definitions", () => {
  const first = policy();
  const { selectionPolicyRecordId: ignoredId, hash: ignoredHash, lineageHash: ignoredLineage, hardGateRules: ignoredRules, ...payload } = first;
  void ignoredId; void ignoredHash; void ignoredLineage; void ignoredRules;
  const legacy = createBucketSelectionPolicyRecord(payload);
  const { createdAt: ignoredAt, ...semantic } = payload; void ignoredAt;
  assert.equal(legacy.hash, hashCanonicalPayload(semantic));
  assert.equal("hardGateRules" in legacy, false);
  assert.deepEqual(parseBucketSelectionPolicyRecord(JSON.parse(JSON.stringify(legacy))), legacy);
});

test("hard gate definitions require exact ID coverage declared features and supported explicit parameters", () => {
  const base = policy();
  const { selectionPolicyRecordId: ignoredId, hash: ignoredHash, lineageHash: ignoredLineage, ...payload } = base;
  void ignoredId; void ignoredHash; void ignoredLineage;
  for (const patch of [{ hardGateRuleIds: ["range"] }, { hardGateRuleIds: ["range", "interval", "missing"] },
    { hardGateRules: [range, range] }, { featureDefinitionRefs: ["another.v1"] }, { hardGateRules: [] }]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...payload, ...patch }));
  }
  for (const rule of [
    { ...range, minimum: 11 }, { ...range, minimum: undefined, maximum: undefined },
    { ...range, minimum: -0 }, { ...range, maximum: Infinity }, { ...range, maximum: Number.MAX_SAFE_INTEGER + 1 },
    { ...range, algorithm: "arbitrary_code.v1" }, { ...range, expression: "return true" },
    { ...range, ruleId: " range " }, { ...interval, allowedIntervals: ["1d", "1d"] },
    { ...interval, allowedIntervals: [] }, { ...interval, allowedIntervals: ["1s"] }
  ]) assert.throws(() => policy([rule as CandidateHardGateRule]));
  assert.doesNotThrow(() => policy([{ ...range, minimum: 10, maximum: 10 }]));
  assert.doesNotThrow(() => policy([{ ruleId: "one-sided", algorithm: "numeric_feature_range.v1", featureDefinitionRef: "metric.v1", maximum: -1 }]));
});

test("hard gate parser rejects payload tampering and even rehashed noncanonical definition order", () => {
  const first = policy();
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...first, hardGateRules: [range, interval] }), /canonical order/);
  const { selectionPolicyRecordId: ignoredId, hash: ignoredHash, lineageHash: ignoredLineage, createdAt, ...raw } = first;
  void ignoredId; void ignoredHash; void ignoredLineage;
  const payload = { ...raw, hardGateRules: [...first.hardGateRules!].reverse() };
  const hash = hashCanonicalPayload(payload), selectionPolicyRecordId = hashDerivedId("selection_policy", hash);
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...payload, hash, selectionPolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "selection_policy", recordId: selectionPolicyRecordId, semanticHash: hash, createdAt }) }), /canonical order/);
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...first, hardGateRules: [first.hardGateRules![0], { ...range, minimum: 2 }] }), /hash mismatch/);
});
