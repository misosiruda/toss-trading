import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import {
  COMPILER_INPUT_IDS, COMPILER_SNAPSHOT_OPTIONS_DIGEST, COMPILER_SNAPSHOT_VALUE_B,
  compileRuntimeSnapshotForTest, compilerInventoryDigestForTest, createCompilerSnapshotSessionForTest,
  fixedCompilerSourcesForTest,
} from "./runtimeCompilerSnapshotCompilerTestFixtures.js";
import { CompilerSnapshotError, type CompilerSnapshotFailure } from "./runtimeCompilerSnapshotProtocolTestFixtures.js";
const rejects = (run: () => unknown, reason: CompilerSnapshotFailure) => assert.throws(run,
  (e: unknown) => e instanceof CompilerSnapshotError && e.reason === reason && e.message === reason);
function prepared() {
  const session = createCompilerSnapshotSessionForTest(fixedCompilerSourcesForTest());
  const sources = COMPILER_INPUT_IDS.map((id) => session.host.getSourceFile("/c2c2/" + id, ts.ScriptTarget.ES2022)!);
  const write = (id: "entry" | "value", text = "export {};\n") => session.host.writeFile("/c2c2/out/" + id + ".js", text,
    false, undefined, [sources.find((s) => s.fileName === "/c2c2/" + id + ".ts")!]);
  return { session, sources, write };
}
test("real TypeScript checks all fixed inputs and emits independently asserted ESM text", () => {
  const inputs = fixedCompilerSourcesForTest();
  const result = compileRuntimeSnapshotForTest(inputs);
  assert.equal(result.consumedInput, compilerInventoryDigestForTest(inputs));
  assert.equal(result.optionsDigest, COMPILER_SNAPSHOT_OPTIONS_DIGEST);
  assert.deepEqual([...result.outputs.keys()].sort(), ["entry.js", "value.js"]);
  assert.equal(result.outputs.get("value.js"), 'export const value = "snapshot-A";\n');
  assert.equal(result.outputs.get("entry.js"), 'import { value } from "./value.js";\nexport const observed = value;\n');
  assert.equal(result.emittedOutput, compilerInventoryDigestForTest(result.outputs));
});
test("real compiler output and consumed input change together for different same-path source bytes", () => {
  const a = fixedCompilerSourcesForTest(), b = fixedCompilerSourcesForTest();
  b.set("value.ts", COMPILER_SNAPSHOT_VALUE_B);
  const left = compileRuntimeSnapshotForTest(a), right = compileRuntimeSnapshotForTest(b);
  assert.notEqual(left.consumedInput, right.consumedInput);
  assert.notEqual(left.emittedOutput, right.emittedOutput);
  assert.equal(right.outputs.get("value.js"), 'export const value = "snapshot-B";\n');
  assert.equal(left.outputs.get("entry.js"), right.outputs.get("entry.js"));
});
test("source snapshot survives caller Map replacement after session creation", () => {
  const inputs = fixedCompilerSourcesForTest(), expected = compilerInventoryDigestForTest(inputs);
  const session = createCompilerSnapshotSessionForTest(inputs);
  inputs.set("value.ts", COMPILER_SNAPSHOT_VALUE_B); inputs.delete("lib.d.ts");
  const p = ts.createProgram(["/c2c2/lib.d.ts", "/c2c2/entry.ts"], session.compilerOptions, session.host);
  assert.deepEqual(ts.getPreEmitDiagnostics(p), []); assert.equal(p.emit().emitSkipped, false);
  const result = session.finish(p.getSourceFiles());
  assert.equal(result.consumedInput, expected);
  assert.equal(result.outputs.get("value.js"), 'export const value = "snapshot-A";\n');
});
test("real invalid import and type diagnostic cannot produce a success observation", () => {
  const missing = fixedCompilerSourcesForTest(); missing.set("entry.ts", 'import "forbidden";\n');
  rejects(() => compileRuntimeSnapshotForTest(missing), "UNLISTED_RESOLUTION");
  const typeError = fixedCompilerSourcesForTest(); typeError.set("value.ts", "export const value: string = 42;\n");
  rejects(() => compileRuntimeSnapshotForTest(typeError), "COMPILER_DIAGNOSTIC");
  rejects(() => compileRuntimeSnapshotForTest(fixedCompilerSourcesForTest(), "stale_output"), "STALE_OUTPUT");
  rejects(() => compileRuntimeSnapshotForTest(fixedCompilerSourcesForTest(), "extra_output"), "UNLISTED_OUTPUT");
});
test("exact input set and UTF-8 byte bounds are enforced before compiler allocation", () => {
  const missing = fixedCompilerSourcesForTest(); missing.delete("value.ts");
  rejects(() => createCompilerSnapshotSessionForTest(missing), "INCOMPLETE_INPUT");
  const extra = fixedCompilerSourcesForTest(); extra.set("private.ts", "SECRET");
  rejects(() => createCompilerSnapshotSessionForTest(extra), "INCOMPLETE_INPUT");
  for (const text of ["x".repeat(16_385), "é".repeat(8_193)]) {
    const input = fixedCompilerSourcesForTest(); input.set("value.ts", text);
    rejects(() => createCompilerSnapshotSessionForTest(input), "INPUT_LIMIT");
  }
  const boundary = new Map(COMPILER_INPUT_IDS.map((id) => [id, "é".repeat(8_192)]));
  const session = createCompilerSnapshotSessionForTest(boundary);
  assert.equal(Buffer.byteLength(session.host.readFile("/c2c2/value.ts")!), 16_384);
  const invalid = fixedCompilerSourcesForTest(); invalid.set("value.ts", "\ud800");
  rejects(() => createCompilerSnapshotSessionForTest(invalid), "INPUT_INVALID");
});
test("host denies unknown paths and package resolution without filesystem fallback", () => {
  for (const invoke of [
    (s: ReturnType<typeof prepared>) => s.session.host.readFile("/SECRET"),
    (s: ReturnType<typeof prepared>) => s.session.host.fileExists("/c2c2/package.json"),
    (s: ReturnType<typeof prepared>) => s.session.host.getSourceFile("/c2c2/../private.ts", ts.ScriptTarget.ES2022),
  ]) rejects(() => invoke(prepared()), "UNLISTED_READ");
  const { session } = prepared();
  rejects(() => session.host.resolveModuleNames!(["../value.js"], "/c2c2/entry.ts", undefined, undefined, session.compilerOptions), "UNLISTED_RESOLUTION");
});
test("source and resolution request counts cannot grow past their frozen caps", () => {
  const session = createCompilerSnapshotSessionForTest(fixedCompilerSourcesForTest());
  for (let i = 0; i < 16; i++) session.host.readFile("/c2c2/value.ts");
  rejects(() => session.host.readFile("/c2c2/value.ts"), "READ_LIMIT");
  const other = createCompilerSnapshotSessionForTest(fixedCompilerSourcesForTest());
  const resolve = () => other.host.resolveModuleNames!(["./value.js"], "/c2c2/entry.ts", undefined, undefined, other.compilerOptions);
  for (let i = 0; i < 8; i++) resolve();
  rejects(resolve, "RESOLUTION_LIMIT");
});
test("missing source consumption and missing outputs cannot close successfully", () => {
  const a = prepared(); a.write("entry"); a.write("value");
  rejects(() => a.session.finish(a.sources.slice(0, 2)), "INCOMPLETE_INPUT");
  const b = prepared(); b.write("entry");
  rejects(() => b.session.finish(b.sources), "INCOMPLETE_OUTPUT");
});
test("AST text changes, substituted source objects and changed options are rejected", () => {
  const a = prepared(); a.write("entry"); a.write("value");
  a.sources[0]!.text += "\n// changed";
  rejects(() => a.session.finish(a.sources), "SOURCE_MISMATCH");
  const b = prepared(); b.write("entry"); b.write("value");
  b.sources[0] = ts.createSourceFile(b.sources[0]!.fileName, b.sources[0]!.text, ts.ScriptTarget.ES2022);
  rejects(() => b.session.finish(b.sources), "SOURCE_MISMATCH");
  const c = prepared(); c.write("entry"); c.write("value"); c.session.compilerOptions.sourceMap = true;
  rejects(() => c.session.finish(c.sources), "SOURCE_MISMATCH");
});
test("emit requires the exact provided source object, output id, no BOM and valid UTF-8", () => {
  const a = prepared();
  rejects(() => a.session.host.writeFile("/c2c2/out/entry.js", "export {};", false), "SOURCE_MISMATCH");
  const b = prepared();
  rejects(() => b.session.host.writeFile("/c2c2/out/extra.js", "export {};", false), "UNLISTED_OUTPUT");
  const c = prepared();
  rejects(() => c.session.host.writeFile("/c2c2/out/entry.js", "export {};", true, undefined, [c.sources[0]!]), "OUTPUT_MISMATCH");
  const d = prepared(); rejects(() => d.write("entry", "\ud800"), "OUTPUT_MISMATCH");
  const e = prepared();
  const separate = ts.createSourceFile(e.sources[0]!.fileName, e.sources[0]!.text, ts.ScriptTarget.ES2022);
  rejects(() => e.session.host.writeFile("/c2c2/out/entry.js", "export {};", false, undefined, [separate]), "SOURCE_MISMATCH");
});
test("output byte cap accepts exactly 16384 and rejects one more UTF-8 byte", () => {
  const a = prepared(); a.write("entry", "é".repeat(8_192)); a.write("value", "x".repeat(16_384));
  assert.equal(a.session.finish(a.sources).outputs.size, 2);
  const b = prepared(); rejects(() => b.write("entry", "é".repeat(8_192) + "x"), "OUTPUT_LIMIT");
});
test("duplicate writes and first failure remain terminal even if later valid output arrives", () => {
  const a = prepared(); a.write("entry");
  rejects(() => a.write("entry"), "DUPLICATE_OUTPUT");
  a.write("value"); rejects(() => a.session.finish(a.sources), "DUPLICATE_OUTPUT");
  rejects(() => a.session.host.readFile("/private"), "DUPLICATE_OUTPUT");
});
test("inventory digest includes logical identity and length while ignoring Map insertion order", () => {
  const input = fixedCompilerSourcesForTest();
  assert.equal(compilerInventoryDigestForTest(input), compilerInventoryDigestForTest(new Map([...input].reverse())));
  const renamed = new Map(input); renamed.set("other.ts", renamed.get("value.ts")!); renamed.delete("value.ts");
  assert.notEqual(compilerInventoryDigestForTest(input), compilerInventoryDigestForTest(renamed));
});
