import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { createReplayResearchHash } from "./replayRunManifest.js";

const helperPath = fileURLToPath(
  new URL("../../scripts/windowsCalendarPublicationRootLease.ps1", import.meta.url)
);

export interface OfficialMarketCalendarWindowsPublicationRootLease {
  readonly publicationRoot: string;
  readonly publicationRootIdentityHash: string;
  release(): Promise<boolean>;
}

export async function createOfficialMarketCalendarWindowsPublicationRootLease(
  publicationRootInput: string
): Promise<OfficialMarketCalendarWindowsPublicationRootLease> {
  if (process.platform !== "win32" || !isAbsolute(publicationRootInput)) {
    throw new Error("official calendar publication root lease requires an absolute win32 path");
  }
  const publicationRoot = await realpath(publicationRootInput);
  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", helperPath, publicationRoot
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  const identity = await new Promise<{ volumeIdentity: string; fileIdentity: string }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("publication root lease timed out")), 10_000);
      const inspect = () => {
        const match = stdout.match(/(?:^|\r?\n)PUBLICATION_ROOT_LEASE_READY:(\d+):(\d+)(?:\r?\n|$)/u);
        if (match?.[1] !== undefined && match[2] !== undefined) {
          clearTimeout(timeout);
          resolve({ volumeIdentity: match[1], fileIdentity: match[2] });
        }
      };
      child.stdout.on("data", inspect);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`publication root lease exited before ready (${code}): ${stderr.trim()}`));
      });
    }
  ).catch((error) => {
    if (child.exitCode === null) child.kill();
    throw error;
  });
  const publicationRootIdentityHash = createReplayResearchHash({
    canonicalPath: publicationRoot,
    ...identity
  });
  let released = false;
  return Object.freeze({
    publicationRoot,
    publicationRootIdentityHash,
    async release(): Promise<boolean> {
      if (released || child.exitCode !== null || child.stdin.destroyed) return false;
      released = true;
      const close = new Promise<number | null>((resolve) => child.once("close", resolve));
      child.stdin.end("RELEASE\n");
      const code = await waitForExit(close);
      if (code === "timeout") {
        child.kill();
        return false;
      }
      return code === 0 && stdout.split(/\r?\n/u).includes("PUBLICATION_ROOT_LEASE_RELEASED");
    }
  });
}

async function waitForExit(
  close: Promise<number | null>
): Promise<number | null | "timeout"> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      close,
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 10_000);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
