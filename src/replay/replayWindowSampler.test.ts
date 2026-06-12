import assert from "node:assert/strict";
import test from "node:test";

import {
  replayWindowCandidates,
  selectReplayWindow
} from "./replayWindowSampler.js";

test("replay window sampler selects a deterministic full calendar month", () => {
  const first = selectReplayWindow({
    rangeStart: new Date("2023-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2026-05-31T23:59:59.999+09:00"),
    seed: "batch-seed-001",
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });
  const second = selectReplayWindow({
    rangeStart: new Date("2023-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2026-05-31T23:59:59.999+09:00"),
    seed: "batch-seed-001",
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(first, second);
  assert.equal(first.candidateCount, 41);
  assert.match(first.selectedMonth, /^20\d{2}-\d{2}$/);
  assert.equal(first.localStartDate.endsWith("-01"), true);
  assert.equal(
    new Date(first.startAt).getTime() <= new Date(first.endAt).getTime(),
    true
  );
});

test("replay window sampler keeps every candidate inside the configured range", () => {
  const candidates = replayWindowCandidates({
    rangeStart: new Date("2023-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2023-03-31T23:59:59.999+09:00"),
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.selectedMonth),
    ["2023-01", "2023-02", "2023-03"]
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.localEndDate),
    ["2023-01-31", "2023-02-28", "2023-03-31"]
  );
});

test("replay window sampler supports multi-month windows", () => {
  const candidates = replayWindowCandidates({
    rangeStart: new Date("2023-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2023-03-31T23:59:59.999+09:00"),
    windowMonths: 2,
    timezoneOffsetMinutes: 540
  });

  assert.deepEqual(
    candidates.map((candidate) => ({
      selectedMonth: candidate.selectedMonth,
      localStartDate: candidate.localStartDate,
      localEndDate: candidate.localEndDate
    })),
    [
      {
        selectedMonth: "2023-01",
        localStartDate: "2023-01-01",
        localEndDate: "2023-02-28"
      },
      {
        selectedMonth: "2023-02",
        localStartDate: "2023-02-01",
        localEndDate: "2023-03-31"
      }
    ]
  );
});

test("replay window sampler fails closed when no full window fits", () => {
  assert.throws(
    () =>
      selectReplayWindow({
        rangeStart: new Date("2023-01-15T00:00:00+09:00"),
        rangeEnd: new Date("2023-01-20T23:59:59.999+09:00"),
        seed: "too-short",
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /No full replay window/
  );

  assert.throws(
    () =>
      selectReplayWindow({
        rangeStart: new Date("2023-01-01T00:00:00+09:00"),
        rangeEnd: new Date("2023-02-01T00:00:00+09:00"),
        seed: "",
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /seed/
  );
});
