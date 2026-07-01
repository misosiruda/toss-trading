export const SUPPORTED_FX_RATE_PAIRS = ["USD/KRW"] as const;

export type FxRatePair = (typeof SUPPORTED_FX_RATE_PAIRS)[number];

export type FxSnapshotFreshnessStatus = "fresh" | "stale" | "missing";

export type FxSnapshotWarningCode =
  | "VIRTUAL_FX_MISSING"
  | "VIRTUAL_FX_STALE";

export interface FxRateSnapshotFixture {
  fxId: string;
  pair: FxRatePair;
  sourceSymbol: string;
  observedAt: string;
  rate: number;
  staleAfter: string;
  sourceRefs: string[];
  createdAt: string;
}

export interface FxSnapshotFreshnessAssessment {
  status: FxSnapshotFreshnessStatus;
  fxId: string | null;
  pair: FxRatePair;
  sourceSymbol: string | null;
  observedAt: string | null;
  staleAfter: string | null;
  warningCodes: FxSnapshotWarningCode[];
}

export function parseFxRateSnapshotFixture(
  value: unknown
): FxRateSnapshotFixture {
  if (!isRecord(value)) {
    throw new Error("FX rate snapshot fixture must be an object");
  }

  const fxId = readNonEmptyString(value, "fxId");
  const pair = readFxRatePair(value["pair"]);
  const sourceSymbol = readNonEmptyString(value, "sourceSymbol");
  const observedAt = readIsoDateTime(value, "observedAt");
  const rate = readPositiveFiniteNumber(value, "rate");
  const staleAfter = readIsoDateTime(value, "staleAfter");
  const sourceRefs = readNonEmptyStringArray(value, "sourceRefs");
  const createdAt = readIsoDateTime(value, "createdAt");

  if (Date.parse(observedAt) >= Date.parse(staleAfter)) {
    throw new Error("observedAt must be before staleAfter");
  }

  return {
    fxId,
    pair,
    sourceSymbol,
    observedAt,
    rate,
    staleAfter,
    sourceRefs,
    createdAt
  };
}

export function parseFxRateSnapshotFixtures(
  values: unknown[]
): FxRateSnapshotFixture[] {
  return values.map((value) => parseFxRateSnapshotFixture(value));
}

export function classifyFxSnapshotFreshness(input: {
  priceObservedAt: Date | string;
  fixture?: FxRateSnapshotFixture | undefined;
  pair?: FxRatePair | undefined;
}): FxSnapshotFreshnessAssessment {
  const priceObservedAt = parseDate(input.priceObservedAt, "priceObservedAt");
  const pair =
    input.fixture?.pair ??
    (input.pair === undefined ? "USD/KRW" : readFxRatePair(input.pair));

  if (input.fixture === undefined) {
    return {
      status: "missing",
      fxId: null,
      pair,
      sourceSymbol: null,
      observedAt: null,
      staleAfter: null,
      warningCodes: ["VIRTUAL_FX_MISSING"]
    };
  }

  if (priceObservedAt.getTime() >= Date.parse(input.fixture.staleAfter)) {
    return {
      status: "stale",
      fxId: input.fixture.fxId,
      pair,
      sourceSymbol: input.fixture.sourceSymbol,
      observedAt: input.fixture.observedAt,
      staleAfter: input.fixture.staleAfter,
      warningCodes: ["VIRTUAL_FX_STALE"]
    };
  }

  return {
    status: "fresh",
    fxId: input.fixture.fxId,
    pair,
    sourceSymbol: input.fixture.sourceSymbol,
    observedAt: input.fixture.observedAt,
    staleAfter: input.fixture.staleAfter,
    warningCodes: []
  };
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

function readFxRatePair(value: unknown): FxRatePair {
  if (value === "USD/KRW") {
    return value;
  }
  throw new Error("pair must be USD/KRW");
}

function readPositiveFiniteNumber(
  record: Record<string, unknown>,
  field: string
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number`);
  }
  return value;
}

function readIsoDateTime(record: Record<string, unknown>, field: string): string {
  const value = readNonEmptyString(record, field);
  if (!hasExplicitTimeZoneOffset(value)) {
    throw new Error(`${field} must include an explicit timezone offset`);
  }
  assertValidCalendarDatePrefix(value, field);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-compatible date-time string`);
  }
  return value;
}

function parseDate(value: Date | string, field: string): Date {
  if (typeof value === "string" && !hasExplicitTimeZoneOffset(value)) {
    throw new Error(`${field} must include an explicit timezone offset`);
  }
  if (typeof value === "string") {
    assertValidCalendarDatePrefix(value, field);
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return date;
}

function assertValidCalendarDatePrefix(value: string, field: string): void {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  const datePart = match?.[1];
  if (datePart === undefined) {
    throw new Error(`${field} must be an ISO-compatible date-time string`);
  }
  assertValidCalendarDate(datePart, field);
}

function assertValidCalendarDate(value: string, field: string): void {
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
    throw new Error(`${field} must include a valid calendar date`);
  }
}

function hasExplicitTimeZoneOffset(value: string): boolean {
  return /T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
