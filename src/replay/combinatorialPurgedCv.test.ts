import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCombinatorialPurgedCvPlan,
  cpcvSplitPlanSchema
} from "./combinatorialPurgedCv.js";
import type { PurgedKFoldSample } from "./purgedSplit.js";

test("CPCV plan emits exhaustive combinatorial purged splits", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "cpcv_full",
    foldCount: 4,
    testFoldCount: 2,
    maxCombinationCount: 10,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-04T00:00:00.000Z", "2025-01-04T23:59:59.999Z"),
      sample("s5", "2025-01-05T00:00:00.000Z", "2025-01-05T23:59:59.999Z"),
      sample("s6", "2025-01-06T00:00:00.000Z", "2025-01-06T23:59:59.999Z"),
      sample("s7", "2025-01-07T00:00:00.000Z", "2025-01-07T23:59:59.999Z"),
      sample("s8", "2025-01-08T00:00:00.000Z", "2025-01-08T23:59:59.999Z")
    ]
  });

  assert.equal(plan.validationProtocol, "combinatorial_purged_cv");
  assert.equal(plan.requestedCombinationCount, 6);
  assert.equal(plan.emittedCombinationCount, 6);
  assert.equal(plan.skippedCombinationCount, 0);
  assert.equal(cpcvSplitPlanSchema.safeParse(plan).success, true);
  assert.deepEqual(plan.combinations[0]!.testFoldIds, [
    "fold_001",
    "fold_002"
  ]);
  assert.deepEqual(plan.combinations[0]!.trainFoldIds, [
    "fold_003",
    "fold_004"
  ]);
  assert.deepEqual(plan.combinations[0]!.testSampleIds, [
    "s1",
    "s2",
    "s3",
    "s4"
  ]);
  assert.deepEqual(plan.combinations[0]!.trainSampleIds, [
    "s5",
    "s6",
    "s7",
    "s8"
  ]);
  assert.deepEqual(plan.combinations.at(-1)!.testFoldIds, [
    "fold_003",
    "fold_004"
  ]);
});

test("CPCV plan applies purge and embargo to each fold combination", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "cpcv_exclusions",
    foldCount: 3,
    testFoldCount: 2,
    maxCombinationCount: 3,
    embargoDurationDays: 2,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-07T00:00:00.000Z", "2025-01-10T23:59:59.999Z"),
      sample("s5", "2025-01-09T00:00:00.000Z", "2025-01-12T23:59:59.999Z"),
      sample("s6", "2025-01-11T00:00:00.000Z", "2025-01-11T23:59:59.999Z")
    ]
  });
  const firstCombination = plan.combinations[0]!;

  assert.deepEqual(firstCombination.testFoldIds, ["fold_001", "fold_002"]);
  assert.deepEqual(firstCombination.testSampleIds, ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(firstCombination.purgedSampleIds, ["s5"]);
  assert.deepEqual(firstCombination.embargoedSampleIds, ["s6"]);
  assert.deepEqual(firstCombination.trainSampleIds, []);
});

test("CPCV plan applies embargo after each non-adjacent test fold", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "cpcv_non_adjacent_embargo",
    foldCount: 3,
    testFoldCount: 2,
    maxCombinationCount: 3,
    embargoDurationDays: 2,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T00:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-04T00:00:00.000Z", "2025-01-04T23:59:59.999Z"),
      sample("s5", "2025-01-10T00:00:00.000Z", "2025-01-10T23:59:59.999Z"),
      sample("s6", "2025-01-11T00:00:00.000Z", "2025-01-11T23:59:59.999Z")
    ]
  });
  const nonAdjacentCombination = plan.combinations[1]!;

  assert.deepEqual(nonAdjacentCombination.testFoldIds, [
    "fold_001",
    "fold_003"
  ]);
  assert.deepEqual(nonAdjacentCombination.testSampleIds, [
    "s1",
    "s2",
    "s5",
    "s6"
  ]);
  assert.deepEqual(nonAdjacentCombination.embargoedSampleIds, ["s3", "s4"]);
  assert.deepEqual(nonAdjacentCombination.trainSampleIds, []);
});

test("CPCV plan expands purge windows by purge duration", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "cpcv_purge_duration",
    foldCount: 2,
    testFoldCount: 1,
    maxCombinationCount: 2,
    purgeDurationDays: 1,
    samples: [
      sample("s1", "2025-01-01T00:00:00.000Z", "2025-01-01T23:59:59.999Z"),
      sample("s2", "2025-01-02T00:00:00.000Z", "2025-01-02T23:59:59.999Z"),
      sample("s3", "2025-01-03T12:00:00.000Z", "2025-01-03T23:59:59.999Z"),
      sample("s4", "2025-01-05T00:00:00.000Z", "2025-01-05T23:59:59.999Z")
    ]
  });
  const firstCombination = plan.combinations[0]!;

  assert.deepEqual(firstCombination.testSampleIds, ["s1", "s2"]);
  assert.deepEqual(firstCombination.purgedSampleIds, ["s3"]);
  assert.deepEqual(firstCombination.trainSampleIds, ["s4"]);
});

test("CPCV sampled mode requires seed and emits deterministic subset", () => {
  const input = {
    planId: "cpcv_sampled",
    foldCount: 5,
    testFoldCount: 2,
    maxCombinationCount: 3,
    combinationMode: "sampled" as const,
    randomSeed: "seed-alpha",
    samples: sequentialSamples(10)
  };
  const firstPlan = buildCombinatorialPurgedCvPlan(input);
  const secondPlan = buildCombinatorialPurgedCvPlan(input);

  assert.equal(firstPlan.requestedCombinationCount, 10);
  assert.equal(firstPlan.emittedCombinationCount, 3);
  assert.equal(firstPlan.skippedCombinationCount, 7);
  assert.equal(firstPlan.randomSeed, "seed-alpha");
  assert.deepEqual(
    firstPlan.combinations.map((combination) => combination.combinationIndex),
    secondPlan.combinations.map((combination) => combination.combinationIndex)
  );
  assert.throws(
    () =>
      buildCombinatorialPurgedCvPlan({
        ...input,
        randomSeed: ""
      }),
    /randomSeed/
  );
});

test("CPCV plan fails closed for invalid config and exhaustive budget excess", () => {
  assert.throws(
    () =>
      buildCombinatorialPurgedCvPlan({
        foldCount: 3,
        testFoldCount: 3,
        maxCombinationCount: 3,
        samples: sequentialSamples(6)
      }),
    /testFoldCount/
  );

  assert.throws(
    () =>
      buildCombinatorialPurgedCvPlan({
        foldCount: 5,
        testFoldCount: 2,
        maxCombinationCount: 3,
        samples: sequentialSamples(10)
      }),
    /maxCombinationCount/
  );

  assert.throws(
    () =>
      buildCombinatorialPurgedCvPlan({
        foldCount: 3,
        testFoldCount: 1,
        maxCombinationCount: 0,
        samples: sequentialSamples(6)
      }),
    /maxCombinationCount/
  );
});

function sequentialSamples(count: number): PurgedKFoldSample[] {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return sample(
      `s${index + 1}`,
      `2025-01-${day}T00:00:00.000Z`,
      `2025-01-${day}T23:59:59.999Z`
    );
  });
}

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
