import { readFileSync } from "node:fs";

import type {
  HistoricalDataAvailabilityCalendarOptions,
  HistoricalDataAvailabilityCalendarRule
} from "../replay/historicalDataAvailability.js";
import {
  parseMarketCalendarFixtures,
  type MarketCalendarTimezone
} from "../replay/marketCalendar.js";

export const CALENDAR_VALIDATION_VALUE_OPTION_NAMES = [
  "--calendar-fixtures-path",
  "--calendar-rule"
] as const;

export function readCalendarValidationOptionsFromArgs(
  args: readonly string[]
): HistoricalDataAvailabilityCalendarOptions | undefined {
  const fixturesPath = readCalendarFixturesPathArg(args);
  const rules = readCalendarRules(args);

  if (fixturesPath === undefined) {
    if (rules.length > 0) {
      throw new Error("--calendar-rule requires --calendar-fixtures-path");
    }
    return undefined;
  }
  if (fixturesPath.trim().length === 0) {
    throw new Error("--calendar-fixtures-path must not be empty");
  }
  if (rules.length === 0) {
    throw new Error(
      "--calendar-fixtures-path requires at least one --calendar-rule"
    );
  }

  return {
    fixtures: readCalendarFixtures(fixturesPath),
    rules
  };
}

function readCalendarFixturesPathArg(
  args: readonly string[]
): string | undefined {
  const index = args.indexOf("--calendar-fixtures-path");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--calendar-fixtures-path requires a value");
  }
  return value;
}

function readCalendarFixtures(path: string) {
  const raw = readFileSync(path, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("--calendar-fixtures-path must not be empty");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("--calendar-fixtures-path must contain fixture array");
    }
    return parseMarketCalendarFixtures(parsed);
  }

  const values = trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(
          `invalid calendar fixture JSONL at line ${index + 1}`
        );
      }
    });
  return parseMarketCalendarFixtures(values);
}

function readCalendarRules(
  args: readonly string[]
): HistoricalDataAvailabilityCalendarRule[] {
  return readArgValues(args, "--calendar-rule").map(parseCalendarRuleArg);
}

function parseCalendarRuleArg(
  value: string
): HistoricalDataAvailabilityCalendarRule {
  const [market, exchange, timezone, extra] = value.split(":");
  if (
    extra !== undefined ||
    (market !== "KR" && market !== "US") ||
    exchange === undefined ||
    exchange.trim().length === 0 ||
    timezone === undefined
  ) {
    throw new Error(
      "--calendar-rule must use MARKET:EXCHANGE:TIMEZONE format"
    );
  }
  return {
    market,
    exchange,
    timezone: parseMarketCalendarTimezoneArg(timezone)
  };
}

function parseMarketCalendarTimezoneArg(
  value: string
): MarketCalendarTimezone {
  if (value === "Asia/Seoul" || value === "America/New_York") {
    return value;
  }
  throw new Error(
    "--calendar-rule timezone must be Asia/Seoul or America/New_York"
  );
}

function readArgValues(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
  }
  return values;
}
