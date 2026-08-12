import { z } from "zod";

import { isoDateTimeSchema } from "../domain/schemas.js";

export const OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION =
  "official_broker_observed_calendar_response.v1";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");

const sourceDateTimeSchema = isoDateTimeSchema.refine(
  (value) => {
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?\+09:00$/.exec(
      value
    );
    return match !== null && isValidCalendarDate(match[1]!);
  },
  "source date-time must use a valid KST +09:00 timestamp"
);

const canonicalUtcDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "normalized date-time must use canonical UTC format"
  );

const krPreMarketSessionSchema = z
  .object({
    startTime: sourceDateTimeSchema,
    singlePriceAuctionStartTime: sourceDateTimeSchema.nullable().optional(),
    endTime: sourceDateTimeSchema
  })
  .strict();

const krRegularMarketSessionSchema = z
  .object({
    startTime: sourceDateTimeSchema,
    singlePriceAuctionStartTime: sourceDateTimeSchema.nullable().optional(),
    endTime: sourceDateTimeSchema
  })
  .strict();

const krAfterMarketSessionSchema = z
  .object({
    startTime: sourceDateTimeSchema,
    singlePriceAuctionEndTime: sourceDateTimeSchema.nullable().optional(),
    endTime: sourceDateTimeSchema
  })
  .strict();

const krIntegratedMarketSchema = z
  .object({
    preMarket: krPreMarketSessionSchema.nullable(),
    regularMarket: krRegularMarketSessionSchema.nullable(),
    afterMarket: krAfterMarketSessionSchema.nullable()
  })
  .strict();

const krMarketDaySchema = z
  .object({
    date: calendarDateSchema,
    integrated: krIntegratedMarketSchema.nullable()
  })
  .strict();

const krMarketCalendarResponseSchema = z
  .object({
    result: z
      .object({
        today: krMarketDaySchema,
        previousBusinessDay: krMarketDaySchema,
        nextBusinessDay: krMarketDaySchema
      })
      .strict()
  })
  .strict();

const usMarketSessionSchema = z
  .object({
    startTime: sourceDateTimeSchema,
    endTime: sourceDateTimeSchema
  })
  .strict();

const usMarketDaySchema = z
  .object({
    date: calendarDateSchema,
    dayMarket: usMarketSessionSchema.nullable(),
    preMarket: usMarketSessionSchema.nullable(),
    regularMarket: usMarketSessionSchema.nullable(),
    afterMarket: usMarketSessionSchema.nullable()
  })
  .strict();

const usMarketCalendarResponseSchema = z
  .object({
    result: z
      .object({
        today: usMarketDaySchema,
        previousBusinessDay: usMarketDaySchema,
        nextBusinessDay: usMarketDaySchema
      })
      .strict()
  })
  .strict();

export const officialBrokerObservedCalendarSessionTypeSchema = z.enum([
  "day_market",
  "pre_market",
  "regular_market",
  "after_market"
]);

const normalizedSessionSchema = z
  .object({
    sessionType: officialBrokerObservedCalendarSessionTypeSchema,
    startAt: canonicalUtcDateTimeSchema,
    endAt: canonicalUtcDateTimeSchema,
    singlePriceAuctionStartAt: canonicalUtcDateTimeSchema.nullable(),
    singlePriceAuctionEndAt: canonicalUtcDateTimeSchema.nullable()
  })
  .strict();

const normalizedDayRelationSchema = z.enum([
  "previous_business_day",
  "today",
  "next_business_day"
]);

const normalizedDaySchema = z
  .object({
    relation: normalizedDayRelationSchema,
    marketDate: calendarDateSchema,
    status: z.enum(["open", "closed"]),
    sessions: z.array(normalizedSessionSchema)
  })
  .strict();

export const officialBrokerObservedCalendarResponseSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    market: z.enum(["KR", "US"]),
    requestedDate: calendarDateSchema,
    days: z.tuple([
      normalizedDaySchema,
      normalizedDaySchema,
      normalizedDaySchema
    ])
  })
  .strict()
  .superRefine(validateNormalizedResponse);

export const officialBrokerObservedCalendarResponseParserOptionsSchema = z
  .object({
    market: z.enum(["KR", "US"]),
    requestedDate: calendarDateSchema
  })
  .strict();

export type OfficialBrokerObservedCalendarSessionType = z.infer<
  typeof officialBrokerObservedCalendarSessionTypeSchema
>;
export type OfficialBrokerObservedCalendarResponse = z.infer<
  typeof officialBrokerObservedCalendarResponseSchema
>;
export type OfficialBrokerObservedCalendarResponseParserOptions = z.infer<
  typeof officialBrokerObservedCalendarResponseParserOptionsSchema
>;

type NormalizedSession = z.infer<typeof normalizedSessionSchema>;
type NormalizedDay = z.infer<typeof normalizedDaySchema>;
type KrMarketCalendarResponse = z.infer<
  typeof krMarketCalendarResponseSchema
>;
type KrMarketDay = z.infer<typeof krMarketDaySchema>;
type UsMarketCalendarResponse = z.infer<
  typeof usMarketCalendarResponseSchema
>;
type UsMarketDay = z.infer<typeof usMarketDaySchema>;

export function parseOfficialBrokerObservedCalendarResponse(
  value: unknown,
  options: OfficialBrokerObservedCalendarResponseParserOptions
): OfficialBrokerObservedCalendarResponse {
  const parsedOptions =
    officialBrokerObservedCalendarResponseParserOptionsSchema.parse(options);

  const days =
    parsedOptions.market === "KR"
      ? normalizeKrResponse(krMarketCalendarResponseSchema.parse(value))
      : normalizeUsResponse(usMarketCalendarResponseSchema.parse(value));

  return officialBrokerObservedCalendarResponseSchema.parse({
    schemaVersion:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    market: parsedOptions.market,
    requestedDate: parsedOptions.requestedDate,
    days
  });
}

function normalizeKrResponse(
  response: KrMarketCalendarResponse
): [NormalizedDay, NormalizedDay, NormalizedDay] {
  return [
    normalizeKrDay("previous_business_day", response.result.previousBusinessDay),
    normalizeKrDay("today", response.result.today),
    normalizeKrDay("next_business_day", response.result.nextBusinessDay)
  ];
}

function normalizeKrDay(
  relation: NormalizedDay["relation"],
  day: KrMarketDay
): NormalizedDay {
  const integrated = day.integrated;
  if (integrated === null) {
    return closedDay(relation, day.date);
  }

  const sessions: NormalizedSession[] = [];
  if (integrated.preMarket !== null) {
    sessions.push(
      normalizeSession(
        "pre_market",
        integrated.preMarket,
        integrated.preMarket.singlePriceAuctionStartTime,
        null
      )
    );
  }
  if (integrated.regularMarket !== null) {
    sessions.push(
      normalizeSession(
        "regular_market",
        integrated.regularMarket,
        integrated.regularMarket.singlePriceAuctionStartTime,
        null
      )
    );
  }
  if (integrated.afterMarket !== null) {
    sessions.push(
      normalizeSession(
        "after_market",
        integrated.afterMarket,
        null,
        integrated.afterMarket.singlePriceAuctionEndTime
      )
    );
  }
  if (sessions.length === 0) {
    throw new Error(
      "KR integrated market must be null when every session is closed"
    );
  }
  return openDay(relation, day.date, sessions);
}

function normalizeUsResponse(
  response: UsMarketCalendarResponse
): [NormalizedDay, NormalizedDay, NormalizedDay] {
  return [
    normalizeUsDay("previous_business_day", response.result.previousBusinessDay),
    normalizeUsDay("today", response.result.today),
    normalizeUsDay("next_business_day", response.result.nextBusinessDay)
  ];
}

function normalizeUsDay(
  relation: NormalizedDay["relation"],
  day: UsMarketDay
): NormalizedDay {
  const sessions: NormalizedSession[] = [];
  for (const [sessionType, session] of [
    ["day_market", day.dayMarket],
    ["pre_market", day.preMarket],
    ["regular_market", day.regularMarket],
    ["after_market", day.afterMarket]
  ] as const) {
    if (session !== null) {
      sessions.push(normalizeSession(sessionType, session, null, null));
    }
  }
  return sessions.length === 0
    ? closedDay(relation, day.date)
    : openDay(relation, day.date, sessions);
}

function normalizeSession(
  sessionType: OfficialBrokerObservedCalendarSessionType,
  session: { startTime: string; endTime: string },
  singlePriceAuctionStartTime: string | null | undefined,
  singlePriceAuctionEndTime: string | null | undefined
): NormalizedSession {
  const startAt = canonicalTimestamp(session.startTime);
  const endAt = canonicalTimestamp(session.endTime);
  if (Date.parse(startAt) >= Date.parse(endAt)) {
    throw new Error(`${sessionType} startTime must be before endTime`);
  }

  const singlePriceAuctionStartAt = nullableCanonicalTimestamp(
    singlePriceAuctionStartTime
  );
  const singlePriceAuctionEndAt = nullableCanonicalTimestamp(
    singlePriceAuctionEndTime
  );
  validateAuctionBoundary(
    sessionType,
    startAt,
    endAt,
    singlePriceAuctionStartAt,
    "start"
  );
  validateAuctionBoundary(
    sessionType,
    startAt,
    endAt,
    singlePriceAuctionEndAt,
    "end"
  );

  return {
    sessionType,
    startAt,
    endAt,
    singlePriceAuctionStartAt,
    singlePriceAuctionEndAt
  };
}

function validateAuctionBoundary(
  sessionType: OfficialBrokerObservedCalendarSessionType,
  startAt: string,
  endAt: string,
  auctionAt: string | null,
  boundary: "start" | "end"
): void {
  if (auctionAt === null) {
    return;
  }
  if (
    Date.parse(auctionAt) < Date.parse(startAt) ||
    Date.parse(auctionAt) > Date.parse(endAt)
  ) {
    throw new Error(
      `${sessionType} single price auction ${boundary} must remain inside session`
    );
  }
}

function openDay(
  relation: NormalizedDay["relation"],
  marketDate: string,
  sessions: NormalizedSession[]
): NormalizedDay {
  return { relation, marketDate, status: "open", sessions };
}

function closedDay(
  relation: NormalizedDay["relation"],
  marketDate: string
): NormalizedDay {
  return { relation, marketDate, status: "closed", sessions: [] };
}

function validateNormalizedResponse(
  value: {
    market: "KR" | "US";
    requestedDate: string;
    days: [NormalizedDay, NormalizedDay, NormalizedDay];
  },
  context: z.RefinementCtx
): void {
  const expectedRelations = [
    "previous_business_day",
    "today",
    "next_business_day"
  ] as const;
  for (const [index, day] of value.days.entries()) {
    if (day.relation !== expectedRelations[index]) {
      context.addIssue({
        code: "custom",
        path: ["days", index, "relation"],
        message: "normalized calendar day relation order is invalid"
      });
    }
    if (
      (day.status === "closed" && day.sessions.length !== 0) ||
      (day.status === "open" && day.sessions.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["days", index, "status"],
        message: "normalized calendar day status must match session count"
      });
    }
    validateSessionSequence(value.market, day, index, context);
  }

  if (value.days[1].marketDate !== value.requestedDate) {
    context.addIssue({
      code: "custom",
      path: ["requestedDate"],
      message: "requestedDate must match returned today date"
    });
  }
  if (
    value.days[0].marketDate >= value.days[1].marketDate ||
    value.days[1].marketDate >= value.days[2].marketDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["days"],
      message: "returned calendar days must be strictly chronological"
    });
  }
}

function validateSessionSequence(
  market: "KR" | "US",
  day: NormalizedDay,
  dayIndex: number,
  context: z.RefinementCtx
): void {
  const expectedTypes: readonly OfficialBrokerObservedCalendarSessionType[] =
    market === "KR"
      ? (["pre_market", "regular_market", "after_market"] as const)
      : ([
          "day_market",
          "pre_market",
          "regular_market",
          "after_market"
        ] as const);
  let previousTypeIndex = -1;
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const [sessionIndex, session] of day.sessions.entries()) {
    const typeIndex = expectedTypes.indexOf(session.sessionType);
    if (typeIndex <= previousTypeIndex) {
      context.addIssue({
        code: "custom",
        path: ["days", dayIndex, "sessions", sessionIndex, "sessionType"],
        message: "normalized calendar sessions must use canonical order"
      });
    }
    const start = Date.parse(session.startAt);
    const end = Date.parse(session.endAt);
    if (start >= end) {
      context.addIssue({
        code: "custom",
        path: ["days", dayIndex, "sessions", sessionIndex],
        message: "normalized calendar session start must be before end"
      });
    }
    for (const [field, auctionAt] of [
      ["singlePriceAuctionStartAt", session.singlePriceAuctionStartAt],
      ["singlePriceAuctionEndAt", session.singlePriceAuctionEndAt]
    ] as const) {
      if (
        auctionAt !== null &&
        (Date.parse(auctionAt) < start || Date.parse(auctionAt) > end)
      ) {
        context.addIssue({
          code: "custom",
          path: ["days", dayIndex, "sessions", sessionIndex, field],
          message: "normalized auction timestamp must remain inside session"
        });
      }
    }
    if (start < previousEnd) {
      context.addIssue({
        code: "custom",
        path: ["days", dayIndex, "sessions", sessionIndex, "startAt"],
        message: "normalized calendar sessions must not overlap"
      });
    }
    previousTypeIndex = typeIndex;
    previousEnd = end;
  }
}

function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function nullableCanonicalTimestamp(
  value: string | null | undefined
): string | null {
  return value === null || value === undefined
    ? null
    : canonicalTimestamp(value);
}

function isValidCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}
