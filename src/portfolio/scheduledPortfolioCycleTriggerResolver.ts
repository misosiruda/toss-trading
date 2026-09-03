import {
  hashCanonicalPayload,
  hashDerivedId,
  parseScheduleBoundaryRecord,
  parseSessionCalendarRecord,
  type ScheduleBoundaryRecord,
  type SessionCalendarEntry,
  type SessionCalendarRecord
} from "./runtimePolicyContracts.js";
import {
  resolvePortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";

type OpenSession = Extract<SessionCalendarEntry, { opensAt: string }>;

export interface CanonicalPortfolioScheduleSlot {
  scheduleSlotId: string;
  market: ScheduleBoundaryRecord["market"];
  exchangeDate: string;
  scheduleBoundaryRecordId: string;
  scheduleBoundaryVersion: string;
  scheduleBoundaryHash: string;
  scheduleBoundaryLineageHash: string;
  sessionCalendarRecordId: string;
  sessionCalendarVersion: string;
  sessionCalendarHash: string;
  sessionCalendarLineageHash: string;
  interval: ScheduleBoundaryRecord["interval"];
  slotEndsAt: string;
}

export interface ResolvedScheduledPortfolioCycleTrigger
  extends ResolvedPortfolioCycleTrigger {
  trigger: Extract<
    ResolvedPortfolioCycleTrigger["trigger"],
    { triggerKind: "scheduled" }
  >;
  boundary: ScheduleBoundaryRecord;
  calendar: SessionCalendarRecord;
  slot: CanonicalPortfolioScheduleSlot;
}

/** Replays one scheduled trigger from its immutable boundary and calendar. */
export function resolveScheduledPortfolioCycleTrigger(input: {
  value: unknown;
  scheduleBoundary: unknown;
  sessionCalendar: unknown;
}): ResolvedScheduledPortfolioCycleTrigger {
  const resolved = resolvePortfolioCycleTrigger(input.value);
  if (resolved.trigger.triggerKind !== "scheduled") {
    throw new Error(
      "scheduled trigger resolver requires a scheduled trigger"
    );
  }
  const trigger = resolved.trigger;
  const boundary = parseScheduleBoundaryRecord(input.scheduleBoundary);
  const calendar = parseSessionCalendarRecord(input.sessionCalendar);
  assertBoundaryCalendarBinding(boundary, calendar);
  if (trigger.scheduleBoundaryHash !== boundary.hash) {
    throw new Error("scheduled trigger boundary hash mismatch");
  }

  const matchingSlots = generateCanonicalScheduleSlots(boundary, calendar)
    .filter((slot) => slot.slotEndsAt === trigger.slotEndsAt);
  if (matchingSlots.length !== 1) {
    throw new Error(
      `scheduled trigger slot end must resolve exactly once; resolved ${matchingSlots.length}`
    );
  }
  const slot = matchingSlots[0] as CanonicalPortfolioScheduleSlot;
  if (slot.scheduleSlotId !== trigger.scheduleSlotId) {
    throw new Error("scheduled trigger slot ID mismatch");
  }

  return deepFreeze({ ...resolved, trigger, boundary, calendar, slot });
}

export function generateCanonicalScheduleSlots(
  scheduleBoundary: unknown,
  sessionCalendar: unknown
): readonly CanonicalPortfolioScheduleSlot[] {
  const boundary = parseScheduleBoundaryRecord(scheduleBoundary);
  const calendar = parseSessionCalendarRecord(sessionCalendar);
  assertBoundaryCalendarBinding(boundary, calendar);
  const sessions = selectedOpenSessions(boundary, calendar);
  const slots = sessions.flatMap((session) =>
    slotEndsForSession(boundary, calendar, session).map((slotEndsAt) =>
      createCanonicalSlot(boundary, calendar, session, slotEndsAt)
    )
  );
  const ids = new Set<string>();
  const ends = new Set<string>();
  for (const slot of slots) {
    if (ids.has(slot.scheduleSlotId) || ends.has(slot.slotEndsAt)) {
      throw new Error("schedule boundary produces duplicate canonical slots");
    }
    ids.add(slot.scheduleSlotId);
    ends.add(slot.slotEndsAt);
  }
  return deepFreeze(slots);
}

function assertBoundaryCalendarBinding(
  boundary: ScheduleBoundaryRecord,
  calendar: SessionCalendarRecord
): void {
  if (
    boundary.sessionCalendarRecordId !== calendar.sessionCalendarRecordId ||
    boundary.sessionCalendarVersion !== calendar.version ||
    boundary.sessionCalendarHash !== calendar.hash ||
    boundary.sessionCalendarLineageHash !== calendar.lineageHash
  ) {
    throw new Error("schedule boundary session calendar identity mismatch");
  }
  if (boundary.market !== calendar.market) {
    throw new Error("schedule boundary and session calendar market mismatch");
  }
  if (boundary.timeZone !== calendar.timeZone) {
    throw new Error("schedule boundary and session calendar timezone mismatch");
  }
  if (Date.parse(calendar.createdAt) > Date.parse(boundary.createdAt)) {
    throw new Error("session calendar cannot postdate its schedule boundary");
  }
}

function selectedOpenSessions(
  boundary: ScheduleBoundaryRecord,
  calendar: SessionCalendarRecord
): readonly OpenSession[] {
  const openByDate = new Map(
    calendar.sessions
      .filter((session): session is OpenSession => session.sessionKind !== "closed")
      .map((session) => [session.exchangeDate, session])
  );
  if (boundary.interval === "hourly") {
    return [...openByDate.values()];
  }
  const targetDates = calendar.sessions
    .map((session) => session.exchangeDate)
    .filter(
      (date) =>
        boundary.interval === "daily" ||
        weekday(date) === boundary.weeklyAnchorDay
    );
  const selected = new Map<string, OpenSession>();
  for (const targetDate of targetDates) {
    const session = resolveOpenSession(
      targetDate,
      boundary.nonSessionDayRule,
      calendar.sessions,
      openByDate
    );
    if (session !== undefined) {
      selected.set(session.exchangeDate, session);
    }
  }
  return [...selected.values()].sort((left, right) =>
    left.exchangeDate < right.exchangeDate
      ? -1
      : left.exchangeDate > right.exchangeDate
        ? 1
        : 0
  );
}

function resolveOpenSession(
  targetDate: string,
  rule: ScheduleBoundaryRecord["nonSessionDayRule"],
  sessions: readonly SessionCalendarEntry[],
  openByDate: ReadonlyMap<string, OpenSession>
): OpenSession | undefined {
  const direct = openByDate.get(targetDate);
  if (direct !== undefined) {
    return direct;
  }
  const start = sessions.findIndex((session) => session.exchangeDate === targetDate);
  if (start < 0) {
    return undefined;
  }
  const step = rule === "previous_session" ? -1 : 1;
  for (let index = start + step; index >= 0 && index < sessions.length; index += step) {
    const candidate = sessions[index] as SessionCalendarEntry;
    if (candidate.sessionKind !== "closed") {
      return candidate;
    }
  }
  return undefined;
}

function slotEndsForSession(
  boundary: ScheduleBoundaryRecord,
  calendar: SessionCalendarRecord,
  session: OpenSession
): readonly string[] {
  const opensAt = Date.parse(session.opensAt);
  const closesAt = Date.parse(session.closesAt);
  const anchor = localAnchorInstant(
    session.exchangeDate,
    boundary.anchorLocalTime,
    calendar.timeZone
  );
  if (boundary.interval !== "hourly") {
    const slotEnd = anchor >= opensAt && anchor <= closesAt ? anchor : closesAt;
    return [new Date(slotEnd).toISOString()];
  }

  const ends: number[] = [];
  let next = anchor;
  while (next <= opensAt) {
    next += 60 * 60 * 1_000;
  }
  while (next < closesAt) {
    ends.push(next);
    next += 60 * 60 * 1_000;
  }
  ends.push(closesAt);
  return ends.map((value) => new Date(value).toISOString());
}

function localAnchorInstant(
  exchangeDate: string,
  anchorLocalTime: string,
  timeZone: string
): number {
  const [year, month, day] = exchangeDate.split("-").map(Number) as [
    number,
    number,
    number
  ];
  const [hour, minute, second = 0] = anchorLocalTime.split(":").map(Number) as [
    number,
    number,
    number?
  ];
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set(
    [-172_800_000, -86_400_000, 0, 86_400_000, 172_800_000].map(
      (delta) => timeZoneOffsetMinutesAt(nominalUtc + delta, timeZone)
    )
  );
  const matches = [...offsets]
    .map((offset) => nominalUtc - offset * 60_000)
    .filter((candidate) =>
      localPartsMatch(candidate, timeZone, {
        year,
        month,
        day,
        hour,
        minute,
        second
      })
    );
  if (matches.length !== 1) {
    throw new Error("schedule anchor does not resolve to one timezone instant");
  }
  return matches[0] as number;
}

function localPartsMatch(
  timestamp: number,
  timeZone: string,
  expected: Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(timestamp));
  const actual = Object.fromEntries(
    parts
      .filter((part) => part.type in expected)
      .map((part) => [part.type, Number(part.value)])
  );
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function timeZoneOffsetMinutesAt(timestamp: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset"
  })
    .formatToParts(new Date(timestamp))
    .find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT") {
    return 0;
  }
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (match === null) {
    throw new Error("IANA timezone offset cannot be resolved");
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

function createCanonicalSlot(
  boundary: ScheduleBoundaryRecord,
  calendar: SessionCalendarRecord,
  session: OpenSession,
  slotEndsAt: string
): CanonicalPortfolioScheduleSlot {
  const payload = {
    market: boundary.market,
    exchangeDate: session.exchangeDate,
    scheduleBoundaryRecordId: boundary.scheduleBoundaryRecordId,
    scheduleBoundaryVersion: boundary.version,
    scheduleBoundaryHash: boundary.hash,
    scheduleBoundaryLineageHash: boundary.lineageHash,
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: boundary.interval,
    slotEndsAt
  };
  return deepFreeze({
    scheduleSlotId: hashDerivedId(
      "portfolio_schedule_slot",
      hashCanonicalPayload(payload)
    ),
    ...payload
  });
}

function weekday(date: string): NonNullable<ScheduleBoundaryRecord["weeklyAnchorDay"]> {
  const names = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ] as const;
  return names[new Date(`${date}T00:00:00.000Z`).getUTCDay()] as NonNullable<
    ScheduleBoundaryRecord["weeklyAnchorDay"]
  >;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
