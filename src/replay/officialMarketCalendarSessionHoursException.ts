import { z } from "zod";

import {
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";
import {
  officialCalendarSourceDocumentRefSchema,
  resolveOfficialCalendarSourceDocumentRefs,
  type OfficialCalendarSourceDocumentRef
} from "./officialMarketCalendarSessionProvenance.js";

export const OFFICIAL_MARKET_CALENDAR_SESSION_HOURS_EXCEPTION_SCHEMA_VERSION =
  "official_market_calendar_session_hours_exception.v1";

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
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "local time must use HH:mm");

export const officialMarketCalendarSessionHoursExceptionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SESSION_HOURS_EXCEPTION_SCHEMA_VERSION
    ),
    exceptionId: identifierSchema,
    exchange: exchangeSchema,
    sessionDate: calendarDateSchema,
    exceptionType: z.enum(["early_close", "delayed_open"]),
    openLocalTimeOverride: localTimeSchema.nullable(),
    closeLocalTimeOverride: localTimeSchema,
    sourceDocumentRefs: z
      .array(officialCalendarSourceDocumentRefSchema)
      .min(1),
    regularSessionRegimeId: identifierSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.exceptionType === "early_close" &&
      value.openLocalTimeOverride !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["openLocalTimeOverride"],
        message: "early close must preserve the regular session open"
      });
    }
    if (
      value.exceptionType === "delayed_open" &&
      value.openLocalTimeOverride === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["openLocalTimeOverride"],
        message: "delayed open must declare an open override"
      });
    }
    if (
      value.openLocalTimeOverride !== null &&
      minutes(value.openLocalTimeOverride) >=
        minutes(value.closeLocalTimeOverride)
    ) {
      context.addIssue({
        code: "custom",
        path: ["closeLocalTimeOverride"],
        message: "session hours exception open must be before close"
      });
    }
  });

export type OfficialMarketCalendarSessionHoursException = z.infer<
  typeof officialMarketCalendarSessionHoursExceptionSchema
>;

export interface ResolvedOfficialMarketCalendarSessionHoursException {
  exception: OfficialMarketCalendarSessionHoursException;
  regularOpenLocalTime: string;
  regularCloseLocalTime: string;
  effectiveOpenLocalTime: string;
  effectiveCloseLocalTime: string;
}

export function resolveOfficialMarketCalendarSessionHoursException(
  value: unknown,
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarSessionHoursException {
  const exception = officialMarketCalendarSessionHoursExceptionSchema.parse(value);
  const resolvedRefs = resolveOfficialCalendarSourceDocumentRefs(
    exception.sourceDocumentRefs,
    options.collections
  );
  if (resolvedRefs.some(({ ref }) => ref.exchange !== exception.exchange)) {
    throw new Error(
      "official calendar session hours exception must not cross exchange boundary"
    );
  }

  const collectionIds = new Set(
    resolvedRefs.map(({ ref }) => ref.collectionId)
  );
  if (collectionIds.size !== 1) {
    throw new Error(
      "official calendar session hours exception must use one source collection"
    );
  }
  const collection = findCollection(
    options.collections,
    exception.exchange,
    resolvedRefs[0]!.ref.collectionId
  );
  if (
    exception.sessionDate < collection.coverageStartDate ||
    exception.sessionDate > collection.coverageEndDate
  ) {
    throw new Error(
      "official calendar session hours exception date is outside source collection coverage"
    );
  }

  validateExceptionScheduleProvenance(exception, collection);
  const regime = collection.regularSessionRegimes.find(
    (candidate) => candidate.regimeId === exception.regularSessionRegimeId
  );
  if (regime === undefined) {
    throw new Error(
      `official calendar session hours exception regime is unknown: ${exception.regularSessionRegimeId}`
    );
  }
  const regimeEnd = regime.effectiveEndDate ?? collection.coverageEndDate;
  if (
    exception.sessionDate < regime.effectiveStartDate ||
    exception.sessionDate > regimeEnd
  ) {
    throw new Error(
      "official calendar session hours exception date does not match effective regime"
    );
  }

  const regularOpenMinutes = minutes(regime.openLocalTime);
  const regularCloseMinutes = minutes(regime.closeLocalTime);
  const closeOverrideMinutes = minutes(exception.closeLocalTimeOverride);
  if (exception.exceptionType === "early_close") {
    if (
      closeOverrideMinutes <= regularOpenMinutes ||
      closeOverrideMinutes >= regularCloseMinutes
    ) {
      throw new Error(
        "official calendar early close must end after regular open and before regular close"
      );
    }
    return {
      exception,
      regularOpenLocalTime: regime.openLocalTime,
      regularCloseLocalTime: regime.closeLocalTime,
      effectiveOpenLocalTime: regime.openLocalTime,
      effectiveCloseLocalTime: exception.closeLocalTimeOverride
    };
  }

  const openOverride = exception.openLocalTimeOverride!;
  if (minutes(openOverride) <= regularOpenMinutes) {
    throw new Error(
      "official calendar delayed open must begin after regular open"
    );
  }
  return {
    exception,
    regularOpenLocalTime: regime.openLocalTime,
    regularCloseLocalTime: regime.closeLocalTime,
    effectiveOpenLocalTime: openOverride,
    effectiveCloseLocalTime: exception.closeLocalTimeOverride
  };
}

export function resolveOfficialMarketCalendarSessionHoursExceptions(
  values: readonly unknown[],
  options: { collections: readonly unknown[] }
): ResolvedOfficialMarketCalendarSessionHoursException[] {
  const resolved = values.map((value) =>
    resolveOfficialMarketCalendarSessionHoursException(value, options)
  );
  let previousException: OfficialMarketCalendarSessionHoursException | null =
    null;
  const sessionDates = new Set<string>();
  for (const item of resolved) {
    if (
      previousException !== null &&
      compareExceptions(previousException, item.exception) >= 0
    ) {
      throw new Error(
        "official calendar session hours exceptions must use canonical order"
      );
    }
    previousException = item.exception;
    const sessionDateKey = JSON.stringify([
      item.exception.exchange,
      item.exception.sessionDate
    ]);
    if (sessionDates.has(sessionDateKey)) {
      throw new Error(
        "official calendar session hours exceptions must be unique per exchange date"
      );
    }
    sessionDates.add(sessionDateKey);
  }
  return resolved;
}

function validateExceptionScheduleProvenance(
  exception: OfficialMarketCalendarSessionHoursException,
  collection: OfficialMarketCalendarSourceCollection
): void {
  const interval = collection.exceptionScheduleIntervals.find(
    (candidate) =>
      candidate.coverageRole === "session_hours_exception_schedule" &&
      candidate.startDate <= exception.sessionDate &&
      candidate.endDate >= exception.sessionDate
  );
  if (interval === undefined) {
    throw new Error(
      "official calendar session hours exception date lacks source schedule coverage"
    );
  }
  const applicableDocumentIds = interval.documentIds.filter((documentId) =>
    collection.documents
      .find((document) => document.documentId === documentId)!
      .scheduleCoverageIntervals.some(
        (coverage) =>
          coverage.coverageRole === "session_hours_exception_schedule" &&
          coverage.startDate <= exception.sessionDate &&
          coverage.endDate >= exception.sessionDate
      )
  );
  if (applicableDocumentIds.length === 0) {
    throw new Error(
      "official calendar session hours exception date lacks applicable source documents"
    );
  }
  const expectedRefs: OfficialCalendarSourceDocumentRef[] =
    applicableDocumentIds.map((documentId) => ({
      exchange: exception.exchange,
      collectionId: collection.collectionId,
      documentId
    }));
  if (
    expectedRefs.length !== exception.sourceDocumentRefs.length ||
    expectedRefs.some(
      (expected, index) =>
        compareSourceDocumentRefs(
          expected,
          exception.sourceDocumentRefs[index]!
        ) !== 0
    )
  ) {
    throw new Error(
      "official calendar session hours exception refs must match effective schedule provenance"
    );
  }
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
      "official calendar session hours exception collection identity must resolve exactly once"
    );
  }
  return matches[0]!;
}

function compareExceptions(
  left: OfficialMarketCalendarSessionHoursException,
  right: OfficialMarketCalendarSessionHoursException
): number {
  return (
    compareCanonicalText(left.exchange, right.exchange) ||
    compareCanonicalText(left.sessionDate, right.sessionDate) ||
    compareCanonicalText(left.exceptionId, right.exceptionId)
  );
}

function compareSourceDocumentRefs(
  left: OfficialCalendarSourceDocumentRef,
  right: OfficialCalendarSourceDocumentRef
): number {
  return (
    compareCanonicalText(left.exchange, right.exchange) ||
    compareCanonicalText(left.collectionId, right.collectionId) ||
    compareCanonicalText(left.documentId, right.documentId)
  );
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
