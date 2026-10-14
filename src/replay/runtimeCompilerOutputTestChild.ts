// Standalone trusted bootstrap; all runtime imports are builtins.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeSync, ftruncateSync, readdirSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import type ts from "typescript";
import type { CompilerOutputCaseId, CompilerOutputRejection, CompilerOutputReport, CompilerOutputRestoration } from "./runtimeCompilerOutputProtocolTestFixtures.js";

const id=process.argv[2] as CompilerOutputCaseId;
const cases=["baseline","output_snapshot_aba","output_reread_aba","output_same_value_substitution","cache_before_hook","hook_rewrite","callback_cap","output_byte_cap","stale_output","extra_output","duplicate_output","missing_output","unlisted_import","unlisted_parent","query_url","fragment_url","import_attributes","format_mismatch","snapshot_swap","supply_mutation","hook_deregister","late_load","artifact_mismatch","compiler_object_mismatch","type_error","options_mutation","source_object_mismatch","input_cap_over","output_cap_over","callback_cap_over","import_failure","restore_failure","input_extra","input_missing","source_text_mismatch","compiler_callback_cap_over","unlisted_read","read_cap_over","resolution_cap_over"];
const pins={"artifactA":"sha256:3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675","inputA":"sha256:2bdea39bca1bf39d5af133d20018c7b7b55e5dc00229068f4d2bfee1cec63a17","outputA":"sha256:533f5a5e504038e4f64ae9acbe37cff8768dd035e3a501a948894c5ae46e0c90","outputB":"sha256:9dff7b0d301dcea56c07266aa59c9dda22e32055e97b9205dd6f774acdb9d0c3","options":"sha256:21aff3ef4aeab8c795691f3eeae2343f5623b7fe29fab296befb015a6e31dc4d","outputSame":"sha256:fdb1fedea900f28693fd4649d720a825f3109cee8690a8fedae1d531ddf7f097","outputCap":"sha256:e9d8ac43a158d83b35512483b5d87621ce669e6f2fc933cefdd21755ca7f05a3"};
const golden={"entry.js":"import { value } from \"./value.js\";\nexport const observed = value;\n","value.js":"export const value = \"snapshot-A\";\n"};
const builtins=["crypto","fs","os","path","perf_hooks"];
const inputIds=["entry.ts","lib.d.ts","value.ts"],outputIds=["entry.js","value.js"] as const;
const ROOT="/c2c2/";
const artifactPath=fileURLToPath(new URL("./compiler.cjs",import.meta.url));
const compilerURL=new URL("./compiler.cjs",import.meta.url).href;
const inputRoot=fileURLToPath(new URL("./inputs/",import.meta.url));
const outputRoot=fileURLToPath(new URL("./outputs/",import.meta.url));
const entryURL=new URL("./outputs/entry.js",import.meta.url).href;
const valueURL=new URL("./outputs/value.js",import.meta.url).href;
const require=createRequire(import.meta.url);
const digest=(text:string):string=>"sha256:"+createHash("sha256").update(text).digest("hex");
const inventory=(files:ReadonlyMap<string,string>):string=>digest(JSON.stringify([...files].sort(([a],[b])=>a<b?-1:a>b?1:0)
  .map(([name,text])=>({id:name,bytes:Buffer.byteLength(text),digest:digest(text)}))));
let failure:CompilerOutputRejection|null=null;
const reject=(reason:CompilerOutputRejection):never=>{failure??=reason;throw new Error(failure);};
const identities=new Map<string,{dev:number;ino:number}>();
function stableRead(path:string,limit:number,kind:"artifact"|"input"|"output"):string{
  let fd:number|undefined;
  const unsafe=kind==="artifact"?"ARTIFACT_UNSAFE":kind==="input"?"INPUT_UNSAFE":"OUTPUT_UNSAFE";
  const changed=kind==="artifact"?"ARTIFACT_UNSAFE":kind==="input"?"INPUT_CHANGED":"OUTPUT_CHANGED";
  const oversized=kind==="artifact"?"ARTIFACT_UNSAFE":kind==="input"?"INPUT_LIMIT":"OUTPUT_LIMIT";
  try{
    const before=lstatSync(path);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)reject(unsafe);
    if(before.size>limit)reject(oversized);
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const same=(s:typeof before):boolean=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.dev===before.dev&&s.ino===before.ino&&
      s.size===before.size&&s.mtimeMs===before.mtimeMs&&s.ctimeMs===before.ctimeMs;
    if(!same(fstatSync(fd)))reject(changed);
    const bytes=Buffer.alloc(limit+1);let size=0;
    while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,size);if(n===0)break;size+=n;}
    if(size>limit)reject(oversized);
    if(!same(fstatSync(fd))||!same(lstatSync(path))||size!==before.size)reject(changed);
    const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size));
    if(!Buffer.from(text).equals(bytes.subarray(0,size)))reject(unsafe);
    const prior=identities.get(path);
    if(prior&&(prior.dev!==before.dev||prior.ino!==before.ino))reject(changed);
    identities.set(path,{dev:before.dev,ino:before.ino});return text;
  }catch{return reject(failure??unsafe);}
  finally{if(fd!==undefined)closeSync(fd);}
}
function replaceOwnedOutput(name:typeof outputIds[number],text:string):void{
  if(Buffer.byteLength(text)>16384||Buffer.from(text).toString("utf8")!==text)reject("OUTPUT_LIMIT");
  const path=outputRoot+name;let fd:number|undefined;
  try{
    const owned=identities.get(path),before=lstatSync(path);
    if(!owned||!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.dev!==owned.dev||before.ino!==owned.ino)reject("OUTPUT_UNSAFE");
    fd=openSync(path,constants.O_WRONLY|constants.O_NOFOLLOW);
    const opened=fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==owned!.dev||opened.ino!==owned!.ino)reject("OUTPUT_CHANGED");
    ftruncateSync(fd,0);const bytes=Buffer.from(text);let offset=0;
    while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset,offset);if(n<=0)reject("OUTPUT_CHANGED");offset+=n;}
    const current=lstatSync(path);
    if(current.isSymbolicLink()||current.dev!==owned!.dev||current.ino!==owned!.ino||current.nlink!==1)reject("OUTPUT_CHANGED");
  }finally{if(fd!==undefined)closeSync(fd);}
}
function readInputs():Map<string,string>{
  if(JSON.stringify(readdirSync(inputRoot).sort())!==JSON.stringify(inputIds))reject("INCOMPLETE_INPUT");
  return new Map(inputIds.map(name=>[name,stableRead(inputRoot+name,16384,"input")]));
}
function readOutputs():Map<string,string>{
  if(JSON.stringify(readdirSync(outputRoot).sort())!==JSON.stringify(outputIds))reject("INCOMPLETE_OUTPUT");
  return new Map(outputIds.map(name=>[name,stableRead(outputRoot+name,16384,"output")]));
}
function common(){
  return {schemaVersion:"compiler_output_experiment.v1" as const,caseId:id,runtime:"unavailable" as const,
    dependencies:"unavailable" as const,result:"unavailable" as const,comparability:"unavailable" as const,
    completeRuntime:false as const,completeConfiguration:false as const,completeInput:false as const};
}
type Compiler=typeof ts;
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
      if(containingFile!==ROOT+"entry.ts"||name!=="./value.js")reject("SOURCE_MISMATCH");
      return {resolvedFileName:ROOT+"value.ts",extension:compiler.Extension.Ts,isExternalLibraryImport:false};
    });},
    writeFile(name,text,bom,_onError,sourceFiles){
      if(!outputIds.some(n=>name===ROOT+"out/"+n))reject("UNLISTED_OUTPUT");
      const outputId=name.slice((ROOT+"out/").length);
      if(outputs.has(outputId))reject("DUPLICATE_OUTPUT");
      // Fixed observer faults, not claims about native compiler behavior.
      if(outputId==="value.js"&&id==="output_cap_over")text=" ".repeat(16385);
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
  const program=compiler.createProgram([ROOT+"lib.d.ts",ROOT+"entry.ts"],options,host);
  if(compiler.getPreEmitDiagnostics(program).length!==0)reject("COMPILER_DIAGNOSTIC");
  const emitted=program.emit();
  if(emitted.emitSkipped||emitted.diagnostics.length!==0)reject("COMPILER_DIAGNOSTIC");
  if(id==="unlisted_read")host.readFile(ROOT+"unknown.ts");
  if(id==="read_cap_over")while(reads<17)host.readFile(ROOT+"value.ts");
  if(id==="resolution_cap_over")while(resolutions<9)
    host.resolveModuleNames!(["./value.js"],ROOT+"entry.ts",undefined,undefined,options);
  if(id==="extra_output")host.writeFile(ROOT+"out/extra.js","export {};\n",false);
  if(id==="duplicate_output")host.writeFile(ROOT+"out/value.js","export {};\n",false);
  if(id==="missing_output")outputs.delete("value.js");
  if(id==="options_mutation")options.strict=false;
  let sourceFiles=[...program.getSourceFiles()];
  if(id==="source_text_mismatch")sourceFiles[0]!.text+=" ";
  if(failure!==null)reject(failure);
  if(JSON.stringify(options)!==originalOptions)reject("SOURCE_MISMATCH");
  if(sourceFiles.length!==3||new Set(sourceFiles.map(s=>s.fileName)).size!==3||consumed.size!==3)reject("INCOMPLETE_INPUT");
  for(const source of sourceFiles)if(!snapshot.has(source.fileName)||source!==supplied.get(source.fileName)||
    source.text!==snapshot.get(source.fileName))reject("SOURCE_MISMATCH");
  if(outputs.size!==2||outputIds.some(name=>!outputs.has(name)))reject("INCOMPLETE_OUTPUT");
  for(const name of outputIds){
    const expected=golden[name as keyof typeof golden];
    if(outputs.get(name)!==expected)reject("OUTPUT_MISMATCH");
  }
  if(compiler!==loaded)reject("COMPILER_IDENTITY");
  return {consumedInput:inventory(consumed),emittedOutput:inventory(outputs),optionsDigest:digest(originalOptions),
    outputs:Object.freeze({"entry.js":outputs.get("entry.js")!,"value.js":outputs.get("value.js")!})};
}
async function run():Promise<CompilerOutputReport>{
  let original:string|undefined,originalInputs:Map<string,string>|undefined,originalOutputs:Map<string,string>|undefined;
  let artifactRestoration:CompilerOutputRestoration="not_changed",inputRestoration:CompilerOutputRestoration="not_changed",
    outputRestoration:CompilerOutputRestoration="not_changed";
  const hooks=new Set<ReturnType<typeof registerHooks>>();
  let observed:Extract<CompilerOutputReport,{status:"observed"|"counterexample"}>|undefined;
  try{
    if(process.version!=="v24.19.0"||process.platform!=="linux"||process.arch!=="x64"||process.execArgv.length!==0||
      process.argv.length!==3||Object.keys(process.env).sort().join(",")!=="LANG,LC_ALL,NODE_DISABLE_COMPILE_CACHE,TZ"||
      process.env.TZ!=="UTC"||process.env.LANG!=="C"||process.env.LC_ALL!=="C"||process.env.NODE_DISABLE_COMPILE_CACHE!=="1")reject("STARTUP_UNSUPPORTED");
    original=stableRead(artifactPath,10*1024*1024,"artifact");
    originalInputs=readInputs();originalOutputs=readOutputs();
    if(inventory(originalInputs)!==pins.inputA||inventory(originalOutputs)!==pins.outputA)reject("INPUT_INVALID");
    const suppliedArtifact=id==="artifact_mismatch"?original+"\n// fixed mismatch\n":original;
    if(Buffer.byteLength(suppliedArtifact)!==9112572||digest(suppliedArtifact)!==pins.artifactA)reject("ARTIFACT_MISMATCH");
    if(Object.keys(require.cache).length!==0)reject("LOAD_INCOMPLETE");
    let compilerCallbacks=0,compilerLoads=0;const builtinLoads=new Set<string>();
    const countCompiler=():void=>{if(++compilerCallbacks>32)reject("LOAD_LIMIT");};
    const compilerHook=registerHooks({
      resolve(specifier,context,next){
        countCompiler();
        if(context.importAttributes!==undefined&&Object.keys(context.importAttributes).length!==0)reject("LOAD_UNLISTED");
        if(specifier===compilerURL&&context.parentURL===import.meta.url)return {url:compilerURL,format:"commonjs",shortCircuit:true};
        const name=specifier.startsWith("node:")?specifier.slice(5):specifier;
        if(context.parentURL!==compilerURL||!builtins.includes(name))return reject("LOAD_UNLISTED");
        const result=next(specifier,context);
        if(result.url!=="node:"+name||(result.format!==undefined&&result.format!=="builtin"))reject("LOAD_FORMAT");
        return result;
      },
      load(url,context,next){
        countCompiler();
        if(context.importAttributes!==undefined&&Object.keys(context.importAttributes).length!==0)reject("LOAD_UNLISTED");
        if(url===compilerURL){
          if(context.format!=="commonjs"||++compilerLoads!==1)reject("LOAD_FORMAT");
          return {format:"commonjs",source:suppliedArtifact,shortCircuit:true};
        }
        const name=url.startsWith("node:")?url.slice(5):"";
        if(!builtins.includes(name)||context.format!=="builtin"||builtinLoads.has(name))return reject("LOAD_UNLISTED");
        const result=next(url,context);if(result.format!=="builtin")reject("LOAD_FORMAT");
        builtinLoads.add(name);return result;
      }
    });hooks.add(compilerHook);
    const compiler=require(compilerURL) as Compiler;
    if(failure!==null)reject(failure);
    if(compiler.version!=="5.9.3")reject("COMPILER_FAILURE");
    const inputs=new Map(originalInputs);
    if(id==="type_error"||id==="restore_failure")inputs.set("value.ts","export const value: string = 42;\n");
    if(id==="input_cap_over")inputs.set("value.ts"," ".repeat(16385));
    if(id==="input_missing")inputs.delete("lib.d.ts");
    if(id==="input_extra")inputs.set("extra.ts","export {};\n");
    if(id==="restore_failure")replaceOwnedOutput("value.js",golden["value.js"].replace("snapshot-A","snapshot-B"));
    const compiled=compile(compiler,inputs);
    const cacheSame=require(compilerURL)===compiler;
    if(id==="compiler_callback_cap_over")for(let i=0;i<21;i++)require.resolve(compilerURL);
    if(failure!==null)reject(failure);
    const cache=Object.values(require.cache);
    if(!cacheSame||cache.length!==1||cache[0]?.exports!==compiler||compilerLoads!==1||compilerCallbacks!==12||
      [...builtinLoads].sort().join(",")!==builtins.join(","))reject("LOAD_INCOMPLETE");
    // Strings in this closed record are actual emit results; no mutable Map escapes.
    let snapshot=compiled.outputs;
    if(id==="snapshot_swap")snapshot=Object.freeze({...snapshot,"value.js":snapshot["value.js"].replace("snapshot-A","snapshot-B")});
    if(inventory(new Map(Object.entries(snapshot)))!==compiled.emittedOutput)reject("OUTPUT_MISMATCH");
    for(const name of outputIds)replaceOwnedOutput(name,snapshot[name]);
    if(id==="output_snapshot_aba"||id==="output_reread_aba")
      replaceOwnedOutput("value.js",snapshot["value.js"].replace("snapshot-A","snapshot-B"));
    const outputB=Object.freeze({...snapshot,"value.js":snapshot["value.js"].replace("snapshot-A","snapshot-B")});
    let supply=snapshot;
    if(id==="output_reread_aba"){
      const reread=readOutputs();supply=Object.freeze({"entry.js":reread.get("entry.js")!,"value.js":reread.get("value.js")!});
    }
    if(id==="output_same_value_substitution")supply=Object.freeze({...snapshot,"value.js":snapshot["value.js"]+"// fixed same-value replacement\n"});
    if(id==="output_byte_cap")supply=Object.freeze({...snapshot,"value.js":snapshot["value.js"]+" ".repeat(16384-Buffer.byteLength(snapshot["value.js"]))});
    const expectedSupply=id==="output_reread_aba"?pins.outputB:id==="output_same_value_substitution"?pins.outputSame:id==="output_byte_cap"?pins.outputCap:pins.outputA;
    if(inventory(new Map(Object.entries(supply)))!==expectedSupply)reject("OUTPUT_MISMATCH");
    function outputHook(source:Readonly<Record<typeof outputIds[number],string>>,faults:boolean){
      const state={callbacks:0,closed:false,active:true,loaded:new Map<string,string>()};
      const count=():void=>{if(state.closed)reject("OUTPUT_CLOSED");if(++state.callbacks>8)reject("OUTPUT_CALLBACK_LIMIT");};
      const hook=registerHooks({
        resolve(specifier,context){
          count();
          if(context.importAttributes!==undefined&&Object.keys(context.importAttributes).length!==0)reject("OUTPUT_UNLISTED");
          // Fixed observer-context fault tests this guard, not a claim about Node producing this parent.
          const parent=faults&&id==="unlisted_parent"?valueURL:context.parentURL;
          if(specifier===entryURL&&parent===import.meta.url)return {url:entryURL,format:"module",shortCircuit:true};
          if(specifier==="./value.js"&&parent===entryURL)return {url:valueURL,format:"module",shortCircuit:true};
          return reject("OUTPUT_UNLISTED");
        },
        load(url,context){
          count();
          if(context.importAttributes!==undefined&&Object.keys(context.importAttributes).length!==0)reject("OUTPUT_UNLISTED");
          const format=faults&&id==="format_mismatch"?"commonjs":context.format;
          if(format!=="module")reject("OUTPUT_FORMAT");
          const name=url===entryURL?"entry.js":url===valueURL?"value.js":undefined;
          if(name===undefined||state.loaded.has(name))return reject("OUTPUT_UNLISTED");
          let text=source[name];
          if(faults&&id==="supply_mutation")text+="\n";
          if(text!==source[name])reject("OUTPUT_MISMATCH");
          // The only executable fault is this exact, closed literal.
          if(faults&&id==="import_failure"&&name==="entry.js")text='throw new Error("FIXED_IMPORT_FAULT");\n';
          if(Buffer.byteLength(text)>16384||Buffer.from(text).toString("utf8")!==text)reject("OUTPUT_LIMIT");
          if([...state.loaded.values()].reduce((n,s)=>n+Buffer.byteLength(s),0)+Buffer.byteLength(text)>32768)reject("OUTPUT_LIMIT");
          state.loaded.set(name,text);
          return {format:"module",source:text,shortCircuit:true};
        }
      });hooks.add(hook);
      return {state,remove():void{hook.deregister();hooks.delete(hook);state.active=false;}};
    }
    let preloadedOutput="unavailable",preloaded:unknown;
    if(id==="cache_before_hook"){
      const preload=outputHook(outputB,false);
      preloaded=await import(entryURL);
      if((preloaded as {observed?:unknown}).observed!=="snapshot-B"||preload.state.callbacks!==4||preload.state.loaded.size!==2)reject("OUTPUT_MISMATCH");
      preloadedOutput=inventory(preload.state.loaded);if(preloadedOutput!==pins.outputB)reject("OUTPUT_MISMATCH");
      preload.remove();
    }
    const loader=outputHook(supply,true);
    let rewrites=0;
    if(id==="hook_rewrite"){
      const rewrite=registerHooks({load(url,context,next){
        const loaded=next(url,context);
        if(url===valueURL){
          if(loaded.format!=="module"||loaded.source!==snapshot["value.js"]||++rewrites!==1)reject("OUTPUT_MISMATCH");
          return {...loaded,source:outputB["value.js"]};
        }
        return loaded;
      }});hooks.add(rewrite);
    }
    if(id==="hook_deregister")loader.remove();
    if(!loader.state.active)reject("OUTPUT_HOOK_LOST");
    let first:{observed?:unknown},second:unknown;
    try{
      const target=id==="query_url"?entryURL+"?fixed":id==="fragment_url"?entryURL+"#fixed":
        id==="unlisted_import"?new URL("./outputs/unknown.js",import.meta.url).href:entryURL;
      first=await import(target,id==="import_attributes"?{with:{type:"json"}}:undefined) as {observed?:unknown};
      second=await import(entryURL);
      if(id==="callback_cap"||id==="callback_cap_over"){
        for(let n=0;n<(id==="callback_cap"?3:4);n++)if(await import(entryURL)!==first)reject("OUTPUT_MISMATCH");
      }
      if(id==="late_load"){loader.state.closed=true;await import(entryURL);}
    }catch{return reject(failure??"OUTPUT_IMPORT_FAILED");}
    if(failure!==null)reject(failure);
    loader.state.closed=true;
    const cached=id==="cache_before_hook",expectedCallbacks=cached?2:id==="callback_cap"?8:5;
    const expectedValue=["output_reread_aba","cache_before_hook","hook_rewrite"].includes(id)?"snapshot-B":"snapshot-A";
    if(first!==second||first.observed!==expectedValue||(cached&&first!==preloaded)||
      loader.state.loaded.size!==(cached?0:2)||loader.state.callbacks!==expectedCallbacks||
      (id==="hook_rewrite"&&rewrites!==1))reject("OUTPUT_MISMATCH");
    const suppliedOutput=cached?"unavailable":inventory(loader.state.loaded);
    if(suppliedOutput!==(cached?"unavailable":expectedSupply))reject("OUTPUT_MISMATCH");
    const changed=["output_reread_aba","output_same_value_substitution","cache_before_hook","hook_rewrite","output_byte_cap"].includes(id);
    observed={...common(),status:changed?"counterexample":"observed",evidence:"fixed_compiler_output_observation",
      compilerVersion:"5.9.3",artifactBytes:Buffer.byteLength(suppliedArtifact) as 9112572,compilerArtifact:digest(suppliedArtifact),
      compilerLoadCount:compilerLoads as 1,compilerCacheSameObject:cacheSame as true,compilerObjectSame:true,
      consumedInput:compiled.consumedInput,optionsDigest:compiled.optionsDigest,sourceFileObjectsSame:true,
      emittedOutput:compiled.emittedOutput,suppliedOutput,preloadedOutput,outputFileCount:2,
      outputLoadCount:loader.state.loaded.size as 0|2,observedValue:first.observed as "snapshot-A"|"snapshot-B",
      cacheSameNamespace:true,outputCallbacks:loader.state.callbacks as 2|5|8,restoredOutput:"",
      artifactUnchanged:true,inputUnchanged:true,outputRestoration:"confirmed"};
  }catch{failure??="COMPILER_FAILURE";}
  finally{
    for(const hook of [...hooks].reverse())try{hook.deregister();}catch{failure??="OUTPUT_HOOK_LOST";}
    if(original!==undefined){
      try{if(stableRead(artifactPath,10*1024*1024,"artifact")!==original)throw new Error("CHANGED");artifactRestoration="confirmed";}
      catch{artifactRestoration="unconfirmed";failure??="ARTIFACT_RESTORE_FAILED";}
    }
    if(originalInputs!==undefined){
      try{if(inventory(readInputs())!==inventory(originalInputs))throw new Error("CHANGED");inputRestoration="confirmed";}
      catch{inputRestoration="unconfirmed";failure??="INPUT_RESTORE_FAILED";}
    }
    if(originalOutputs!==undefined){
      try{
        if(id==="restore_failure")throw new Error("FIXED_RESTORE_FAULT");
        for(const name of outputIds)replaceOwnedOutput(name,originalOutputs.get(name)!);
        const restored=inventory(readOutputs());if(restored!==inventory(originalOutputs))throw new Error("CHANGED");
        outputRestoration="confirmed";if(observed)observed.restoredOutput=restored;
      }catch{outputRestoration="unconfirmed";failure??="OUTPUT_RESTORE_FAILED";}
    }
  }
  if(failure!==null||observed===undefined)return {...common(),status:"rejected",evidence:"unavailable",
    reason:failure??"COMPILER_FAILURE",artifactRestoration,inputRestoration,outputRestoration};
  return observed;
}
if(!(cases as readonly string[]).includes(id))process.exitCode=1;
else process.stdout.write(JSON.stringify(await run())+"\n");
