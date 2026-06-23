import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurgedKFoldPlan,
  purgedKFoldPlanSchema,
  purgedKFoldSplitSchema,
  type PurgedKFoldSample
} from "./purgedSplit.js";

test("purged k-fold plan removes train samples with overlapping label horizons", () => {
  const plan = buildPurgedKFoldPlan({
    planId: "pkf_review",
    foldCount: 3,
    samples: [
      sample("s6", "2025-01-13T00:00:00.000Z", "2025-01-13T23:59:59.999Z"),
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-05T23:59:59.999Z"),
      sample("s4", "2025-01-11T00:00:00.000Z", "2025-01-11T23:59:59.999Z"),
      sample("s2", "2025-01-06T00:00:00.000Z", "2025-01-10T23:59:59.999Z"),
      sample("s3", "2025-01-09T00:00:00.000Z", "2025-01-12T23:59:59.999Z"),
      sample("s5", "2025-01-12T00:00:00.000Z", "2025-01-12T23:59:59.999Z")
    ]
  });
  const firstSplit = plan.splits[0]!;

  assert.equal(plan.validationProtocol, "purged_k_fold");
  assert.equal(plan.splitCount, 3);
  assert.equal(purgedKFoldPlanSchema.safeParse(plan).success, true);
  assert.deepEqual(firstSplit.testSampleIds, ["s1", "s2"]);
  assert.deepEqual(firstSplit.purgedSampleIds, ["s3"]);
  assert.deepEqual(firstSplit.embargoedSampleIds, []);
  assert.deepEqual(firstSplit.trainSampleIds, ["s4", "s5", "s6"]);
  assert.equal(firstSplit.trainCandidateSampleCount, 4);
  assert.equal(firstSplit.includedTrainSampleCount, 3);
  assert.equal(firstSplit.purgeExcludedSampleCount, 1);
  assert.equal(firstSplit.embargoExcludedSampleCount, 0);
  assert.equal(purgedKFoldSplitSchema.safeParse(firstSplit).success, true);
});

test("purged k-fold plan applies purging and post-test embargo together", () => {
  const plan = buildPurgedKFoldPlan({
    planId: "pkf_embargo",
    foldCount: 3,
    embargoDurationDays: 2,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-05T23:59:59.999Z"),
      sample("s2", "2025-01-06T00:00:00.000Z", "2025-01-10T23:59:59.999Z"),
      sample("s3", "2025-01-09T00:00:00.000Z", "2025-01-12T23:59:59.999Z"),
      sample("s4", "2025-01-11T00:00:00.000Z", "2025-01-11T23:59:59.999Z"),
      sample("s5", "2025-01-12T00:00:00.000Z", "2025-01-12T23:59:59.999Z"),
      sample("s6", "2025-01-13T00:00:00.000Z", "2025-01-13T23:59:59.999Z")
    ]
  });
  const firstSplit = plan.splits[0]!;

  assert.deepEqual(firstSplit.testSampleIds, ["s1", "s2"]);
  assert.deepEqual(firstSplit.purgedSampleIds, ["s3"]);
  assert.deepEqual(firstSplit.embargoedSampleIds, ["s4", "s5"]);
  assert.deepEqual(firstSplit.trainSampleIds, ["s6"]);
  assert.equal(firstSplit.excludedSampleCount, 3);
  assert.equal(firstSplit.purgeExcludedSampleCount, 1);
  assert.equal(firstSplit.embargoExcludedSampleCount, 2);
  assert.equal(firstSplit.embargoStart, "2025-01-11T00:00:00.000Z");
  assert.equal(firstSplit.embargoEnd, "2025-01-12T23:59:59.999Z");
});

test("purged k-fold plan creates deterministic contiguous fold sizes", () => {
  const plan = buildPurgedKFoldPlan({
    planId: "pkf_sizes",
    foldCount: 4,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-04T00:00:00.000Z", "2025-01-04T23:59:59.999Z"),
      sample("s5", "2025-01-05T00:00:00.000Z", "2025-01-05T23:59:59.999Z"),
      sample("s6", "2025-01-06T00:00:00.000Z", "2025-01-06T23:59:59.999Z"),
      sample("s7", "2025-01-07T00:00:00.000Z", "2025-01-07T23:59:59.999Z")
    ]
  });

  assert.deepEqual(
    plan.splits.map((split) => split.testSampleIds),
    [["s1", "s2"], ["s3", "s4"], ["s5", "s6"], ["s7"]]
  );
  assert.deepEqual(
    plan.splits.map((split) => split.splitId),
    [
      "pkf_sizes_fold_001",
      "pkf_sizes_fold_002",
      "pkf_sizes_fold_003",
      "pkf_sizes_fold_004"
    ]
  );
});

test("purged k-fold plan fails closed for invalid sample or fold config", () => {
  assert.throws(
    () =>
      buildPurgedKFoldPlan({
        foldCount: 1,
        samples: [
          sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z")
        ]
      }),
    /foldCount/
  );

  assert.throws(
    () =>
      buildPurgedKFoldPlan({
        foldCount: 3,
        samples: [
          sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
          sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z")
        ]
      }),
    /sample count/
  );

  assert.throws(
    () =>
      buildPurgedKFoldPlan({
        foldCount: 2,
        samples: [
          sample("s1", "2025-01-02T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
          sample("s2", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z")
        ]
      }),
    /labelStart/
  );

  assert.throws(
    () =>
      buildPurgedKFoldPlan({
        foldCount: 2,
        samples: [
          sample("dup", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
          sample("dup", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z")
        ]
      }),
    /duplicate sampleId/
  );
});

test("purged k-fold split schema rejects inconsistent id counts or duplicate ids", () => {
  const split = buildPurgedKFoldPlan({
    planId: "pkf_schema",
    foldCount: 2,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-04T00:00:00.000Z", "2025-01-04T23:59:59.999Z")
    ]
  }).splits[0]!;

  assert.equal(
    purgedKFoldSplitSchema.safeParse({
      ...split,
      testSampleCount: split.testSampleCount + 1
    }).success,
    false
  );
  assert.equal(
    purgedKFoldSplitSchema.safeParse({
      ...split,
      trainSampleIds: [split.testSampleIds[0]!, ...split.trainSampleIds.slice(1)]
    }).success,
    false
  );
});

test("purged k-fold plan schema rejects split metadata that disagrees with parent plan", () => {
  const plan = buildPurgedKFoldPlan({
    planId: "pkf_parent",
    foldCount: 2,
    embargoDurationDays: 1,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-04T00:00:00.000Z", "2025-01-04T23:59:59.999Z")
    ]
  });

  assert.equal(
    purgedKFoldPlanSchema.safeParse({
      ...plan,
      sampleCount: plan.sampleCount + 1
    }).success,
    false
  );
  assert.equal(
    purgedKFoldPlanSchema.safeParse({
      ...plan,
      embargoDurationDays: plan.embargoDurationDays + 1
    }).success,
    false
  );
});

function sample(
  sampleId: string,
  labelStart: string,
  labelEnd: string
): PurgedKFoldSample {
  return {
    sampleId,
    labelStart,
    labelEnd
  };
}
