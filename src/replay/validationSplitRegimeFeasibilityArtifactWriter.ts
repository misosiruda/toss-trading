import { randomUUID } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

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

  const firstCreatedDirectory = await mkdir(outputDirectory, {
    recursive: true
  });
  if (firstCreatedDirectory !== undefined) {
    await syncCreatedDirectoryChain(firstCreatedDirectory, outputDirectory);
  }
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
    } finally {
      await syncOutputDirectory(outputDirectory);
    }
  }
}

async function syncCreatedDirectoryChain(
  firstCreatedDirectory: string,
  outputDirectory: string
): Promise<void> {
  const [firstCreatedPath, outputPath] = await Promise.all([
    realpath(firstCreatedDirectory),
    realpath(outputDirectory)
  ]);
  const relativeOutputPath = relative(firstCreatedPath, outputPath);
  if (
    isAbsolute(relativeOutputPath) ||
    relativeOutputPath === ".." ||
    relativeOutputPath.startsWith(`..${sep}`)
  ) {
    throw new Error("created directory must be an ancestor of output directory");
  }
  const createdDirectories = [dirname(firstCreatedPath), firstCreatedPath];
  let currentPath = firstCreatedPath;

  for (const segment of relativeOutputPath.split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    createdDirectories.push(currentPath);
  }

  for (const directory of createdDirectories) {
    await syncOutputDirectory(directory);
  }
}

async function syncOutputDirectory(outputDirectory: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>>;
  try {
    directory = await open(outputDirectory, "r");
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySync(error)) {
      throw error;
    }
    return;
  }
  try {
    await directory.sync();
  } catch (error) {
    // Node on Windows opens directory handles but rejects fsync with EPERM.
    if (!isUnsupportedWindowsDirectorySync(error)) {
      throw error;
    }
  } finally {
    await directory.close();
  }
}

function isUnsupportedWindowsDirectorySync(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    isNodeError(error) &&
    error.code === "EPERM"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
