import type { Market } from "../domain/schemas.js";

export const SUPPORTED_MARKET_CALENDAR_TIMEZONES = [
  "Asia/Seoul",
  "America/New_York"
] as const;

export type MarketCalendarTimezone =
  (typeof SUPPORTED_MARKET_CALENDAR_TIMEZONES)[number];

export type MarketCalendarStatus =
  | "session_open"
  | "session_closed"
  | "holiday"
  | "fixture_missing";

export type MarketCalendarWarningCode =
  | "CALENDAR_FIXTURE_MISSING"
  | "CALENDAR_HOLIDAY_SAMPLE"
  | "CALENDAR_SESSION_MISMATCH"
  | "CALENDAR_TIMEZONE_MISMATCH";

export interface MarketCalendarFixture {
  calendarId: string;
  exchange: string;
  market: Market;
  timezone: MarketCalendarTimezone;
  sessionDate: string;
  marketOpen: string | null;
  marketClose: string | null;
  isHoliday: boolean;
  holidayName?: string;
  sourceRefs: string[];
  createdAt: string;
}

export interface MarketCalendarTimestampClassification {
  status: MarketCalendarStatus;
  calendarId: string | null;
  exchange: string | null;
  market: Market | null;
  timezone: MarketCalendarTimezone | null;
  sessionDate: string | null;
  localDate: string | null;
  marketOpen: string | null;
  marketClose: string | null;
  isHoliday: boolean | null;
  warningCodes: MarketCalendarWarningCode[];
}

export class MarketCalendarFixtureIndex {
  private readonly fixturesByKey = new Map<string, MarketCalendarFixture>();

  constructor(fixtures: MarketCalendarFixture[]) {
    for (const fixture of fixtures) {
      const key = marketCalendarFixtureKey(fixture);
      if (this.fixturesByKey.has(key)) {
        throw new Error(`duplicate market calendar fixture: ${key}`);
      }
      this.fixturesByKey.set(key, fixture);
    }
  }

  get(input: {
    exchange: string;
    sessionDate: string;
  }): MarketCalendarFixture | undefined {
    return this.fixturesByKey.get(
      marketCalendarFixtureKey({
        exchange: input.exchange,
        sessionDate: input.sessionDate
      })
    );
  }
}

export function parseMarketCalendarFixture(value: unknown): MarketCalendarFixture {
  if (!isRecord(value)) {
    throw new Error("market calendar fixture must be an object");
  }

  const calendarId = readNonEmptyString(value, "calendarId");
  const exchange = readNonEmptyString(value, "exchange");
  const market = readMarket(value["market"]);
  const timezone = readMarketCalendarTimezone(value["timezone"]);
  const sessionDate = readSessionDate(value["sessionDate"]);
  const isHoliday = readBoolean(value, "isHoliday");
  const marketOpen = readNullableIsoDateTime(value, "marketOpen");
  const marketClose = readNullableIsoDateTime(value, "marketClose");
  const holidayName =
    value["holidayName"] === undefined
      ? undefined
      : readNonEmptyString(value, "holidayName");
  const sourceRefs = readNonEmptyStringArray(value, "sourceRefs");
  const createdAt = readIsoDateTime(value, "createdAt");

  if (isHoliday) {
    if (marketOpen !== null || marketClose !== null) {
      throw new Error("holiday fixture must not define marketOpen or marketClose");
    }
  } else {
    if (marketOpen === null || marketClose === null) {
      throw new Error("session fixture must define marketOpen and marketClose");
    }
    if (Date.parse(marketOpen) >= Date.parse(marketClose)) {
      throw new Error("marketOpen must be before marketClose");
    }
    const openLocalDate = localDatePart(new Date(marketOpen), timezone);
    const closeLocalDate = localDatePart(new Date(marketClose), timezone);
    if (openLocalDate !== sessionDate || closeLocalDate !== sessionDate) {
      throw new Error(
        "marketOpen and marketClose must resolve to fixture sessionDate"
      );
    }
  }

  return {
    calendarId,
    exchange,
    market,
    timezone,
    sessionDate,
    marketOpen,
    marketClose,
    isHoliday,
    ...(holidayName === undefined ? {} : { holidayName }),
    sourceRefs,
    createdAt
  };
}

export function parseMarketCalendarFixtures(
  values: unknown[]
): MarketCalendarFixture[] {
  return values.map((value) => parseMarketCalendarFixture(value));
}

export function classifyMarketCalendarTimestamp(input: {
  observedAt: Date | string;
  fixture?: MarketCalendarFixture | undefined;
}): MarketCalendarTimestampClassification {
  const observedAt = parseDate(input.observedAt, "observedAt");
  const fixture = input.fixture;
  if (fixture === undefined) {
    return {
      status: "fixture_missing",
      calendarId: null,
      exchange: null,
      market: null,
      timezone: null,
      sessionDate: null,
      localDate: null,
      marketOpen: null,
      marketClose: null,
      isHoliday: null,
      warningCodes: ["CALENDAR_FIXTURE_MISSING"]
    };
  }

  const localDate = localDatePart(observedAt, fixture.timezone);
  const warningCodes: MarketCalendarWarningCode[] = [];
  if (localDate !== fixture.sessionDate) {
    warningCodes.push("CALENDAR_TIMEZONE_MISMATCH");
  }

  let status: MarketCalendarStatus;
  if (fixture.isHoliday) {
    warningCodes.push("CALENDAR_HOLIDAY_SAMPLE");
    status = "holiday";
  } else if (
    fixture.marketOpen === null ||
    fixture.marketClose === null ||
    observedAt.getTime() < Date.parse(fixture.marketOpen) ||
    observedAt.getTime() > Date.parse(fixture.marketClose)
  ) {
    warningCodes.push("CALENDAR_SESSION_MISMATCH");
    status = "session_closed";
  } else {
    status = "session_open";
  }

  return {
    status,
    calendarId: fixture.calendarId,
    exchange: fixture.exchange,
    market: fixture.market,
    timezone: fixture.timezone,
    sessionDate: fixture.sessionDate,
    localDate,
    marketOpen: fixture.marketOpen,
    marketClose: fixture.marketClose,
    isHoliday: fixture.isHoliday,
    warningCodes
  };
}

export function localDatePart(
  timestamp: Date,
  timezone: MarketCalendarTimezone
): string {
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("timestamp must be a valid date");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(timestamp);
  const year = readFormattedPart(parts, "year");
  const month = readFormattedPart(parts, "month");
  const day = readFormattedPart(parts, "day");
  return `${year}-${month}-${day}`;
}

export function marketCalendarFixtureKey(input: {
  exchange: string;
  sessionDate: string;
}): string {
  return `${input.exchange}:${input.sessionDate}`;
}

function readFormattedPart(
  parts: Intl.DateTimeFormatPart[],
  type: "year" | "month" | "day"
): string {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new Error(`missing formatted ${type}`);
  }
  return part.value;
}

function readNonEmptyString(
  record: Record<string, unknown>,
  field: string
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function readNonEmptyStringArray(
  record: Record<string, unknown>,
  field: string
): string[] {
  const value = record[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function readMarket(value: unknown): Market {
  if (value === "KR" || value === "US") {
    return value;
  }
  throw new Error("market must be KR or US");
}

function readMarketCalendarTimezone(value: unknown): MarketCalendarTimezone {
  if (value === "Asia/Seoul" || value === "America/New_York") {
    return value;
  }
  throw new Error("timezone is not supported");
}

function readSessionDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("sessionDate must use YYYY-MM-DD");
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("sessionDate must be a valid calendar date");
  }
  return value;
}

function readNullableIsoDateTime(
  record: Record<string, unknown>,
  field: string
): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  return readIsoDateTime(record, field);
}

function readIsoDateTime(record: Record<string, unknown>, field: string): string {
  const value = readNonEmptyString(record, field);
  if (!hasExplicitTimeZoneOffset(value)) {
    throw new Error(`${field} must include an explicit timezone offset`);
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-compatible date-time string`);
  }
  return value;
}

function parseDate(value: Date | string, field: string): Date {
  if (typeof value === "string" && !hasExplicitTimeZoneOffset(value)) {
    throw new Error(`${field} must include an explicit timezone offset`);
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return date;
}

function hasExplicitTimeZoneOffset(value: string): boolean {
  return /T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
