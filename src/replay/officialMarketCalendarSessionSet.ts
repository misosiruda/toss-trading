import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  officialMarketCalendarOpenSessionSchema,
  resolveOfficialMarketCalendarOpenSessions,
  type OfficialMarketCalendarOpenSession,
  type ResolveOfficialMarketCalendarOpenSessionOptions
} from "./officialMarketCalendarOpenSession.js";
import {
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";
import {
  officialMarketCalendarSourceBackedClosureSchema,
  resolveOfficialMarketCalendarSourceBackedClosures,
  type OfficialMarketCalendarSourceBackedClosure
} from "./officialMarketCalendarSourceBackedClosure.js";
import {
  officialMarketCalendarWeekendSessionSchema,
  resolveOfficialMarketCalendarWeekendSessions,
  type OfficialMarketCalendarWeekendSession
} from "./officialMarketCalendarWeekendSession.js";

export const OFFICIAL_MARKET_CALENDAR_SESSION_SET_SCHEMA_VERSION =
  "official_market_calendar_session_set.v1";

const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");
const sourceCollectionRefSchema = z
  .object({
    exchange: z.enum(["KRX", "NYSE"]),
    collectionId: identifierSchema,
    collectionHash: sha256HashSchema
  })
  .strict();

export const officialMarketCalendarSessionSetSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SESSION_SET_SCHEMA_VERSION
    ),
    coverage: z
      .object({
        startDate: calendarDateSchema,
        endDate: calendarDateSchema,
        exchanges: z.tuple([z.literal("KRX"), z.literal("NYSE")])
      })
      .strict(),
    sourceCollections: z.tuple([
      sourceCollectionRefSchema.extend({ exchange: z.literal("KRX") }),
      sourceCollectionRefSchema.extend({ exchange: z.literal("NYSE") })
    ]),
    openSessions: z.array(officialMarketCalendarOpenSessionSchema),
    sourceBackedClosures: z.array(
      officialMarketCalendarSourceBackedClosureSchema
    ),
    weekendSessions: z.array(officialMarketCalendarWeekendSessionSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.coverage.startDate > value.coverage.endDate) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "endDate"],
        message: "official calendar session set coverage start must not follow end"
      });
    }
  });

export type OfficialMarketCalendarSessionSet = z.infer<
  typeof officialMarketCalendarSessionSetSchema
>;

export interface ResolveOfficialMarketCalendarSessionSetOptions
  extends ResolveOfficialMarketCalendarOpenSessionOptions {}

export interface ResolvedOfficialMarketCalendarSessionSet {
  sessionSet: OfficialMarketCalendarSessionSet;
  sourceCollections: readonly [
    OfficialMarketCalendarSourceCollection,
    OfficialMarketCalendarSourceCollection
  ];
}

type SessionIdentity =
  | OfficialMarketCalendarOpenSession
  | OfficialMarketCalendarSourceBackedClosure
  | OfficialMarketCalendarWeekendSession;

export function resolveOfficialMarketCalendarSessionSet(
  value: unknown,
  options: ResolveOfficialMarketCalendarSessionSetOptions
): ResolvedOfficialMarketCalendarSessionSet {
  const sessionSet = officialMarketCalendarSessionSetSchema.parse(value);
  const sourceCollections = resolveSourceCollections(
    sessionSet,
    options.collections
  );
  const selectedCollections: readonly unknown[] = sourceCollections;
  const openSessions = resolveOfficialMarketCalendarOpenSessions(
    sessionSet.openSessions,
    {
      collections: selectedCollections,
      sessionProvenances: options.sessionProvenances,
      sessionHoursExceptions: options.sessionHoursExceptions
    }
  );
  const closures = resolveOfficialMarketCalendarSourceBackedClosures(
    sessionSet.sourceBackedClosures,
    { collections: selectedCollections }
  );
  const weekends = resolveOfficialMarketCalendarWeekendSessions(
    sessionSet.weekendSessions,
    { collections: selectedCollections }
  );

  const sessions: SessionIdentity[] = [
    ...openSessions.map(({ session }) => session),
    ...closures.map(({ closure }) => closure),
    ...weekends.map(({ session }) => session)
  ];
  validateCompleteCoverage(sessionSet, sessions);
  return { sessionSet, sourceCollections };
}

function resolveSourceCollections(
  sessionSet: OfficialMarketCalendarSessionSet,
  values: readonly unknown[]
): readonly [
  OfficialMarketCalendarSourceCollection,
  OfficialMarketCalendarSourceCollection
] {
  const parsed = values.map((value) =>
    parseOfficialMarketCalendarSourceCollection(value)
  );
  const resolved = sessionSet.sourceCollections.map((ref) => {
    const matches = parsed.filter(
      (collection) =>
        collection.exchange === ref.exchange &&
        collection.collectionId === ref.collectionId
    );
    if (matches.length !== 1) {
      throw new Error(
        "official calendar session set collection must resolve exactly once"
      );
    }
    const collection = matches[0]!;
    if (collection.collectionHash !== ref.collectionHash) {
      throw new Error(
        "official calendar session set collection hash mismatch"
      );
    }
    if (
      sessionSet.coverage.startDate < collection.coverageStartDate ||
      sessionSet.coverage.endDate > collection.coverageEndDate
    ) {
      throw new Error(
        "official calendar session set coverage exceeds source collection"
      );
    }
    return collection;
  });
  return [resolved[0]!, resolved[1]!];
}

function validateCompleteCoverage(
  sessionSet: OfficialMarketCalendarSessionSet,
  sessions: readonly SessionIdentity[]
): void {
  const sessionIds = new Set<string>();
  for (const session of sessions) {
    if (sessionIds.has(session.sessionId)) {
      throw new Error(
        "official calendar session set must use unique session IDs"
      );
    }
    sessionIds.add(session.sessionId);
  }

  const sessionsByExchangeDate = new Map<string, SessionIdentity>();
  for (const session of sessions) {
    if (
      session.sessionDate < sessionSet.coverage.startDate ||
      session.sessionDate > sessionSet.coverage.endDate
    ) {
      throw new Error(
        "official calendar session set contains a date outside coverage"
      );
    }
    if (
      isWeekend(session.sessionDate) !==
      (session.sessionType === "weekend")
    ) {
      throw new Error(
        "official calendar session set weekend dates must use weekend sessions"
      );
    }
    const key = exchangeDateKey(session.exchange, session.sessionDate);
    if (sessionsByExchangeDate.has(key)) {
      throw new Error(
        "official calendar session set must contain one session per exchange date"
      );
    }
    sessionsByExchangeDate.set(key, session);
  }

  for (const exchange of sessionSet.coverage.exchanges) {
    for (const sessionDate of calendarDateRange(
      sessionSet.coverage.startDate,
      sessionSet.coverage.endDate
    )) {
      if (!sessionsByExchangeDate.has(exchangeDateKey(exchange, sessionDate))) {
        throw new Error(
          `official calendar session set is missing ${exchange}:${sessionDate}`
        );
      }
    }
  }
}

function exchangeDateKey(exchange: string, sessionDate: string): string {
  return JSON.stringify([exchange, sessionDate]);
}

function calendarDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = shiftCalendarDate(current, 1);
  }
  return dates;
}

function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(value: string): boolean {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
