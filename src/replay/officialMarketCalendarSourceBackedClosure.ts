import { z } from "zod";

import {
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";
import {
  officialCalendarSourceDocumentRefSchema,
  resolveOfficialCalendarSourceDocumentRefs
} from "./officialMarketCalendarSessionProvenance.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_BACKED_CLOSURE_SCHEMA_VERSION =
  "official_market_calendar_source_backed_closure.v1";

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

export const officialMarketCalendarSourceBackedClosureSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_BACKED_CLOSURE_SCHEMA_VERSION
    ),
    sessionId: identifierSchema,
    exchange: exchangeSchema,
    sessionDate: calendarDateSchema,
    sessionType: z.enum(["holiday", "special_closure"]),
    exceptionName: z.string().trim().min(1),
    sourceDocumentRefs: z
      .array(officialCalendarSourceDocumentRefSchema)
      .min(1)
  })
  .strict();

export type OfficialMarketCalendarSourceBackedClosure = z.infer<
  typeof officialMarketCalendarSourceBackedClosureSchema
>;

export interface ResolvedOfficialMarketCalendarSourceBackedClosure {
  closure: OfficialMarketCalendarSourceBackedClosure;
  collectionHash: string;
}

export function resolveOfficialMarketCalendarSourceBackedClosure(
  value: unknown,
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarSourceBackedClosure {
  const closure = officialMarketCalendarSourceBackedClosureSchema.parse(value);
  const resolvedRefs = resolveOfficialCalendarSourceDocumentRefs(
    closure.sourceDocumentRefs,
    options.collections
  );
  if (resolvedRefs.some(({ ref }) => ref.exchange !== closure.exchange)) {
    throw new Error(
      "official calendar source-backed closure must not cross exchange boundary"
    );
  }
  const collectionIds = new Set(
    resolvedRefs.map(({ ref }) => ref.collectionId)
  );
  if (collectionIds.size !== 1) {
    throw new Error(
      "official calendar source-backed closure must use one source collection"
    );
  }
  const collection = findCollection(
    options.collections,
    closure.exchange,
    resolvedRefs[0]!.ref.collectionId
  );
  if (
    closure.sessionDate < collection.coverageStartDate ||
    closure.sessionDate > collection.coverageEndDate
  ) {
    throw new Error(
      "official calendar source-backed closure date is outside collection coverage"
    );
  }
  if (isWeekend(closure.sessionDate)) {
    throw new Error(
      "official calendar source-backed closure must not replace a weekend session"
    );
  }

  const rowRole = closure.sessionType === "holiday"
    ? "holiday_rows"
    : "special_closure";
  for (const { ref } of resolvedRefs) {
    const document = collection.documents.find(
      (candidate) => candidate.documentId === ref.documentId
    )!;
    if (!document.evidenceRoles.includes(rowRole)) {
      throw new Error(
        "official calendar closure refs must declare the matching row evidence role"
      );
    }
  }

  const scheduleRole = closure.sessionType === "holiday"
    ? "holiday_schedule"
    : "special_closure_schedule";
  const scheduleCoverage = collection.exceptionScheduleIntervals.find(
    (interval) =>
      interval.coverageRole === scheduleRole &&
      interval.startDate <= closure.sessionDate &&
      interval.endDate >= closure.sessionDate
  );
  if (scheduleCoverage === undefined) {
    throw new Error(
      "official calendar source-backed closure lacks matching schedule coverage"
    );
  }
  return {
    closure,
    collectionHash: collection.collectionHash
  };
}

export function resolveOfficialMarketCalendarSourceBackedClosures(
  values: readonly unknown[],
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarSourceBackedClosure[] {
  const resolved = values.map((value) =>
    resolveOfficialMarketCalendarSourceBackedClosure(value, options)
  );
  let previous: OfficialMarketCalendarSourceBackedClosure | null = null;
  const exchangeDates = new Set<string>();
  for (const item of resolved) {
    if (previous !== null && compareClosures(previous, item.closure) >= 0) {
      throw new Error(
        "official calendar source-backed closures must use canonical order"
      );
    }
    previous = item.closure;
    const exchangeDate = JSON.stringify([
      item.closure.exchange,
      item.closure.sessionDate
    ]);
    if (exchangeDates.has(exchangeDate)) {
      throw new Error(
        "official calendar source-backed closures must be unique per exchange date"
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
      "official calendar source-backed closure collection must resolve exactly once"
    );
  }
  return matches[0]!;
}

function compareClosures(
  left: OfficialMarketCalendarSourceBackedClosure,
  right: OfficialMarketCalendarSourceBackedClosure
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

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isWeekend(value: string): boolean {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}
