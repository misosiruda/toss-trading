import type { ZodType } from "zod";
import { replayResearchManifestSchema } from "../domain/schemas.js";
import {
  historicalReplayRunConfigurationSchema as configuration,
  historicalReplayRunWindowSchema as window
} from "../replay/historicalReplayAuditLog.js";

export type ProvenanceReason = "not_persisted" | "not_present" | "invalid" | "missing" | "blocked" | "limit" | "ambiguous" | "identity_mismatch" | "redacted_text";
export type ProvenanceSource = "batch_manifest" | "run_record" | "run_metadata" | "research_manifest";
export type ProvenanceField =
  | { status: "recorded"; source: ProvenanceSource; verification: "stored_observation"; value: string | number | boolean | null | string[] }
  | { status: "unavailable"; reason: ProvenanceReason; value: null };
export interface ReplayProvenance {
  mode: "paper_only"; readOnly: true; contractVersion: "replay_provenance_read.v1";
  requestedRunId: string | null;
  status: "partial" | "missing" | "invalid" | "blocked" | "limit" | "ambiguous";
  fields: Record<string, ProvenanceField>;
  comparability: "unavailable"; clone: "unavailable";
}
export const provenanceRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function validProvenanceId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}(?![\s\S])/.test(value)) return true;
  // safeArtifactPathPart preserves leading hyphens. Admit that additional
  // boundary only for the writer's sanitized-prefix/padded-index/month form.
  const child = /^-(?:[A-Za-z0-9_-]*[A-Za-z0-9-])?_run_([0-9]{6}|[1-9][0-9]{6,})_-?(?:0|[1-9][0-9]{0,5})-(?:0[1-9]|1[0-2])(?![\s\S])/.exec(value);
  return child !== null && Number.isSafeInteger(Number(child[1]));
}
const absent = (reason: ProvenanceReason): ProvenanceField => ({ status: "unavailable", reason, value: null });
const descriptors: Array<{ path: string; schema: ZodType }> = [];
function add(prefix: string, shapes: Record<string, ZodType>, keys: string[]) {
  for (const key of keys) { const schema = shapes[key]; if (schema) descriptors.push({path: `${prefix}.${key}`, schema}); }
}
add("window",window.shape,["source","startAt","endAt","rangeStart","rangeEnd","windowMonths","timezoneOffsetMinutes"]);
add("configuration",configuration.shape,["initialCashKrw","packetExpiresInSeconds","maxCandidates","maxSnapshotAgeSeconds","riskProfile"]);
add("configuration.clock",configuration.shape.clock.shape,["startAt","endAt","stepSeconds","speedMultiplier"]);
add("configuration.samplingPolicy",configuration.shape.samplingPolicy.unwrap().shape,["everyNSteps","candidateChangedOnly","decisionFrequency","maxDecisionCalls","timezoneOffsetMinutes"]);
add("configuration.constraints",configuration.shape.constraints.shape,["maxNewPositions","maxBudgetPerSymbolKrw","allowedActions"]);
add("configuration.executionPolicy",configuration.shape.executionPolicy.unwrap().shape,["fillPriceRule","slippageBps","feeBps","taxBps","halfSpreadBps","fillRatio","allowFractionalShares","maxVolumeParticipationRate","minLiquidityFillRatio","rejectStaleLiquidity","marketImpactBpsPerParticipationRate"]);
add("configuration.riskPolicy",configuration.shape.riskPolicy.unwrap().shape,["maxBudgetPerDecisionKrw","maxSymbolExposureKrw","targetExposureRatio","maxPositionWeightRatio","maxSectorExposureKrw","maxSectorExposureRatio","maxCountryExposureKrw","maxCountryExposureRatio","maxCurrencyExposureKrw","maxCurrencyExposureRatio","maxUnknownMetadataExposureKrw","maxUnknownMetadataExposureRatio","minCashReserveRatio","minCashReserveKrw"]);
add("configuration.allocationPolicy",configuration.shape.allocationPolicy.unwrap().shape,["targetExposureRatio","minCashReserveRatio","maxBudgetPerDecisionRatio","maxSymbolExposureRatio","deploymentRampDays","rampDayIndex","maxInitialDeploymentRatio","maxDailyGrossBuyRatio","maxInitialOpenPositions","maxNewPositionsPerDay","maxConcurrentPositions","positionSlotRampDays"]);
add("configuration.paperExitPolicy",configuration.shape.paperExitPolicy.unwrap().shape,["takeProfitRatio","stopLossRatio","rebalanceMaxPositionWeightRatio","takeProfitMode","takeProfitSellRatio","trailingStopFromPeakRatio"]);
const hashes = ["configHash","dataSnapshotHash","universeHash","coverageHash","promptHash","schemaHash","riskPolicyHash","costModelHash"] as const;
const structuralFields = ["requestedConfig","effectiveConfig","notices","runtime.gitRevision","runtime.dependencyLockHash","runtime.nodeVersion"];
const redactedFields = ["batch.seed","child.runSeed","window.seed","configuration.strategyPreset","configuration.packetIdPrefix"];
const timestampFields = new Set(["window.startAt","window.endAt","window.rangeStart","window.rangeEnd","configuration.clock.startAt","configuration.clock.endAt"]);
export function isStoredProvenanceTimestamp(value: unknown): value is string {
  if(typeof value!=="string" || value.length>40) return false;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if(!match) return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const calendar=new Date(0);calendar.setUTCFullYear(year,month,0);
  return month>=1 && month<=12 && day>=1 && day<=calendar.getUTCDate() && Number(match[4])<=23 && Number(match[5])<=59 && Number(match[6])<=59 && Number(match[7]??0)<=23 && Number(match[8]??0)<=59 && Number.isFinite(Date.parse(value));
}

export function emptyReplayProvenance(runId: string | null, status: ReplayProvenance["status"], reason: ProvenanceReason): ReplayProvenance {
  const fields: Record<string, ProvenanceField> = {};
  for (const field of [...descriptors.map(d=>d.path),...hashes.map(h=>`research.${h}`),"research.manifestVersion","research.executionModelVersion",...redactedFields]) fields[field]=absent(reason);
  for (const field of structuralFields) fields[field]=absent("not_persisted");
  return {mode:"paper_only",readOnly:true,contractVersion:"replay_provenance_read.v1",requestedRunId:runId,status,fields,comparability:"unavailable",clone:"unavailable"};
}
function readPath(raw: unknown, path: string): {present:boolean;value:unknown} {
  let current=raw;
  for(const key of path.split(".")) {
    if(!provenanceRecord(current) || !Object.hasOwn(current,key)) return {present:false,value:null};
    current=current[key];
  }
  return {present:true,value:current};
}
function field(raw:unknown,path:string,schema:ZodType,source:ProvenanceSource): ProvenanceField {
  const observed=readPath(raw,path);
  // Check raw presence before schemas with defaults. Never synthesize defaults.
  if(!observed.present) return absent("not_present");
  // Bound raw input before Zod allocates member errors or parses permissive
  // Date.parse strings. Preserve stored text; never normalize a rejected date.
  if((typeof observed.value==="string" && observed.value.length>128) || (Array.isArray(observed.value) && observed.value.length>16)) return absent("invalid");
  if(timestampFields.has(path) && observed.value!==null && !isStoredProvenanceTimestamp(observed.value)) return absent("invalid");
  const parsed=schema.safeParse(observed.value);
  if(!parsed.success) return absent("invalid");
  const value=parsed.data;
  if ((typeof value === "string" && value.length > 128) || (Array.isArray(value) && (value.length > 16 || value.some(v=>typeof v!=="string" || v.length>128)))) return absent("invalid");
  if(value===null || typeof value==="string" || typeof value==="boolean" || (typeof value==="number" && Number.isFinite(value)) || (Array.isArray(value) && value.every(v=>typeof v==="string")))
    return {status:"recorded",source,verification:"stored_observation",value};
  return absent("invalid");
}
export function projectReplayProvenance(input:{runId:string;batch:Record<string,unknown>;run:Record<string,unknown>;metadata:Record<string,unknown>|null;metadataReason:ProvenanceReason;research:Record<string,unknown>|null;researchReason:ProvenanceReason;researchSource:ProvenanceSource}): ReplayProvenance {
  const result=emptyReplayProvenance(input.runId,"partial","not_present");
  for(const descriptor of descriptors) result.fields[descriptor.path]=input.metadata ? field(input.metadata,descriptor.path,descriptor.schema,"run_metadata") : absent(input.metadataReason);
  for(const [name,raw,path] of [["batch.seed",input.batch,"seed"],["child.runSeed",input.run,"runSeed"],["window.seed",input.metadata,"window.seed"],["configuration.strategyPreset",input.metadata,"configuration.strategyPreset"],["configuration.packetIdPrefix",input.metadata,"configuration.packetIdPrefix"]] as const) {
    const observed=readPath(raw,path);
    result.fields[name]=absent(observed.present ? "redacted_text" : raw===null ? input.metadataReason : "not_present");
  }
  for(const key of hashes) result.fields[`research.${key}`]=input.research ? field(input.research,key,replayResearchManifestSchema.shape[key],input.researchSource) : absent(input.researchReason);
  result.fields["research.manifestVersion"]=input.research ? field(input.research,"manifestVersion",replayResearchManifestSchema.shape.manifestVersion,input.researchSource) : absent(input.researchReason);
  const execution=input.research?.executionModelVersion;
  result.fields["research.executionModelVersion"]=input.research===null ? absent(input.researchReason) :
    execution==="execution_simulator.v4" || execution==="execution_simulator.v5" ? {status:"recorded",source:input.researchSource,verification:"stored_observation",value:execution} : absent(execution===undefined ? "not_present" : "redacted_text");
  return result;
}
