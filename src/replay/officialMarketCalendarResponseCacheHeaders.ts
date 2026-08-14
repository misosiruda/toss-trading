import { z } from "zod";

const rawResponseCacheHeadersSchema = z
  .object({
    dateHeaderValues: z.array(z.string()),
    ageHeaderValues: z.array(z.string())
  })
  .strict();

const rawNetworkResponseCacheHeadersSchema = rawResponseCacheHeadersSchema
  .safeExtend({
    expiresHeaderValues: z.array(z.string())
  })
  .strict();

const HTTP_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HTTP_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
] as const;

export interface OfficialMarketCalendarResponseCacheHeaders {
  responseDate: string;
  responseAgeSeconds: number | null;
}

export interface OfficialMarketCalendarNetworkResponseCacheHeaders
  extends OfficialMarketCalendarResponseCacheHeaders {
  responseExpires: string | null;
}

export function parseOfficialMarketCalendarResponseCacheHeaders(
  value: unknown
): OfficialMarketCalendarResponseCacheHeaders {
  const headers = rawResponseCacheHeadersSchema.parse(value);
  if (headers.dateHeaderValues.length !== 1) {
    throw new Error(
      "official calendar response must contain exactly one Date header"
    );
  }
  if (headers.ageHeaderValues.length > 1) {
    throw new Error(
      "official calendar response must not contain duplicate Age headers"
    );
  }

  return {
    responseDate: parseStrictHttpDate(headers.dateHeaderValues[0]!),
    responseAgeSeconds:
      headers.ageHeaderValues.length === 0
        ? null
        : parseStrictAge(headers.ageHeaderValues[0]!)
  };
}

export function parseOfficialMarketCalendarNetworkResponseCacheHeaders(
  value: unknown
): OfficialMarketCalendarNetworkResponseCacheHeaders {
  const headers = rawNetworkResponseCacheHeadersSchema.parse(value);
  if (headers.expiresHeaderValues.length > 1) {
    throw new Error(
      "official calendar response must not contain duplicate Expires headers"
    );
  }
  return {
    ...parseOfficialMarketCalendarResponseCacheHeaders({
      dateHeaderValues: headers.dateHeaderValues,
      ageHeaderValues: headers.ageHeaderValues
    }),
    responseExpires:
      headers.expiresHeaderValues.length === 0
        ? null
        : parseStrictHttpDate(headers.expiresHeaderValues[0]!, "Expires")
  };
}

function parseStrictHttpDate(
  value: string,
  headerName: "Date" | "Expires" = "Date"
): string {
  const match =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) GMT$/.exec(
      value
    );
  if (match === null) {
    throw new Error(
      `official calendar response ${headerName} must use canonical IMF-fixdate`
    );
  }

  const month = HTTP_MONTHS.indexOf(match[3] as (typeof HTTP_MONTHS)[number]);
  const timestamp = new Date(0);
  timestamp.setUTCHours(0, 0, 0, 0);
  timestamp.setUTCFullYear(Number(match[4]), month, Number(match[2]));
  timestamp.setUTCHours(Number(match[5]), Number(match[6]), Number(match[7]), 0);

  if (
    timestamp.getUTCFullYear() !== Number(match[4]) ||
    timestamp.getUTCMonth() !== month ||
    timestamp.getUTCDate() !== Number(match[2]) ||
    HTTP_WEEKDAYS[timestamp.getUTCDay()] !== match[1]
  ) {
    throw new Error(
      `official calendar response ${headerName} must represent an existing matching date`
    );
  }

  return timestamp.toISOString().replace(".000Z", "Z");
}

function parseStrictAge(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      "official calendar response Age must be a non-negative decimal integer"
    );
  }
  const age = Number(value);
  if (!Number.isSafeInteger(age)) {
    throw new Error(
      "official calendar response Age exceeds the safe integer range"
    );
  }
  return age;
}
