import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { validationSplitRegimeFeasibilityArtifactSchema } from "./validationSplitRegimeFeasibility.js";

export async function writeValidationSplitRegimeFeasibilityArtifact(input: {
  outputPath: string;
  artifact: unknown;
}): Promise<void> {
  const artifact = validationSplitRegimeFeasibilityArtifactSchema.parse(
    input.artifact
  );
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const outputDirectory = dirname(input.outputPath);
  const temporaryPath = join(
    outputDirectory,
    `.${basename(input.outputPath)}.${randomUUID()}.tmp`
  );

  await mkdir(outputDirectory, { recursive: true });
  const temporaryFile = await open(temporaryPath, "wx");
  try {
    try {
      await temporaryFile.writeFile(serialized, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }
    await link(temporaryPath, input.outputPath);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
