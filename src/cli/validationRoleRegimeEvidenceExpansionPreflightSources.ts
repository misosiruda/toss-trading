import { readFile } from "node:fs/promises";

import {
  validateValidationRoleRegimeEvidenceExpansionInputBoundary,
  type ValidationRoleRegimeEvidenceExpansionInput
} from "../replay/validationRoleRegimeEvidenceExpansionInputBoundary.js";
import {
  verifyEvidenceExpansionPreflightBundle,
  type EvidenceExpansionPreflightBundleVerificationState,
  type VerifyEvidenceExpansionPreflightBundleOptions
} from "../replay/validationRoleRegimeEvidenceExpansionPreflightBundleVerifier.js";
import {
  writeValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "../replay/validationRoleRegimeEvidenceExpansionPreflightArtifactWriter.js";

export interface ReadVerifyAndWriteEvidenceExpansionPreflightOptions
  extends VerifyEvidenceExpansionPreflightBundleOptions {
  outputPath: string;
}

export async function readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
  inputPath: string,
  options: ReadVerifyAndWriteEvidenceExpansionPreflightOptions
): Promise<EvidenceExpansionPreflightBundleVerificationState> {
  assertExactReadVerifyAndWriteOptions(options);
  const state =
    await readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle(
      inputPath,
      { generatedAt: options.generatedAt }
    );
  await writeValidationRoleRegimeEvidenceExpansionPreflightArtifact({
    outputPath: options.outputPath,
    artifact: state.artifact
  });
  return state;
}

export async function readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle(
  inputPath: string,
  options: VerifyEvidenceExpansionPreflightBundleOptions
): Promise<EvidenceExpansionPreflightBundleVerificationState> {
  const input =
    await readValidationRoleRegimeEvidenceExpansionPreflightInput(
      inputPath
    );
  return verifyEvidenceExpansionPreflightBundle(input, options);
}

export async function readValidationRoleRegimeEvidenceExpansionPreflightInput(
  inputPath: string
): Promise<ValidationRoleRegimeEvidenceExpansionInput> {
  if (inputPath.trim().length === 0) {
    throw new Error("evidence expansion preflight input path must not be empty");
  }
  const source = await readJsonFile(inputPath);
  const boundary =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(source);
  if (boundary.status === "invalid") {
    throw new Error(
      `evidence expansion preflight input rejected: ${boundary.forbiddenPaths.join(", ")}`
    );
  }
  return boundary.input;
}

async function readJsonFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(
      "evidence expansion preflight input must contain valid JSON"
    );
  }
}

function assertExactReadVerifyAndWriteOptions(
  options: ReadVerifyAndWriteEvidenceExpansionPreflightOptions
): void {
  const actual = Object.keys(options).sort();
  const expected = ["generatedAt", "outputPath"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight read-verify-write options contain unknown fields"
    );
  }
}
