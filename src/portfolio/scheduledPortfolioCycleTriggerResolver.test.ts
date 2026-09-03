import assert from "node:assert/strict";
import test from "node:test";

import {
  createScheduleBoundaryRecord,
  createSessionCalendarRecord,
  type ScheduleBoundaryRecord,
  type SessionCalendarRecord
} from "./runtimePolicyContracts.js";
import {
  generateCanonicalScheduleSlots,
  resolveScheduledPortfolioCycleTrigger
} from "./scheduledPortfolioCycleTriggerResolver.js";

test("scheduled trigger replays a daily early-close slot", () => {
  const calendar = krCalendar();
  const boundary = scheduleBoundary(calendar, {
    interval: "daily",
    anchorLocalTime: "15:30:00"
  });
  const slots = generateCanonicalScheduleSlots(boundary, calendar);
  const earlyClose = slots.find((slot) => slot.exchangeDate === "2026-09-04");
  assert.equal(earlyClose?.slotEndsAt, "2026-09-04T04:00:00.000Z");

  const resolved = resolveScheduledPortfolioCycleTrigger({
    value: trigger(boundary, earlyClose!),
    scheduleBoundary: boundary,
    sessionCalendar: calendar
  });
  assert.deepEqual(resolved.slot, earlyClose);
  assert.equal(resolved.triggerIdentity, `scheduled:${boundary.hash}`);
  assert.equal(resolved.evidenceCutoffAt, earlyClose?.slotEndsAt);
  assert.equal(Object.isFrozen(resolved.slot), true);
});

test("scheduled slot generation maps a closed weekly anchor by policy", () => {
  const calendar = krCalendar();
  const boundary = scheduleBoundary(calendar, {
    interval: "weekly",
    anchorLocalTime: "15:30",
    weeklyAnchorDay: "monday",
    nonSessionDayRule: "previous_session"
  });
  const slots = generateCanonicalScheduleSlots(boundary, calendar);

  assert.deepEqual(
    slots.map((slot) => [slot.exchangeDate, slot.slotEndsAt]),
    [["2026-09-04", "2026-09-04T04:00:00.000Z"]]
  );
});

test("scheduled slot generation maps a closed weekly anchor forward", () => {
  const calendar = krNextSessionCalendar();
  const boundary = scheduleBoundary(calendar, {
    interval: "weekly",
    anchorLocalTime: "15:30",
    weeklyAnchorDay: "monday",
    nonSessionDayRule: "next_session"
  });
  const slots = generateCanonicalScheduleSlots(boundary, calendar);

  assert.deepEqual(
    slots.map((slot) => [slot.exchangeDate, slot.slotEndsAt]),
    [["2026-09-08", "2026-09-08T06:30:00.000Z"]]
  );
});

test("scheduled slot generation produces hourly boundaries and final close", () => {
  const calendar = oneDayUsCalendar();
  const boundary = scheduleBoundary(calendar, {
    interval: "hourly",
    anchorLocalTime: "10:00:00"
  });
  const slots = generateCanonicalScheduleSlots(boundary, calendar);

  assert.deepEqual(
    slots.map((slot) => slot.slotEndsAt),
    [
      "2026-11-02T15:00:00.000Z",
      "2026-11-02T16:00:00.000Z",
      "2026-11-02T17:00:00.000Z",
      "2026-11-02T18:00:00.000Z",
      "2026-11-02T19:00:00.000Z",
      "2026-11-02T20:00:00.000Z",
      "2026-11-02T21:00:00.000Z"
    ]
  );
});

test("scheduled slot identity binds boundary and calendar lineage", () => {
  const firstCalendar = oneDayUsCalendar();
  const replayedCalendar = createSessionCalendarRecord({
    market: firstCalendar.market,
    version: firstCalendar.version,
    timeZone: firstCalendar.timeZone,
    validFromExchangeDate: firstCalendar.validFromExchangeDate,
    validThroughExchangeDate: firstCalendar.validThroughExchangeDate,
    sessions: firstCalendar.sessions,
    createdAt: "2026-09-02T00:00:01.000Z"
  });
  const firstBoundary = scheduleBoundary(firstCalendar, {
    interval: "daily",
    anchorLocalTime: "16:00"
  });
  const replayedBoundary = scheduleBoundary(replayedCalendar, {
    interval: "daily",
    anchorLocalTime: "16:00"
  });

  const first = generateCanonicalScheduleSlots(firstBoundary, firstCalendar)[0]!;
  const replayed = generateCanonicalScheduleSlots(
    replayedBoundary,
    replayedCalendar
  )[0]!;
  assert.equal(first.scheduleBoundaryHash, replayed.scheduleBoundaryHash);
  assert.equal(first.sessionCalendarHash, replayed.sessionCalendarHash);
  assert.notEqual(
    first.sessionCalendarLineageHash,
    replayed.sessionCalendarLineageHash
  );
  assert.notEqual(first.scheduleSlotId, replayed.scheduleSlotId);
});

test("scheduled trigger rejects boundary, slot ID, and slot-end drift", () => {
  const calendar = krCalendar();
  const boundary = scheduleBoundary(calendar, {
    interval: "daily",
    anchorLocalTime: "15:30"
  });
  const slot = generateCanonicalScheduleSlots(boundary, calendar)[0]!;

  assert.throws(
    () =>
      resolveScheduledPortfolioCycleTrigger({
        value: { ...trigger(boundary, slot), scheduleBoundaryHash: HASH },
        scheduleBoundary: boundary,
        sessionCalendar: calendar
      }),
    /boundary hash mismatch/
  );
  assert.throws(
    () =>
      resolveScheduledPortfolioCycleTrigger({
        value: { ...trigger(boundary, slot), scheduleSlotId: "wrong" },
        scheduleBoundary: boundary,
        sessionCalendar: calendar
      }),
    /slot ID mismatch/
  );
  assert.throws(
    () =>
      resolveScheduledPortfolioCycleTrigger({
        value: {
          ...trigger(boundary, slot),
          slotEndsAt: "2026-09-04T04:00:01.000Z"
        },
        scheduleBoundary: boundary,
        sessionCalendar: calendar
      }),
    /resolved 0/
  );
});

test("scheduled trigger rejects calendar identity drift and other variants", () => {
  const calendar = krCalendar();
  const boundary = scheduleBoundary(calendar, {
    interval: "daily",
    anchorLocalTime: "15:30"
  });
  const slot = generateCanonicalScheduleSlots(boundary, calendar)[0]!;
  const otherCalendar = createSessionCalendarRecord({
    market: calendar.market,
    version: "2",
    timeZone: calendar.timeZone,
    validFromExchangeDate: calendar.validFromExchangeDate,
    validThroughExchangeDate: calendar.validThroughExchangeDate,
    sessions: calendar.sessions,
    createdAt: "2026-09-02T00:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveScheduledPortfolioCycleTrigger({
        value: trigger(boundary, slot),
        scheduleBoundary: boundary,
        sessionCalendar: otherCalendar
      }),
    /calendar identity mismatch/
  );
  assert.throws(
    () =>
      resolveScheduledPortfolioCycleTrigger({
        value: {
          triggerKind: "every_tick",
          packetHash: boundary.hash,
          packetAsOf: slot.slotEndsAt
        },
        scheduleBoundary: boundary,
        sessionCalendar: calendar
      }),
    /requires a scheduled trigger/
  );
});

const HASH = `sha256:${"f".repeat(64)}`;

function trigger(
  boundary: ScheduleBoundaryRecord,
  slot: ReturnType<typeof generateCanonicalScheduleSlots>[number]
) {
  return {
    triggerKind: "scheduled" as const,
    scheduleBoundaryHash: boundary.hash,
    scheduleSlotId: slot.scheduleSlotId,
    slotEndsAt: slot.slotEndsAt
  };
}

function scheduleBoundary(
  calendar: SessionCalendarRecord,
  overrides: {
    interval: "hourly" | "daily" | "weekly";
    anchorLocalTime: string;
    weeklyAnchorDay?: "monday";
    nonSessionDayRule?: "previous_session" | "next_session";
  }
) {
  return createScheduleBoundaryRecord({
    market: calendar.market,
    version: "1",
    timeZone: calendar.timeZone,
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: overrides.interval,
    anchorLocalTime: overrides.anchorLocalTime,
    ...(overrides.weeklyAnchorDay === undefined
      ? {}
      : { weeklyAnchorDay: overrides.weeklyAnchorDay }),
    nonSessionDayRule:
      overrides.nonSessionDayRule ?? "previous_session",
    createdAt: "2026-09-03T00:00:00.000Z"
  });
}

function krCalendar() {
  return createSessionCalendarRecord({
    market: "KR",
    version: "1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-09-04",
    validThroughExchangeDate: "2026-09-07",
    sessions: [
      {
        exchangeDate: "2026-09-04",
        sessionKind: "early_close",
        opensAt: "2026-09-04T09:00:00+09:00",
        closesAt: "2026-09-04T13:00:00+09:00",
        sourceEvidenceRefs: ["calendar-evidence-1"]
      },
      closed("2026-09-05"),
      closed("2026-09-06"),
      closed("2026-09-07")
    ],
    createdAt: "2026-09-02T00:00:00.000Z"
  });
}

function oneDayUsCalendar() {
  return createSessionCalendarRecord({
    market: "US",
    version: "1",
    timeZone: "America/New_York",
    validFromExchangeDate: "2026-11-02",
    validThroughExchangeDate: "2026-11-02",
    sessions: [
      {
        exchangeDate: "2026-11-02",
        sessionKind: "regular",
        opensAt: "2026-11-02T09:30:00-05:00",
        closesAt: "2026-11-02T16:00:00-05:00",
        sourceEvidenceRefs: ["calendar-evidence-2"]
      }
    ],
    createdAt: "2026-09-02T00:00:00.000Z"
  });
}

function krNextSessionCalendar() {
  return createSessionCalendarRecord({
    market: "KR",
    version: "1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-09-07",
    validThroughExchangeDate: "2026-09-08",
    sessions: [
      closed("2026-09-07"),
      {
        exchangeDate: "2026-09-08",
        sessionKind: "regular",
        opensAt: "2026-09-08T09:00:00+09:00",
        closesAt: "2026-09-08T15:30:00+09:00",
        sourceEvidenceRefs: ["calendar-evidence-3"]
      }
    ],
    createdAt: "2026-09-02T00:00:00.000Z"
  });
}

function closed(exchangeDate: string) {
  return {
    exchangeDate,
    sessionKind: "closed" as const,
    sourceEvidenceRefs: ["calendar-evidence-1"]
  };
}
