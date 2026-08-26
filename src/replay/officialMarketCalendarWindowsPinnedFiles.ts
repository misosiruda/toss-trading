import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(
  new URL("../../scripts/windowsCalendarPublicationPinnedFiles.ps1", import.meta.url)
);

export interface OfficialMarketCalendarPinnedFileDescriptor {
  relativePath: string;
  contentHash: string;
  contentLength: number;
}

export interface OfficialMarketCalendarWindowsPinnedFiles {
  publish(): Promise<
    "published_verified" | "published_unverified" | "collision" | "indeterminate"
  >;
  release(): Promise<boolean>;
}

export async function pinOfficialMarketCalendarWindowsPackageFiles(input: {
  stagingRoot: string;
  destinationRoot: string;
  files: readonly OfficialMarketCalendarPinnedFileDescriptor[];
}): Promise<OfficialMarketCalendarWindowsPinnedFiles> {
  if (
    process.platform !== "win32" ||
    !isAbsolute(input.stagingRoot) ||
    !isAbsolute(input.destinationRoot) ||
    input.files.length === 0
  ) {
    throw new Error(
      "official calendar Windows pinned files require absolute paths and files"
    );
  }
  const [stagingRoot, destinationParent] = await Promise.all([
    realpath(input.stagingRoot),
    realpath(dirname(input.destinationRoot))
  ]);
  const destinationRoot = join(
    destinationParent,
    basename(input.destinationRoot)
  );
  const files = parseFileDescriptors(input.files);
  const child = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", helperPath, stagingRoot, destinationRoot
  ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const lines = files.map(({ relativePath, contentHash, contentLength }) =>
    `${relativePath}|${contentHash}|${contentLength}`
  );
  child.stdin.write(`${lines.join("\n")}\nEND\n`);
  const pinned = await waitForMarker(`PACKAGE_FILES_PINNED:${files.length}`);
  if (!pinned) {
    if (child.exitCode === null) child.kill();
    throw new Error(`official calendar package file pin failed: ${stderr.trim()}`);
  }
  let finalized = false;
  return Object.freeze({
    publish: publishPinnedPackage,
    release: () => finalizeRelease()
  });

  async function publishPinnedPackage(): Promise<
    "published_verified" | "published_unverified" | "collision" | "indeterminate"
  > {
    if (finalized || child.exitCode !== null || child.stdin.destroyed) {
      return "indeterminate";
    }
    finalized = true;
    const close = new Promise<number | null>((resolve) => child.once("close", resolve));
    child.stdin.end("PUBLISH\n");
    const code = await waitForExit(close);
    if (code === "timeout") child.kill();
    const lines = stdout.split(/\r?\n/u);
    if (lines.includes("PACKAGE_DIRECTORY_COLLISION")) return "collision";
    if (!lines.includes("PACKAGE_DIRECTORY_PUBLISHED")) return "indeterminate";
    return code === 0 && lines.includes("PACKAGE_FILES_VERIFIED")
      ? "published_verified"
      : "published_unverified";
  }

  async function finalizeRelease(): Promise<boolean> {
    if (finalized || child.exitCode !== null || child.stdin.destroyed) return false;
    finalized = true;
    const close = new Promise<number | null>((resolve) => child.once("close", resolve));
    child.stdin.end("RELEASE\n");
    const code = await waitForExit(close);
    if (code === "timeout") child.kill();
    return code === 0;
  }
  async function waitForMarker(marker: string): Promise<boolean> {
    if (stdout.split(/\r?\n/u).includes(marker)) return true;
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10_000);
      const inspect = () => {
        if (stdout.split(/\r?\n/u).includes(marker)) { clearTimeout(timeout); resolve(true); }
      };
      child.stdout.on("data", inspect);
      child.once("close", () => { clearTimeout(timeout); resolve(false); });
    });
  }
}

function parseFileDescriptors(
  input: readonly OfficialMarketCalendarPinnedFileDescriptor[]
): OfficialMarketCalendarPinnedFileDescriptor[] {
  const files = input.map((file) => ({ ...file }));
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (
      !/^(?:artifact\.json|sources\/sha256\/[a-f0-9]{64}\.bin)$/u.test(
        file.relativePath
      ) ||
      !/^sha256:[a-f0-9]{64}$/u.test(file.contentHash) ||
      !Number.isSafeInteger(file.contentLength) ||
      file.contentLength < 0 ||
      (index > 0 && files[index - 1]!.relativePath >= file.relativePath)
    ) {
      throw new Error(
        "official calendar pinned file descriptors must be canonical"
      );
    }
  }
  return files;
}

async function waitForExit(close: Promise<number | null>): Promise<number | null | "timeout"> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([close, new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), 10_000);
    })]);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
