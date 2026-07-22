import "../config/loadEnv.js";

import {
  readValidationSplitRegimeFeasibilityArtifact,
  readValidationSplitRegimeFeasibilitySources
} from "./validationSplitRegimeFeasibilitySources.js";
import {
  buildValidationRoleRegimeReplayPlan,
  VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION
} from "../replay/validationRoleRegimeReplayPlan.js";
import { writeValidationRoleRegimeReplayPlanArtifact } from "../replay/validationRoleRegimeReplayPlanArtifactWriter.js";
import { verifyValidationRoleRegimeReplayPlanSources } from "../replay/validationRoleRegimeReplayPlanSourceVerifier.js";

const SINGLE_VALUE_OPTIONS = [
  "--feasibility-path",
  "--source-data-dir",
  "--universe-path",
  "--coverage-path",
  "--validation-splits-path",
  "--calendar-fixtures-path",
  "--selection-policy",
  "--calendar-evidence-class",
  "--output-path"
] as const;
const ALLOWED_OPTIONS = new Set<string>(SINGLE_VALUE_OPTIONS);
const args = process.argv.slice(2);
validateArgs(args);

const feasibilityPath = readRequiredArgValue("--feasibility-path");
const sourceDataDir = readRequiredArgValue("--source-data-dir");
const universePath = readRequiredArgValue("--universe-path");
const coveragePath = readRequiredArgValue("--coverage-path");
const validationSplitsPath = readRequiredArgValue("--validation-splits-path");
const calendarFixturesPath = readRequiredArgValue("--calendar-fixtures-path");
const outputPath = readRequiredArgValue("--output-path");
readSelectionPolicy();
const calendarEvidenceClass = readCalendarEvidenceClass();

const [feasibilityArtifact, sources] = await Promise.all([
  readValidationSplitRegimeFeasibilityArtifact(feasibilityPath),
  readValidationSplitRegimeFeasibilitySources({
    sourceDataDir,
    universePath,
    coveragePath,
    validationSplitsPath,
    calendarFixturesPath
  })
]);
const verifiedFeasibility = verifyValidationRoleRegimeReplayPlanSources({
  feasibilityArtifact,
  assignments: sources.assignments,
  snapshots: sources.snapshots,
  universe: sources.universeSource,
  coverage: sources.coverage,
  validationSplit: sources.validationSplit,
  calendarFixtures: sources.calendarFixtures
});
const plan = buildValidationRoleRegimeReplayPlan({
  feasibilityArtifact: verifiedFeasibility,
  validationAssignments: sources.assignments,
  calendarEvidenceClass
});
await writeValidationRoleRegimeReplayPlanArtifact({ outputPath, plan });
console.log(JSON.stringify(plan, null, 2));

function validateArgs(values: readonly string[]): void {
  const seen = new Set<string>();
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
    if (seen.has(option)) {
      throw new Error(`${option} must not be repeated`);
    }
    seen.add(option);
  }
}

function readRequiredArgValue(name: (typeof SINGLE_VALUE_OPTIONS)[number]): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readSelectionPolicy(): void {
  if (
    readRequiredArgValue("--selection-policy") !==
    VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION
  ) {
    throw new Error(
      `--selection-policy must be ${VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION}`
    );
  }
}

function readCalendarEvidenceClass(): "observed_session_only" {
  if (
    readRequiredArgValue("--calendar-evidence-class") !==
    "observed_session_only"
  ) {
    throw new Error(
      "--calendar-evidence-class must be observed_session_only"
    );
  }
  return "observed_session_only";
}
