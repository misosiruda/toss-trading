import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink, link, rename, unlink, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runCompilerBuild } from "./runtimeCompilerBuildHarnessTestFixtures.js";
import { readCompilerBuildFileForTest, prepareCompilerBuildFixture } from "./runtimeCompilerBuildPreparationTestFixtures.js";
import { COMPILER_BUILD_POSITIVE_CASES, COMPILER_BUILD_NEGATIVE_CASES, COMPILER_BUILD_CONSTANTS, COMPILER_ARTIFACT_LIMIT,
  compilerBuildSourcesForTest, expectedCompilerBuildObservationForTest, type CompilerBuildReport } from "./runtimeCompilerBuildProtocolTestFixtures.js";
const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64";

test("compiler-build actual single-child pinned load, Program and emit observations", { skip: !supported }, async t => {
  const positive = new Map<string, Exclude<CompilerBuildReport,{status:"rejected"}>>();
  for (const caseId of COMPILER_BUILD_POSITIVE_CASES) await t.test(caseId, async () => {
    const result = await runCompilerBuild(caseId);
    assert.equal(result.status,"collected",JSON.stringify(result));
    if(result.status!=="collected")return;
    assert.deepEqual(result.report,expectedCompilerBuildObservationForTest(caseId));
    assert.equal(result.termination,"confirmed"); assert.equal(result.cleanup,"removed");
    assert.notEqual(result.report.status,"rejected");
    if(result.report.status!=="rejected")positive.set(caseId,result.report);
  });
  const a=positive.get("baseline")!,c=positive.get("compiler_reread_aba")!,i=positive.get("input_reread_aba")!,b=positive.get("both_reread_aba")!;
  assert.ok(a&&c&&i&&b);
  assert.equal(a.emittedOutput,c.emittedOutput); assert.notEqual(a.suppliedArtifact,c.suppliedArtifact);
  assert.equal(a.suppliedArtifact,i.suppliedArtifact); assert.notEqual(a.emittedOutput,i.emittedOutput);
  assert.equal(c.suppliedArtifact,b.suppliedArtifact); assert.equal(i.emittedOutput,b.emittedOutput);
  assert.equal(b.restoredArtifact,a.capturedArtifact); assert.equal(b.restoredInput,a.capturedInput);
});
test("compiler-build actual fixed negative cases keep first failure without promoting evidence", { skip: !supported }, async t => {
  for(const caseId of Object.keys(COMPILER_BUILD_NEGATIVE_CASES) as (keyof typeof COMPILER_BUILD_NEGATIVE_CASES)[]) {
    if(caseId==="restore_failure")continue;
    await t.test(caseId,async()=>{
      const result=await runCompilerBuild(caseId);
      assert.equal(result.status,"collected",JSON.stringify(result));
      if(result.status!=="collected")return;
      assert.equal(result.report.status,"rejected",JSON.stringify(result.report));
      if(result.report.status!=="rejected")return;
      assert.equal(result.report.reason,COMPILER_BUILD_NEGATIVE_CASES[caseId]);
      assert.equal(result.report.artifactRestoration,"confirmed"); assert.equal(result.report.inputRestoration,"confirmed");
      assert.equal(result.report.evidence,"unavailable"); assert.equal(result.report.completeInput,false);
    });
  }
});
test("compiler-build child does not inherit hostile preload/configuration environment", { skip: !supported }, async () => {
  const keys=["NODE_OPTIONS","NODE_COMPILE_CACHE","TS_NODE_PROJECT"],prior=keys.map(k=>process.env[k]);
  try {
    process.env.NODE_OPTIONS="--require /unlisted-preload.cjs";
    process.env.NODE_COMPILE_CACHE="/unlisted-cache";process.env.TS_NODE_PROJECT="/unlisted-config";
    const result=await runCompilerBuild("baseline");
    assert.equal(result.status,"collected",JSON.stringify(result));
    if(result.status==="collected")assert.deepEqual(result.report,expectedCompilerBuildObservationForTest("baseline"));
  } finally { keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];}); }
});
test("compiler-build bounded reader rejects links, replacements, malformed UTF8 and overflow", {skip:process.platform!=="linux"}, async () => {
  const root = await mkdtemp(join(tmpdir(),"compiler-reader-test-"));
  const file = join(root,"source");
  try {
    await writeFile(file,"A".repeat(32)); assert.equal((await readCompilerBuildFileForTest(file,32)).length,32);
    await writeFile(file,"A".repeat(33)); await assert.rejects(readCompilerBuildFileForTest(file,32), /FILE_LIMIT/);
    await writeFile(file,Buffer.from([195,40])); await assert.rejects(readCompilerBuildFileForTest(file,32));
    await writeFile(file,"same"); await link(file,join(root,"hard")); await assert.rejects(readCompilerBuildFileForTest(file,32),/FILE_UNSAFE/);
    await unlink(join(root,"hard")); await symlink(file,join(root,"symbolic")); await assert.rejects(readCompilerBuildFileForTest(join(root,"symbolic"),32),/FILE_UNSAFE/);
    await assert.rejects(readCompilerBuildFileForTest(root,32),/FILE_UNSAFE/);
    await assert.rejects(readCompilerBuildFileForTest(file,32,async()=>{await rename(file,join(root,"old"));await writeFile(file,"same");}),/FILE_CHANGED/);
    await assert.rejects(readCompilerBuildFileForTest(file,32,async()=>{await unlink(file);}));
    await writeFile(file,"é".repeat(8192)); assert.equal(Buffer.byteLength(await readCompilerBuildFileForTest(file,16384)),16384);
    await writeFile(file,"é".repeat(8192)+"a"); await assert.rejects(readCompilerBuildFileForTest(file,16384),/FILE_LIMIT/);
    await writeFile(file,"a"); await assert.rejects(readCompilerBuildFileForTest(file,0),/FILE_LIMIT/);
    await assert.rejects(readCompilerBuildFileForTest(file,COMPILER_ARTIFACT_LIMIT+1),/FILE_LIMIT/);
    await writeFile(file," ".repeat(COMPILER_ARTIFACT_LIMIT)); assert.equal((await readCompilerBuildFileForTest(file,COMPILER_ARTIFACT_LIMIT)).length,COMPILER_ARTIFACT_LIMIT);
    await writeFile(file," ".repeat(COMPILER_ARTIFACT_LIMIT+1)); await assert.rejects(readCompilerBuildFileForTest(file,COMPILER_ARTIFACT_LIMIT),/FILE_LIMIT/);
  } finally { await rm(root,{recursive:true,force:false,maxRetries:0}); }
});
test("compiler-build preparation copies exact pinned artifact and builtin-only bounded bootstrap exclusively", {skip:!supported}, async () => {
  const root = await mkdtemp(join(tmpdir(),"compiler-preparation-test-"));
  try {
    const child = await prepareCompilerBuildFixture("baseline",root);
    const artifact = await readFile(join(root,"compiler.cjs"));
    assert.equal(artifact.length,9112572);
    assert.equal("sha256:"+createHash("sha256").update(artifact).digest("hex"),COMPILER_BUILD_CONSTANTS.artifactA);
    const bootstrap = await readFile(child,"utf8");
    assert.ok(Buffer.byteLength(bootstrap)<=65536);
    assert.ok(!/from ["'](?!node:)/.test(bootstrap));
    assert.equal((await stat(child)).mode & 0o777,0o600);
    for (const [name, text] of compilerBuildSourcesForTest())
      assert.equal(await readFile(join(root,"inputs",name),"utf8"),text);
    await assert.rejects(prepareCompilerBuildFixture("baseline",root),/FIXTURE_PREPARATION_FAILED/);
    assert.deepEqual(await readFile(join(root,"compiler.cjs")),artifact);
  } finally { await rm(root,{recursive:true,force:false,maxRetries:0}); }
});
test("compiler-build bootstrap source keeps compiler and protocol imports type-only", async () => {
  const source = await readFile("src/replay/runtimeCompilerBuildTestChild.ts", "utf8");
  const imports = source.split("\n").filter(line => line.startsWith("import "));
  assert.ok(imports.some(line => line === 'import type ts from "typescript";'));
  for (const line of imports) assert.ok(line.startsWith("import type ") || /from "node:[a-z]+";$/.test(line));
});

// Last real harness invocation: this deliberate restoration fault permanently halts it.
test("compiler-build actual restoration failure retains original rejection, root and halt", { skip: !supported }, async () => {
  const result=await runCompilerBuild("restore_failure");
  assert.equal(result.status,"failed",JSON.stringify(result));
  if(result.status!=="failed")return;
  assert.equal(result.reason,"RESTORE_UNCONFIRMED"); assert.equal(result.termination,"confirmed"); assert.equal(result.cleanup,"retained");
  assert.equal(result.report?.reason,"COMPILER_DIAGNOSTIC");
  assert.equal(result.report?.artifactRestoration,"unconfirmed"); assert.equal(result.report?.inputRestoration,"unconfirmed");
  assert.deepEqual(await runCompilerBuild("baseline"),{status:"failed",reason:"RESTORE_UNCONFIRMED",report:null,termination:"not_started",cleanup:"not_created"});
});
