import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { assertExperimentPath, readExperimentFile } from "../storage/paperExperimentFilesystem.js";
import { paperExperimentRuntimeIdentitySchema } from "../storage/paperExperimentContract.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const PAPER_EXPERIMENT_BUILD_RECEIPT = "dist/paper-experiment-build.json";
export class PaperExperimentRuntimeError extends Error {
  constructor(readonly code: "RUNTIME_UNAVAILABLE" | "DIRTY_SOURCE" | "BUILD_UNBOUND") {
    super(`Paper experiment runtime rejected: ${code}`); this.name = "PaperExperimentRuntimeError";
  }
}
export const paperExperimentBuildReceiptSchema = z.object({
  schemaVersion: z.literal("paper_experiment_build.v1"), runtimeIdentity: paperExperimentRuntimeIdentitySchema,
  sourceHash: sha256HashSchema, compiledHash: sha256HashSchema
}).strict();

/** Do not inherit Git redirection, user hooks/fsmonitor, alternate index, or injected Node options. */
export function paperExperimentProcessEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMP", "TEMP", "TMPDIR"];
  const env = Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0" };
}

async function git(root: string, args: string[]) {
  return (await promisify(execFile)("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args],
    { cwd: root, env: paperExperimentProcessEnvironment(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
}

async function files(root: string, directory: string, suffix: string): Promise<string[]> {
  await assertExperimentPath(join(root, directory));
  const result: string[] = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new PaperExperimentRuntimeError("BUILD_UNBOUND");
    if (entry.isDirectory()) result.push(...await files(root, name, suffix));
    else if (entry.isFile() && name.endsWith(suffix)) result.push(name);
  }
  return result.sort();
}
async function contents(root: string, names: string[]) {
  return Promise.all(names.map(async (name) => {
    await assertExperimentPath(join(root, name));
    const info = await lstat(join(root, name));
    if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw new PaperExperimentRuntimeError("BUILD_UNBOUND");
    return [name, (await readFile(join(root, name))).toString("base64")];
  }));
}

export async function observePaperExperimentSource(root: string) {
  try {
    await assertExperimentPath(root);
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    if (relative(root, top) !== "") throw new PaperExperimentRuntimeError("RUNTIME_UNAVAILABLE");
    const implementationRevision = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    if ((await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).length > 0) throw new PaperExperimentRuntimeError("DIRTY_SOURCE");
    const tracked = new Set((await git(root, ["ls-files", "-z"])).split("\0").filter(Boolean));
    const sourceNames = await files(root, "src", ".ts");
    const bindingFiles = ["package.json", "package-lock.json", "tsconfig.json", "scripts/paperExperiment.mjs"];
    if ([...sourceNames, ...bindingFiles].some((name) => !tracked.has(name))) throw new PaperExperimentRuntimeError("BUILD_UNBOUND");
    const lock = JSON.parse(await readExperimentFile(join(root, "package-lock.json"), 4 * 1024 * 1024));
    const runtimeIdentity = paperExperimentRuntimeIdentitySchema.parse({ implementationRevision,
      dependencyLockHash: createReplayResearchHash(lock), nodeVersion: process.version });
    return { runtimeIdentity, sourceHash: createReplayResearchHash(await contents(root, [...sourceNames, ...bindingFiles].sort())), sourceNames };
  } catch (error) {
    if (error instanceof PaperExperimentRuntimeError) throw error;
    throw new PaperExperimentRuntimeError("RUNTIME_UNAVAILABLE");
  }
}

export async function capturePaperExperimentBuild(root: string) {
  const source = await observePaperExperimentSource(root);
  const compiledNames = await files(root, "dist", ".js");
  const expected = source.sourceNames.filter((name) => !name.endsWith(".d.ts")).map((name) => name.replace(/^src\//, "dist/").replace(/\.ts$/, ".js")).sort();
  if (createReplayResearchHash(compiledNames) !== createReplayResearchHash(expected)) throw new PaperExperimentRuntimeError("BUILD_UNBOUND");
  return paperExperimentBuildReceiptSchema.parse({ schemaVersion: "paper_experiment_build.v1", runtimeIdentity: source.runtimeIdentity,
    sourceHash: source.sourceHash, compiledHash: createReplayResearchHash(await contents(root, compiledNames)) });
}

/** Entry checks the receipt against every compiled JS file, including this actually loaded module. */
export async function verifyPaperExperimentBuild(root: string) {
  const actual = await capturePaperExperimentBuild(root);
  try {
    const stored = paperExperimentBuildReceiptSchema.parse(JSON.parse(await readExperimentFile(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT), 16 * 1024)));
    if (createReplayResearchHash(actual) !== createReplayResearchHash(stored)) throw new Error();
  } catch { throw new PaperExperimentRuntimeError("BUILD_UNBOUND"); }
  return actual.runtimeIdentity;
}
