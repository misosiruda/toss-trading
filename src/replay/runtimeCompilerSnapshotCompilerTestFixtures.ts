// The already-loaded TypeScript module is a declared trust root, not an attested compiler artifact.
import { createHash } from "node:crypto";
import ts from "typescript";
import { COMPILER_SNAPSHOT_FILE_LIMIT, CompilerSnapshotError, type CompilerSnapshotFailure } from "./runtimeCompilerSnapshotProtocolTestFixtures.js";

export const COMPILER_SNAPSHOT_VERSION = ts.version;
export const COMPILER_INPUT_IDS = ["entry.ts", "lib.d.ts", "value.ts"] as const;
export const COMPILER_OUTPUT_IDS = ["entry.js", "value.js"] as const;
const ROOT = "/c2c2/";
export const COMPILER_SNAPSHOT_VALUE_A = 'export const value: string = "snapshot-A";\n';
export const COMPILER_SNAPSHOT_VALUE_B = 'export const value: string = "snapshot-B";\n';
export function fixedCompilerSourcesForTest(): Map<string, string> {
  return new Map([
    ["entry.ts", 'import { value } from "./value.js";\nexport const observed: string = value;\n'],
    ["value.ts", COMPILER_SNAPSHOT_VALUE_A],
    ["lib.d.ts", "interface Array<T> { length: number; [n: number]: T }\ninterface Boolean {}\n" +
      "interface Function {}\ninterface CallableFunction extends Function {}\ninterface NewableFunction extends Function {}\n" +
      "interface IArguments {}\ninterface Number {}\ninterface Object {}\ninterface RegExp {}\ninterface String {}\n"],
  ]);
}
export function compilerSnapshotDigestForTest(bytes: string | Buffer): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}
export function compilerInventoryDigestForTest(files: ReadonlyMap<string, string>): string {
  return compilerSnapshotDigestForTest(JSON.stringify([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([id, text]) => ({ id, bytes: Buffer.byteLength(text), digest: compilerSnapshotDigestForTest(text) }))));
}
function options(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Classic,
    noLib: true, types: [], strict: true, noEmitOnError: true, noResolve: false, skipLibCheck: false,
    rootDir: "/c2c2", outDir: "/c2c2/out", newLine: ts.NewLineKind.LineFeed,
    sourceMap: false, declaration: false, incremental: false, removeComments: true,
  };
}
export const COMPILER_SNAPSHOT_OPTIONS_DIGEST = compilerSnapshotDigestForTest(JSON.stringify(options()));
export interface CompilerSnapshotCompilation {
  consumedInput: string;
  emittedOutput: string;
  optionsDigest: string;
  outputs: ReadonlyMap<string, string>;
}
/** Trusted unit seam. It never reads disk, imports caller modules or executes emitted code. */
export function createCompilerSnapshotSessionForTest(input: ReadonlyMap<string, string>, initialOutputCount = 0) {
  let failure: CompilerSnapshotFailure | null = null;
  const reject = (reason: CompilerSnapshotFailure): never => {
    failure ??= reason;
    throw new CompilerSnapshotError(failure);
  };
  if (initialOutputCount !== 0) reject("STALE_OUTPUT");
  if (input.size !== 3 || COMPILER_INPUT_IDS.some((name) => !input.has(name))) reject("INCOMPLETE_INPUT");
  const snapshot = new Map<string, string>();
  for (const name of COMPILER_INPUT_IDS) {
    const text = input.get(name)!;
    if (typeof text !== "string") reject("INPUT_INVALID");
    if (text.length > COMPILER_SNAPSHOT_FILE_LIMIT || Buffer.byteLength(text) > COMPILER_SNAPSHOT_FILE_LIMIT) reject("INPUT_LIMIT");
    if (Buffer.from(text).toString("utf8") !== text) reject("INPUT_INVALID");
    snapshot.set(ROOT + name, text);
  }
  const supplied = new Map<string, ts.SourceFile>();
  const consumed = new Map<string, string>();
  const outputs = new Map<string, string>();
  let reads = 0, resolutions = 0;
  const takeText = (name: string): string => {
    if (++reads > 16) reject("READ_LIMIT");
    const text = snapshot.get(name);
    if (text === undefined) return reject("UNLISTED_READ");
    return text;
  };
  const fixedOptions = options();
  const originalOptions = JSON.stringify(fixedOptions);
  const host: ts.CompilerHost = {
    getSourceFile(name, language) {
      const text = takeText(name);
      const source = ts.createSourceFile(name, text, language);
      supplied.set(name, source);
      consumed.set(name.slice(ROOT.length), text);
      return source;
    },
    getDefaultLibFileName: () => ROOT + "lib.d.ts", // A label lookup is not a content read.
    getCurrentDirectory: () => "/c2c2",
    getCanonicalFileName: (name) => name,
    getNewLine: () => "\n",
    useCaseSensitiveFileNames: () => true,
    fileExists(name) { if (!snapshot.has(name)) reject("UNLISTED_READ"); return true; },
    readFile: takeText,
    resolveModuleNames(names, containingFile) {
      return names.map((name): ts.ResolvedModuleFull => {
        if (++resolutions > 8) reject("RESOLUTION_LIMIT");
        if (containingFile !== ROOT + "entry.ts" || name !== "./value.js") reject("UNLISTED_RESOLUTION");
        return { resolvedFileName: ROOT + "value.ts", extension: ts.Extension.Ts, isExternalLibraryImport: false };
      });
    },
    writeFile(name, text, bom, _onError, sourceFiles) {
      if (!COMPILER_OUTPUT_IDS.some((id) => name === ROOT + "out/" + id)) reject("UNLISTED_OUTPUT");
      const id = name.slice((ROOT + "out/").length);
      if (outputs.has(id)) reject("DUPLICATE_OUTPUT");
      if (typeof text !== "string" || text.length > COMPILER_SNAPSHOT_FILE_LIMIT ||
        Buffer.byteLength(text) > COMPILER_SNAPSHOT_FILE_LIMIT) reject("OUTPUT_LIMIT");
      if (bom !== false || Buffer.from(text).toString("utf8") !== text) reject("OUTPUT_MISMATCH");
      const inputName = ROOT + id.replace(/\.js$/, ".ts");
      // TypeScript emit supplies a transformed SourceFile; its original must be the exact host object.
      const originalNode = sourceFiles?.length === 1 ? ts.getOriginalNode(sourceFiles[0]!) : undefined;
      if (originalNode === undefined || !ts.isSourceFile(originalNode)) return reject("SOURCE_MISMATCH");
      const original = originalNode;
      if (sourceFiles?.length !== 1 || original !== supplied.get(inputName) || original?.text !== snapshot.get(inputName) ||
        sourceFiles[0]?.fileName !== inputName || sourceFiles[0]?.text !== snapshot.get(inputName)) reject("SOURCE_MISMATCH");
      outputs.set(id, text);
    },
  };
  return {
    host,
    compilerOptions: fixedOptions,
    reject,
    finish(sourceFiles: readonly ts.SourceFile[]): CompilerSnapshotCompilation {
      if (failure !== null) reject(failure);
      if (JSON.stringify(fixedOptions) !== originalOptions) reject("SOURCE_MISMATCH");
      if (sourceFiles.length !== 3 || new Set(sourceFiles.map((s) => s.fileName)).size !== 3 || consumed.size !== 3) reject("INCOMPLETE_INPUT");
      for (const source of sourceFiles) {
        if (!snapshot.has(source.fileName) || source !== supplied.get(source.fileName) || source.text !== snapshot.get(source.fileName)) reject("SOURCE_MISMATCH");
      }
      if (outputs.size !== 2 || COMPILER_OUTPUT_IDS.some((name) => !outputs.has(name))) reject("INCOMPLETE_OUTPUT");
      return { consumedInput: compilerInventoryDigestForTest(consumed), emittedOutput: compilerInventoryDigestForTest(outputs),
        optionsDigest: compilerSnapshotDigestForTest(originalOptions), outputs: new Map(outputs) };
    },
  };
}
export function compileRuntimeSnapshotForTest(input: ReadonlyMap<string, string>, fault?: "stale_output" | "extra_output"):
  CompilerSnapshotCompilation {
  const session = createCompilerSnapshotSessionForTest(input, fault === "stale_output" ? 1 : 0);
  try {
    const program = ts.createProgram([ROOT + "lib.d.ts", ROOT + "entry.ts"], session.compilerOptions, session.host);
    if (ts.getPreEmitDiagnostics(program).length !== 0) session.reject("COMPILER_DIAGNOSTIC");
    const emit = program.emit();
    if (emit.emitSkipped || emit.diagnostics.length !== 0) session.reject("COMPILER_DIAGNOSTIC");
    if (fault === "extra_output") session.host.writeFile(ROOT + "out/extra.js", "export {};\n", false);
    return session.finish(program.getSourceFiles());
  } catch (error) {
    if (error instanceof CompilerSnapshotError) throw error;
    return session.reject("COMPILER_FAILURE");
  }
}
