import { spawn } from "node:child_process";
import { access, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const windowsProbeSessionHelperPath = fileURLToPath(
  new URL(
    "../../scripts/windowsCalendarPublicationProbeSession.ps1",
    import.meta.url
  )
);

export interface OfficialMarketCalendarWindowsProbeSession {
  readonly probeRoot: string;
  cleanup(): Promise<boolean>;
}

export async function createOfficialMarketCalendarWindowsProbeSession(input: {
  publicationRoot: string;
}): Promise<OfficialMarketCalendarWindowsProbeSession> {
  if (process.platform !== "win32") {
    throw new Error("official calendar Windows probe session requires win32");
  }
  if (!isAbsolute(input.publicationRoot)) {
    throw new Error("official calendar Windows probe session root must be absolute");
  }

  const publicationRoot = await realpath(input.publicationRoot);
  if (!(await lstat(publicationRoot)).isDirectory()) {
    throw new Error("official calendar Windows probe session root must be a directory");
  }

  const probeRoot = join(
    publicationRoot,
    `.calendar-publication-preflight-${randomUUID()}`
  );
  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      windowsProbeSessionHelperPath,
      publicationRoot,
      probeRoot
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
    await cleanupAfterStartupFailure();
    throw error;
  }

  let cleanupPromise: Promise<boolean> | undefined;
  return Object.freeze({
    probeRoot,
    cleanup(): Promise<boolean> {
      cleanupPromise ??= finishAndVerifyCleanup();
      return cleanupPromise;
    }
  });

  async function waitForReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const expectedLine = `PROBE_READY:${probeRoot}`;
      const timeout = setTimeout(() => {
        reject(new Error("official calendar Windows probe session start timed out"));
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
              `official calendar Windows probe session exited before ready (${code}): ${stderr.trim()}`
            )
          );
        }
      });
    });
  }

  async function finishAndVerifyCleanup(): Promise<boolean> {
    if (!ready || child.exitCode !== null || child.stdin.destroyed) {
      return false;
    }
    const exitPromise = new Promise<number | null>((resolve) => {
      child.once("close", resolve);
    });
    child.stdin.end("CLEANUP\n");
    const exitCode = await waitForExit(exitPromise);
    if (exitCode === "timeout") {
      child.kill();
      return false;
    }
    if (
      exitCode !== 0 ||
      !stdout.split(/\r?\n/u).includes("PROBE_CLEANUP_VERIFIED")
    ) {
      return false;
    }
    try {
      await access(probeRoot);
      return false;
    } catch (error) {
      return isNodeError(error) && error.code === "ENOENT";
    }
  }

  async function cleanupAfterStartupFailure(): Promise<void> {
    if (child.exitCode !== null) return;
    const closePromise = new Promise<number | null>((resolve) => {
      child.once("close", resolve);
    });
    if (!child.stdin.destroyed) {
      child.stdin.end("CLEANUP\n");
    }
    if ((await waitForExit(closePromise)) === "timeout") {
      child.kill();
    }
  }
}

async function waitForExit(
  exitPromise: Promise<number | null>
): Promise<number | null | "timeout"> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exitPromise,
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
