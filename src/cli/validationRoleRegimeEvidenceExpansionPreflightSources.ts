import { readFile } from "node:fs/promises";

import {
  validateValidationRoleRegimeEvidenceExpansionInputBoundary,
  type ValidationRoleRegimeEvidenceExpansionInput
} from "../replay/validationRoleRegimeEvidenceExpansionInputBoundary.js";
import {
  verifyEvidenceExpansionPreflightBundle,
  type EvidenceExpansionPreflightBundleVerificationState
} from "../replay/validationRoleRegimeEvidenceExpansionPreflightBundleVerifier.js";

export async function readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle(
  inputPath: string
): Promise<EvidenceExpansionPreflightBundleVerificationState> {
  const input =
    await readValidationRoleRegimeEvidenceExpansionPreflightInput(
      inputPath
    );
  return verifyEvidenceExpansionPreflightBundle(input);
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
