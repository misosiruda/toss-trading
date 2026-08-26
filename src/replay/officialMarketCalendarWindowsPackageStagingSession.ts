import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const windowsPackageStagingSessionHelperPath = fileURLToPath(
  new URL(
    "../../scripts/windowsCalendarPublicationPackageStagingSession.ps1",
    import.meta.url
  )
);

export interface OfficialMarketCalendarWindowsPackageStagingSession {
  readonly stagingRoot: string;
  release(): Promise<boolean>;
  complete(): Promise<boolean>;
  cleanup(sourceFileNames: readonly string[]): Promise<boolean>;
}

export async function createOfficialMarketCalendarWindowsPackageStagingSession(
  input: {
    publicationRoot: string;
    packageNamespace: string;
    stagingRoot: string;
  }
): Promise<OfficialMarketCalendarWindowsPackageStagingSession> {
  if (
    process.platform !== "win32" ||
    !isAbsolute(input.publicationRoot) ||
    !isAbsolute(input.packageNamespace) ||
    !isAbsolute(input.stagingRoot)
  ) {
    throw new Error(
      "official calendar Windows package staging session requires absolute win32 paths"
    );
  }

  const [publicationRoot, packageNamespace, stagingParent] = await Promise.all([
    realpath(input.publicationRoot),
    realpath(input.packageNamespace),
    realpath(dirname(input.stagingRoot))
  ]);
  const stagingRoot = input.stagingRoot;
  const stagingName = basename(stagingRoot);
  if (
    dirname(packageNamespace) !== publicationRoot ||
    basename(packageNamespace) !== "sha256" ||
    stagingParent !== packageNamespace ||
    !/^\.calendar-package-[a-f0-9]{64}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.staging$/u.test(
      stagingName
    )
  ) {
    throw new Error(
      "official calendar package staging session path identity mismatch"
    );
  }

  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      windowsPackageStagingSessionHelperPath,
      publicationRoot,
      packageNamespace,
      stagingRoot
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let ready = false;
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    await waitForReady();
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  }

  let state: "active" | "released" | "finalized" = "active";
  let releasePromise: Promise<boolean> | undefined;
  let finalizationPromise: Promise<boolean> | undefined;
  return Object.freeze({
    stagingRoot,
    release(): Promise<boolean> {
      if (state === "released") return Promise.resolve(true);
      if (state !== "active") return Promise.resolve(false);
      releasePromise ??= releaseHandles();
      return releasePromise;
    },
    complete(): Promise<boolean> {
      if (state !== "released") return Promise.resolve(false);
      finalizationPromise ??= finish("complete", []);
      return finalizationPromise;
    },
    cleanup(sourceFileNames: readonly string[]): Promise<boolean> {
      const parsedNames = parseSourceFileNames(sourceFileNames);
      if (state === "finalized") return Promise.resolve(false);
      finalizationPromise ??= finish("cleanup", parsedNames);
      return finalizationPromise;
    }
  });

  async function waitForReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const expectedLine = `PACKAGE_STAGING_READY:${stagingRoot}`;
      const timeout = setTimeout(() => {
        reject(new Error("official calendar package staging session timed out"));
      }, 10_000);
      const inspectOutput = () => {
        if (stdout.split(/\r?\n/u).includes(expectedLine)) {
          ready = true;
          clearTimeout(timeout);
          resolve();
        }
      };
      child.stdout.on("data", inspectOutput);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        if (!ready) {
          clearTimeout(timeout);
          reject(
            new Error(
              `official calendar package staging session exited before ready (${code}): ${stderr.trim()}`
            )
          );
        }
      });
    });
  }

  async function releaseHandles(): Promise<boolean> {
    if (!ready || child.exitCode !== null || child.stdin.destroyed) return false;
    child.stdin.write("RELEASE\n");
    const released = await waitForMarker("PACKAGE_STAGING_RELEASED");
    if (released) state = "released";
    return released;
  }

  async function finish(
    mode: "complete" | "cleanup",
    sourceFileNames: readonly string[]
  ): Promise<boolean> {
    if (!ready || child.exitCode !== null || child.stdin.destroyed) return false;
    const initialState = state;
    state = "finalized";
    const closePromise = new Promise<number | null>((resolve) => {
      child.once("close", resolve);
    });
    child.stdin.end(
      mode === "complete"
        ? "DONE\n"
        : `CLEANUP\n${sourceFileNames.join("\n")}\nEND\n`
    );
    const exitCode = await waitForExit(closePromise);
    if (exitCode === "timeout") {
      child.kill();
      return false;
    }
    const expectedMarker =
      mode === "complete"
        ? "PACKAGE_STAGING_COMPLETED"
        : "PACKAGE_STAGING_CLEANUP_VERIFIED";
    if (
      exitCode !== 0 ||
      !stdout.split(/\r?\n/u).includes(expectedMarker)
    ) {
      return false;
    }
    if (mode === "complete") return initialState === "released";
    try {
      await access(stagingRoot);
      return false;
    } catch (error) {
      return isNodeError(error) && error.code === "ENOENT";
    }
  }

  async function waitForMarker(marker: string): Promise<boolean> {
    if (stdout.split(/\r?\n/u).includes(marker)) return true;
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 10_000);
      const inspectOutput = () => {
        if (stdout.split(/\r?\n/u).includes(marker)) {
          clearTimeout(timeout);
          resolve(true);
        }
      };
      child.stdout.on("data", inspectOutput);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }
}

function parseSourceFileNames(value: readonly string[]): string[] {
  const names = [...value];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (!/^[a-f0-9]{64}\.bin$/u.test(name)) {
      throw new Error("official calendar package source file name is invalid");
    }
    if (index > 0 && names[index - 1]! >= name) {
      throw new Error(
        "official calendar package source file names must be unique and canonical"
      );
    }
  }
  return names;
}

async function waitForExit(
  closePromise: Promise<number | null>
): Promise<number | null | "timeout"> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      closePromise,
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 10_000);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
