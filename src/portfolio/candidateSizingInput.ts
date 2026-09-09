import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { marketSchema, sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { parseBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { paperFillExecutionPolicySchema } from "./paperFillExecution.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const wellFormed = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const identifier = z.string().min(1).max(240).refine((value) => value.trim() === value && wellFormed(value));
const finite = z.number().finite().refine((value) => !Object.is(value, -0));
const amount = finite.nonnegative().refine(Number.isSafeInteger);
const ratio = finite.min(0).max(1);
const evidenceRefs = z.array(identifier).min(1).max(128);
const featureSchema = z.object({ featureDefinitionRef: identifier,
  value: z.union([finite, z.boolean(), z.string().max(4096).refine(wellFormed)]), evidenceRefs }).strict();

/** Complete parameters, without runtime defaults. A named model is not proof its estimate was evaluated. */
export const candidateExecutionCostInputSchema = paperFillExecutionPolicySchema.omit({ modelVersion: true }).extend({
  modelVersion: identifier, side: z.enum(["BUY", "SELL"]), referenceNotionalKrw: amount,
  participationRate: ratio, estimatedCostKrw: amount, evidenceRefs
}).strict();

export const candidateSizingInputPayloadSchema = z.object({
  requestId: identifier, portfolioId: identifier, portfolioSnapshotId: identifier, portfolioSnapshotHash: sha256HashSchema,
  policyHash: sha256HashSchema, asOf: offsetQualifiedIsoDateTimeSchema, market: marketSchema, symbol: identifier,
  bucket: strategyBucketSchema, scoringModelVersion: identifier, sizingAlgorithmVersion: identifier, selectionScore: finite,
  exposureKeys: z.object({ sector: identifier, country: identifier, currency: identifier, classificationEvidenceRef: identifier }).strict(),
  featureInputs: z.array(featureSchema).min(1).max(128),
  exposureCapInputs: z.object({ bucketRemainingKrw: amount, symbolRemainingKrw: amount, sectorRemainingKrw: amount,
    countryRemainingKrw: amount, currencyRemainingKrw: amount, cashAvailableKrw: amount }).strict(),
  liquidityInput: z.object({ averageDailyNotionalKrw: amount, maximumParticipationRatio: ratio,
    maximumLiquidityNotionalKrw: amount, evidenceRefs }).strict(),
  executionCostInput: candidateExecutionCostInputSchema
}).strict();
export const candidateSizingInputRecordSchema = candidateSizingInputPayloadSchema.extend({
  sizingInputRecordId: identifier, sizingInputHash: sha256HashSchema, createdAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type CandidateSizingInputRecord = Readonly<z.infer<typeof candidateSizingInputRecordSchema>>;

/** Immutable input content only; no feature/eligibility/score/cap/cost/sizing evaluation or source authority. */
export function createCandidateSizingInputRecord(input: z.input<typeof candidateSizingInputPayloadSchema> & { createdAt: string }): CandidateSizingInputRecord {
  const { createdAt, ...raw } = input;
  const payload = canonicalPayload(raw);
  assertTime(payload.asOf, createdAt);
  return deepFreeze(candidateSizingInputRecordSchema.parse({ ...payload, createdAt,
    sizingInputRecordId: recordId(payload), sizingInputHash: hashCanonicalPayload(payload) }));
}

export function parseCandidateSizingInputRecord(value: unknown): CandidateSizingInputRecord {
  const record = candidateSizingInputRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) throw new Error("candidate sizing input must already be canonical");
  const { sizingInputRecordId, sizingInputHash, createdAt, ...payload } = record;
  if (!isDeepStrictEqual(payload, canonicalPayload(payload))) throw new Error("candidate sizing feature and evidence order is not canonical");
  assertTime(payload.asOf, createdAt);
  if (sizingInputRecordId !== recordId(payload) || sizingInputHash !== hashCanonicalPayload(payload)) {
    throw new Error("candidate sizing input identity or complete payload hash mismatch");
  }
  return deepFreeze(record);
}

/** Payload binding only. The request itself still needs its actual trigger/policy/snapshot/capacity resolution. */
export function resolveCandidateSizingInputRequestBinding(input: { sizingInput: unknown; request: unknown }) {
  const sizingInput = parseCandidateSizingInputRecord(input.sizingInput);
  const request = parseBucketSelectionRequest(input.request);
  if (sizingInput.requestId !== request.requestId || sizingInput.portfolioId !== request.portfolioId ||
    sizingInput.portfolioSnapshotId !== request.portfolioSnapshotId || sizingInput.portfolioSnapshotHash !== request.portfolioSnapshotHash ||
    sizingInput.policyHash !== request.policyHash || sizingInput.bucket !== request.bucket ||
    Date.parse(sizingInput.asOf) !== Date.parse(request.asOf) || Date.parse(sizingInput.createdAt) < Date.parse(request.createdAt)) {
    throw new Error("candidate sizing input request scope or chronology mismatch");
  }
  return Object.freeze({ sizingInput, request });
}

function canonicalPayload(value: unknown) {
  const payload = candidateSizingInputPayloadSchema.parse(value);
  const features = payload.featureInputs.map((feature) => ({ ...feature, evidenceRefs: canonicalRefs(feature.evidenceRefs) }))
    .sort((left, right) => compareText(left.featureDefinitionRef, right.featureDefinitionRef));
  if (new Set(features.map((feature) => feature.featureDefinitionRef)).size !== features.length) {
    throw new Error("candidate sizing input has duplicate feature definitions");
  }
  return { ...payload, featureInputs: features,
    liquidityInput: { ...payload.liquidityInput, evidenceRefs: canonicalRefs(payload.liquidityInput.evidenceRefs) },
    executionCostInput: { ...payload.executionCostInput, evidenceRefs: canonicalRefs(payload.executionCostInput.evidenceRefs) } };
}
function canonicalRefs(refs: string[]): string[] {
  if (new Set(refs).size !== refs.length) throw new Error("candidate sizing input has duplicate evidence refs");
  return [...refs].sort(compareText);
}
function recordId(payload: z.infer<typeof candidateSizingInputPayloadSchema>) {
  return hashDerivedId("candidate_sizing_input", hashCanonicalPayload({ requestId: payload.requestId, market: payload.market, symbol: payload.symbol }));
}
function assertTime(asOf: string, createdAt: string) {
  offsetQualifiedIsoDateTimeSchema.parse(createdAt);
  if (Date.parse(asOf) > Date.parse(createdAt)) throw new Error("candidate sizing input cannot be created before asOf");
}
function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
