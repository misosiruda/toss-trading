import type {
  VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows
} from "./officialMarketCalendarKrxLegacyWordSourceRows.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_calendar_semantics.v2";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent {
  index: number;
  sourceRowIndex: number;
  month: number;
  day: number;
  date: string;
  description: string;
  kind: "holiday" | "derivatives_schedule";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordCalendarMonth {
  month: number;
  title: string;
  titleRowIndex: number;
  weekdayRowIndex: number;
  dateGridRowIndices: readonly number[];
  eventRowIndices: readonly number[];
  events: readonly VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[];
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordCalendarSemantics {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_SCHEMA_VERSION;
  targetYear: string;
  nFib: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["nFib"];
  tableStreamName: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["tableStreamName"];
  months: readonly VerifiedOfficialMarketCalendarKrxLegacyWordCalendarMonth[];
  events: readonly VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[];
  holidayCount: number;
  derivativesScheduleCount: number;
  twoMonthBlockCount: 6;
  monthTitleStatus: "january_through_december_verified";
  weekdayHeaderStatus: "sunday_through_saturday_verified";
  dateGridStatus: "gregorian_five_or_six_row_layout_verified";
  columnSemanticsStatus: "calendar_grid_and_event_columns_verified";
  holidaySemanticsStatus: "classified_not_accepted";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordCalendarSemanticsErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_INVALID";

export class OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordCalendarSemanticsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError";
  }
}

const MONTH_NAMES = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
]);
const WEEKDAY_HEADERS = Object.freeze([
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT"
]);

export function verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
  sourceRows: Pick<
    VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows,
    "nFib" | "tableStreamName" | "rows"
  >,
  targetYear: string
): VerifiedOfficialMarketCalendarKrxLegacyWordCalendarSemantics {
  const year = parseTargetYear(targetYear);
  if (
    sourceRows.rows.length === 0 ||
    sourceRows.rows.some((row, index) => row.index !== index)
  ) {
    throw invalidCalendarSemantics();
  }
  const titleRowIndices = sourceRows.rows
    .filter((row) => row.cells.length === 3)
    .map((row) => row.index);
  if (
    titleRowIndices.length !== 6 ||
    titleRowIndices[0] !== 0
  ) {
    throw invalidCalendarSemantics();
  }

  const months: VerifiedOfficialMarketCalendarKrxLegacyWordCalendarMonth[] = [];
  const events: VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[] = [];
  for (let pairIndex = 0; pairIndex < 6; pairIndex += 1) {
    const firstMonth = pairIndex * 2 + 1;
    const secondMonth = firstMonth + 1;
    const blockStart = titleRowIndices[pairIndex]!;
    const blockEnd = titleRowIndices[pairIndex + 1] ?? sourceRows.rows.length;
    const block = sourceRows.rows.slice(blockStart, blockEnd);
    if (block.length < 7) throw invalidCalendarSemantics();

    verifyTitleRow(block[0]!, firstMonth, secondMonth);
    verifyWeekdayRow(block[1]!);
    const dateRows = block.slice(2).filter(
      (row, index, rows) =>
        row.cells.length === 15 &&
        rows.slice(0, index).every((candidate) => candidate.cells.length === 15)
    );
    if (dateRows.length < 5 || dateRows.length > 6) {
      throw invalidCalendarSemantics();
    }
    verifyDateGrid(dateRows, year, firstMonth, 0);
    verifyDateGrid(dateRows, year, secondMonth, 8);

    const firstEvents: VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[] = [];
    const secondEvents: VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[] = [];
    const eventRowIndices: number[] = [];
    for (const row of block.slice(2 + dateRows.length)) {
      const eventColumns = parseEventColumns(row);
      eventRowIndices.push(row.index);
      const left = parseEvents(
        row.index,
        firstMonth,
        eventColumns.left.dayText,
        eventColumns.left.descriptionText,
        year,
        events.length
      );
      firstEvents.push(...left);
      events.push(...left);
      const right = parseEvents(
        row.index,
        secondMonth,
        eventColumns.right.dayText,
        eventColumns.right.descriptionText,
        year,
        events.length
      );
      secondEvents.push(...right);
      events.push(...right);
    }

    months.push(
      createMonth(firstMonth, block, dateRows, eventRowIndices, firstEvents),
      createMonth(secondMonth, block, dateRows, eventRowIndices, secondEvents)
    );
  }

  const holidayCount = events.filter((event) => event.kind === "holiday").length;
  const derivativesScheduleCount = events.length - holidayCount;
  if (months.length !== 12 || holidayCount < 1 || derivativesScheduleCount < 1) {
    throw invalidCalendarSemantics();
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_SCHEMA_VERSION,
    targetYear,
    nFib: sourceRows.nFib,
    tableStreamName: sourceRows.tableStreamName,
    months: Object.freeze(months),
    events: Object.freeze(events),
    holidayCount,
    derivativesScheduleCount,
    twoMonthBlockCount: 6,
    monthTitleStatus: "january_through_december_verified",
    weekdayHeaderStatus: "sunday_through_saturday_verified",
    dateGridStatus: "gregorian_five_or_six_row_layout_verified",
    columnSemanticsStatus: "calendar_grid_and_event_columns_verified",
    holidaySemanticsStatus: "classified_not_accepted",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function verifyTitleRow(
  row: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["rows"][number],
  firstMonth: number,
  secondMonth: number
): void {
  if (
    row.tableDepth !== 1 ||
    row.cells.length !== 3 ||
    normalize(row.cells[0]!.contentText) !== MONTH_NAMES[firstMonth - 1] ||
    normalize(row.cells[1]!.contentText) !== "" ||
    !isExpectedMonthTitle(row.cells[2]!.contentText, secondMonth)
  ) {
    throw invalidCalendarSemantics();
  }
}

function verifyWeekdayRow(
  row: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["rows"][number]
): void {
  const expected = [...WEEKDAY_HEADERS, "", ...WEEKDAY_HEADERS];
  if (
    row.tableDepth !== 1 ||
    row.cells.length !== expected.length ||
    row.cells.some(
      (cell, index) => normalize(cell.contentText) !== expected[index]
    )
  ) {
    throw invalidCalendarSemantics();
  }
}

function verifyDateGrid(
  rows: readonly VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["rows"][number][],
  year: number,
  month: number,
  cellOffset: 0 | 8
): void {
  const actual = rows.map((row) => {
    if (
      row.tableDepth !== 1 ||
      row.cells.length !== 15 ||
      normalize(row.cells[7]!.contentText) !== ""
    ) {
      throw invalidCalendarSemantics();
    }
    return Array.from({ length: 7 }, (_, weekday) =>
      normalize(row.cells[cellOffset + weekday]!.contentText)
    );
  });
  const folded = rows.length === 5
    ? createExpectedFiveRowFoldedDateGrid(year, month)
    : null;
  if (folded !== null && isDeepEqualGrid(actual, folded)) return;

  const unfolded = createExpectedUnfoldedDateGrid(year, month);
  const firstNonEmpty = actual.findIndex((row) => row.some((value) => value !== ""));
  let lastNonEmpty = -1;
  for (let index = actual.length - 1; index >= 0; index -= 1) {
    if (actual[index]!.some((value) => value !== "")) {
      lastNonEmpty = index;
      break;
    }
  }
  if (
    firstNonEmpty < 0 ||
    !isDeepEqualGrid(actual.slice(firstNonEmpty, lastNonEmpty + 1), unfolded)
  ) {
    throw invalidCalendarSemantics();
  }
}

function createExpectedFiveRowFoldedDateGrid(year: number, month: number): string[][] {
  const cells = Array.from({ length: 5 }, () =>
    Array.from({ length: 7 }, () => "")
  );
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= dayCount; day += 1) {
    const linearIndex = firstWeekday + day - 1;
    const rowIndex = Math.min(Math.floor(linearIndex / 7), 4);
    const weekday = linearIndex % 7;
    const previous = cells[rowIndex]![weekday]!;
    cells[rowIndex]![weekday] = previous === "" ? String(day) : `${previous}/${day}`;
  }
  return cells;
}

function createExpectedUnfoldedDateGrid(year: number, month: number): string[][] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Array.from(
    { length: Math.ceil((firstWeekday + dayCount) / 7) },
    () => Array.from({ length: 7 }, () => "")
  );
  for (let day = 1; day <= dayCount; day += 1) {
    const linearIndex = firstWeekday + day - 1;
    cells[Math.floor(linearIndex / 7)]![linearIndex % 7] = String(day);
  }
  return cells;
}

function isDeepEqualGrid(
  actual: readonly (readonly string[])[],
  expected: readonly (readonly string[])[]
): boolean {
  return actual.length === expected.length && actual.every(
    (row, rowIndex) =>
      row.length === expected[rowIndex]!.length &&
      row.every((value, columnIndex) => value === expected[rowIndex]![columnIndex])
  );
}

interface EventTextColumns {
  dayText: string;
  descriptionText: string;
}

function parseEventColumns(
  row: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["rows"][number]
): { left: EventTextColumns; right: EventTextColumns } {
  if (row.tableDepth !== 1) throw invalidCalendarSemantics();
  if (row.cells.length === 5) {
    if (normalize(row.cells[2]!.contentText) !== "") {
      throw invalidCalendarSemantics();
    }
    return {
      left: {
        dayText: row.cells[0]!.contentText,
        descriptionText: row.cells[1]!.contentText
      },
      right: {
        dayText: row.cells[3]!.contentText,
        descriptionText: row.cells[4]!.contentText
      }
    };
  }
  if (row.cells.length !== 4) throw invalidCalendarSemantics();
  if (normalize(row.cells[1]!.contentText) === "") {
    return {
      left: splitCombinedEventCell(row.cells[0]!.contentText),
      right: {
        dayText: row.cells[2]!.contentText,
        descriptionText: row.cells[3]!.contentText
      }
    };
  }
  if (normalize(row.cells[2]!.contentText) === "") {
    return {
      left: {
        dayText: row.cells[0]!.contentText,
        descriptionText: row.cells[1]!.contentText
      },
      right: splitCombinedEventCell(row.cells[3]!.contentText)
    };
  }
  throw invalidCalendarSemantics();
}

function splitCombinedEventCell(value: string): EventTextColumns {
  const match = normalize(value).match(
    /^((?:[1-9]|[12][0-9]|3[01])(?:\s*~\s*(?:[1-9]|[12][0-9]|3[01]))?)\s*([^0-9\s].*)$/
  );
  if (match === null) throw invalidCalendarSemantics();
  return { dayText: match[1]!, descriptionText: match[2]! };
}

function parseEvents(
  sourceRowIndex: number,
  month: number,
  dayText: string,
  descriptionText: string,
  year: number,
  index: number
): readonly VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[] {
  const normalizedDay = normalize(dayText);
  const description = normalize(descriptionText);
  if (normalizedDay === "" && description === "") return [];
  if (description === "") {
    throw invalidCalendarSemantics();
  }
  const days = parseEventDays(normalizedDay);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (days.some((day) => day > dayCount)) throw invalidCalendarSemantics();
  const isHoliday = description.startsWith("Holiday (");
  if (isHoliday && !/^Holiday \(.+\)$/.test(description)) {
    throw invalidCalendarSemantics();
  }
  return Object.freeze(days.map((day, dayIndex) => Object.freeze({
    index: index + dayIndex,
    sourceRowIndex,
    month,
    day,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    description,
    kind: isHoliday ? "holiday" : "derivatives_schedule"
  })));
}

function parseEventDays(value: string): readonly number[] {
  const single = value.match(/^(?:[1-9]|[12][0-9]|3[01])$/);
  if (single !== null) return [Number(value)];
  const range = value.match(
    /^([1-9]|[12][0-9]|3[01])\s*~\s*([1-9]|[12][0-9]|3[01])$/
  );
  if (range !== null) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= end) throw invalidCalendarSemantics();
    return Object.freeze(Array.from(
      { length: end - start + 1 },
      (_, offset) => start + offset
    ));
  }
  if (/^(?:[1-9]|[12][0-9]|3[01])(?:\s+(?:[1-9]|[12][0-9]|3[01]))+$/.test(value)) {
    const days = value.split(/\s+/u).map(Number);
    if (days.some((day, index) => index > 0 && day <= days[index - 1]!)) {
      throw invalidCalendarSemantics();
    }
    return Object.freeze(days);
  }
  throw invalidCalendarSemantics();
}

function isExpectedMonthTitle(value: string, month: number): boolean {
  const normalized = normalize(value);
  return normalized === MONTH_NAMES[month - 1] ||
    (month === 2 && normalized === "Febuary");
}

function createMonth(
  month: number,
  block: readonly VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["rows"][number][],
  dateRows: readonly VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows["rows"][number][],
  eventRowIndices: readonly number[],
  events: readonly VerifiedOfficialMarketCalendarKrxLegacyWordCalendarEvent[]
): VerifiedOfficialMarketCalendarKrxLegacyWordCalendarMonth {
  return Object.freeze({
    month,
    title: MONTH_NAMES[month - 1]!,
    titleRowIndex: block[0]!.index,
    weekdayRowIndex: block[1]!.index,
    dateGridRowIndices: Object.freeze(dateRows.map((row) => row.index)),
    eventRowIndices: Object.freeze([...eventRowIndices]),
    events: Object.freeze([...events])
  });
}

function normalize(value: string): string {
  return value.replace(/[\u0000-\u0020]+/g, " ").trim();
}

function parseTargetYear(value: string): number {
  if (!/^20\d{2}$/.test(value)) throw invalidCalendarSemantics();
  const year = Number(value);
  if (!Number.isSafeInteger(year)) throw invalidCalendarSemantics();
  return year;
}

function invalidCalendarSemantics(): OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError {
  return new OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_INVALID",
    "Official calendar KRX legacy Word calendar semantics are invalid."
  );
}
