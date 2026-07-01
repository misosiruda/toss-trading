import { readFileSync } from "node:fs";

import type { HistoricalDataAvailabilityFxOptions } from "../replay/historicalDataAvailability.js";
import { parseFxRateSnapshotFixtures } from "../replay/fxSnapshotFreshness.js";
import type { Market } from "../domain/schemas.js";

export const FX_VALIDATION_VALUE_OPTION_NAMES = [
  "--fx-fixtures-path",
  "--fx-required-market"
] as const;

export function readFxValidationOptionsFromArgs(
  args: readonly string[]
): HistoricalDataAvailabilityFxOptions | undefined {
  const fixturesPath = readFxFixturesPathArg(args);
  const requiredMarkets = readFxRequiredMarkets(args);

  if (fixturesPath === undefined) {
    if (requiredMarkets.length > 0) {
      throw new Error("--fx-required-market requires --fx-fixtures-path");
    }
    return undefined;
  }
  if (fixturesPath.trim().length === 0) {
    throw new Error("--fx-fixtures-path must not be empty");
  }

  return {
    fixtures: readFxFixtures(fixturesPath),
    ...(requiredMarkets.length === 0 ? {} : { requiredMarkets })
  };
}

function readFxFixturesPathArg(args: readonly string[]): string | undefined {
  const index = args.indexOf("--fx-fixtures-path");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--fx-fixtures-path requires a value");
  }
  return value;
}

function readFxFixtures(path: string) {
  const raw = readFileSync(path, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("--fx-fixtures-path must not be empty");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("--fx-fixtures-path must contain fixture array");
    }
    return parseFxRateSnapshotFixtures(parsed);
  }

  const values = trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`invalid FX fixture JSONL at line ${index + 1}`);
      }
    });
  return parseFxRateSnapshotFixtures(values);
}

function readFxRequiredMarkets(args: readonly string[]): Market[] {
  return readArgValues(args, "--fx-required-market").map(
    parseFxRequiredMarketArg
  );
}

function parseFxRequiredMarketArg(value: string): Market {
  if (value === "KR" || value === "US") {
    return value;
  }
  throw new Error("--fx-required-market must be KR or US");
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
