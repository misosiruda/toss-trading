import { writeExclusiveJsonArtifact } from "./exclusiveJsonArtifactWriter.js";
import { parseValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";

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
