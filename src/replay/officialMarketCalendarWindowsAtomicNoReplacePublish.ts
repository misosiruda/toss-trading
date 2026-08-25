import { execFile } from "node:child_process";
import { access, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const windowsAtomicMoveHelperPath = fileURLToPath(
  new URL("../../scripts/windowsAtomicNoReplaceMove.ps1", import.meta.url)
);
const windowsDestinationExistsErrorCodes = new Set([80, 183]);

export type OfficialMarketCalendarAtomicPublishEntryKind =
  | "file"
  | "directory";

export async function publishOfficialMarketCalendarEntryAtomicNoReplace(
  input: {
    sourcePath: string;
    destinationPath: string;
    entryKind: OfficialMarketCalendarAtomicPublishEntryKind;
  }
): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(
      "official calendar Windows atomic publish is unsupported on this platform"
    );
  }
  if (!isAbsolute(input.sourcePath) || !isAbsolute(input.destinationPath)) {
    throw new Error("official calendar atomic publish paths must be absolute");
  }

  const sourceParent = await realpath(dirname(input.sourcePath));
  const destinationParent = await realpath(dirname(input.destinationPath));
  if (sourceParent !== destinationParent) {
    throw new Error(
      "official calendar atomic publish paths must share one real parent"
    );
  }
  const sourceStats = await lstat(input.sourcePath);
  if (
    (input.entryKind === "file" && !sourceStats.isFile()) ||
    (input.entryKind === "directory" && !sourceStats.isDirectory())
  ) {
    throw new Error(
      `official calendar atomic publish source must be a ${input.entryKind}`
    );
  }

  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        windowsAtomicMoveHelperPath,
        input.sourcePath,
        input.destinationPath
      ],
      {
        timeout: 10_000,
        maxBuffer: 16 * 1024,
        windowsHide: true
      }
    );
  } catch (error) {
    const windowsErrorCode = readWindowsMoveErrorCode(error);
    if (
      windowsErrorCode !== null &&
      windowsDestinationExistsErrorCodes.has(windowsErrorCode)
    ) {
      const collision = new Error(
        "official calendar atomic publish destination already exists"
      ) as NodeJS.ErrnoException;
      collision.code = "EEXIST";
      throw collision;
    }
    throw new Error(
      windowsErrorCode === null
        ? "official calendar Windows atomic publish helper failed"
        : `official calendar Windows atomic publish helper failed with Win32 error ${windowsErrorCode}`,
      { cause: error }
    );
  }

  const destinationStats = await lstat(input.destinationPath);
  if (
    (input.entryKind === "file" && !destinationStats.isFile()) ||
    (input.entryKind === "directory" && !destinationStats.isDirectory())
  ) {
    throw new Error(
      "official calendar atomic publish destination type does not match source"
    );
  }
  try {
    await access(input.sourcePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(
    "official calendar atomic publish source remained visible after move"
  );
}

function readWindowsMoveErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("stderr" in error)) {
    return null;
  }
  const stderr = String(error.stderr);
  const match = stderr.match(/MOVEFILEEX_ERROR:(\d+)/);
  if (match?.[1] === undefined) {
    return null;
  }
  const code = Number(match[1]);
  return Number.isSafeInteger(code) ? code : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
