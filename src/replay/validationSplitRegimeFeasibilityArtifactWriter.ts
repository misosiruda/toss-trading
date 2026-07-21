import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { validationSplitRegimeFeasibilityArtifactSchema } from "./validationSplitRegimeFeasibility.js";

export async function writeValidationSplitRegimeFeasibilityArtifact(input: {
  outputPath: string;
  artifact: unknown;
}): Promise<void> {
  const artifact = validationSplitRegimeFeasibilityArtifactSchema.parse(
    input.artifact
  );

  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(
    input.outputPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx"
    }
  );
}
