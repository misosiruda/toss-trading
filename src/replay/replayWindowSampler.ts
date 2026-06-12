export interface ReplayWindowSamplerOptions {
  rangeStart: Date;
  rangeEnd: Date;
  seed: string | number;
  windowMonths?: number;
  timezoneOffsetMinutes?: number;
}

export interface ReplayWindowSelection {
  seed: string;
  rangeStart: string;
  rangeEnd: string;
  windowMonths: number;
  timezoneOffsetMinutes: number;
  candidateCount: number;
  selectedCandidateIndex: number;
  selectedMonth: string;
  localStartDate: string;
  localEndDate: string;
  startAt: string;
  endAt: string;
}

interface LocalMonth {
  year: number;
  monthIndex: number;
}

interface ReplayWindowCandidate {
  selectedMonth: string;
  localStartDate: string;
  localEndDate: string;
  startMs: number;
  endMs: number;
}

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 540;
const DEFAULT_WINDOW_MONTHS = 1;

export function selectReplayWindow(
  options: ReplayWindowSamplerOptions
): ReplayWindowSelection {
  validateSamplerOptions(options);

  const windowMonths = options.windowMonths ?? DEFAULT_WINDOW_MONTHS;
  const timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES;
  const candidates = replayWindowCandidates({
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
    windowMonths,
    timezoneOffsetMinutes
  });

  if (candidates.length === 0) {
    throw new Error("No full replay window fits inside the configured range");
  }

  const seed = String(options.seed);
  const selectedCandidateIndex = seededIndex(
    [
      seed,
      options.rangeStart.toISOString(),
      options.rangeEnd.toISOString(),
      String(windowMonths),
      String(timezoneOffsetMinutes)
    ].join("|"),
    candidates.length
  );
  const selected = candidates[selectedCandidateIndex]!;

  return {
    seed,
    rangeStart: options.rangeStart.toISOString(),
    rangeEnd: options.rangeEnd.toISOString(),
    windowMonths,
    timezoneOffsetMinutes,
    candidateCount: candidates.length,
    selectedCandidateIndex,
    selectedMonth: selected.selectedMonth,
    localStartDate: selected.localStartDate,
    localEndDate: selected.localEndDate,
    startAt: new Date(selected.startMs).toISOString(),
    endAt: new Date(selected.endMs).toISOString()
  };
}

export function replayWindowCandidates(input: {
  rangeStart: Date;
  rangeEnd: Date;
  windowMonths?: number;
  timezoneOffsetMinutes?: number;
}): ReplayWindowCandidate[] {
  validateDate(input.rangeStart, "rangeStart");
  validateDate(input.rangeEnd, "rangeEnd");
  if (input.rangeStart.getTime() > input.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }

  const windowMonths = input.windowMonths ?? DEFAULT_WINDOW_MONTHS;
  validateWindowMonths(windowMonths);
  const timezoneOffsetMinutes =
    input.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES;
  validateTimezoneOffset(timezoneOffsetMinutes);

  const candidates: ReplayWindowCandidate[] = [];
  const startMonth = localMonth(input.rangeStart, timezoneOffsetMinutes);
  const endMonth = localMonth(input.rangeEnd, timezoneOffsetMinutes);
  const endCursor = addMonths(endMonth, 1);

  for (
    let cursor = startMonth;
    compareMonths(cursor, endCursor) < 0;
    cursor = addMonths(cursor, 1)
  ) {
    const windowStartMs = localMonthStartUtcMs(
      cursor,
      timezoneOffsetMinutes
    );
    const nextWindowMonth = addMonths(cursor, windowMonths);
    const windowEndMs =
      localMonthStartUtcMs(nextWindowMonth, timezoneOffsetMinutes) - 1;

    if (
      windowStartMs < input.rangeStart.getTime() ||
      windowEndMs > input.rangeEnd.getTime()
    ) {
      continue;
    }

    candidates.push({
      selectedMonth: formatLocalMonth(cursor),
      localStartDate: formatLocalDate(cursor.year, cursor.monthIndex, 1),
      localEndDate: formatLocalEndDate(nextWindowMonth),
      startMs: windowStartMs,
      endMs: windowEndMs
    });
  }

  return candidates;
}

function validateSamplerOptions(options: ReplayWindowSamplerOptions): void {
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }
  validateWindowMonths(options.windowMonths ?? DEFAULT_WINDOW_MONTHS);
  validateTimezoneOffset(
    options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES
  );
  if (String(options.seed).trim().length === 0) {
    throw new Error("seed must not be empty");
  }
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function validateWindowMonths(windowMonths: number): void {
  if (!Number.isInteger(windowMonths) || windowMonths <= 0) {
    throw new Error("windowMonths must be a positive integer");
  }
}

function validateTimezoneOffset(timezoneOffsetMinutes: number): void {
  if (!Number.isInteger(timezoneOffsetMinutes)) {
    throw new Error("timezoneOffsetMinutes must be an integer");
  }
}

function localMonth(date: Date, timezoneOffsetMinutes: number): LocalMonth {
  const shifted = new Date(
    date.getTime() + timezoneOffsetMinutes * 60_000
  );
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth()
  };
}

function addMonths(month: LocalMonth, count: number): LocalMonth {
  const absoluteMonth = month.year * 12 + month.monthIndex + count;
  return {
    year: Math.floor(absoluteMonth / 12),
    monthIndex: modulo(absoluteMonth, 12)
  };
}

function compareMonths(left: LocalMonth, right: LocalMonth): number {
  return left.year * 12 + left.monthIndex - (right.year * 12 + right.monthIndex);
}

function localMonthStartUtcMs(
  month: LocalMonth,
  timezoneOffsetMinutes: number
): number {
  return (
    Date.UTC(month.year, month.monthIndex, 1, 0, 0, 0, 0) -
    timezoneOffsetMinutes * 60_000
  );
}

function formatLocalMonth(month: LocalMonth): string {
  return `${month.year}-${pad2(month.monthIndex + 1)}`;
}

function formatLocalEndDate(nextWindowMonth: LocalMonth): string {
  const endDate = new Date(
    Date.UTC(nextWindowMonth.year, nextWindowMonth.monthIndex, 1) - 1
  );
  return formatLocalDate(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate()
  );
}

function formatLocalDate(
  year: number,
  monthIndex: number,
  day: number
): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function seededIndex(seedMaterial: string, candidateCount: number): number {
  const random = mulberry32(fnv1a(seedMaterial))();
  return Math.min(candidateCount - 1, Math.floor(random * candidateCount));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
