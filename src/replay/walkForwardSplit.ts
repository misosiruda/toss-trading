import {
  validationSplitAssignmentSchema,
  validationSplitSchema,
  type ValidationSplit,
  type ValidationSplitAssignment,
  type ValidationSplitRole
} from "./validationProtocol.js";

export interface WalkForwardSplitOptions {
  rangeStart: Date;
  rangeEnd: Date;
  trainMonths: number;
  validationMonths: number;
  testMonths?: number;
  stepMonths?: number;
  timezoneOffsetMinutes?: number;
  embargoDurationDays?: number;
}

export interface WalkForwardSplitPlan {
  validationProtocol: "walk_forward";
  rangeStart: string;
  rangeEnd: string;
  trainMonths: number;
  validationMonths: number;
  testMonths: number;
  stepMonths: number;
  timezoneOffsetMinutes: number;
  embargoDurationDays: number;
  splitCount: number;
  splits: ValidationSplit[];
}

interface LocalMonth {
  year: number;
  monthIndex: number;
}

interface LocalWindow {
  startMonth: LocalMonth;
  endExclusiveMonth: LocalMonth;
  startMs: number;
  endMs: number;
  localStartDate: string;
  localEndDate: string;
}

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 540;
const DEFAULT_TEST_MONTHS = 0;
const DEFAULT_EMBARGO_DURATION_DAYS = 0;

export function buildWalkForwardSplitPlan(
  options: WalkForwardSplitOptions
): WalkForwardSplitPlan {
  validateOptions(options);

  const testMonths = options.testMonths ?? DEFAULT_TEST_MONTHS;
  const stepMonths = options.stepMonths ?? options.validationMonths;
  const timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES;
  const embargoDurationDays =
    options.embargoDurationDays ?? DEFAULT_EMBARGO_DURATION_DAYS;
  const splits = generateWalkForwardSplits({
    ...options,
    testMonths,
    stepMonths,
    timezoneOffsetMinutes,
    embargoDurationDays
  });

  if (splits.length === 0) {
    throw new Error("No walk-forward split fits inside the configured range");
  }

  return {
    validationProtocol: "walk_forward",
    rangeStart: options.rangeStart.toISOString(),
    rangeEnd: options.rangeEnd.toISOString(),
    trainMonths: options.trainMonths,
    validationMonths: options.validationMonths,
    testMonths,
    stepMonths,
    timezoneOffsetMinutes,
    embargoDurationDays,
    splitCount: splits.length,
    splits
  };
}

export function walkForwardSplitAssignments(
  split: ValidationSplit
): ValidationSplitAssignment[] {
  const roles: ValidationSplitRole[] =
    split.testStart === null || split.testEnd === null
      ? ["train", "validation"]
      : ["train", "validation", "test"];

  return roles.map((splitRole) =>
    validationSplitAssignmentSchema.parse({
      ...split,
      splitRole
    })
  );
}

function generateWalkForwardSplits(
  options: Required<WalkForwardSplitOptions>
): ValidationSplit[] {
  const splits: ValidationSplit[] = [];
  const firstTrainStartMonth = localMonth(
    options.rangeStart,
    options.timezoneOffsetMinutes
  );
  const totalMonths =
    options.trainMonths + options.validationMonths + options.testMonths;

  for (
    let trainStartMonth = firstTrainStartMonth;
    true;
    trainStartMonth = addMonths(trainStartMonth, options.stepMonths)
  ) {
    const trainWindow = localWindow({
      startMonth: trainStartMonth,
      monthCount: options.trainMonths,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes
    });
    const validationWindow = localWindow({
      startMonth: trainWindow.endExclusiveMonth,
      monthCount: options.validationMonths,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes
    });
    const testWindow =
      options.testMonths === 0
        ? null
        : localWindow({
            startMonth: validationWindow.endExclusiveMonth,
            monthCount: options.testMonths,
            timezoneOffsetMinutes: options.timezoneOffsetMinutes
          });
    const splitEndMs = (testWindow ?? validationWindow).endMs;

    if (splitEndMs > options.rangeEnd.getTime()) {
      break;
    }

    if (trainWindow.startMs >= options.rangeStart.getTime()) {
      const split = validationSplitSchema.parse({
        validationProtocol: "walk_forward",
        splitId: buildSplitId({
          splitIndex: splits.length,
          trainWindow,
          validationWindow,
          testWindow
        }),
        splitIndex: splits.length,
        trainStart: new Date(trainWindow.startMs).toISOString(),
        trainEnd: new Date(trainWindow.endMs).toISOString(),
        validationStart: new Date(validationWindow.startMs).toISOString(),
        validationEnd: new Date(validationWindow.endMs).toISOString(),
        testStart:
          testWindow === null ? null : new Date(testWindow.startMs).toISOString(),
        testEnd:
          testWindow === null ? null : new Date(testWindow.endMs).toISOString(),
        purgeDurationDays: 0,
        embargoDurationDays: options.embargoDurationDays
      });
      splits.push(split);
    }

    const nextStart = addMonths(trainStartMonth, options.stepMonths);
    const nextEndExclusive = addMonths(nextStart, totalMonths);
    if (
      localMonthStartUtcMs(
        nextEndExclusive,
        options.timezoneOffsetMinutes
      ) -
        1 >
      options.rangeEnd.getTime()
    ) {
      break;
    }
  }

  return splits;
}

function buildSplitId(input: {
  splitIndex: number;
  trainWindow: LocalWindow;
  validationWindow: LocalWindow;
  testWindow: LocalWindow | null;
}): string {
  const index = String(input.splitIndex + 1).padStart(3, "0");
  const testSuffix =
    input.testWindow === null
      ? "no_test"
      : `test_${input.testWindow.localStartDate}_${input.testWindow.localEndDate}`;

  return [
    "wf",
    index,
    "train",
    input.trainWindow.localStartDate,
    input.trainWindow.localEndDate,
    "validation",
    input.validationWindow.localStartDate,
    input.validationWindow.localEndDate,
    testSuffix
  ].join("_");
}

function localWindow(input: {
  startMonth: LocalMonth;
  monthCount: number;
  timezoneOffsetMinutes: number;
}): LocalWindow {
  const endExclusiveMonth = addMonths(input.startMonth, input.monthCount);
  const startMs = localMonthStartUtcMs(
    input.startMonth,
    input.timezoneOffsetMinutes
  );
  const endMs =
    localMonthStartUtcMs(endExclusiveMonth, input.timezoneOffsetMinutes) - 1;

  return {
    startMonth: input.startMonth,
    endExclusiveMonth,
    startMs,
    endMs,
    localStartDate: formatLocalDate(
      input.startMonth.year,
      input.startMonth.monthIndex,
      1
    ),
    localEndDate: formatLocalEndDate(endExclusiveMonth)
  };
}

function validateOptions(options: WalkForwardSplitOptions): void {
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }
  validatePositiveInteger(options.trainMonths, "trainMonths");
  validatePositiveInteger(options.validationMonths, "validationMonths");
  validateNonNegativeInteger(
    options.testMonths ?? DEFAULT_TEST_MONTHS,
    "testMonths"
  );
  validatePositiveInteger(
    options.stepMonths ?? options.validationMonths,
    "stepMonths"
  );
  validateInteger(
    options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES,
    "timezoneOffsetMinutes"
  );
  validateNonNegativeInteger(
    options.embargoDurationDays ?? DEFAULT_EMBARGO_DURATION_DAYS,
    "embargoDurationDays"
  );
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validateInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
}

function localMonth(date: Date, timezoneOffsetMinutes: number): LocalMonth {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60_000);
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

function localMonthStartUtcMs(
  month: LocalMonth,
  timezoneOffsetMinutes: number
): number {
  return (
    Date.UTC(month.year, month.monthIndex, 1, 0, 0, 0, 0) -
    timezoneOffsetMinutes * 60_000
  );
}

function formatLocalEndDate(endExclusiveMonth: LocalMonth): string {
  const endDate = new Date(
    Date.UTC(endExclusiveMonth.year, endExclusiveMonth.monthIndex, 1) - 1
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

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
