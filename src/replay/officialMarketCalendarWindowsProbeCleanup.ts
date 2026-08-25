import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const windowsProbeCleanupHelperPath = fileURLToPath(
  new URL(
    "../../scripts/windowsRemoveCalendarPublicationProbe.ps1",
    import.meta.url
  )
);

export async function cleanupOfficialMarketCalendarWindowsPublicationProbe(
  input: {
    publicationRoot: string;
    probeRoot: string;
  }
): Promise<boolean> {
  if (
    process.platform !== "win32" ||
    !isAbsolute(input.publicationRoot) ||
    !isAbsolute(input.probeRoot)
  ) {
    return false;
  }

  let publicationRoot: string;
  let probeRoot: string;
  try {
    publicationRoot = await realpath(input.publicationRoot);
    probeRoot = await realpath(input.probeRoot);
  } catch {
    return false;
  }
  if (
    dirname(probeRoot) !== publicationRoot ||
    !basename(probeRoot).startsWith(".calendar-publication-preflight-")
  ) {
    return false;
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
        windowsProbeCleanupHelperPath,
        publicationRoot,
        probeRoot
      ],
      {
        timeout: 10_000,
        maxBuffer: 16 * 1024,
        windowsHide: true
      }
    );
  } catch {
    return false;
  }

  try {
    await access(probeRoot);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
