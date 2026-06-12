import assert from "node:assert/strict";
import test from "node:test";

import { isWithinReplaySession, SimulatedClock } from "./simulatedClock.js";

test("simulated clock emits deterministic inclusive ticks", () => {
  const clock = new SimulatedClock({
    startAt: new Date("2025-01-02T00:00:00.000Z"),
    endAt: new Date("2025-01-02T00:02:00.000Z"),
    stepSeconds: 60,
    speedMultiplier: 30
  });

  assert.deepEqual(
    clock.ticks().map((tick) => tick.simulatedAt),
    [
      "2025-01-02T00:00:00.000Z",
      "2025-01-02T00:01:00.000Z",
      "2025-01-02T00:02:00.000Z"
    ]
  );
  assert.deepEqual(
    clock.ticks().map((tick) => tick.stepIndex),
    [0, 1, 2]
  );
  assert.equal(clock.metadata().speedMultiplier, 30);
});

test("simulated clock skips timestamps outside the configured session", () => {
  const clock = new SimulatedClock({
    startAt: new Date("2025-01-02T23:58:00.000Z"),
    endAt: new Date("2025-01-03T00:02:00.000Z"),
    stepSeconds: 60,
    session: {
      startTime: "09:00",
      endTime: "09:01",
      timezoneOffsetMinutes: 540,
      weekdaysOnly: true
    }
  });

  assert.deepEqual(
    clock.ticks().map((tick) => tick.simulatedAt),
    ["2025-01-03T00:00:00.000Z", "2025-01-03T00:01:00.000Z"]
  );
});

test("simulated session guard skips weekends without reading real time", () => {
  assert.equal(
    isWithinReplaySession(new Date("2025-01-03T00:30:00.000Z"), {
      startTime: "09:00",
      endTime: "15:30",
      timezoneOffsetMinutes: 540,
      weekdaysOnly: true
    }),
    true
  );
  assert.equal(
    isWithinReplaySession(new Date("2025-01-04T00:30:00.000Z"), {
      startTime: "09:00",
      endTime: "15:30",
      timezoneOffsetMinutes: 540,
      weekdaysOnly: true
    }),
    false
  );
});

test("simulated clock rejects invalid replay windows", () => {
  assert.throws(
    () =>
      new SimulatedClock({
        startAt: new Date("2025-01-02T00:01:00.000Z"),
        endAt: new Date("2025-01-02T00:00:00.000Z"),
        stepSeconds: 60
      }),
    /startAt/
  );
  assert.throws(
    () =>
      new SimulatedClock({
        startAt: new Date("2025-01-02T00:00:00.000Z"),
        endAt: new Date("2025-01-02T00:01:00.000Z"),
        stepSeconds: 0
      }),
    /stepSeconds/
  );
  assert.throws(
    () =>
      new SimulatedClock({
        startAt: new Date("2025-01-02T00:00:00.000Z"),
        endAt: new Date("2025-01-02T00:01:00.000Z"),
        stepSeconds: 60,
        session: {
          startTime: "9:00",
          endTime: "15:30",
          timezoneOffsetMinutes: 540
        }
      }),
    /HH:mm/
  );
});
