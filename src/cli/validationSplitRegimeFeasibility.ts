import "../config/loadEnv.js";

import { readCalendarValidationRulesFromArgs } from "./calendarValidationArgs.js";
import { readValidationSplitRegimeFeasibilitySources } from "./validationSplitRegimeFeasibilitySources.js";
import {
  buildValidationSplitRegimeFeasibilityArtifact,
  feasibilityTargetRegimeSchema
} from "../replay/validationSplitRegimeFeasibility.js";
import { writeValidationSplitRegimeFeasibilityArtifact } from "../replay/validationSplitRegimeFeasibilityArtifactWriter.js";

const SINGLE_VALUE_OPTIONS = [
  "--source-data-dir",
  "--universe-path",
  "--coverage-path",
  "--validation-splits-path",
  "--calendar-fixtures-path",
  "--candidate-strategy-bucket",
  "--window-months",
  "--timezone-offset-minutes",
  "--target-regimes",
  "--min-candidates-per-role-regime",
  "--output-path"
] as const;
const REPEATABLE_VALUE_OPTIONS = ["--calendar-rule"] as const;
const ALLOWED_OPTIONS = new Set<string>([
  ...SINGLE_VALUE_OPTIONS,
  ...REPEATABLE_VALUE_OPTIONS
]);

const args = process.argv.slice(2);
validateArgs(args);

const sourceDataDir = readRequiredArgValue("--source-data-dir");
const universePath = readRequiredArgValue("--universe-path");
const coveragePath = readRequiredArgValue("--coverage-path");
const validationSplitsPath = readRequiredArgValue("--validation-splits-path");
const calendarFixturesPath = readRequiredArgValue("--calendar-fixtures-path");
const outputPath = readRequiredArgValue("--output-path");
const candidateStrategyBucket = readCandidateStrategyBucket();
const windowMonths = readPositiveIntegerArg("--window-months");
const timezoneOffsetMinutes = readIntegerArg("--timezone-offset-minutes");
const targetRegimes = readTargetRegimes();
const minimumCandidatesPerRoleRegime = readPositiveIntegerArg(
  "--min-candidates-per-role-regime"
);
const calendarRules = readCalendarValidationRulesFromArgs(args);
if (calendarRules.length === 0) {
  throw new Error("at least one --calendar-rule is required");
}

const sources = await readValidationSplitRegimeFeasibilitySources({
  sourceDataDir,
  universePath,
  coveragePath,
  validationSplitsPath,
  calendarFixturesPath
});
const artifact = buildValidationSplitRegimeFeasibilityArtifact({
  assignments: sources.assignments,
  snapshots: sources.snapshots,
  universe: sources.universeSource,
  coverage: sources.coverage,
  validationSplit: sources.validationSplit,
  calendarValidation: {
    rules: calendarRules,
    fixtures: sources.calendarFixtures
  },
  windowMonths,
  timezoneOffsetMinutes,
  targetRegimes,
  candidateStrategyBucket,
  minimumCandidatesPerRoleRegime
});

await writeValidationSplitRegimeFeasibilityArtifact({
  outputPath,
  artifact
});
console.log(JSON.stringify(artifact, null, 2));
process.exitCode = artifact.status === "available" ? 0 : 1;

function validateArgs(values: readonly string[]): void {
  const seenSingleOptions = new Set<string>();
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    if (option === undefined || !option.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${option ?? ""}`);
    }
    if (!ALLOWED_OPTIONS.has(option)) {
      throw new Error(`unsupported option: ${option}`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${option} requires a value`);
    }
    if (
      SINGLE_VALUE_OPTIONS.includes(
        option as (typeof SINGLE_VALUE_OPTIONS)[number]
      )
    ) {
      if (seenSingleOptions.has(option)) {
        throw new Error(`${option} must not be repeated`);
      }
      seenSingleOptions.add(option);
    }
  }
}

function readRequiredArgValue(name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readIntegerArg(name: string): number {
  const raw = readRequiredArgValue(name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function readPositiveIntegerArg(name: string): number {
  const parsed = readIntegerArg(name);
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readCandidateStrategyBucket(): "short_term" {
  const value = readRequiredArgValue("--candidate-strategy-bucket");
  if (value !== "short_term") {
    throw new Error("--candidate-strategy-bucket must be short_term");
  }
  return value;
}

function readTargetRegimes() {
  const values = readRequiredArgValue("--target-regimes")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => feasibilityTargetRegimeSchema.parse(value));
  if (values.length === 0) {
    throw new Error("--target-regimes must not be empty");
  }
  if (new Set(values).size !== values.length) {
    throw new Error("--target-regimes must not contain duplicates");
  }
  return values;
}
