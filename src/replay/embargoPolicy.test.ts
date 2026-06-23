import assert from "node:assert/strict";
import test from "node:test";

import { applyValidationEmbargoPolicy } from "./embargoPolicy.js";
import { validationSplitExclusionSummarySchema } from "./validationProtocol.js";

interface Sample {
  id: string;
  observedAt: string;
}

test("validation embargo policy excludes train samples inside the pre-validation embargo window", () => {
  const result = applyValidationEmbargoPolicy({
    split: split({ embargoDurationDays: 5 }),
    samples: [
      sample("before-train", "2024-12-31T23:59:59.999Z"),
      sample("included-train", "2025-01-15T00:00:00.000Z"),
      sample("embargo-start", "2025-01-27T00:00:00.000Z"),
      sample("embargo-end", "2025-01-31T23:59:59.999Z"),
      sample("validation", "2025-02-01T00:00:00.000Z")
    ],
    getSampleTimestamp: (candidate) => candidate.observedAt
  });

  assert.deepEqual(
    result.includedTrainSamples.map((candidate) => candidate.id),
    ["included-train"]
  );
  assert.deepEqual(
    result.excludedTrainSamples.map((candidate) => ({
      id: candidate.sample.id,
      observedAt: candidate.observedAt,
      reason: candidate.reason
    })),
    [
      {
        id: "embargo-start",
        observedAt: "2025-01-27T00:00:00.000Z",
        reason: "embargo"
      },
      {
        id: "embargo-end",
        observedAt: "2025-01-31T23:59:59.999Z",
        reason: "embargo"
      }
    ]
  );
  assert.deepEqual(result.summary, {
    validationProtocol: "walk_forward",
    splitId: "wf_review",
    splitIndex: 0,
    sampleCount: 5,
    trainCandidateSampleCount: 3,
    includedTrainSampleCount: 1,
    excludedSampleCount: 2,
    purgeExcludedSampleCount: 0,
    embargoExcludedSampleCount: 2,
    purgeDurationDays: 0,
    embargoDurationDays: 5,
    embargoStart: "2025-01-27T00:00:00.000Z",
    embargoEnd: "2025-01-31T23:59:59.999Z"
  });
  assert.equal(
    validationSplitExclusionSummarySchema.safeParse(result.summary).success,
    true
  );
});

test("validation embargo policy keeps all train samples when embargo is disabled", () => {
  const result = applyValidationEmbargoPolicy({
    split: split({ embargoDurationDays: 0 }),
    samples: [
      sample("first", "2025-01-01T00:00:00.000Z"),
      sample("last", "2025-01-31T23:59:59.999Z")
    ],
    getSampleTimestamp: (candidate) => new Date(candidate.observedAt)
  });

  assert.deepEqual(
    result.includedTrainSamples.map((candidate) => candidate.id),
    ["first", "last"]
  );
  assert.deepEqual(result.excludedTrainSamples, []);
  assert.equal(result.summary.embargoStart, null);
  assert.equal(result.summary.embargoEnd, null);
  assert.equal(result.summary.embargoExcludedSampleCount, 0);
});

test("validation embargo policy fails closed for invalid sample timestamps", () => {
  assert.throws(
    () =>
      applyValidationEmbargoPolicy({
        split: split({ embargoDurationDays: 1 }),
        samples: [sample("bad", "not-a-date")],
        getSampleTimestamp: (candidate) => candidate.observedAt
      }),
    /sample timestamp/
  );
});

test("validation split exclusion summary rejects inconsistent counts", () => {
  const parsed = validationSplitExclusionSummarySchema.safeParse({
    validationProtocol: "walk_forward",
    splitId: "wf_review",
    splitIndex: 0,
    sampleCount: 1,
    trainCandidateSampleCount: 1,
    includedTrainSampleCount: 1,
    excludedSampleCount: 1,
    purgeExcludedSampleCount: 0,
    embargoExcludedSampleCount: 1,
    purgeDurationDays: 0,
    embargoDurationDays: 1,
    embargoStart: "2025-01-31T00:00:00.000Z",
    embargoEnd: "2025-01-31T23:59:59.999Z"
  });

  assert.equal(parsed.success, false);
});

function split(input: { embargoDurationDays: number }) {
  return {
    validationProtocol: "walk_forward" as const,
    splitId: "wf_review",
    splitIndex: 0,
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: null,
    testEnd: null,
    purgeDurationDays: 0,
    embargoDurationDays: input.embargoDurationDays
  };
}

function sample(id: string, observedAt: string): Sample {
  return { id, observedAt };
}
