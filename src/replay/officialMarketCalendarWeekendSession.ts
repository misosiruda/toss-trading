import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";

export const OFFICIAL_MARKET_CALENDAR_WEEKEND_SESSION_SCHEMA_VERSION =
  "official_market_calendar_weekend_session.v1";

const exchangeSchema = z.enum(["KRX", "NYSE"]);
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

export const officialMarketCalendarWeekendSessionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_WEEKEND_SESSION_SCHEMA_VERSION
    ),
    sessionId: identifierSchema,
    exchange: exchangeSchema,
    sessionDate: calendarDateSchema,
    sessionType: z.literal("weekend"),
    exceptionName: z.null(),
    sourceCollection: z
      .object({
        exchange: exchangeSchema,
        collectionId: identifierSchema,
        collectionHash: sha256HashSchema
      })
      .strict(),
    sourceDocumentRefs: z.tuple([])
  })
  .strict();

export type OfficialMarketCalendarWeekendSession = z.infer<
  typeof officialMarketCalendarWeekendSessionSchema
>;

export interface ResolvedOfficialMarketCalendarWeekendSession {
  session: OfficialMarketCalendarWeekendSession;
  collection: OfficialMarketCalendarSourceCollection;
}

export function resolveOfficialMarketCalendarWeekendSession(
  value: unknown,
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarWeekendSession {
  const session = officialMarketCalendarWeekendSessionSchema.parse(value);
  if (session.sourceCollection.exchange !== session.exchange) {
    throw new Error(
      "official calendar weekend session collection must match exchange"
    );
  }
  const collection = findCollection(
    options.collections,
    session.exchange,
    session.sourceCollection.collectionId
  );
  if (collection.collectionHash !== session.sourceCollection.collectionHash) {
    throw new Error(
      "official calendar weekend session collection hash mismatch"
    );
  }
  if (
    session.sessionDate < collection.coverageStartDate ||
    session.sessionDate > collection.coverageEndDate
  ) {
    throw new Error(
      "official calendar weekend session date is outside collection coverage"
    );
  }
  if (!isWeekend(session.sessionDate)) {
    throw new Error(
      "official calendar weekend session date must be Saturday or Sunday"
    );
  }
  return { session, collection };
}

export function resolveOfficialMarketCalendarWeekendSessions(
  values: readonly unknown[],
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarWeekendSession[] {
  const resolved = values.map((value) =>
    resolveOfficialMarketCalendarWeekendSession(value, options)
  );
  let previous: OfficialMarketCalendarWeekendSession | null = null;
  const exchangeDates = new Set<string>();
  const sessionIds = new Set<string>();
  for (const item of resolved) {
    if (previous !== null && compareSessions(previous, item.session) >= 0) {
      throw new Error(
        "official calendar weekend sessions must use canonical order"
      );
    }
    previous = item.session;
    if (sessionIds.has(item.session.sessionId)) {
      throw new Error(
        "official calendar weekend sessions must use unique session IDs"
      );
    }
    sessionIds.add(item.session.sessionId);
    const exchangeDate = JSON.stringify([
      item.session.exchange,
      item.session.sessionDate
    ]);
    if (exchangeDates.has(exchangeDate)) {
      throw new Error(
        "official calendar weekend sessions must be unique per exchange date"
      );
    }
    exchangeDates.add(exchangeDate);
  }
  return resolved;
}

function findCollection(
  values: readonly unknown[],
  exchange: "KRX" | "NYSE",
  collectionId: string
): OfficialMarketCalendarSourceCollection {
  const matches = values
    .map((value) => parseOfficialMarketCalendarSourceCollection(value))
    .filter(
      (collection) =>
        collection.exchange === exchange &&
        collection.collectionId === collectionId
    );
  if (matches.length !== 1) {
    throw new Error(
      "official calendar weekend session collection must resolve exactly once"
    );
  }
  return matches[0]!;
}

function compareSessions(
  left: OfficialMarketCalendarWeekendSession,
  right: OfficialMarketCalendarWeekendSession
): number {
  return (
    compareCanonicalText(left.exchange, right.exchange) ||
    compareCanonicalText(left.sessionDate, right.sessionDate) ||
    compareCanonicalText(left.sessionId, right.sessionId)
  );
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
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
