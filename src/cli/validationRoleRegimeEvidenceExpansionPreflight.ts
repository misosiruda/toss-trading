import "../config/loadEnv.js";

import {
  readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflightSources.js";

const SINGLE_VALUE_OPTIONS = [
  "--input-path",
  "--generated-at",
  "--output-path"
] as const;
const ALLOWED_OPTIONS = new Set<string>(SINGLE_VALUE_OPTIONS);
const args = process.argv.slice(2);
validateArgs(args);

const inputPath = readRequiredArgValue("--input-path");
const generatedAt = readRequiredArgValue("--generated-at");
const outputPath = readRequiredArgValue("--output-path");
const state =
  await readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
    inputPath,
    { generatedAt, outputPath }
  );
console.log(JSON.stringify(state.artifact, null, 2));

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

function readRequiredArgValue(
  name: (typeof SINGLE_VALUE_OPTIONS)[number]
): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
