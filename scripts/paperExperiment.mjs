#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from "node:fs";
import { join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function rejectAliases(path, recursive = false) {
  const absolute = resolve(path); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) {
      try { lstatSync(current); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    }
    const info = lstatSync(current);
    if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) throw new Error("BUILD_UNBOUND");
  }
  if (recursive && lstatSync(absolute).isDirectory()) {
    for (const name of readdirSync(absolute)) rejectAliases(join(absolute, name), true);
  }
}
const args = process.argv.slice(2);
// Reject unsupported commands/options before builds, subprocesses or storage mutations.
const command = args[0];
const help = args.length === 0 || (args.length === 1 && ["help", "--help"].includes(command));
const review = command === "review" && [3, 5].includes(args.length) && args[1] === "--attempt"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(args[2] ?? "")
  && (args.length === 3 || (args[3] === "--compare-attempt" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(args[4] ?? "")));
const valid = review || args.length === 3 && ["validate", "run", "inspect", "retry"].includes(command)
  && args[1] === (["validate", "run"].includes(command) ? "--input" : "--attempt")
  && args[2].length > 0 && !args[2].startsWith("-");
if (!help && !valid) {
  console.error(JSON.stringify({ error: "INVALID_COMMAND", detail: "cancel/resume are unsupported; retry creates a new attempt" }));
  process.exitCode = 1;
} else if (help) {
  console.log("paper:experiment validate|run --input <fixture.json> | inspect|retry --attempt <id> | review --attempt <id> [--compare-attempt <id>]\nFixture only. cancel/resume unsupported; Ctrl+C leaves partial artifacts. retry creates a new attempt.");
} else {
  try {
    const receipt = new URL("../dist/paper-experiment-build.json", import.meta.url);
    const allowed = ["PATH", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMP", "TEMP", "TMPDIR"];
    const env = Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_OPTIONAL_LOCKS: "0" });
    const git = (...argv) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...argv], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (command !== "inspect" && command !== "review") {
      rejectAliases(root); rejectAliases(join(root, "src"), true);
      for (const name of ["package.json", "package-lock.json", "tsconfig.json", "scripts/paperExperiment.mjs"]) rejectAliases(join(root, name));
      // tsc writes existing output leaves in place; reject nested symlinks and hardlinks BEFORE it runs.
      rejectAliases(join(root, "dist"), true);
      if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") throw new Error("DIRTY_SOURCE");
      // Compare build inputs before/after compilation without trusting an old dist hash implementation.
      const names = git("ls-files", "-z").split("\0").filter((name) => name && (name.startsWith("src/") || ["package.json", "package-lock.json", "tsconfig.json", "scripts/paperExperiment.mjs"].includes(name))).sort();
      const readInputs = () => JSON.stringify(names.map((name) => [name, readFileSync(new URL(`../${name}`, import.meta.url)).toString("base64")]));
      const before = readInputs(); const head = git("rev-parse", "--verify", "HEAD");
      rmSync(receipt, { force: true });
      execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      if (before !== readInputs() || head !== git("rev-parse", "--verify", "HEAD")) throw new Error("BUILD_UNBOUND");
      const { capturePaperExperimentBuild } = await import("../dist/replay/paperExperimentRuntime.js");
      const binding = await capturePaperExperimentBuild(root);
      writeFileSync(receipt, `${JSON.stringify(binding)}\n`, { flag: "wx" });
    }
    // Import in this process: SIGINT/forced termination cannot leave a detached runner continuing to mutate.
    const { paperExperimentMain } = await import("../dist/cli/paperExperiment.js");
    process.exitCode = await paperExperimentMain(args);
  } catch (error) {
    const safe = ["DIRTY_SOURCE", "BUILD_UNBOUND", "RUNTIME_UNAVAILABLE"].includes(error?.code) ? error.code
      : ["DIRTY_SOURCE", "BUILD_UNBOUND"].includes(error?.message) ? error.message : "BUILD_OR_RUNTIME_FAILED";
    console.error(JSON.stringify({ error: safe })); process.exitCode = 1;
  }
}
