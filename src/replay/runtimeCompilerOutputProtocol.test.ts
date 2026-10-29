import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  COMPILER_OUTPUT_CASES, COMPILER_OUTPUT_POSITIVE_CASES, COMPILER_OUTPUT_REJECTIONS, COMPILER_OUTPUT_RESTORATION_STATES,
  COMPILER_OUTPUT_MAX_WIRE_BYTES, COMPILER_OUTPUT_MAX_REJECTED_BYTES, COMPILER_OUTPUT_CONSTANTS,
  COMPILER_OUTPUT_GOLDEN_OUTPUTS, compilerOutputSourcesForTest, compilerOutputCommonForTest,
  expectedCompilerOutputObservationForTest, parseCompilerOutputReport,
} from "./runtimeCompilerOutputProtocolTestFixtures.js";
const encode=(v:unknown):Buffer=>Buffer.from(JSON.stringify(v)+"\n");
test("compiler-output finite schema maximum counts every case, reason, restoration triple and LF",()=>{
  const lengths=[1248,1259,1263,1276,1263,1258,1252,1261];
  let observedMax=0,rejectedMax=0;
  for(const [index,id] of COMPILER_OUTPUT_POSITIVE_CASES.entries()){
    const value=expectedCompilerOutputObservationForTest(id),bytes=encode(value);
    assert.equal(bytes.length,lengths[index]);assert.deepEqual(parseCompilerOutputReport(bytes,id),value);
    observedMax=Math.max(observedMax,bytes.length);
  }
  for(const id of COMPILER_OUTPUT_CASES)for(const reason of COMPILER_OUTPUT_REJECTIONS)
    for(const artifactRestoration of COMPILER_OUTPUT_RESTORATION_STATES)for(const inputRestoration of COMPILER_OUTPUT_RESTORATION_STATES)for(const outputRestoration of COMPILER_OUTPUT_RESTORATION_STATES){
      const value={...compilerOutputCommonForTest(id),status:"rejected",evidence:"unavailable",reason,artifactRestoration,inputRestoration,outputRestoration};
      const bytes=encode(value);assert.deepEqual(parseCompilerOutputReport(bytes,id),value);rejectedMax=Math.max(rejectedMax,bytes.length);
    }
  assert.equal(observedMax,1276);assert.equal(observedMax,COMPILER_OUTPUT_MAX_WIRE_BYTES);
  assert.equal(rejectedMax,457);assert.equal(rejectedMax,COMPILER_OUTPUT_MAX_REJECTED_BYTES);
});
test("compiler-output parser rejects every missing or changed field, noncanonical framing and privacy markers",()=>{
  const good=expectedCompilerOutputObservationForTest("baseline"),bytes=encode(good);
  const bad=(b:Buffer):void=>{assert.throws(()=>parseCompilerOutputReport(b,"baseline"),{message:"INVALID_REPORT"});};
  for(const b of [Buffer.alloc(0),bytes.subarray(0,-1),Buffer.concat([bytes,bytes]),Buffer.concat([bytes,Buffer.from("\n")]),
    Buffer.concat([Buffer.from(" "),bytes]),Buffer.concat([Buffer.from([239,187,191]),bytes]),Buffer.from([195,40]),Buffer.alloc(1277),
    Buffer.from(bytes.toString().replace('"caseId":','"caseId":"baseline","caseId":')),
    encode(Object.fromEntries(Object.entries(good).reverse()))])bad(b);
  for(const key of Object.keys(good)){
    const missing={...good} as Record<string,unknown>;delete missing[key];bad(encode(missing));
    for(const value of [null,"PRIVATE_SOURCE_PATH_ENV_DIAGNOSTIC",true,0,[],{}])
      if(JSON.stringify(value)!==JSON.stringify((good as unknown as Record<string,unknown>)[key]))bad(encode({...good,[key]:value}));
  }
  for(const key of ["rawSource","output","path","env","argv","error","diagnostic","sessionId"])
    bad(encode({...good,[key]:"PRIVATE_SOURCE_PATH_ENV_DIAGNOSTIC"}));
  for(const id of COMPILER_OUTPUT_POSITIVE_CASES)if(id!=="baseline")bad(encode(expectedCompilerOutputObservationForTest(id)));
  const rejected={...compilerOutputCommonForTest("baseline"),status:"rejected",evidence:"unavailable",reason:"COMPILER_DIAGNOSTIC",
    artifactRestoration:"confirmed",inputRestoration:"confirmed",outputRestoration:"confirmed"};
  for(const [key,value] of [["reason","PRIVATE_ERROR"],["artifactRestoration","yes"],["inputRestoration",true],["outputRestoration","lost"],["completeRuntime",true],
    ["completeConfiguration",true],["completeInput",true],["result","available"],["evidence","fixed_compiler_output_observation"]])bad(encode({...rejected,[key as string]:value}));
  for(const key of Object.keys(rejected)){const missing={...rejected} as Record<string,unknown>;delete missing[key];bad(encode(missing));}
});
test("compiler-output ABA compiler/input/output relationships cannot be recombined across reports",()=>{
  const c=COMPILER_OUTPUT_CONSTANTS;
  for(const id of COMPILER_OUTPUT_POSITIVE_CASES){
    const good=expectedCompilerOutputObservationForTest(id);
    for(const key of ["compilerArtifact","consumedInput","emittedOutput","suppliedOutput","preloadedOutput","restoredOutput","optionsDigest"])
      for(const value of Object.values(c))if(value!==(good as unknown as Record<string,unknown>)[key])
        assert.throws(()=>parseCompilerOutputReport(encode({...good,[key]:value}),id),{message:"INVALID_REPORT"});
    for(const [key,value] of [["compilerObjectSame",false],["compilerCacheSameObject",false],["cacheSameNamespace",false],["sourceFileObjectsSame",false],["artifactUnchanged",false],["inputUnchanged",false],
      ["compilerLoadCount",2],["outputFileCount",3],["artifactBytes",9112573],["outputCallbacks",7],["compilerVersion","5.9.4"]])
      assert.throws(()=>parseCompilerOutputReport(encode({...good,[key as string]:value}),id),{message:"INVALID_REPORT"});
  }
});
test("compiler-output pinned inventories derive independently from literal graph and golden emit, not child reports",()=>{
  const digest=(s:string):string=>"sha256:"+createHash("sha256").update(s).digest("hex");
  const inventory=(files:ReadonlyMap<string,string>):string=>digest(JSON.stringify([...files].sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([id,text])=>({id,bytes:Buffer.byteLength(text),digest:digest(text)}))));
  const a=new Map([
    ["entry.ts",'import { value } from "./value.js";\nexport const observed: string = value;\n'],
    ["value.ts",'export const value: string = "snapshot-A";\n'],
    ["lib.d.ts","interface Array<T> { length: number; [n: number]: T }\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction extends Function {}\ninterface NewableFunction extends Function {}\ninterface IArguments {}\ninterface Number {}\ninterface Object {}\ninterface RegExp {}\ninterface String {}\n"],
  ]);
  assert.deepEqual(compilerOutputSourcesForTest(),a);
  const out=new Map([["entry.js",'import { value } from "./value.js";\nexport const observed = value;\n'],["value.js",'export const value = "snapshot-A";\n']]);
  assert.deepEqual(new Map(Object.entries(COMPILER_OUTPUT_GOLDEN_OUTPUTS)),out);
  assert.equal(inventory(a),COMPILER_OUTPUT_CONSTANTS.inputA);assert.equal(inventory(out),COMPILER_OUTPUT_CONSTANTS.outputA);
  out.set("value.js",'export const value = "snapshot-B";\n');
  assert.equal(inventory(out),COMPILER_OUTPUT_CONSTANTS.outputB);
  out.set("value.js",'export const value = "snapshot-A";\n// fixed same-value replacement\n');
  assert.equal(inventory(out),COMPILER_OUTPUT_CONSTANTS.outputSame);
  const base='export const value = "snapshot-A";\n';
  out.set("value.js",base+" ".repeat(16384-Buffer.byteLength(base)));
  assert.equal(inventory(out),COMPILER_OUTPUT_CONSTANTS.outputCap);
  const options={target:9,module:7,moduleResolution:1,noLib:true,types:[],strict:true,noEmitOnError:true,noResolve:false,skipLibCheck:false,
    rootDir:"/c2c2",outDir:"/c2c2/out",newLine:1,sourceMap:false,declaration:false,incremental:false,removeComments:true};
  assert.equal(digest(JSON.stringify(options)),COMPILER_OUTPUT_CONSTANTS.options);
});
