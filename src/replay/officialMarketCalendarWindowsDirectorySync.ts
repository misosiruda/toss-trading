import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const windowsDirectorySyncHelperPath = fileURLToPath(
  new URL(
    "../../scripts/windowsSyncCalendarPublicationDirectoryChain.ps1",
    import.meta.url
  )
);

export async function syncOfficialMarketCalendarWindowsPublicationDirectoryChain(
  input: {
    publicationRoot: string;
    leafDirectory: string;
    inclusiveAncestorDirectory: string;
  }
): Promise<boolean> {
  if (
    process.platform !== "win32" ||
    !isAbsolute(input.publicationRoot) ||
    !isAbsolute(input.leafDirectory) ||
    !isAbsolute(input.inclusiveAncestorDirectory)
  ) {
    return false;
  }

  let publicationRoot: string;
  let leafDirectory: string;
  let ancestorDirectory: string;
  try {
    [publicationRoot, leafDirectory, ancestorDirectory] = await Promise.all([
      realpath(input.publicationRoot),
      realpath(input.leafDirectory),
      realpath(input.inclusiveAncestorDirectory)
    ]);
  } catch {
    return false;
  }
  if (
    !isWithinRoot(publicationRoot, leafDirectory) ||
    !isWithinRoot(publicationRoot, ancestorDirectory)
  ) {
    return false;
  }

  const chainLength = countInclusiveAncestorChain(
    leafDirectory,
    ancestorDirectory
  );
  if (chainLength === null) return false;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        windowsDirectorySyncHelperPath,
        publicationRoot,
        leafDirectory,
        ancestorDirectory
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 16 * 1024,
        windowsHide: true
      }
    );
    return stdout
      .split(/\r?\n/u)
      .includes(`DIRECTORY_SYNC_VERIFIED:${chainLength}`);
  } catch {
    return false;
  }
}

function isWithinRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function countInclusiveAncestorChain(
  leafDirectory: string,
  ancestorDirectory: string
): number | null {
  let current = leafDirectory;
  let count = 1;
  while (!sameWindowsPath(current, ancestorDirectory)) {
    const parent = dirname(current);
    if (sameWindowsPath(parent, current)) return null;
    current = parent;
    count += 1;
  }
  return count;
}

function sameWindowsPath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
