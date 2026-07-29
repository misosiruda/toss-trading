import { readFile } from "node:fs/promises";

import {
  parseValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "../replay/validationRoleRegimeEvidenceExpansionPreflightHash.js";

const ARTIFACT_PATH_OPTION = "--artifact-path";
const args = process.argv.slice(2);
validateArgs(args);

const artifactPath = readRequiredArtifactPath();
const source = await readFile(artifactPath, "utf8");
const artifact =
  parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
    JSON.parse(source)
  );
console.log(JSON.stringify(artifact, null, 2));

function validateArgs(values: readonly string[]): void {
  if (values.length !== 2) {
    throw new Error(`${ARTIFACT_PATH_OPTION} is required exactly once`);
  }
  if (values[0] !== ARTIFACT_PATH_OPTION) {
    throw new Error(`unsupported option: ${values[0] ?? ""}`);
  }
  if (values[1] === undefined || values[1].startsWith("--")) {
    throw new Error(`${ARTIFACT_PATH_OPTION} requires a value`);
  }
}

function readRequiredArtifactPath(): string {
  const value = args[1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${ARTIFACT_PATH_OPTION} is required`);
  }
  return value;
}
