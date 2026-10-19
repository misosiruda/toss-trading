import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink, link, rename, unlink, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runCompilerLoad, createCompilerLoadObservationForTest, readCompilerLoadObservationForTest,
} from "./runtimeCompilerLoadHarnessTestFixtures.js";
import { readCompilerLoadFileForTest, prepareCompilerLoadFixture } from "./runtimeCompilerLoadPreparationTestFixtures.js";
import { COMPILER_LOAD_CASES, COMPILER_ARTIFACT_A, COMPILER_ARTIFACT_B, COMPILER_ARTIFACT_A_BYTES,
  COMPILER_ARTIFACT_B_BYTES, COMPILER_ARTIFACT_LIMIT, COMPILER_LOAD_INPUT, COMPILER_LOAD_OUTPUT,
  COMPILER_LOAD_BUILTINS, COMPILER_LOAD_REJECTIONS, COMPILER_LOAD_MAX_WIRE_BYTES,
  parseCompilerLoadReport, type CompilerLoadCaseId, type CompilerLoadReport } from "./runtimeCompilerLoadProtocolTestFixtures.js";

const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64";
const encode = (v: unknown): Buffer => Buffer.from(JSON.stringify(v) + "\n");
function report(caseId: CompilerLoadCaseId = "snapshot_baseline"): CompilerLoadReport {
  const counter = caseId === "reread_during_disk_aba";
  return { schemaVersion: "compiler_load_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false,
    status: counter ? "counterexample" : "observed", evidence: "fixed_compiler_load_observation", compilerVersion: "5.9.3",
    artifactBytes: counter ? COMPILER_ARTIFACT_B_BYTES : COMPILER_ARTIFACT_A_BYTES,
    capturedArtifact: COMPILER_ARTIFACT_A, suppliedArtifact: counter ? COMPILER_ARTIFACT_B : COMPILER_ARTIFACT_A,
    restoredArtifact: COMPILER_ARTIFACT_A, captureMatchesSupplied: !counter, diskBeforeAfterMatch: true,
    compilerLoadCount: 1, builtinLoads: COMPILER_LOAD_BUILTINS, cacheSameObject: true, observedMarker: counter ? 202 : 0,
    inputDigest: COMPILER_LOAD_INPUT, outputDigest: COMPILER_LOAD_OUTPUT, callbackCount: caseId === "callback_cap" ? 32 : 12 };
}
test("compiler-load actual artifact supply, ABA and latched failure cases", { skip: !supported }, async t => {
  const positive = new Map<string, CompilerLoadReport>();
  const rejected: Record<string, string> = { cache_before_hook: "CACHE_PREPOPULATED", artifact_mismatch: "ARTIFACT_MISMATCH",
    unlisted_builtin: "LOAD_UNLISTED", unlisted_module: "LOAD_UNLISTED", callback_cap_over: "LOAD_LIMIT", artifact_cap_over: "ARTIFACT_LIMIT" };
  for (const caseId of COMPILER_LOAD_CASES) await t.test(caseId, async () => {
    const observation = createCompilerLoadObservationForTest();
    const pending = runCompilerLoad(caseId, observation);
    const result = await pending;
    let assertionMessage = JSON.stringify(result);
    if (result.status !== "collected") {
      assertionMessage += "; cleanupObservation=unavailable";
      try {
        const text = JSON.stringify({ result,
          cleanupObservation: readCompilerLoadObservationForTest(observation, pending) });
        if (Buffer.byteLength(text, "utf8") <= 4_096) assertionMessage = text;
      } catch { /* Diagnostic failure preserves the existing assertion. */ }
    }
    assert.equal(result.status, "collected", assertionMessage);
    if (result.status !== "collected") return;
    assert.equal(result.termination, "confirmed"); assert.equal(result.cleanup, "removed");
    if (rejected[caseId]) {
      assert.equal(result.report.status, "rejected");
      if (result.report.status === "rejected") assert.equal(result.report.reason, rejected[caseId]);
    } else { assert.deepEqual(result.report, report(caseId)); positive.set(caseId, result.report); }
  });
  const baseline = positive.get("snapshot_baseline")!;
  const snapshot = positive.get("snapshot_after_disk_aba")!;
  const reread = positive.get("reread_during_disk_aba")!;
  assert.ok(baseline.status !== "rejected" && snapshot.status !== "rejected" && reread.status !== "rejected");
  assert.equal(snapshot.suppliedArtifact, baseline.suppliedArtifact);
  assert.notEqual(reread.suppliedArtifact, baseline.suppliedArtifact);
  assert.equal(reread.restoredArtifact, baseline.restoredArtifact);
  assert.equal(reread.outputDigest, baseline.outputDigest); // Same output cannot certify the compiler artifact.
  assert.equal(reread.observedMarker, 202); assert.equal(baseline.observedMarker, 0);
});
test("compiler-load child does not inherit hostile preload/configuration environment", { skip: !supported }, async () => {
  const keys = ["NODE_OPTIONS", "NODE_COMPILE_CACHE", "TS_NODE_PROJECT"];
  const prior = keys.map(k => process.env[k]);
  try {
    process.env.NODE_OPTIONS = "--require /unlisted-preload.cjs";
    process.env.NODE_COMPILE_CACHE = "/unlisted-cache"; process.env.TS_NODE_PROJECT = "/unlisted-config";
    const result = await runCompilerLoad("snapshot_baseline");
    assert.equal(result.status, "collected");
    if (result.status === "collected") assert.deepEqual(result.report, report());
  } finally { keys.forEach((k,i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; }); }
});
test("compiler-load fixed schema maximum is 1041 bytes and all rejections retain unavailable", () => {
  for (const [id, length] of [["snapshot_baseline",1027],["snapshot_after_disk_aba",1033],["reread_during_disk_aba",1041],["callback_cap",1022]] as const) {
    const bytes = encode(report(id)); assert.equal(bytes.length, length); assert.deepEqual(parseCompilerLoadReport(bytes,id), report(id));
  }
  assert.equal(encode(report("reread_during_disk_aba")).length, COMPILER_LOAD_MAX_WIRE_BYTES);
  for (const caseId of COMPILER_LOAD_CASES) for (const reason of COMPILER_LOAD_REJECTIONS) {
    const base = report(caseId);
    const value = { schemaVersion: base.schemaVersion, caseId, runtime: "unavailable", dependencies: "unavailable",
      result: "unavailable", comparability: "unavailable", completeRuntime: false, completeConfiguration: false,
      completeInput: false, status: "rejected", evidence: "unavailable", reason };
    assert.deepEqual(parseCompilerLoadReport(encode(value),caseId),value);
  }
});
test("compiler-load protocol rejects framing, promotion, missing fields and semantic contradictions", () => {
  const good = report(), bytes = encode(good);
  const bad = (b: Buffer): void => { assert.throws(() => parseCompilerLoadReport(b,"snapshot_baseline"), {message:"INVALID_REPORT"}); };
  for (const b of [Buffer.alloc(0), bytes.subarray(0,-1), Buffer.concat([bytes,bytes]), Buffer.concat([Buffer.from(" "),bytes]),
    Buffer.concat([Buffer.from([239,187,191]),bytes]), Buffer.from([195,40]), Buffer.alloc(1042),
    Buffer.from(bytes.toString().replace('"caseId":','"caseId":"snapshot_baseline","caseId":'))]) bad(b);
  const variants: unknown[] = [null,[],4,{...good,extra:"PRIVATE"}, {...good,completeRuntime:true}, {...good,completeInput:true},
    {...good,completeConfiguration:true}, {...good,runtime:"available"}, {...good,dependencies:"verified"}, {...good,result:"complete"},
    {...good,comparability:"available"}, {...good,status:"counterexample"}, {...good,artifactBytes:1}, {...good,observedMarker:202},
    {...good,suppliedArtifact:COMPILER_ARTIFACT_B}, {...good,capturedArtifact:COMPILER_ARTIFACT_B}, {...good,restoredArtifact:COMPILER_ARTIFACT_B},
    {...good,inputDigest:COMPILER_ARTIFACT_A}, {...good,outputDigest:COMPILER_ARTIFACT_B}, {...good,compilerVersion:"5.9.4"},
    {...good,captureMatchesSupplied:false}, {...good,diskBeforeAfterMatch:false}, {...good,compilerLoadCount:0}, {...good,cacheSameObject:false},
    {...good,builtinLoads:["fs"]}, {...good,builtinLoads:[...COMPILER_LOAD_BUILTINS,"fs"]}, {...good,callbackCount:32}];
  for (const key of Object.keys(good)) { const v = {...good} as Record<string,unknown>; delete v[key]; variants.push(v); }
  variants.forEach(v => bad(encode(v)));
  for (const id of ["cache_before_hook","artifact_mismatch","unlisted_builtin","unlisted_module"] as const)
    assert.throws(() => parseCompilerLoadReport(encode(report(id)),id), {message:"INVALID_REPORT"});
});
test("compiler-load bounded reader rejects links, replacements, malformed UTF8 and overflow", {skip:process.platform!=="linux"}, async () => {
  const root = await mkdtemp(join(tmpdir(),"compiler-reader-test-"));
  const file = join(root,"source");
  try {
    await writeFile(file,"A".repeat(32)); assert.equal((await readCompilerLoadFileForTest(file,32)).length,32);
    await writeFile(file,"A".repeat(33)); await assert.rejects(readCompilerLoadFileForTest(file,32), /FILE_LIMIT/);
    await writeFile(file,Buffer.from([195,40])); await assert.rejects(readCompilerLoadFileForTest(file,32));
    await writeFile(file,"same"); await link(file,join(root,"hard")); await assert.rejects(readCompilerLoadFileForTest(file,32),/FILE_UNSAFE/);
    await unlink(join(root,"hard")); await symlink(file,join(root,"symbolic")); await assert.rejects(readCompilerLoadFileForTest(join(root,"symbolic"),32),/FILE_UNSAFE/);
    await assert.rejects(readCompilerLoadFileForTest(root,32),/FILE_UNSAFE/);
    await assert.rejects(readCompilerLoadFileForTest(file,32,async()=>{await rename(file,join(root,"old"));await writeFile(file,"same");}),/FILE_CHANGED/);
    await assert.rejects(readCompilerLoadFileForTest(file,32,async()=>{await unlink(file);}));
    await writeFile(file,"a"); await assert.rejects(readCompilerLoadFileForTest(file,0),/FILE_LIMIT/);
    await assert.rejects(readCompilerLoadFileForTest(file,COMPILER_ARTIFACT_LIMIT+1),/FILE_LIMIT/);
    await writeFile(file," ".repeat(COMPILER_ARTIFACT_LIMIT)); assert.equal((await readCompilerLoadFileForTest(file,COMPILER_ARTIFACT_LIMIT)).length,COMPILER_ARTIFACT_LIMIT);
    await writeFile(file," ".repeat(COMPILER_ARTIFACT_LIMIT+1)); await assert.rejects(readCompilerLoadFileForTest(file,COMPILER_ARTIFACT_LIMIT),/FILE_LIMIT/);
  } finally { await rm(root,{recursive:true,force:false,maxRetries:0}); }
});
test("compiler-load preparation copies exact pinned artifact and builtin-only bounded bootstrap exclusively", {skip:!supported}, async () => {
  const root = await mkdtemp(join(tmpdir(),"compiler-preparation-test-"));
  try {
    const child = await prepareCompilerLoadFixture("snapshot_baseline",root);
    const artifact = await readFile(join(root,"compiler.cjs"));
    assert.equal(artifact.length,COMPILER_ARTIFACT_A_BYTES);
    assert.equal("sha256:"+createHash("sha256").update(artifact).digest("hex"),COMPILER_ARTIFACT_A);
    const bootstrap = await readFile(child,"utf8");
    assert.ok(Buffer.byteLength(bootstrap)<=65536);
    assert.ok(!/from ["'](?!node:)/.test(bootstrap));
    assert.equal((await stat(child)).mode & 0o777,0o600);
    await assert.rejects(prepareCompilerLoadFixture("snapshot_baseline",root),/FIXTURE_PREPARATION_FAILED/);
    assert.deepEqual(await readFile(join(root,"compiler.cjs")),artifact);
  } finally { await rm(root,{recursive:true,force:false,maxRetries:0}); }
});
test("compiler-load bootstrap source keeps compiler and protocol imports type-only", async () => {
  const source = await readFile("src/replay/runtimeCompilerLoadTestChild.ts", "utf8");
  const imports = source.split("\n").filter(line => line.startsWith("import "));
  assert.ok(imports.some(line => line === 'import type ts from "typescript";'));
  for (const line of imports) assert.ok(line.startsWith("import type ") || /from "node:[a-z]+";$/.test(line));
});
