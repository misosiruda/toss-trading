import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, writeFile, symlink, link, rename, unlink, readFile, stat, lstat, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runCompilerOutput, compilerOutputPreservedRootsForTest } from "./runtimeCompilerOutputHarnessTestFixtures.js";
import { readCompilerOutputFileForTest, prepareCompilerOutputFixture } from "./runtimeCompilerOutputPreparationTestFixtures.js";
import { COMPILER_OUTPUT_POSITIVE_CASES, COMPILER_OUTPUT_NEGATIVE_CASES, COMPILER_OUTPUT_CONSTANTS, COMPILER_ARTIFACT_LIMIT,
  compilerOutputSourcesForTest, expectedCompilerOutputObservationForTest, type CompilerOutputReport, type CompilerOutputCaseId, type CompilerOutputParentResult } from "./runtimeCompilerOutputProtocolTestFixtures.js";
const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64";

async function observeOutput(caseId: CompilerOutputCaseId): Promise<CompilerOutputParentResult> {
  const result = await runCompilerOutput(caseId);
  if (result.cleanup !== "not_created") {
    const owned = compilerOutputPreservedRootsForTest().at(-1);
    assert.equal(owned?.caseId, caseId);
    console.log(JSON.stringify({ evidence: "C5_terminal", owned, result }));
  }
  return result;
}
const extraRoots: { kind: string; root: string }[] = [];
after(async () => {
  if (!supported) return;
  const records = compilerOutputPreservedRootsForTest();
  let complete = true;
  for (const [index, record] of records.entries()) {
    if (!record.spawned || !record.closed || !Number.isInteger(record.pid)) complete = false;
    const files: { path: string; bytes?: number; sha256?: string; status: string }[] = [];
    for (const path of ["compiler.cjs", "bootstrap.mjs", "inputs/entry.ts", "inputs/value.ts", "inputs/lib.d.ts", "outputs/entry.js", "outputs/value.js"]) {
      try {
        const bytes = await readFile(join(record.root, path));
        files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), status: "recorded" });
      } catch { complete = false; files.push({ path, status: "read_unconfirmed" }); }
    }
    if (files.reduce((sum, file) => sum + (file.bytes ?? 0), 0) > 10 * 1024 * 1024 + 65536 + 49152 + 32768 + 1) complete = false;
    console.log(JSON.stringify({ evidence: "C5_retained_root", ordinal: index + 1, ...record, files }));
  }
  for (const record of extraRoots) {
    const files: { path: string; bytes?: number; sha256?: string; link?: string; status: string }[] = [];
    const visit = async (relative: string): Promise<void> => {
      try {
        const path = join(record.root, relative), info = await lstat(path);
        if (info.isSymbolicLink()) files.push({ path: relative, link: await readlink(path), status: "symlink_recorded" });
        else if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(join(relative, name));
        else {
          const bytes = await readFile(path);
          files.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), status: "recorded" });
        }
      } catch { complete = false; files.push({ path: relative, status: "read_unconfirmed" }); }
    };
    await visit("");
    console.log(JSON.stringify({ evidence: "C5_retained_extra_root", ...record, files }));
  }
  // Record partial failures first; no failed assertion may erase the roots already allocated.
  assert.equal(records.length, 40);
  assert.equal(complete, true);
});


test("compiler-output actual single-child pinned compiler, Program, actual emit supply and ESM import observations", { skip: !supported }, async t => {
  const positive = new Map<string, Exclude<CompilerOutputReport,{status:"rejected"}>>();
  for (const caseId of COMPILER_OUTPUT_POSITIVE_CASES) await t.test(caseId, async () => {
    const result = await observeOutput(caseId);
    assert.equal(result.status,"collected",JSON.stringify(result));
    if(result.status!=="collected")return;
    assert.deepEqual(result.report,expectedCompilerOutputObservationForTest(caseId));
    assert.equal(result.termination,"confirmed"); assert.equal(result.cleanup,"cleanup_not_performed");
    assert.notEqual(result.report.status,"rejected");
    if(result.report.status!=="rejected")positive.set(caseId,result.report);
  });
  const a=positive.get("baseline")!,r=positive.get("output_reread_aba")!,s=positive.get("output_same_value_substitution")!,
    c=positive.get("cache_before_hook")!,h=positive.get("hook_rewrite")!;
  assert.ok(a&&r&&s&&c&&h);
  assert.equal(a.emittedOutput,r.emittedOutput);assert.notEqual(a.suppliedOutput,r.suppliedOutput);
  assert.equal(a.restoredOutput,r.restoredOutput);assert.notEqual(a.observedValue,r.observedValue);
  assert.equal(a.observedValue,s.observedValue);assert.notEqual(a.suppliedOutput,s.suppliedOutput);
  assert.equal(c.suppliedOutput,"unavailable");assert.equal(c.outputLoadCount,0);
  assert.equal(c.preloadedOutput,r.suppliedOutput);assert.equal(c.observedValue,r.observedValue);
  assert.equal(h.suppliedOutput,a.suppliedOutput);assert.notEqual(h.observedValue,a.observedValue);
});
test("compiler-output actual fixed negative cases keep first failure without promoting evidence", { skip: !supported }, async t => {
  for(const caseId of Object.keys(COMPILER_OUTPUT_NEGATIVE_CASES) as (keyof typeof COMPILER_OUTPUT_NEGATIVE_CASES)[]) {
    if(caseId==="restore_failure")continue;
    await t.test(caseId,async()=>{
      const result=await observeOutput(caseId);
      assert.equal(result.status,"collected",JSON.stringify(result));
      if(result.status!=="collected")return;
      assert.equal(result.report.status,"rejected",JSON.stringify(result.report));
      if(result.report.status!=="rejected")return;
      assert.equal(result.report.reason,COMPILER_OUTPUT_NEGATIVE_CASES[caseId]);
      assert.equal(result.report.artifactRestoration,"confirmed"); assert.equal(result.report.inputRestoration,"confirmed"); assert.equal(result.report.outputRestoration,"confirmed");
      assert.equal(result.report.evidence,"unavailable"); assert.equal(result.report.completeInput,false);
    });
  }
});
test("compiler-output child does not inherit hostile preload/configuration environment", { skip: !supported }, async () => {
  const keys=["NODE_OPTIONS","NODE_COMPILE_CACHE","TS_NODE_PROJECT"],prior=keys.map(k=>process.env[k]);
  try {
    process.env.NODE_OPTIONS="--require /unlisted-preload.cjs";
    process.env.NODE_COMPILE_CACHE="/unlisted-cache";process.env.TS_NODE_PROJECT="/unlisted-config";
    const result=await observeOutput("baseline");
    assert.equal(result.status,"collected",JSON.stringify(result));
    if(result.status==="collected")assert.deepEqual(result.report,expectedCompilerOutputObservationForTest("baseline"));
  } finally { keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];}); }
});
test("compiler-output bounded reader rejects links, replacements, malformed UTF8 and overflow", {skip:process.platform!=="linux"}, async () => {
  const root = await mkdtemp(join(tmpdir(),"compiler-output-reader-test-"));
  extraRoots.push({ kind: "reader", root });
  const file = join(root,"source");
  {
    await writeFile(file,"A".repeat(32)); assert.equal((await readCompilerOutputFileForTest(file,32)).length,32);
    await writeFile(file,"A".repeat(33)); await assert.rejects(readCompilerOutputFileForTest(file,32), /FILE_LIMIT/);
    await writeFile(file,Buffer.from([195,40])); await assert.rejects(readCompilerOutputFileForTest(file,32));
    await writeFile(file,"same"); await link(file,join(root,"hard")); await assert.rejects(readCompilerOutputFileForTest(file,32),/FILE_UNSAFE/);
    await unlink(join(root,"hard")); await symlink(file,join(root,"symbolic")); await assert.rejects(readCompilerOutputFileForTest(join(root,"symbolic"),32),/FILE_UNSAFE/);
    await assert.rejects(readCompilerOutputFileForTest(root,32),/FILE_UNSAFE/);
    await assert.rejects(readCompilerOutputFileForTest(file,32,async()=>{await rename(file,join(root,"old"));await writeFile(file,"same");}),/FILE_CHANGED/);
    await assert.rejects(readCompilerOutputFileForTest(file,32,async()=>{await unlink(file);}));
    await writeFile(file,"é".repeat(8192)); assert.equal(Buffer.byteLength(await readCompilerOutputFileForTest(file,16384)),16384);
    await writeFile(file,"é".repeat(8192)+"a"); await assert.rejects(readCompilerOutputFileForTest(file,16384),/FILE_LIMIT/);
    await writeFile(file,"a"); await assert.rejects(readCompilerOutputFileForTest(file,0),/FILE_LIMIT/);
    await assert.rejects(readCompilerOutputFileForTest(file,COMPILER_ARTIFACT_LIMIT+1),/FILE_LIMIT/);
    await writeFile(file," ".repeat(COMPILER_ARTIFACT_LIMIT)); assert.equal((await readCompilerOutputFileForTest(file,COMPILER_ARTIFACT_LIMIT)).length,COMPILER_ARTIFACT_LIMIT);
    await writeFile(file," ".repeat(COMPILER_ARTIFACT_LIMIT+1)); await assert.rejects(readCompilerOutputFileForTest(file,COMPILER_ARTIFACT_LIMIT),/FILE_LIMIT/);
  }
  assert.ok((await lstat(root)).isDirectory());
});
test("compiler-output preparation copies exact pinned artifact and builtin-only bounded bootstrap exclusively", {skip:!supported}, async () => {
  const root = await mkdtemp(join(tmpdir(),"compiler-output-preparation-test-"));
  extraRoots.push({ kind: "preparation", root });
  {
    const child = await prepareCompilerOutputFixture("baseline",root);
    const artifact = await readFile(join(root,"compiler.cjs"));
    assert.equal(artifact.length,9112572);
    assert.equal("sha256:"+createHash("sha256").update(artifact).digest("hex"),COMPILER_OUTPUT_CONSTANTS.artifactA);
    const bootstrap = await readFile(child,"utf8");
    assert.ok(Buffer.byteLength(bootstrap)<=65536);
    assert.ok(!/from ["'](?!node:)/.test(bootstrap));
    assert.equal((await stat(child)).mode & 0o777,0o600);
    for (const name of ["entry.js","value.js"]) assert.ok((await lstat(join(root,"outputs",name))).isFile());
    for (const [name, text] of compilerOutputSourcesForTest())
      assert.equal(await readFile(join(root,"inputs",name),"utf8"),text);
    await assert.rejects(prepareCompilerOutputFixture("baseline",root),/FIXTURE_PREPARATION_FAILED/);
    assert.deepEqual(await readFile(join(root,"compiler.cjs")),artifact);
  }
  assert.ok((await lstat(root)).isDirectory());
});
test("compiler-output bootstrap source keeps compiler and protocol imports type-only", async () => {
  const source = await readFile("src/replay/runtimeCompilerOutputTestChild.ts", "utf8");
  const imports = source.split("\n").filter(line => line.startsWith("import "));
  assert.ok(imports.some(line => line === 'import type ts from "typescript";'));
  for (const line of imports) assert.ok(line.startsWith("import type ") || /from "node:[a-z]+";$/.test(line));
});

// Last real harness invocation: this deliberate restoration fault permanently halts it.
test("compiler-output actual restoration failure retains original rejection, root and halt", { skip: !supported }, async () => {
  const result=await observeOutput("restore_failure");
  assert.equal(result.status,"failed",JSON.stringify(result));
  if(result.status!=="failed")return;
  assert.equal(result.reason,"RESTORE_UNCONFIRMED"); assert.equal(result.termination,"confirmed"); assert.equal(result.cleanup,"cleanup_not_performed");
  assert.equal(result.report?.reason,"COMPILER_DIAGNOSTIC");
  assert.equal(result.report?.artifactRestoration,"confirmed"); assert.equal(result.report?.inputRestoration,"confirmed");
  assert.equal(result.report?.outputRestoration,"unconfirmed");
  assert.deepEqual(await observeOutput("baseline"),{status:"failed",reason:"RESTORE_UNCONFIRMED",report:null,termination:"not_started",cleanup:"not_created"});
});
