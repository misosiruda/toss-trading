import { z } from "zod";

import {
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollection
} from "./officialMarketCalendarSourceCollection.js";
import {
  resolveOfficialMarketCalendarSessionHoursExceptions,
  type ResolvedOfficialMarketCalendarSessionHoursException
} from "./officialMarketCalendarSessionHoursException.js";
import {
  officialCalendarSourceDocumentRefSchema,
  parseOfficialMarketCalendarSessionProvenance,
  resolveOfficialCalendarSourceDocumentRefs,
  type OfficialCalendarSourceDocumentRef,
  type OfficialMarketCalendarSessionProvenance
} from "./officialMarketCalendarSessionProvenance.js";

export const OFFICIAL_MARKET_CALENDAR_OPEN_SESSION_SCHEMA_VERSION =
  "official_market_calendar_open_session.v1";

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

export const officialMarketCalendarOpenSessionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_OPEN_SESSION_SCHEMA_VERSION
    ),
    sessionId: identifierSchema,
    exchange: exchangeSchema,
    sessionDate: calendarDateSchema,
    sessionType: z.enum(["regular", "early_close", "delayed_open"]),
    openLocalTime: localTimeSchema,
    closeLocalTime: localTimeSchema,
    sourceDocumentRefs: z
      .array(officialCalendarSourceDocumentRefSchema)
      .min(1),
    regularSessionRegimeId: identifierSchema,
    sessionHoursExceptionId: identifierSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (minutes(value.openLocalTime) >= minutes(value.closeLocalTime)) {
      context.addIssue({
        code: "custom",
        path: ["closeLocalTime"],
        message: "official calendar open session open must be before close"
      });
    }
    if (
      (value.sessionType === "regular") !==
      (value.sessionHoursExceptionId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sessionHoursExceptionId"],
        message:
          "only non-regular open sessions must reference a session hours exception"
      });
    }
  });

export type OfficialMarketCalendarOpenSession = z.infer<
  typeof officialMarketCalendarOpenSessionSchema
>;

export interface ResolveOfficialMarketCalendarOpenSessionOptions {
  collections: readonly unknown[];
  sessionProvenances: readonly unknown[];
  sessionHoursExceptions: readonly unknown[];
}

export interface ResolvedOfficialMarketCalendarOpenSession {
  session: OfficialMarketCalendarOpenSession;
  provenance: OfficialMarketCalendarSessionProvenance;
  sessionHoursException:
    | ResolvedOfficialMarketCalendarSessionHoursException
    | null;
}

export function resolveOfficialMarketCalendarOpenSession(
  value: unknown,
  options: ResolveOfficialMarketCalendarOpenSessionOptions
): ResolvedOfficialMarketCalendarOpenSession {
  const session = officialMarketCalendarOpenSessionSchema.parse(value);
  resolveOfficialCalendarSourceDocumentRefs(
    session.sourceDocumentRefs,
    options.collections
  );
  const provenances = options.sessionProvenances.map((provenance) =>
    parseOfficialMarketCalendarSessionProvenance(provenance, {
      collections: options.collections
    })
  );
  const matchingProvenances = provenances.filter(
    (provenance) =>
      provenance.sessionId === session.sessionId &&
      provenance.exchange === session.exchange &&
      provenance.sessionDate === session.sessionDate
  );
  if (matchingProvenances.length !== 1) {
    throw new Error(
      "official calendar open session provenance must resolve exactly once"
    );
  }
  const provenance = matchingProvenances[0]!;
  if (provenance.regularSessionRegimeId !== session.regularSessionRegimeId) {
    throw new Error(
      "official calendar open session regime must match session provenance"
    );
  }

  const exceptions = resolveOfficialMarketCalendarSessionHoursExceptions(
    options.sessionHoursExceptions,
    { collections: options.collections }
  );
  const dateExceptions = exceptions.filter(
    ({ exception }) =>
      exception.exchange === session.exchange &&
      exception.sessionDate === session.sessionDate
  );
  const resolvedException = resolveSessionHoursException(
    session,
    dateExceptions
  );
  if (
    resolvedException !== null &&
    resolvedException.exception.sourceDocumentRefs.some(
      (ref) =>
        ref.collectionId !==
        provenance.sourceDocumentRefs[0]!.collectionId
    )
  ) {
    throw new Error(
      "official calendar open session evidence must use one source collection"
    );
  }

  const expectedHours = resolvedException === null
    ? resolveRegularSessionHours(provenance, options.collections)
    : {
        openLocalTime: resolvedException.effectiveOpenLocalTime,
        closeLocalTime: resolvedException.effectiveCloseLocalTime
      };
  if (
    session.openLocalTime !== expectedHours.openLocalTime ||
    session.closeLocalTime !== expectedHours.closeLocalTime
  ) {
    throw new Error(
      "official calendar open session hours must match effective source evidence"
    );
  }

  const expectedRefs = canonicalRefUnion(
    provenance.sourceDocumentRefs,
    resolvedException?.exception.sourceDocumentRefs ?? []
  );
  if (!sameRefs(session.sourceDocumentRefs, expectedRefs)) {
    throw new Error(
      "official calendar open session refs must match canonical evidence union"
    );
  }
  return {
    session,
    provenance,
    sessionHoursException: resolvedException
  };
}

export function resolveOfficialMarketCalendarOpenSessions(
  values: readonly unknown[],
  options: ResolveOfficialMarketCalendarOpenSessionOptions
): ResolvedOfficialMarketCalendarOpenSession[] {
  const resolved = values.map((value) =>
    resolveOfficialMarketCalendarOpenSession(value, options)
  );
  let previousSession: OfficialMarketCalendarOpenSession | null = null;
  const exchangeDates = new Set<string>();
  for (const item of resolved) {
    if (
      previousSession !== null &&
      compareSessions(previousSession, item.session) >= 0
    ) {
      throw new Error(
        "official calendar open sessions must use canonical order"
      );
    }
    previousSession = item.session;
    const exchangeDate = JSON.stringify([
      item.session.exchange,
      item.session.sessionDate
    ]);
    if (exchangeDates.has(exchangeDate)) {
      throw new Error(
        "official calendar open sessions must be unique per exchange date"
      );
    }
    exchangeDates.add(exchangeDate);
  }
  return resolved;
}

function resolveSessionHoursException(
  session: OfficialMarketCalendarOpenSession,
  candidates: readonly ResolvedOfficialMarketCalendarSessionHoursException[]
): ResolvedOfficialMarketCalendarSessionHoursException | null {
  if (session.sessionType === "regular") {
    if (candidates.length !== 0) {
      throw new Error(
        "official calendar regular session must not have a session hours exception"
      );
    }
    return null;
  }
  const matches = candidates.filter(
    ({ exception }) =>
      exception.exceptionId === session.sessionHoursExceptionId
  );
  if (matches.length !== 1) {
    throw new Error(
      "official calendar non-regular session exception must resolve exactly once"
    );
  }
  const resolved = matches[0]!;
  if (
    resolved.exception.exceptionType !== session.sessionType ||
    resolved.exception.regularSessionRegimeId !==
      session.regularSessionRegimeId
  ) {
    throw new Error(
      "official calendar non-regular session must match exception type and regime"
    );
  }
  return resolved;
}

function resolveRegularSessionHours(
  provenance: OfficialMarketCalendarSessionProvenance,
  collectionValues: readonly unknown[]
): { openLocalTime: string; closeLocalTime: string } {
  const collectionId = provenance.sourceDocumentRefs[0]!.collectionId;
  const collections = collectionValues
    .map((value) => parseOfficialMarketCalendarSourceCollection(value))
    .filter(
      (collection) =>
        collection.exchange === provenance.exchange &&
        collection.collectionId === collectionId
    );
  if (collections.length !== 1) {
    throw new Error(
      "official calendar open session collection must resolve exactly once"
    );
  }
  const regime = collections[0]!.regularSessionRegimes.find(
    (candidate) => candidate.regimeId === provenance.regularSessionRegimeId
  );
  if (regime === undefined) {
    throw new Error("official calendar open session regime is unknown");
  }
  return {
    openLocalTime: regime.openLocalTime,
    closeLocalTime: regime.closeLocalTime
  };
}

function canonicalRefUnion(
  ...groups: readonly OfficialCalendarSourceDocumentRef[][]
): OfficialCalendarSourceDocumentRef[] {
  const refs = groups.flat();
  const unique = new Map(
    refs.map((ref) => [JSON.stringify([ref.exchange, ref.collectionId, ref.documentId]), ref])
  );
  return [...unique.values()].sort(compareSourceDocumentRefs);
}

function sameRefs(
  actual: readonly OfficialCalendarSourceDocumentRef[],
  expected: readonly OfficialCalendarSourceDocumentRef[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (ref, index) => compareSourceDocumentRefs(ref, expected[index]!) === 0
    )
  );
}

function compareSessions(
  left: OfficialMarketCalendarOpenSession,
  right: OfficialMarketCalendarOpenSession
): number {
  return (
    compareCanonicalText(left.exchange, right.exchange) ||
    compareCanonicalText(left.sessionDate, right.sessionDate) ||
    compareCanonicalText(left.sessionId, right.sessionId)
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
