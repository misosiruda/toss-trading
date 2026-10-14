// Standalone trusted bootstrap; runtime imports are builtins only.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeSync, ftruncateSync, readdirSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type ts from "typescript";
import type { CompilerBuildCaseId, CompilerBuildRejection, CompilerBuildReport, CompilerBuildRestoration } from "./runtimeCompilerBuildProtocolTestFixtures.js";

const id = process.argv[2] as CompilerBuildCaseId;
const cases = ["baseline","compiler_snapshot_aba","compiler_reread_aba","input_snapshot_aba","input_reread_aba","both_snapshot_aba","both_reread_aba","callback_cap","read_cap","resolution_cap","cache_before_hook","artifact_mismatch","artifact_cap_over","unlisted_builtin","unlisted_module","callback_cap_over","unlisted_import","type_error","stale_output","extra_output","duplicate_output","missing_output","source_object_mismatch","source_text_mismatch","missing_source","duplicate_source","options_mutation","compiler_throw","compiler_object_mismatch","cache_object_mismatch","unlisted_read","read_cap_over","resolution_cap_over","input_cap_over","output_cap_over","output_cap","source_extra","source_missing","restore_failure"];
const pins = {"artifactA":"sha256:3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675","artifactB":"sha256:ee733b7a5349430d9e46a995f815f777cb520421d92a44062f8aecf12ad2dcf3","inputA":"sha256:2bdea39bca1bf39d5af133d20018c7b7b55e5dc00229068f4d2bfee1cec63a17","inputB":"sha256:d9d1b2b6685d61de6d70967870ac9a9801d4e7ff633b17d0f91b47329dbfcff7","outputA":"sha256:533f5a5e504038e4f64ae9acbe37cff8768dd035e3a501a948894c5ae46e0c90","outputB":"sha256:9dff7b0d301dcea56c07266aa59c9dda22e32055e97b9205dd6f774acdb9d0c3","options":"sha256:21aff3ef4aeab8c795691f3eeae2343f5623b7fe29fab296befb015a6e31dc4d"};
const golden = {"entry.js":"import { value } from \"./value.js\";\nexport const observed = value;\n","value.js":"export const value = \"snapshot-A\";\n"};
const builtins = ["crypto", "fs", "os", "path", "perf_hooks"];
const inputIds = ["entry.ts", "lib.d.ts", "value.ts"], outputIds = ["entry.js", "value.js"];
const ROOT = "/c2c2/";
const artifactPath = fileURLToPath(new URL("./compiler.cjs", import.meta.url));
const compilerURL = new URL("./compiler.cjs", import.meta.url).href;
const inputRoot = fileURLToPath(new URL("./inputs/", import.meta.url));
const require = createRequire(import.meta.url);
const digest = (text: string): string => "sha256:" + createHash("sha256").update(text).digest("hex");
const inventory = (files: ReadonlyMap<string,string>): string => digest(JSON.stringify([...files].sort(([a],[b])=>a<b?-1:a>b?1:0)
  .map(([name,text])=>({id:name,bytes:Buffer.byteLength(text),digest:digest(text)}))));
let failure: CompilerBuildRejection | null = null;
const reject = (reason: CompilerBuildRejection): never => { failure ??= reason; throw new Error(failure); };
const identities = new Map<string,{dev:number;ino:number}>();
function stableRead(path: string, limit: number, artifact: boolean): string {
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) reject(artifact ? "ARTIFACT_UNSAFE" : "INPUT_UNSAFE");
    if (before.size > limit) reject(artifact ? "ARTIFACT_LIMIT" : "INPUT_LIMIT");
    fd = openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const same = (s: typeof before): boolean => s.isFile() && !s.isSymbolicLink() && s.nlink===1 &&
      s.dev===before.dev && s.ino===before.ino && s.size===before.size && s.mtimeMs===before.mtimeMs && s.ctimeMs===before.ctimeMs;
    if (!same(fstatSync(fd))) reject(artifact ? "ARTIFACT_UNSAFE" : "INPUT_CHANGED");
    const bytes=Buffer.alloc(limit+1);let size=0;
    while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,size);if(n===0)break;size+=n;}
    if(size>limit)reject(artifact ? "ARTIFACT_LIMIT" : "INPUT_LIMIT");
    if(!same(fstatSync(fd))||!same(lstatSync(path))||size!==before.size)reject(artifact ? "ARTIFACT_UNSAFE" : "INPUT_CHANGED");
    const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size));
    if(!Buffer.from(text).equals(bytes.subarray(0,size)))reject(artifact ? "ARTIFACT_UNSAFE" : "INPUT_INVALID");
    const prior=identities.get(path);
    if(prior && (prior.dev!==before.dev||prior.ino!==before.ino))reject(artifact ? "ARTIFACT_UNSAFE" : "INPUT_CHANGED");
    identities.set(path,{dev:before.dev,ino:before.ino});return text;
  } catch { return reject(failure ?? (artifact ? "ARTIFACT_UNSAFE" : "INPUT_INVALID")); }
  finally { if(fd!==undefined)closeSync(fd); }
}
/** Only an already captured single-link inode in this private fixture may be changed. */
function replaceOwned(path:string,text:string):void {
  let fd:number|undefined;
  try {
    const owned=identities.get(path);const before=lstatSync(path);
    if(!owned||!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.dev!==owned.dev||before.ino!==owned.ino)throw new Error("OWNED_FILE_CHANGED");
    fd=openSync(path,constants.O_WRONLY|constants.O_NOFOLLOW);
    const opened=fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==owned.dev||opened.ino!==owned.ino)throw new Error("OWNED_FILE_CHANGED");
    ftruncateSync(fd,0);const bytes=Buffer.from(text);let offset=0;
    while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset,offset);if(n<=0)throw new Error("WRITE_FAILED");offset+=n;}
    const current=lstatSync(path);
    if(current.isSymbolicLink()||current.dev!==owned.dev||current.ino!==owned.ino||current.nlink!==1)throw new Error("OWNED_FILE_CHANGED");
  } finally {if(fd!==undefined)closeSync(fd);}
}
function readInputs():Map<string,string>{
  const names=readdirSync(inputRoot).sort();
  if(JSON.stringify(names)!==JSON.stringify(inputIds))reject("INCOMPLETE_INPUT");
  const files=new Map<string,string>();
  for(const name of inputIds)files.set(name,stableRead(inputRoot+name,16384,false));
  return files;
}
function common(){
  return {schemaVersion:"compiler_build_experiment.v1" as const,caseId:id,runtime:"unavailable" as const,
    dependencies:"unavailable" as const,result:"unavailable" as const,comparability:"unavailable" as const,
    completeRuntime:false as const,completeConfiguration:false as const,completeInput:false as const};
}
type Compiler = typeof ts & {__c2c3Marker?:number};
function compile(loaded:Compiler,input:ReadonlyMap<string,string>){
  const compiler:Compiler=id==="compiler_object_mismatch"?{...loaded}:loaded;
  if(compiler!==loaded)reject("COMPILER_IDENTITY");
  if(input.size!==3||inputIds.some(name=>!input.has(name)))reject("INCOMPLETE_INPUT");
  const snapshot=new Map<string,string>();
  for(const name of inputIds){
    const text=input.get(name)!;
    if(typeof text!=="string"||Buffer.from(text).toString("utf8")!==text)reject("INPUT_INVALID");
    if(text.length>16384||Buffer.byteLength(text)>16384)reject("INPUT_LIMIT");
    snapshot.set(ROOT+name,text);
  }
  const supplied=new Map<string,ts.SourceFile>(),consumed=new Map<string,string>(),outputs=new Map<string,string>();
  if(id==="stale_output")outputs.set("value.js",'export const value = "stale";\n');
  if(outputs.size!==0)reject("STALE_OUTPUT");
  let reads=0,resolutions=0,outputBytes=0;
  const takeText=(name:string):string=>{
    if(++reads>16)reject("READ_LIMIT");
    const text=snapshot.get(name);if(text===undefined)return reject("UNLISTED_READ");return text;
  };
  const options:ts.CompilerOptions={
    target:compiler.ScriptTarget.ES2022,module:compiler.ModuleKind.ES2022,moduleResolution:compiler.ModuleResolutionKind.Classic,
    noLib:true,types:[],strict:true,noEmitOnError:true,noResolve:false,skipLibCheck:false,rootDir:"/c2c2",outDir:"/c2c2/out",
    newLine:compiler.NewLineKind.LineFeed,sourceMap:false,declaration:false,incremental:false,removeComments:true
  };
  const originalOptions=JSON.stringify(options);
  if(digest(originalOptions)!==pins.options)reject("SOURCE_MISMATCH");
  const host:ts.CompilerHost={
    getSourceFile(name,language){
      const text=takeText(name);const source=compiler.createSourceFile(name,text,language);
      if(supplied.has(name))reject("SOURCE_MISMATCH");
      supplied.set(name,source);consumed.set(name.slice(ROOT.length),text);return source;
    },
    getDefaultLibFileName:()=>ROOT+"lib.d.ts",getCurrentDirectory:()=>"/c2c2",getCanonicalFileName:name=>name,
    getNewLine:()=>"\n",useCaseSensitiveFileNames:()=>true,
    fileExists(name){if(!snapshot.has(name))reject("UNLISTED_READ");return true;},
    readFile:takeText,
    resolveModuleNames(names,containingFile){return names.map((name):ts.ResolvedModuleFull=>{
      if(++resolutions>8)reject("RESOLUTION_LIMIT");
      if(containingFile!==ROOT+"entry.ts"||name!=="./value.js")reject("UNLISTED_RESOLUTION");
      return {resolvedFileName:ROOT+"value.ts",extension:compiler.Extension.Ts,isExternalLibraryImport:false};
    });},
    writeFile(name,text,bom,_onError,sourceFiles){
      if(!outputIds.some(n=>name===ROOT+"out/"+n))reject("UNLISTED_OUTPUT");
      const outputId=name.slice((ROOT+"out/").length);
      if(outputs.has(outputId))reject("DUPLICATE_OUTPUT");
      // Fixed observer faults, not claims about native compiler behavior.
      if(outputId==="value.js"&&(id==="output_cap"||id==="output_cap_over"))text=" ".repeat(id==="output_cap"?16384:16385);
      if(typeof text!=="string"||text.length>16384||Buffer.byteLength(text)>16384)reject("OUTPUT_LIMIT");
      outputBytes+=Buffer.byteLength(text);if(outputBytes>32768)reject("OUTPUT_LIMIT");
      if(bom!==false||Buffer.from(text).toString("utf8")!==text)reject("OUTPUT_MISMATCH");
      const inputName=ROOT+outputId.replace(/\.js$/,".ts");
      // Exercise the emit association guard itself with the same name/text but a different original.
      if(id==="source_object_mismatch"&&sourceFiles?.[0]){
        const source=sourceFiles[0];
        sourceFiles=[compiler.createSourceFile(source.fileName,source.text,compiler.ScriptTarget.ES2022)];
      }
      const original=sourceFiles?.length===1?compiler.getOriginalNode(sourceFiles[0]!):undefined;
      if(original===undefined||!compiler.isSourceFile(original)||original!==supplied.get(inputName)||
        original.text!==snapshot.get(inputName)||sourceFiles?.[0]?.fileName!==inputName||
        sourceFiles[0]?.text!==snapshot.get(inputName))reject("SOURCE_MISMATCH");
      outputs.set(outputId,text);
    }
  };
  if(id==="compiler_throw")throw new Error("FIXED_COMPILER_THROW");
  const program=compiler.createProgram([ROOT+"lib.d.ts",ROOT+"entry.ts"],options,host);
  if(compiler.getPreEmitDiagnostics(program).length!==0)reject("COMPILER_DIAGNOSTIC");
  const emitted=program.emit();
  if(emitted.emitSkipped||emitted.diagnostics.length!==0)reject("COMPILER_DIAGNOSTIC");
  if(id==="unlisted_read")host.readFile(ROOT+"unknown.ts");
  if(id==="read_cap"||id==="read_cap_over")while(reads<(id==="read_cap"?16:17))host.readFile(ROOT+"value.ts");
  if(id==="resolution_cap"||id==="resolution_cap_over")while(resolutions<(id==="resolution_cap"?8:9))
    host.resolveModuleNames!(["./value.js"],ROOT+"entry.ts",undefined,undefined,options);
  if(id==="extra_output")host.writeFile(ROOT+"out/extra.js","export {};\n",false);
  if(id==="duplicate_output")host.writeFile(ROOT+"out/value.js","export {};\n",false);
  if(id==="missing_output")outputs.delete("value.js");
  if(id==="options_mutation")options.strict=false;
  let sourceFiles=[...program.getSourceFiles()];
  if(id==="missing_source")sourceFiles=sourceFiles.slice(1);
  if(id==="duplicate_source")sourceFiles.push(sourceFiles[0]!);
  if(id==="source_text_mismatch")sourceFiles[0]!.text+=" ";
  if(failure!==null)reject(failure);
  if(JSON.stringify(options)!==originalOptions)reject("SOURCE_MISMATCH");
  if(sourceFiles.length!==3||new Set(sourceFiles.map(s=>s.fileName)).size!==3||consumed.size!==3)reject("INCOMPLETE_INPUT");
  for(const source of sourceFiles)if(!snapshot.has(source.fileName)||source!==supplied.get(source.fileName)||
    source.text!==snapshot.get(source.fileName))reject("SOURCE_MISMATCH");
  if(outputs.size!==2||outputIds.some(name=>!outputs.has(name)))reject("INCOMPLETE_OUTPUT");
  const inputB=id==="input_reread_aba"||id==="both_reread_aba";
  for(const name of outputIds){
    const expected=golden[name as keyof typeof golden].replaceAll("snapshot-A",inputB?"snapshot-B":"snapshot-A");
    if(outputs.get(name)!==expected)reject("OUTPUT_MISMATCH");
  }
  if(compiler!==loaded)reject("COMPILER_IDENTITY");
  return {consumedInput:inventory(consumed),emittedOutput:inventory(outputs),optionsDigest:digest(originalOptions)};
}
function run():CompilerBuildReport{
  let original:string|undefined,originalInputs:Map<string,string>|undefined;
  let artifactChanged=false,inputChanged=false;
  let artifactRestoration:CompilerBuildRestoration="not_changed",inputRestoration:CompilerBuildRestoration="not_changed";
  let hook:ReturnType<typeof registerHooks>|undefined;
  let observed:Extract<CompilerBuildReport,{status:"observed"|"counterexample"}>|undefined;
  try{
    if(process.version!=="v24.19.0"||process.platform!=="linux"||process.arch!=="x64"||process.execArgv.length!==0||
      process.argv.length!==3||Object.keys(process.env).sort().join(",")!=="LANG,LC_ALL,NODE_DISABLE_COMPILE_CACHE,TZ"||
      process.env.TZ!=="UTC"||process.env.LANG!=="C"||process.env.LC_ALL!=="C"||process.env.NODE_DISABLE_COMPILE_CACHE!=="1")reject("STARTUP_UNSUPPORTED");
    original=stableRead(artifactPath,10*1024*1024,true);
    if(Buffer.byteLength(original)!==9112572||digest(original)!==pins.artifactA)reject("ARTIFACT_MISMATCH");
    originalInputs=readInputs();if(inventory(originalInputs)!==pins.inputA)reject("INPUT_INVALID");
    const compilerABA=["compiler_snapshot_aba","compiler_reread_aba","both_snapshot_aba","both_reread_aba","cache_before_hook","restore_failure"].includes(id);
    const inputABA=["input_snapshot_aba","input_reread_aba","both_snapshot_aba","both_reread_aba","restore_failure"].includes(id);
    if(compilerABA){artifactChanged=true;replaceOwned(artifactPath,original+"\nmodule.exports.__c2c3Marker = 202;\n");}
    if(inputABA){inputChanged=true;replaceOwned(inputRoot+"value.ts",originalInputs.get("value.ts")!.replace("snapshot-A","snapshot-B"));}
    if(id==="restore_failure")replaceOwned(inputRoot+"value.ts","export const value: string = 42;\n");
    if(id==="artifact_mismatch"){artifactChanged=true;replaceOwned(artifactPath,original+"\n// changed\n");}
    if(id==="artifact_cap_over"){artifactChanged=true;replaceOwned(artifactPath," ".repeat(10*1024*1024+1));stableRead(artifactPath,10*1024*1024,true);}
    if(id==="cache_before_hook"){const preloaded=require(artifactPath) as Compiler;if(preloaded.__c2c3Marker!==202)reject("COMPILER_FAILURE");}
    if(Object.keys(require.cache).length!==0)reject("CACHE_PREPOPULATED");
    let supplied=["compiler_reread_aba","both_reread_aba","artifact_mismatch"].includes(id)?stableRead(artifactPath,10*1024*1024,true):original;
    const supplyB=id==="compiler_reread_aba"||id==="both_reread_aba";
    if(Buffer.byteLength(supplied)!==(supplyB?9112608:9112572)||digest(supplied)!==(supplyB?pins.artifactB:pins.artifactA))reject("ARTIFACT_MISMATCH");
    // Only after the immutable supply passes its pin may fixed rejection fixtures append their fault.
    if(id==="unlisted_builtin")supplied+='\ntry { require("node:net"); } catch {}\n';
    if(id==="unlisted_module")supplied+='\ntry { require("./unknown.cjs"); } catch {}\n';
    if(Buffer.byteLength(supplied)>10*1024*1024)reject("ARTIFACT_LIMIT");
    const suppliedSnapshot=supplied;let events=0,compilerLoads=0;const builtinLoads=new Set<string>();
    const count=()=>{if(++events>32)reject("LOAD_LIMIT");};
    hook=registerHooks({
      resolve(specifier,context,next){
        count();if(context.importAttributes!==undefined&&Object.keys(context.importAttributes).length!==0)reject("LOAD_UNLISTED");
        if(specifier===compilerURL&&context.parentURL===import.meta.url)return {url:compilerURL,format:"commonjs",shortCircuit:true};
        const name=specifier.startsWith("node:")?specifier.slice(5):specifier;
        if(context.parentURL!==compilerURL||!builtins.includes(name))return reject("LOAD_UNLISTED");
        const resolved=next(specifier,context);
        if(resolved.url!=="node:"+name||(resolved.format!==undefined&&resolved.format!=="builtin"))reject("LOAD_FORMAT");
        return resolved;
      },
      load(url,context,next){
        count();if(context.importAttributes!==undefined&&Object.keys(context.importAttributes).length!==0)reject("LOAD_UNLISTED");
        if(url===compilerURL){
          if(context.format!=="commonjs"||++compilerLoads!==1)reject("LOAD_FORMAT");
          return {format:"commonjs",source:suppliedSnapshot,shortCircuit:true};
        }
        const name=url.startsWith("node:")?url.slice(5):"";
        if(!builtins.includes(name)||context.format!=="builtin"||builtinLoads.has(name))return reject("LOAD_UNLISTED");
        const loaded=next(url,context);if(loaded.format!=="builtin")reject("LOAD_FORMAT");builtinLoads.add(name);return loaded;
      }
    });
    const compiler=require(compilerURL) as Compiler;
    if(failure!==null)reject(failure);
    if(compiler.version!=="5.9.3")reject("COMPILER_FAILURE");
    const input=["input_reread_aba","both_reread_aba","restore_failure"].includes(id)?readInputs():new Map(originalInputs);
    if(id==="unlisted_import")input.set("entry.ts",'import "forbidden";\n');
    if(id==="type_error")input.set("value.ts","export const value: string = 42;\n");
    if(id==="input_cap_over")input.set("value.ts"," ".repeat(16385));
    if(id==="source_missing")input.delete("lib.d.ts");
    if(id==="source_extra")input.set("extra.ts","export {};\n");
    const compiled=compile(compiler,input);if(failure!==null)reject(failure);
    if(id==="cache_object_mismatch"){
      const item=Object.values(require.cache)[0];
      if(item===undefined)return reject("LOAD_INCOMPLETE");
      item.exports={...compiler};
    }
    const sameObject=require(compilerURL)===compiler;
    if(id==="callback_cap"||id==="callback_cap_over")for(let n=0;n<(id==="callback_cap"?20:21);n++)require.resolve(compilerURL);
    if(failure!==null)reject(failure);
    const cache=Object.values(require.cache),expectedCallbacks=id==="callback_cap"?32:12;
    if(!sameObject||cache.length!==1||cache[0]?.exports!==compiler||compilerLoads!==1||
      [...builtinLoads].sort().join(",")!==builtins.join(",")||events!==expectedCallbacks)reject("LOAD_INCOMPLETE");
    const compilerB=id==="compiler_reread_aba"||id==="both_reread_aba",inputB=id==="input_reread_aba"||id==="both_reread_aba";
    const marker=compiler.__c2c3Marker??0;if(marker!==(compilerB?202:0))reject("COMPILER_FAILURE");
    observed={...common(),status:compilerB||inputB?"counterexample":"observed",evidence:"fixed_compiler_build_observation",
      compilerVersion:"5.9.3",artifactBytes:Buffer.byteLength(suppliedSnapshot) as 9112572|9112608,
      capturedArtifact:digest(original),suppliedArtifact:digest(suppliedSnapshot),restoredArtifact:"",
      compilerLoadCount:1,builtinLoads:[...builtinLoads].sort(),cacheSameObject:true,compilerObjectSame:true,
      observedMarker:marker as 0|202,callbackCount:expectedCallbacks,inputFileCount:3,outputFileCount:2,
      capturedInput:inventory(originalInputs),consumedInput:compiled.consumedInput,restoredInput:"",
      emittedOutput:compiled.emittedOutput,optionsDigest:compiled.optionsDigest,sourceFileObjectsSame:true,diskBeforeAfterMatch:true};
  }catch{failure??="COMPILER_FAILURE";}
  finally{
    try{hook?.deregister();}catch{failure??="LOAD_INCOMPLETE";}
    if(original!==undefined){
      try{
        if(id==="restore_failure"&&artifactChanged)throw new Error("FIXED_RESTORE_FAULT");
        if(artifactChanged)replaceOwned(artifactPath,original);
        const restored=digest(stableRead(artifactPath,10*1024*1024,true));
        if(restored!==digest(original))throw new Error("RESTORE_MISMATCH");
        artifactRestoration="confirmed";if(observed)observed.restoredArtifact=restored;
      }catch{artifactRestoration="unconfirmed";failure??="ARTIFACT_RESTORE_FAILED";}
    }
    if(originalInputs!==undefined){
      try{
        if(id==="restore_failure"&&inputChanged)throw new Error("FIXED_RESTORE_FAULT");
        if(inputChanged)for(const [name,text] of originalInputs)replaceOwned(inputRoot+name,text);
        const restored=inventory(readInputs());
        if(restored!==inventory(originalInputs))throw new Error("RESTORE_MISMATCH");
        inputRestoration="confirmed";if(observed)observed.restoredInput=restored;
      }catch{inputRestoration="unconfirmed";failure??="INPUT_RESTORE_FAILED";}
    }
  }
  if(failure!==null||observed===undefined)return {...common(),status:"rejected",evidence:"unavailable",
    reason:failure??"COMPILER_FAILURE",artifactRestoration,inputRestoration};
  return observed;
}
if(!(cases as readonly string[]).includes(id))process.exitCode=1;
else process.stdout.write(JSON.stringify(run())+"\n");
