import assert from "node:assert/strict";
import test from "node:test";

import {
  validationSplitAssignmentSchema,
  validationSplitSchema
} from "./validationProtocol.js";
import {
  buildWalkForwardSplitPlan,
  walkForwardSplitAssignments
} from "./walkForwardSplit.js";

test("walk-forward split plan generates deterministic rolling train validation test windows", () => {
  const first = buildWalkForwardSplitPlan({
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-06-30T23:59:59.999+09:00"),
    trainMonths: 2,
    validationMonths: 1,
    testMonths: 1,
    stepMonths: 1,
    timezoneOffsetMinutes: 540
  });
  const second = buildWalkForwardSplitPlan({
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-06-30T23:59:59.999+09:00"),
    trainMonths: 2,
    validationMonths: 1,
    testMonths: 1,
    stepMonths: 1,
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(first, second);
  assert.equal(first.validationProtocol, "walk_forward");
  assert.equal(first.splitCount, 3);
  assert.equal(first.embargoDurationDays, 0);
  assert.deepEqual(
    first.splits.map((split) => ({
      trainStart: split.trainStart,
      trainEnd: split.trainEnd,
      validationStart: split.validationStart,
      validationEnd: split.validationEnd,
      testStart: split.testStart,
      testEnd: split.testEnd
    })),
    [
      {
        trainStart: "2024-12-31T15:00:00.000Z",
        trainEnd: "2025-02-28T14:59:59.999Z",
        validationStart: "2025-02-28T15:00:00.000Z",
        validationEnd: "2025-03-31T14:59:59.999Z",
        testStart: "2025-03-31T15:00:00.000Z",
        testEnd: "2025-04-30T14:59:59.999Z"
      },
      {
        trainStart: "2025-01-31T15:00:00.000Z",
        trainEnd: "2025-03-31T14:59:59.999Z",
        validationStart: "2025-03-31T15:00:00.000Z",
        validationEnd: "2025-04-30T14:59:59.999Z",
        testStart: "2025-04-30T15:00:00.000Z",
        testEnd: "2025-05-31T14:59:59.999Z"
      },
      {
        trainStart: "2025-02-28T15:00:00.000Z",
        trainEnd: "2025-04-30T14:59:59.999Z",
        validationStart: "2025-04-30T15:00:00.000Z",
        validationEnd: "2025-05-31T14:59:59.999Z",
        testStart: "2025-05-31T15:00:00.000Z",
        testEnd: "2025-06-30T14:59:59.999Z"
      }
    ]
  );
  for (const split of first.splits) {
    assert.equal(validationSplitSchema.safeParse(split).success, true);
    assert.match(split.splitId, /^wf_\d{3}_train_/);
    assert.equal(
      new Date(split.trainEnd).getTime() < new Date(split.validationStart).getTime(),
      true
    );
    assert.equal(
      new Date(split.validationEnd).getTime() < new Date(split.testStart!).getTime(),
      true
    );
    assert.equal(split.purgeDurationDays, 0);
    assert.equal(split.embargoDurationDays, 0);
  }
  assert.deepEqual(
    walkForwardSplitAssignments(first.splits[0]!).map(
      (assignment) => assignment.splitRole
    ),
    ["train", "validation", "test"]
  );
});

test("walk-forward split assignment expands split roles without a test window", () => {
  const plan = buildWalkForwardSplitPlan({
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    trainMonths: 1,
    validationMonths: 1,
    timezoneOffsetMinutes: 540
  });
  const assignments = walkForwardSplitAssignments(plan.splits[0]!);

  assert.deepEqual(
    assignments.map((assignment) => assignment.splitRole),
    ["train", "validation"]
  );
  assert.equal(assignments[0]?.testStart, null);
  for (const assignment of assignments) {
    assert.equal(
      validationSplitAssignmentSchema.safeParse(assignment).success,
      true
    );
  }
  assert.equal(
    validationSplitAssignmentSchema.safeParse({
      ...plan.splits[0]!,
      splitRole: "test"
    }).success,
    false
  );
});

test("validation split schema rejects overlapping or half-open split metadata", () => {
  const valid = buildWalkForwardSplitPlan({
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-04-30T23:59:59.999+09:00"),
    trainMonths: 2,
    validationMonths: 1,
    testMonths: 1,
    timezoneOffsetMinutes: 540
  }).splits[0]!;

  assert.equal(
    validationSplitSchema.safeParse({
      ...valid,
      validationStart: valid.trainEnd
    }).success,
    false
  );
  assert.equal(
    validationSplitSchema.safeParse({
      ...valid,
      testEnd: null
    }).success,
    false
  );
});

test("walk-forward split plan supports multi-month steps", () => {
  const plan = buildWalkForwardSplitPlan({
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-08-31T23:59:59.999+09:00"),
    trainMonths: 2,
    validationMonths: 1,
    testMonths: 1,
    stepMonths: 2,
    timezoneOffsetMinutes: 540
  });

  assert.equal(plan.splitCount, 3);
  assert.deepEqual(
    plan.splits.map((split) => split.trainStart),
    [
      "2024-12-31T15:00:00.000Z",
      "2025-02-28T15:00:00.000Z",
      "2025-04-30T15:00:00.000Z"
    ]
  );
});

test("walk-forward split plan records configured embargo duration", () => {
  const plan = buildWalkForwardSplitPlan({
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    trainMonths: 1,
    validationMonths: 1,
    embargoDurationDays: 5,
    timezoneOffsetMinutes: 540
  });

  assert.equal(plan.embargoDurationDays, 5);
  assert.equal(plan.splits[0]?.embargoDurationDays, 5);
  assert.equal(plan.splits[0]?.purgeDurationDays, 0);
});

test("walk-forward split plan fails closed for invalid config or short ranges", () => {
  assert.throws(
    () =>
      buildWalkForwardSplitPlan({
        rangeStart: new Date("2025-01-01T00:00:00+09:00"),
        rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
        trainMonths: 2,
        validationMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /No walk-forward split/
  );

  assert.throws(
    () =>
      buildWalkForwardSplitPlan({
        rangeStart: new Date("invalid"),
        rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
        trainMonths: 1,
        validationMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /rangeStart/
  );

  assert.throws(
    () =>
      buildWalkForwardSplitPlan({
        rangeStart: new Date("2025-01-01T00:00:00+09:00"),
        rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
        trainMonths: 0,
        validationMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /trainMonths/
  );

  assert.throws(
    () =>
      buildWalkForwardSplitPlan({
        rangeStart: new Date("2025-01-01T00:00:00+09:00"),
        rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
        trainMonths: 1,
        validationMonths: 1,
        embargoDurationDays: -1,
        timezoneOffsetMinutes: 540
      }),
    /embargoDurationDays/
  );
});
