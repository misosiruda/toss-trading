import { writeExclusiveJsonArtifact } from "./exclusiveJsonArtifactWriter.js";
import { validationSplitRegimeFeasibilityArtifactSchema } from "./validationSplitRegimeFeasibility.js";

export async function writeValidationSplitRegimeFeasibilityArtifact(input: {
  outputPath: string;
  artifact: unknown;
}): Promise<void> {
  const artifact = validationSplitRegimeFeasibilityArtifactSchema.parse(
    input.artifact
  );
  await writeExclusiveJsonArtifact({
    outputPath: input.outputPath,
    value: artifact
  });
}
