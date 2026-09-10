import assert from "node:assert/strict";
import test from "node:test";
import { CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION } from "./candidatePositionExposureBounds.js";
import { createBucketSelectionPolicyRecord, parseBucketSelectionPolicyRecord } from "./runtimePolicyContracts.js";

const payload = { bucket: "swing" as const, version: "synthetic.v1", createdAt: "2026-09-01T00:00:00.000Z",
  requiredEvidence: [{ evidenceClass: "market_technical" as const, sourceContractId: "synthetic", maximumAgeSeconds: 60 }],
  hardGateRuleIds: ["synthetic"], scoringModelVersion: "synthetic.v1", featureDefinitionRefs: ["synthetic"] };
const limits = { modelVersion: CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION, maximumSectorExposureRatio: 0.3 };

test("position exposure policy binds sector ceiling and model to identity while preserving legacy absence", () => {
  const legacy = createBucketSelectionPolicyRecord(payload);
  assert.equal("exposureLimitPolicy" in legacy, false);
  assert.equal(JSON.stringify(parseBucketSelectionPolicyRecord(legacy)), JSON.stringify(legacy));
  const selected = createBucketSelectionPolicyRecord({ ...payload, exposureLimitPolicy: limits });
  assert.deepEqual(parseBucketSelectionPolicyRecord(selected), selected);
  for (const exposureLimitPolicy of [limits, { ...limits, maximumSectorExposureRatio: 0.2 }, { ...limits, modelVersion: "next.v1" }]) {
    const record = createBucketSelectionPolicyRecord({ ...payload, exposureLimitPolicy });
    assert.notEqual(record.hash, legacy.hash);
    assert.notEqual(record.selectionPolicyRecordId, legacy.selectionPolicyRecordId);
    assert.notEqual(record.lineageHash, legacy.lineageHash);
    if (exposureLimitPolicy !== limits) assert.notEqual(record.hash, selected.hash);
  }
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...selected, exposureLimitPolicy: { ...limits, maximumSectorExposureRatio: 1 } }), /hash mismatch/);
});

test("position exposure policy requires a complete strict versioned positive sector ratio without defaults", () => {
  for (const maximumSectorExposureRatio of [Number.MIN_VALUE, 0.1, 1]) {
    assert.equal(createBucketSelectionPolicyRecord({ ...payload, exposureLimitPolicy: { ...limits, maximumSectorExposureRatio } })
      .exposureLimitPolicy!.maximumSectorExposureRatio, maximumSectorExposureRatio);
  }
  for (const exposureLimitPolicy of [null, {}, { modelVersion: limits.modelVersion }, { maximumSectorExposureRatio: 0.3 },
    { ...limits, extra: true }, ...[0, -0, -1, 1.01, NaN, Infinity, "0.3", null].map((maximumSectorExposureRatio) => ({ ...limits, maximumSectorExposureRatio })),
    ...["", " ", "x".repeat(81)].map((modelVersion) => ({ ...limits, modelVersion }))]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...payload, exposureLimitPolicy } as never));
  }
});
