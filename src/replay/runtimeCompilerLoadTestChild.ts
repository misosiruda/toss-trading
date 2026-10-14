// Trusted standalone test bootstrap: no application/compiler static import.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type ts from "typescript";
import type { CompilerLoadCaseId, CompilerLoadRejection, CompilerLoadReport } from "./runtimeCompilerLoadProtocolTestFixtures.js";

const cases = ["snapshot_baseline", "snapshot_after_disk_aba", "reread_during_disk_aba", "cache_before_hook",
  "artifact_mismatch", "unlisted_builtin", "unlisted_module", "callback_cap", "callback_cap_over", "artifact_cap_over"];
const id = process.argv[2] as CompilerLoadCaseId;
const aDigest = "sha256:3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";
const expectedOutput = "export const answer = 42;\n";
const input = "export const answer: number = 42;\n";
const builtins = ["crypto", "fs", "os", "path", "perf_hooks"];
const artifactPath = fileURLToPath(new URL("./compiler.cjs", import.meta.url));
const compilerURL = new URL("./compiler.cjs", import.meta.url).href;
const require = createRequire(import.meta.url);
let failure: CompilerLoadRejection | null = null;
function reject(reason: CompilerLoadRejection): never { failure ??= reason; throw new Error(failure); }
const digest = (text: string): string => "sha256:" + createHash("sha256").update(text).digest("hex");
function readArtifact(): string {
  let fd: number | undefined;
  try {
    const before = lstatSync(artifactPath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) reject("ARTIFACT_UNSAFE");
    if (before.size > 10 * 1024 * 1024) reject("ARTIFACT_LIMIT");
    fd = openSync(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const same = (s: typeof before): boolean => s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.dev === before.dev &&
      s.ino === before.ino && s.size === before.size && s.mtimeMs === before.mtimeMs && s.ctimeMs === before.ctimeMs;
    if (!same(fstatSync(fd))) reject("ARTIFACT_UNSAFE");
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, size); if (n === 0) break; size += n; }
    if (size > 10 * 1024 * 1024) reject("ARTIFACT_LIMIT");
    if (!same(fstatSync(fd)) || !same(lstatSync(artifactPath)) || size !== before.size) reject("ARTIFACT_UNSAFE");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
    if (!Buffer.from(text).equals(bytes.subarray(0, size))) reject("ARTIFACT_UNSAFE");
    return text;
  } catch { return reject(failure ?? "ARTIFACT_UNSAFE"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
function common() {
  return { schemaVersion: "compiler_load_experiment.v1" as const, caseId: id, runtime: "unavailable" as const,
    dependencies: "unavailable" as const, result: "unavailable" as const, comparability: "unavailable" as const,
    completeRuntime: false as const, completeConfiguration: false as const, completeInput: false as const };
}
function run(): CompilerLoadReport {
  let original: string | undefined;
  let changed = false;
  let hook: ReturnType<typeof registerHooks> | undefined;
  let observed: CompilerLoadReport | undefined;
  try {
    if (process.version !== "v24.19.0" || process.platform !== "linux" || process.arch !== "x64" || process.execArgv.length !== 0 ||
      process.argv.length !== 3 || Object.keys(process.env).sort().join(",") !== "LANG,LC_ALL,NODE_DISABLE_COMPILE_CACHE,TZ" ||
      process.env.TZ !== "UTC" || process.env.LANG !== "C" || process.env.LC_ALL !== "C" || process.env.NODE_DISABLE_COMPILE_CACHE !== "1") reject("STARTUP_UNSUPPORTED");
    original = readArtifact();
    if (Buffer.byteLength(original) !== 9_112_572 || digest(original) !== aDigest) reject("ARTIFACT_MISMATCH");
    const captured = original;
    const replace = (text: string): void => { changed = true; writeFileSync(artifactPath, text, { flag: "r+" }); };
    if (id === "artifact_mismatch") { replace(original + "\n// changed\n"); if (digest(readArtifact()) !== aDigest) reject("ARTIFACT_MISMATCH"); }
    if (id === "artifact_cap_over") { replace(" ".repeat(10 * 1024 * 1024 + 1)); readArtifact(); }
    if (["snapshot_after_disk_aba", "reread_during_disk_aba", "cache_before_hook"].includes(id)) replace(original + "\nmodule.exports.__c2c3Marker = 202;\n");
    if (id === "cache_before_hook") {
      const preloaded = require(artifactPath) as { __c2c3Marker?: number };
      if (preloaded.__c2c3Marker !== 202) reject("COMPILER_FAILURE"); // Actual pre-hook B evaluation, never normal admission.
    }
    if (Object.keys(require.cache).length !== 0) reject("CACHE_PREPOPULATED");
    let supplied = id === "reread_during_disk_aba" ? readArtifact() : captured;
    if (id === "unlisted_builtin") supplied += '\ntry { require("node:net"); } catch {}\n';
    if (id === "unlisted_module") supplied += '\ntry { require("./unknown.cjs"); } catch {}\n';
    if (Buffer.byteLength(supplied) > 10 * 1024 * 1024) reject("ARTIFACT_LIMIT");
    const suppliedSnapshot = supplied;
    let events = 0, compilerLoads = 0;
    const builtinLoads = new Set<string>();
    const count = (): void => { if (++events > 32) reject("LOAD_LIMIT"); };
    hook = registerHooks({
      resolve(specifier, context, next) {
        count();
        if (context.importAttributes !== undefined && Object.keys(context.importAttributes).length !== 0) reject("LOAD_UNLISTED");
        if (specifier === compilerURL && context.parentURL === import.meta.url) return { url: compilerURL, format: "commonjs", shortCircuit: true };
        const name = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
        if (context.parentURL !== compilerURL || !builtins.includes(name)) return reject("LOAD_UNLISTED");
        const resolved = next(specifier, context);
        // CJS nextResolve returns the canonical URL without a format hint; actual load must still be builtin.
        if (resolved.url !== "node:" + name || (resolved.format !== undefined && resolved.format !== "builtin")) reject("LOAD_FORMAT");
        return resolved;
      },
      load(url, context, next) {
        count();
        if (context.importAttributes !== undefined && Object.keys(context.importAttributes).length !== 0) reject("LOAD_UNLISTED");
        if (url === compilerURL) {
          if (context.format !== "commonjs" || ++compilerLoads !== 1) reject("LOAD_FORMAT");
          return { format: "commonjs", source: suppliedSnapshot, shortCircuit: true };
        }
        const name = url.startsWith("node:") ? url.slice(5) : "";
        if (!builtins.includes(name) || context.format !== "builtin" || builtinLoads.has(name)) return reject("LOAD_UNLISTED");
        const loaded = next(url, context);
        if (loaded.format !== "builtin") reject("LOAD_FORMAT");
        builtinLoads.add(name);
        return loaded;
      },
    });
    const compiler = require(compilerURL) as typeof ts & { __c2c3Marker?: number };
    if (failure !== null) reject(failure); // Compiler code may catch a rejected require; that cannot clear the latch.
    if (compiler.version !== "5.9.3") reject("COMPILER_FAILURE");
    const output = compiler.transpileModule(input, { fileName: "entry.ts", reportDiagnostics: true,
      compilerOptions: { module: compiler.ModuleKind.ES2022, target: compiler.ScriptTarget.ES2022, newLine: compiler.NewLineKind.LineFeed } });
    if (failure !== null) reject(failure);
    if (output.outputText !== expectedOutput || (output.diagnostics?.length ?? 0) !== 0) reject("COMPILER_FAILURE");
    const sameObject = require(compilerURL) === compiler;
    if (failure !== null) reject(failure);
    if (id === "callback_cap" || id === "callback_cap_over") {
      for (let i = 0; i < (id === "callback_cap" ? 20 : 21); i++) require.resolve(compilerURL);
    }
    const expectedCallbacks = id === "callback_cap" ? 32 : 12;
    if (failure !== null) reject(failure);
    const cache = Object.values(require.cache);
    if (!sameObject || cache.length !== 1 || cache[0]?.exports !== compiler || compilerLoads !== 1 ||
      [...builtinLoads].sort().join(",") !== builtins.join(",") || events !== expectedCallbacks) reject("LOAD_INCOMPLETE");
    const counter = id === "reread_during_disk_aba";
    const marker = compiler.__c2c3Marker ?? 0;
    if (marker !== (counter ? 202 : 0)) reject("COMPILER_FAILURE");
    observed = { ...common(), status: counter ? "counterexample" : "observed", evidence: "fixed_compiler_load_observation",
      compilerVersion: "5.9.3", artifactBytes: Buffer.byteLength(suppliedSnapshot), capturedArtifact: digest(captured),
      suppliedArtifact: digest(suppliedSnapshot), restoredArtifact: aDigest, captureMatchesSupplied: captured === suppliedSnapshot,
      diskBeforeAfterMatch: true, compilerLoadCount: 1, builtinLoads: [...builtinLoads].sort(), cacheSameObject: true,
      observedMarker: marker, inputDigest: digest(input), outputDigest: digest(output.outputText), callbackCount: expectedCallbacks };
  } catch { failure ??= "COMPILER_FAILURE"; }
  finally {
    try { hook?.deregister(); } catch { failure ??= "LOAD_INCOMPLETE"; }
    if (original !== undefined) {
      try {
        if (changed) writeFileSync(artifactPath, original, { flag: "w" });
        if (digest(readArtifact()) !== aDigest) failure ??= "ARTIFACT_RESTORE_FAILED";
      } catch { failure ??= "ARTIFACT_RESTORE_FAILED"; }
    }
  }
  if (failure !== null || observed === undefined) return { ...common(), status: "rejected", evidence: "unavailable", reason: failure ?? "COMPILER_FAILURE" };
  return observed;
}
if (!cases.includes(id)) process.exitCode = 1;
else process.stdout.write(JSON.stringify(run()) + "\n");
