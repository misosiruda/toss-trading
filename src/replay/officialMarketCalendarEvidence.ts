import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_EVIDENCE_SCHEMA_VERSION =
  "official_market_calendar_evidence.v1";

export const OFFICIAL_CALENDAR_EXCHANGES = ["KRX", "NYSE"] as const;

export const officialCalendarExchangeSchema = z.enum(
  OFFICIAL_CALENDAR_EXCHANGES
);

export const officialCalendarSessionTypeSchema = z.enum([
  "regular",
  "early_close",
  "holiday",
  "special_closure",
  "weekend"
]);

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "local time must use HH:mm");

const officialCalendarSourceSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    evidenceClass: z.literal("official_exchange"),
    exchange: officialCalendarExchangeSchema,
    market: z.enum(["KR", "US"]),
    timezone: z.enum(["Asia/Seoul", "America/New_York"]),
    publisher: z.string().trim().min(1),
    sourceUrl: z.url(),
    sourceDocumentHash: sha256HashSchema,
    retrievedAt: isoDateTimeSchema,
    staleAfter: isoDateTimeSchema,
    regularSession: z
      .object({
        openLocalTime: localTimeSchema,
        closeLocalTime: localTimeSchema
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.retrievedAt) >= Date.parse(value.staleAfter)) {
      context.addIssue({
        code: "custom",
        message: "calendar source retrievedAt must be before staleAfter"
      });
    }
    if (
      minutesFromLocalTime(value.regularSession.openLocalTime) >=
      minutesFromLocalTime(value.regularSession.closeLocalTime)
    ) {
      context.addIssue({
        code: "custom",
        path: ["regularSession"],
        message: "regular session open must be before close"
      });
    }
  });

const officialCalendarSessionSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    exchange: officialCalendarExchangeSchema,
    market: z.enum(["KR", "US"]),
    timezone: z.enum(["Asia/Seoul", "America/New_York"]),
    sessionDate: calendarDateSchema,
    sessionType: officialCalendarSessionTypeSchema,
    marketOpen: isoDateTimeSchema.nullable(),
    marketClose: isoDateTimeSchema.nullable(),
    exceptionName: z.string().trim().min(1).nullable()
  })
  .strict();

const officialMarketCalendarEvidenceBaseSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_EVIDENCE_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    purpose: z.literal("official_exchange_calendar_evidence"),
    generatedAt: isoDateTimeSchema,
    coverage: z
      .object({
        startDate: calendarDateSchema,
        endDate: calendarDateSchema,
        exchanges: z.tuple([z.literal("KRX"), z.literal("NYSE")])
      })
      .strict(),
    sources: z
      .tuple([officialCalendarSourceSchema, officialCalendarSourceSchema]),
    sessions: z.array(officialCalendarSessionSchema).min(2)
  })
  .strict()
  .superRefine((value, context) => {
    validateCoverage(value, context);
    validateSources(value, context);
    validateSessions(value, context);
  });

export const officialMarketCalendarEvidenceArtifactSchema =
  officialMarketCalendarEvidenceBaseSchema
    .safeExtend({
      artifactHash: sha256HashSchema
    })
    .strict();

export type OfficialCalendarExchange = z.infer<
  typeof officialCalendarExchangeSchema
>;
export type OfficialCalendarSessionType = z.infer<
  typeof officialCalendarSessionTypeSchema
>;
export type OfficialMarketCalendarEvidenceArtifact = z.infer<
  typeof officialMarketCalendarEvidenceArtifactSchema
>;
export type OfficialMarketCalendarEvidencePayload = z.infer<
  typeof officialMarketCalendarEvidenceBaseSchema
>;

export function createOfficialMarketCalendarEvidenceHash(
  value: OfficialMarketCalendarEvidencePayload
): Sha256Hash {
  return createReplayResearchHash(
    officialMarketCalendarEvidenceBaseSchema.parse(value)
  );
}

export function parseOfficialMarketCalendarEvidenceArtifact(
  value: unknown,
  options: { asOf: Date | string }
): OfficialMarketCalendarEvidenceArtifact {
  const artifact = officialMarketCalendarEvidenceArtifactSchema.parse(value);
  const { artifactHash, ...payload } = artifact;
  const expectedHash = createOfficialMarketCalendarEvidenceHash(payload);
  if (artifactHash !== expectedHash) {
    throw new Error("official market calendar evidence artifact hash mismatch");
  }

  const asOf = parseDate(options.asOf, "asOf");
  for (const source of artifact.sources) {
    if (asOf.getTime() < Date.parse(source.retrievedAt)) {
      throw new Error(
        `official market calendar evidence is not yet available: ${source.sourceId}`
      );
    }
    if (asOf.getTime() >= Date.parse(source.staleAfter)) {
      throw new Error(
        `official market calendar evidence is stale: ${source.sourceId}`
      );
    }
  }
  return artifact;
}

function validateCoverage(
  value: OfficialMarketCalendarEvidencePayload,
  context: z.RefinementCtx
): void {
  if (value.coverage.startDate > value.coverage.endDate) {
    context.addIssue({
      code: "custom",
      path: ["coverage"],
      message: "calendar coverage startDate must be before or equal to endDate"
    });
  }
}

function validateSources(
  value: OfficialMarketCalendarEvidencePayload,
  context: z.RefinementCtx
): void {
  const generatedAt = Date.parse(value.generatedAt);
  const sourceIds = new Set<string>();
  for (const [index, source] of value.sources.entries()) {
    const expectedExchange = OFFICIAL_CALENDAR_EXCHANGES[index]!;
    if (source.exchange !== expectedExchange) {
      context.addIssue({
        code: "custom",
        path: ["sources", index, "exchange"],
        message: "calendar sources must use canonical KRX then NYSE order"
      });
    }
    if (sourceIds.has(source.sourceId)) {
      context.addIssue({
        code: "custom",
        path: ["sources", index, "sourceId"],
        message: "calendar sourceId values must be unique"
      });
    }
    sourceIds.add(source.sourceId);

    const expected = exchangeContract(source.exchange);
    if (
      source.market !== expected.market ||
      source.timezone !== expected.timezone
    ) {
      context.addIssue({
        code: "custom",
        path: ["sources", index],
        message: "calendar source market or timezone does not match exchange"
      });
    }
    if (
      generatedAt < Date.parse(source.retrievedAt) ||
      generatedAt >= Date.parse(source.staleAfter)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sources", index],
        message: "generatedAt must be inside each source freshness window"
      });
    }
  }
}

function validateSessions(
  value: OfficialMarketCalendarEvidencePayload,
  context: z.RefinementCtx
): void {
  const sourcesById = new Map(
    value.sources.map((source) => [source.sourceId, source])
  );
  const sessionsByKey = new Map<string, number>();
  const sessionIds = new Set<string>();
  let previousKey: string | null = null;

  for (const [index, session] of value.sessions.entries()) {
    if (sessionIds.has(session.sessionId)) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index, "sessionId"],
        message: "calendar sessionId values must be unique"
      });
    }
    sessionIds.add(session.sessionId);

    const key = sessionKey(session.exchange, session.sessionDate);
    if (previousKey !== null && previousKey.localeCompare(key) >= 0) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index],
        message:
          "calendar sessions must use canonical exchange and date order without duplicates"
      });
    }
    previousKey = key;
    sessionsByKey.set(key, index);

    if (
      session.sessionDate < value.coverage.startDate ||
      session.sessionDate > value.coverage.endDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index, "sessionDate"],
        message: "calendar session must remain inside coverage"
      });
    }

    const source = sourcesById.get(session.sourceId);
    if (source === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index, "sourceId"],
        message: "calendar session sourceId must reference artifact source"
      });
      continue;
    }
    if (
      source.exchange !== session.exchange ||
      source.market !== session.market ||
      source.timezone !== session.timezone
    ) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index],
        message: "calendar session identity must match source provenance"
      });
    }
    validateSessionSchedule(session, source, index, context);
  }

  for (const exchange of OFFICIAL_CALENDAR_EXCHANGES) {
    for (const sessionDate of calendarDateRange(
      value.coverage.startDate,
      value.coverage.endDate
    )) {
      if (!sessionsByKey.has(sessionKey(exchange, sessionDate))) {
        context.addIssue({
          code: "custom",
          path: ["sessions"],
          message: `calendar coverage is missing ${exchange}:${sessionDate}`
        });
      }
    }
  }
}

function validateSessionSchedule(
  session: z.infer<typeof officialCalendarSessionSchema>,
  source: z.infer<typeof officialCalendarSourceSchema>,
  index: number,
  context: z.RefinementCtx
): void {
  const closed =
    session.sessionType === "holiday" ||
    session.sessionType === "special_closure" ||
    session.sessionType === "weekend";
  if (closed) {
    if (session.marketOpen !== null || session.marketClose !== null) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index],
        message: "closed calendar session must not define market timestamps"
      });
    }
    if (
      (session.sessionType === "holiday" ||
        session.sessionType === "special_closure") &&
      session.exceptionName === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index, "exceptionName"],
        message: "holiday and special closure require exceptionName"
      });
    }
    if (
      session.sessionType === "weekend" &&
      (session.exceptionName !== null || !isWeekend(session.sessionDate))
    ) {
      context.addIssue({
        code: "custom",
        path: ["sessions", index],
        message:
          "weekend session must use a weekend date without exceptionName"
      });
    }
    return;
  }

  if (session.marketOpen === null || session.marketClose === null) {
    context.addIssue({
      code: "custom",
      path: ["sessions", index],
      message: "open calendar session must define market timestamps"
    });
    return;
  }
  if (Date.parse(session.marketOpen) >= Date.parse(session.marketClose)) {
    context.addIssue({
      code: "custom",
      path: ["sessions", index],
      message: "marketOpen must be before marketClose"
    });
  }

  const openLocal = localDateTimeParts(session.marketOpen, session.timezone);
  const closeLocal = localDateTimeParts(session.marketClose, session.timezone);
  if (
    openLocal.date !== session.sessionDate ||
    closeLocal.date !== session.sessionDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["sessions", index],
      message:
        "market timestamps must resolve to sessionDate in exchange timezone"
    });
  }
  if (openLocal.time !== source.regularSession.openLocalTime) {
    context.addIssue({
      code: "custom",
      path: ["sessions", index, "marketOpen"],
      message: "marketOpen must match the source regular local open time"
    });
  }

  const closeMinutes = minutesFromLocalTime(closeLocal.time);
  const regularCloseMinutes = minutesFromLocalTime(
    source.regularSession.closeLocalTime
  );
  if (
    session.sessionType === "regular" &&
    (closeLocal.time !== source.regularSession.closeLocalTime ||
      session.exceptionName !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["sessions", index],
      message:
        "regular session must match regular local close without exceptionName"
    });
  }
  if (
    session.sessionType === "early_close" &&
    (closeMinutes >= regularCloseMinutes || session.exceptionName === null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["sessions", index],
      message:
        "early close must close before regular time and define exceptionName"
    });
  }
}

function exchangeContract(exchange: OfficialCalendarExchange): {
  market: "KR" | "US";
  timezone: "Asia/Seoul" | "America/New_York";
} {
  return exchange === "KRX"
    ? { market: "KR", timezone: "Asia/Seoul" }
    : { market: "US", timezone: "America/New_York" };
}

function localDateTimeParts(
  timestamp: string,
  timezone: "Asia/Seoul" | "America/New_York"
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) {
      throw new Error(`missing calendar ${type}`);
    }
    return value;
  };
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`
  };
}

function minutesFromLocalTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function calendarDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (
    let timestamp = Date.parse(`${startDate}T00:00:00.000Z`);
    timestamp <= Date.parse(`${endDate}T00:00:00.000Z`);
    timestamp += 86_400_000
  ) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}

function sessionKey(
  exchange: OfficialCalendarExchange,
  sessionDate: string
): string {
  return `${exchange}:${sessionDate}`;
}

function isWeekend(sessionDate: string): boolean {
  const day = new Date(`${sessionDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isValidCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function parseDate(value: Date | string, field: string): Date {
  if (
    typeof value === "string" &&
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    throw new Error(`${field} must include an explicit timezone offset`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return parsed;
}
