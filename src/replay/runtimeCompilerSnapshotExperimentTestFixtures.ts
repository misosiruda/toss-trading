// Fixed disposable source fixtures only; no application build, output execution or provider calls.
import { constants } from "node:fs";
import { lstat, mkdtemp, open, readdir, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPILER_INPUT_IDS, COMPILER_SNAPSHOT_VALUE_A, COMPILER_SNAPSHOT_VALUE_B, COMPILER_SNAPSHOT_VERSION,
  compileRuntimeSnapshotForTest, compilerInventoryDigestForTest, fixedCompilerSourcesForTest,
  type CompilerSnapshotCompilation,
} from "./runtimeCompilerSnapshotCompilerTestFixtures.js";
import {
  COMPILER_SNAPSHOT_FILE_LIMIT, CompilerSnapshotError, isCompilerSnapshotCase, parseCompilerSnapshotReport,
  type CompilerSnapshotCase, type CompilerSnapshotFailure, type CompilerSnapshotReport, type CompilerSnapshotResult,
} from "./runtimeCompilerSnapshotProtocolTestFixtures.js";

/** Trusted fixture seam: callers own the directory, never a request-supplied source path. */
export async function readCompilerSnapshotSourcesForTest(root: string,
  onOpenedForTest?: (id: typeof COMPILER_INPUT_IDS[number]) => Promise<void>): Promise<Map<string, string>> {
  let names: string[];
  try { names = await readdir(root); } catch { throw new CompilerSnapshotError("INPUT_INVALID"); }
  if (names.length !== 3 || COMPILER_INPUT_IDS.some((id) => !names.includes(id))) throw new CompilerSnapshotError("INPUT_UNSAFE");
  const sources = new Map<string, string>();
  for (const id of COMPILER_INPUT_IDS) {
    const path = join(root, id);
    let handle: FileHandle | undefined;
    let failure: CompilerSnapshotError | undefined;
    let text: string | undefined;
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new CompilerSnapshotError("INPUT_UNSAFE");
      if (before.size > COMPILER_SNAPSHOT_FILE_LIMIT) throw new CompilerSnapshotError("INPUT_LIMIT");
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || before.dev !== opened.dev || before.ino !== opened.ino) throw new CompilerSnapshotError("INPUT_CHANGED");
      await onOpenedForTest?.(id); // Deterministic owned-filesystem race seam; ordinary experiments pass no callback.
      const bytes = Buffer.alloc(COMPILER_SNAPSHOT_FILE_LIMIT + 1);
      let count = 0;
      while (count < bytes.length) {
        const part = await handle.read(bytes, count, bytes.length - count, count);
        if (part.bytesRead === 0) break;
        count += part.bytesRead;
      }
      if (count > COMPILER_SNAPSHOT_FILE_LIMIT) throw new CompilerSnapshotError("INPUT_LIMIT");
      const after = await handle.stat(), current = await lstat(path);
      if (!after.isFile() || !current.isFile() || current.isSymbolicLink() || after.nlink !== 1 || current.nlink !== 1 ||
        [opened, after, current].some((s) => s.dev !== before.dev || s.ino !== before.ino || s.size !== count ||
          s.mtimeMs !== before.mtimeMs || s.ctimeMs !== before.ctimeMs) || before.size !== count) throw new CompilerSnapshotError("INPUT_CHANGED");
      const raw = bytes.subarray(0, count);
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
      if (!Buffer.from(text).equals(raw)) throw new CompilerSnapshotError("INPUT_INVALID");
    } catch (error) {
      failure = error instanceof CompilerSnapshotError ? error : new CompilerSnapshotError("INPUT_INVALID");
    }
    if (handle !== undefined) {
      try { await handle.close(); } catch { failure ??= new CompilerSnapshotError("INPUT_INVALID"); }
    }
    if (failure !== undefined) throw failure;
    if (text === undefined) throw new CompilerSnapshotError("INPUT_INVALID");
    sources.set(id, text);
  }
  return sources;
}
type RootIdentity = { dev: number; ino: number; directory: boolean; symlink: boolean };
export interface CompilerSnapshotExperimentDependenciesForTest {
  runtime: { node: string; platform: string; arch: string; compiler: string };
  createRoot(): Promise<string>;
  inspectRoot(root: string): Promise<RootIdentity>;
  prepare(root: string, caseId: CompilerSnapshotCase): Promise<void>;
  read(root: string): Promise<Map<string, string>>;
  replaceValue(root: string, value: "A" | "B"): Promise<void>;
  compile(input: ReadonlyMap<string, string>, fault?: "stale_output" | "extra_output"): CompilerSnapshotCompilation;
  removeRoot(root: string): Promise<void>;
}
const sameRoot = (a: RootIdentity, b: RootIdentity) => a.directory && b.directory && !a.symlink && !b.symlink && a.dev === b.dev && a.ino === b.ino;
const failed = (reason: CompilerSnapshotFailure, cleanup: "not_created" | "removed" | "retained"): CompilerSnapshotResult =>
  ({ status: "failed", reason, report: null, cleanup });
export function createCompilerSnapshotExperimentForTest(deps: CompilerSnapshotExperimentDependenciesForTest):
  (caseId: unknown) => Promise<CompilerSnapshotResult> {
  let halted = false;
  let queue: Promise<void> = Promise.resolve();
  async function run(input: unknown): Promise<CompilerSnapshotResult> {
    if (!isCompilerSnapshotCase(input)) return failed("INVALID_CASE", "not_created");
    if (halted) return failed("CLEANUP_FAILURE", "not_created");
    const rt = deps.runtime;
    if (rt.node !== "v24.19.0" || rt.platform !== "linux" || rt.arch !== "x64" || rt.compiler !== "5.9.3") {
      return { status: "unsupported", reason: "RUNTIME_UNSUPPORTED", report: null, cleanup: "not_created" };
    }
    let root: string;
    try { root = await deps.createRoot(); } catch { return failed("FIXTURE_PREPARATION_FAILED", "not_created"); }
    let identity: RootIdentity;
    try {
      identity = await deps.inspectRoot(root);
      if (!identity.directory || identity.symlink) throw new Error("UNSAFE_ROOT");
    } catch {
      halted = true;
      return failed("FIXTURE_PREPARATION_FAILED", "retained");
    }
    let reason: CompilerSnapshotFailure | null = null;
    let report: CompilerSnapshotReport | null = null;
    try {
      await deps.prepare(root, input);
      const captured = await deps.read(root);
      const capturedInput = compilerInventoryDigestForTest(captured);
      let compilerInput = captured;
      const aba = input === "snapshot_after_disk_aba" || input === "reread_during_disk_aba";
      if (aba) await deps.replaceValue(root, "B");
      if (input === "reread_during_disk_aba") compilerInput = await deps.read(root);
      if (!sameRoot(identity, await deps.inspectRoot(root))) throw new CompilerSnapshotError("INPUT_CHANGED");
      let compiled: CompilerSnapshotCompilation;
      try { compiled = deps.compile(compilerInput, input === "stale_output" || input === "extra_output" ? input : undefined); }
      catch (error) { throw error instanceof CompilerSnapshotError ? error : new CompilerSnapshotError("COMPILER_FAILURE"); }
      if (aba) await deps.replaceValue(root, "A");
      const restoredInput = compilerInventoryDigestForTest(await deps.read(root));
      const observation: CompilerSnapshotReport = {
        schemaVersion: "compiler_snapshot_experiment.v1", caseId: input,
        status: input === "reread_during_disk_aba" ? "counterexample" : "observed",
        evidence: "synthetic_compiler_observation", runtime: "unavailable", dependencies: "unavailable",
        result: "unavailable", comparability: "unavailable", completeRuntime: false,
        completeConfiguration: false, completeInput: false, compilerVersion: "5.9.3", inputFileCount: 3, outputFileCount: 2,
        capturedInput, consumedInput: compiled.consumedInput, restoredInput, emittedOutput: compiled.emittedOutput,
        optionsDigest: compiled.optionsDigest, captureMatchesConsumed: capturedInput === compiled.consumedInput, beforeAfterMatch: true,
      };
      try { report = parseCompilerSnapshotReport(Buffer.from(JSON.stringify(observation) + "\n"), input); }
      catch { throw new CompilerSnapshotError("OUTPUT_MISMATCH"); }
    } catch (error) { reason = error instanceof CompilerSnapshotError ? error.reason : "FIXTURE_PREPARATION_FAILED"; }
    try {
      if (!sameRoot(identity, await deps.inspectRoot(root))) throw new Error("ROOT_CHANGED");
      await deps.removeRoot(root);
    } catch {
      halted = true;
      return failed(reason ?? "CLEANUP_FAILURE", "retained");
    }
    if (reason !== null) return failed(reason, "removed");
    if (report === null) return failed("OUTPUT_MISMATCH", "removed");
    return { status: "collected", report, cleanup: "removed" };
  }
  return (caseId) => {
    const result = queue.then(() => run(caseId));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
const realExperiment = createCompilerSnapshotExperimentForTest({
  runtime: { node: process.version, platform: process.platform, arch: process.arch, compiler: COMPILER_SNAPSHOT_VERSION },
  createRoot: () => mkdtemp(join(tmpdir(), "runtime-compiler-snapshot-")),
  inspectRoot: async (root) => {
    const s = await lstat(root);
    return { dev: s.dev, ino: s.ino, directory: s.isDirectory(), symlink: s.isSymbolicLink() };
  },
  prepare: async (root, caseId) => {
    const sources = fixedCompilerSourcesForTest();
    if (caseId === "unlisted_import") sources.set("entry.ts", 'import { value } from "unlisted-package";\nexport const observed = value;\n');
    if (caseId === "type_error") sources.set("value.ts", "export const value: string = 42;\n");
    for (const [id, text] of sources) await writeFile(join(root, id), text, { flag: "wx", mode: 0o600 });
  },
  read: readCompilerSnapshotSourcesForTest,
  replaceValue: (root, value) => writeFile(join(root, "value.ts"), value === "A" ? COMPILER_SNAPSHOT_VALUE_A : COMPILER_SNAPSHOT_VALUE_B),
  compile: compileRuntimeSnapshotForTest,
  removeRoot: (root) => rm(root, { recursive: true, force: false, maxRetries: 0 }),
});
export const runRuntimeCompilerSnapshotExperiment = (caseId: unknown): Promise<CompilerSnapshotResult> => realExperiment(caseId);
