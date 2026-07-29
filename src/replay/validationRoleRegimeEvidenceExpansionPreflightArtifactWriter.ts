import {
  buildEvidenceExpansionPreflightArtifact,
  type EvidenceExpansionPreflightArtifactBuilderInput
} from "./validationRoleRegimeEvidenceExpansionPreflightArtifactBuilder.js";
import type {
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import { writeExclusiveJsonArtifact } from "./exclusiveJsonArtifactWriter.js";
import { parseValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";

export interface BuildAndWriteEvidenceExpansionPreflightArtifactInput
  extends EvidenceExpansionPreflightArtifactBuilderInput {
  outputPath: string;
}

export async function buildAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
  input: BuildAndWriteEvidenceExpansionPreflightArtifactInput
): Promise<ValidationRoleRegimeEvidenceExpansionPreflightArtifact> {
  assertExactBuildAndWriteInputKeys(input);
  const artifact = buildEvidenceExpansionPreflightArtifact({
    baselineIdentity: input.baselineIdentity,
    expansion: input.expansion,
    calendarClassifier: input.calendarClassifier,
    roleRegimeSampleMinimum: input.roleRegimeSampleMinimum,
    generatedAt: input.generatedAt
  });
  await writeValidationRoleRegimeEvidenceExpansionPreflightArtifact({
    outputPath: input.outputPath,
    artifact
  });
  return artifact;
}

export async function writeValidationRoleRegimeEvidenceExpansionPreflightArtifact(
  input: {
    outputPath: string;
    artifact: unknown;
  }
): Promise<void> {
  const artifact =
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      input.artifact
    );
  await writeExclusiveJsonArtifact({
    outputPath: input.outputPath,
    value: artifact
  });
}

function assertExactBuildAndWriteInputKeys(
  input: BuildAndWriteEvidenceExpansionPreflightArtifactInput
): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "baselineIdentity",
    "calendarClassifier",
    "expansion",
    "generatedAt",
    "outputPath",
    "roleRegimeSampleMinimum"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight build-and-write input contains unknown fields"
    );
  }
}
