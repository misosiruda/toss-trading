import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError,
  verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics
} from "./officialMarketCalendarKrxLegacyWordCalendarSemantics.js";
import type {
  VerifiedOfficialMarketCalendarKrxLegacyWordSourceCell,
  VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow
} from "./officialMarketCalendarKrxLegacyWordSourceRows.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

test("official calendar KRX legacy Word calendar semantics verify two-month blocks and events", () => {
  const result = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    buildSourceRows(),
    "2013"
  );

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_SCHEMA_VERSION
  );
  assert.equal(result.months.length, 12);
  assert.equal(result.events.length, 12);
  assert.equal(result.holidayCount, 6);
  assert.equal(result.derivativesScheduleCount, 6);
  assert.deepEqual(result.events.slice(0, 2).map((event) => ({
    date: event.date,
    kind: event.kind
  })), [
    { date: "2013-01-01", kind: "holiday" },
    { date: "2013-02-02", kind: "derivatives_schedule" }
  ]);
  assert.equal(
    result.dateGridStatus,
    "gregorian_five_or_six_row_layout_verified"
  );
  assert.equal(
    result.columnSemanticsStatus,
    "calendar_grid_and_event_columns_verified"
  );
  assert.equal(result.holidaySemanticsStatus, "classified_not_accepted");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
});

test("official calendar KRX legacy Word calendar semantics reject malformed headers, grids, and events", () => {
  const invalidFixtures = [
    new Map([["1:0", "MON"]]),
    new Map([["20:0", "24"]]),
    new Map([["7:1", ""]]),
    new Map([["7:1", "Holiday (New Year"]]),
    new Map([["7:0", "10~8"]]),
    new Map([["7:0", "10 10"]])
  ];
  for (const overrides of invalidFixtures) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
          buildSourceRows(overrides),
          "2013"
        ),
      (error: unknown) =>
        error instanceof
          OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError &&
        error.code ===
          "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CALENDAR_SEMANTICS_INVALID"
    );
  }
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
      replaceRowValues(buildSourceRows(), 7, ["1", "description", "2", "description"]),
      "2013"
    ),
    OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError
  );
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
      replaceRowValues(buildSourceRows(), 7, [
        "12Derivative schedule", "", "2", "description"
      ]),
      "2013"
    ),
    OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError
  );
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
      replaceRowValues(buildSourceRows(), 7, [
        "1 3-year KTB schedule", "", "2", "description"
      ]),
      "2013"
    ),
    OfficialMarketCalendarKrxLegacyWordCalendarSemanticsError
  );
});

test("official calendar KRX legacy Word calendar semantics accept observed legacy event layouts", () => {
  const rangeResult = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    buildSourceRows(new Map([
    ["0:2", "Febuary"],
    ["7:0", "8~10"]
    ])),
    "2013"
  );
  assert.deepEqual(
    rangeResult.months[0]!.events.slice(0, 3).map((event) => event.day),
    [8, 9, 10]
  );

  const listResult = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    buildSourceRows(new Map([["7:0", "10 11"]])),
    "2013"
  );
  assert.deepEqual(
    listResult.months[0]!.events.slice(0, 2).map((event) => event.day),
    [10, 11]
  );

  const combinedLeftResult = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    replaceRowValues(buildSourceRows(), 7, [
      "12 Derivative schedule", "", "2", "Derivative schedule"
    ]),
    "2013"
  );
  assert.equal(combinedLeftResult.months[0]!.events[0]!.day, 12);

  const combinedRightResult = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    replaceRowValues(buildSourceRows(), 7, [
      "1", "Holiday (January holiday)", "", "3 Derivative schedule"
    ]),
    "2013"
  );
  assert.deepEqual(
    combinedRightResult.months[1]!.events.map((event) => event.day),
    [3]
  );

  const rightOnlyCombinedResult = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    replaceRowValues(buildSourceRows(), 7, [
      "", "", "", "3 Derivative schedule"
    ]),
    "2013"
  );
  assert.deepEqual(
    rightOnlyCombinedResult.months[1]!.events.map((event) => event.day),
    [3]
  );
});

test("official calendar KRX legacy Word calendar semantics accept padded six-row grids", () => {
  const result = verifyOfficialMarketCalendarKrxLegacyWordCalendarSemantics(
    insertRowValues(
      buildSourceRows(),
      7,
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]
    ),
    "2013"
  );

  assert.equal(result.months[0]!.dateGridRowIndices.length, 6);
  assert.equal(result.months[1]!.dateGridRowIndices.length, 6);
});

function buildSourceRows(
  overrides: ReadonlyMap<string, string> = new Map()
): {
  nFib: 0x0112;
  tableStreamName: "1Table";
  rows: readonly VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow[];
} {
  const rows: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow[] = [];
  for (let pairIndex = 0; pairIndex < 6; pairIndex += 1) {
    const firstMonth = pairIndex * 2 + 1;
    const secondMonth = firstMonth + 1;
    appendRow(rows, [MONTH_NAMES[firstMonth - 1]!, "", MONTH_NAMES[secondMonth - 1]!], overrides);
    appendRow(rows, [...WEEKDAYS, "", ...WEEKDAYS], overrides);
    const firstGrid = buildDateGrid(2013, firstMonth);
    const secondGrid = buildDateGrid(2013, secondMonth);
    for (let week = 0; week < 5; week += 1) {
      appendRow(rows, [...firstGrid[week]!, "", ...secondGrid[week]!], overrides);
    }
    appendRow(
      rows,
      ["1", `Holiday (${MONTH_NAMES[firstMonth - 1]} holiday)`, "", "2", "Derivative schedule"],
      overrides
    );
  }
  return { nFib: 0x0112, tableStreamName: "1Table", rows };
}

function buildDateGrid(year: number, month: number): string[][] {
  const grid = Array.from({ length: 5 }, () =>
    Array.from({ length: 7 }, () => "")
  );
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= dayCount; day += 1) {
    const linear = firstWeekday + day - 1;
    const row = Math.min(Math.floor(linear / 7), 4);
    const weekday = linear % 7;
    const previous = grid[row]![weekday]!;
    grid[row]![weekday] = previous === "" ? String(day) : `${previous}/${day}`;
  }
  return grid;
}

function appendRow(
  rows: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow[],
  values: readonly string[],
  overrides: ReadonlyMap<string, string>
): void {
  const rowIndex = rows.length;
  const cells = values.map((value, cellIndex) =>
    createCell(cellIndex, overrides.get(`${rowIndex}:${cellIndex}`) ?? value)
  );
  rows.push({
    index: rowIndex,
    tableDepth: 1,
    cpStart: rowIndex * 100,
    cpEnd: rowIndex * 100 + values.length,
    cells: Object.freeze(cells),
    rowTerminatorParagraphIndex: rowIndex,
    rowTerminatorRole: "depth_1_ttp_mark"
  });
}

function replaceRowValues(
  sourceRows: ReturnType<typeof buildSourceRows>,
  rowIndex: number,
  values: readonly string[]
): ReturnType<typeof buildSourceRows> {
  return {
    ...sourceRows,
    rows: Object.freeze(sourceRows.rows.map((row) =>
      row.index === rowIndex
        ? {
            ...row,
            cells: Object.freeze(values.map((value, index) =>
              createCell(index, value)
            ))
          }
        : row
    ))
  };
}

function insertRowValues(
  sourceRows: ReturnType<typeof buildSourceRows>,
  rowIndex: number,
  values: readonly string[]
): ReturnType<typeof buildSourceRows> {
  const inserted: VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow = {
    ...sourceRows.rows[rowIndex - 1]!,
    cells: Object.freeze(values.map((value, index) => createCell(index, value)))
  };
  return {
    ...sourceRows,
    rows: Object.freeze([
      ...sourceRows.rows.slice(0, rowIndex),
      inserted,
      ...sourceRows.rows.slice(rowIndex)
    ].map((row, index) => ({
      ...row,
      index,
      cpStart: index * 100,
      cpEnd: index * 100 + row.cells.length,
      rowTerminatorParagraphIndex: index
    })))
  };
}

function createCell(
  index: number,
  contentText: string
): VerifiedOfficialMarketCalendarKrxLegacyWordSourceCell {
  return {
    index,
    cpStart: index,
    cpEnd: index + 1,
    contentCpEnd: index,
    paragraphIndices: [index],
    terminalParagraphIndex: index,
    terminalRole: "depth_1_cell_mark",
    rawText: `${contentText}\u0007`,
    contentText
  };
}
