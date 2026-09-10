import assert from "node:assert/strict";
import test from "node:test";
import { CANDIDATE_EXECUTION_COST_MODEL_VERSION } from "./candidateExecutionCost.js";
import { createBucketSelectionPolicyRecord, hashCanonicalPayload, parseBucketSelectionPolicyRecord,
  selectionPolicyRefFor } from "./runtimePolicyContracts.js";

function input() {
  return { bucket: "swing" as const, version: "synthetic.v1", createdAt: "2026-09-01T00:00:00.000Z",
    requiredEvidence: [{ evidenceClass: "market_technical" as const, sourceContractId: "synthetic", maximumAgeSeconds: 60 }],
    hardGateRuleIds: ["synthetic"], scoringModelVersion: "synthetic-score.v1", featureDefinitionRefs: ["synthetic-feature.v1"] };
}

test("selection policy binds the explicit candidate cost algorithm to complete identity and lineage", () => {
  const record = createBucketSelectionPolicyRecord({ ...input(), costEstimationModelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION });
  const changed = createBucketSelectionPolicyRecord({ ...input(), costEstimationModelVersion: "future-cost.v2" });
  assert.notEqual(record.hash, changed.hash);
  assert.notEqual(record.selectionPolicyRecordId, changed.selectionPolicyRecordId);
  assert.notEqual(record.lineageHash, changed.lineageHash);
  assert.notDeepEqual(selectionPolicyRefFor(record), selectionPolicyRefFor(changed));
  assert.equal(record.costEstimationModelVersion, CANDIDATE_EXECUTION_COST_MODEL_VERSION);
  assert.deepEqual(parseBucketSelectionPolicyRecord(JSON.parse(JSON.stringify(record))), record);
  assert.ok(Object.isFrozen(record));
});

test("selection policy preserves legacy bytes and hash without synthesizing a candidate cost model", () => {
  const record = createBucketSelectionPolicyRecord(input());
  const { createdAt: ignored, ...payload } = input(); void ignored;
  assert.equal(record.hash, hashCanonicalPayload(payload));
  assert.equal("costEstimationModelVersion" in record, false);
  const bytes = JSON.stringify(record);
  assert.equal(JSON.stringify(parseBucketSelectionPolicyRecord(JSON.parse(bytes))), bytes);
});

test("selection policy rejects malformed cost versions and stale hashes after model changes", () => {
  for (const costEstimationModelVersion of ["", " ", "x".repeat(81), null, 1, {}]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...input(), costEstimationModelVersion } as never));
  }
  const record = createBucketSelectionPolicyRecord({ ...input(), costEstimationModelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION });
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...record, costEstimationModelVersion: "future-cost.v2" }), /hash mismatch/);
  const { costEstimationModelVersion: ignored, ...withoutModel } = record; void ignored;
  assert.throws(() => parseBucketSelectionPolicyRecord(withoutModel), /hash mismatch/);
});
