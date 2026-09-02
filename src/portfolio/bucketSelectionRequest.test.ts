import assert from "node:assert/strict";
import test from "node:test";

import {
  createBucketSelectionRequest,
  parseBucketSelectionRequest,
  type CreateBucketSelectionRequestInput
} from "./bucketSelectionRequest.js";
import {
  hashCanonicalPayload,
  hashDerivedId
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("selection request binds a complete semantic payload to hash identity", () => {
  const request = createBucketSelectionRequest(requestInput());
  const { requestId, requestHash, createdAt: _createdAt, ...payload } = request;

  assert.equal(requestHash, hashCanonicalPayload(payload));
  assert.equal(
    requestId,
    hashDerivedId("bucket_selection_request", requestHash)
  );
  assert.deepEqual(parseBucketSelectionRequest(request), request);
  assert.equal(Object.isFrozen(request), true);
});

test("selection request identity excludes creation time for semantic retries", () => {
  const first = createBucketSelectionRequest(requestInput());
  const retry = createBucketSelectionRequest({
    ...requestInput(),
    createdAt: "2026-09-02T00:05:00.000Z"
  });

  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.requestHash, first.requestHash);
  assert.notEqual(retry.createdAt, first.createdAt);
});

test("selection request rejects identity and payload tamper", () => {
  const request = createBucketSelectionRequest(requestInput());
  assert.throws(
    () => parseBucketSelectionRequest({ ...request, requestHash: HASH_B }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      parseBucketSelectionRequest({
        ...request,
        requestId: "bucket_selection_request_wrong"
      }),
    /identity does not match payload/
  );
  assert.throws(
    () => parseBucketSelectionRequest({ ...request, gapKrw: 101 }),
    /identity does not match payload/
  );
});

test("selection request requires positive slot, gap, and bounded capacity", () => {
  for (const override of [
    { gapKrw: 0 },
    { availableSlots: 0 },
    { maximumAdditionalExposureKrw: 0 }
  ]) {
    assert.throws(() =>
      createBucketSelectionRequest({ ...requestInput(), ...override })
    );
  }
  assert.throws(
    () =>
      createBucketSelectionRequest({
        ...requestInput(),
        maximumAdditionalExposureKrw: 101
      }),
    /exceeds gap/
  );
});

test("selection request enforces cutoff and creation chronology", () => {
  assert.throws(
    () =>
      createBucketSelectionRequest({
        ...requestInput(),
        evidenceCutoffAt: "2026-09-02T00:00:01.000Z"
      }),
    /cutoff is after asOf/
  );
  assert.throws(
    () =>
      createBucketSelectionRequest({
        ...requestInput(),
        createdAt: "2026-09-01T23:59:59.000Z"
      }),
    /created before asOf/
  );
  assert.throws(
    () =>
      createBucketSelectionRequest({
        ...requestInput(),
        asOf: "2026-09-02T00:00:00"
      }),
    /timezone offset/
  );
});

test("selection request rejects normalized and malformed identifiers", () => {
  assert.throws(
    () =>
      createBucketSelectionRequest({
        ...requestInput(),
        triggerRef: " trigger-1 "
      }),
    /already be canonical/
  );
  assert.throws(
    () =>
      createBucketSelectionRequest({
        ...requestInput(),
        triggerIdentity: "scheduled:\ud800"
      }),
    /well-formed Unicode/
  );
});

function requestInput(): CreateBucketSelectionRequestInput {
  return {
    cycleId: "cycle-2026-09-02-1",
    triggerIdentity: "scheduled:boundary-hash-1",
    triggerRef: "schedule-slot-1",
    portfolioId: "portfolio-1",
    portfolioSnapshotId: "portfolio-sizing-snapshot-1",
    portfolioSnapshotHash: HASH_A,
    policyHash: HASH_B,
    asOf: "2026-09-02T00:00:00.000Z",
    bucket: "long_term",
    gapBasis: "min",
    gapKrw: 100,
    availableSlots: 2,
    maximumAdditionalExposureKrw: 80,
    evidenceCutoffAt: "2026-09-01T23:59:00.000Z",
    createdAt: "2026-09-02T00:00:01.000Z"
  };
}
