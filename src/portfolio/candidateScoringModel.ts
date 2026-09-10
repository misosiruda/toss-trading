import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { candidateScoringModelRefSchema, compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const CANDIDATE_SCORING_ALGORITHM = "weighted_clamped_feature_score.v1";
const identifier = z.string().min(1).max(240).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const finite = z.number().finite().refine((value) => !Object.is(value, -0));
const bounded = finite.min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const termSchema = z.object({ featureDefinitionRef: identifier, weight: finite.positive().max(1),
  lowerBound: bounded, upperBound: bounded, direction: z.enum(["higher_is_better", "lower_is_better"]) }).strict()
  .refine((term) => term.upperBound > term.lowerBound, "score normalization bounds must be increasing");
const payloadSchema = z.object({ algorithm: z.literal(CANDIDATE_SCORING_ALGORITHM), version: identifier,
  terms: z.array(termSchema).min(1).max(128) }).strict();
const recordSchema = payloadSchema.extend({ scoringModelRecordId: identifier, scoringModelHash: sha256HashSchema,
  createdAt: offsetQualifiedIsoDateTimeSchema }).strict();
const featureSchema = z.object({ featureDefinitionRef: identifier, value: bounded,
  evidenceRefs: z.array(identifier).min(1).max(128) }).strict();
const inputSchema = z.object({ model: z.unknown(), features: z.array(featureSchema).min(1).max(128) }).strict();
export type CandidateScoringModel = Readonly<z.infer<typeof recordSchema>>;
export type CandidateScoringModelInput = z.input<typeof payloadSchema> & { createdAt: string };
export type CandidateScoringInput = z.input<typeof inputSchema>;

/** Explicit parameters only. A version label or record hash does not establish active policy authorization. */
export function createCandidateScoringModel(value: CandidateScoringModelInput): CandidateScoringModel {
  const parsed = payloadSchema.extend({ createdAt: offsetQualifiedIsoDateTimeSchema }).strict().parse(value);
  if (!isDeepStrictEqual(value, parsed)) throw new Error("candidate scoring model must already be canonical");
  const { createdAt, ...raw } = parsed;
  const terms = [...raw.terms].sort((left, right) => compareText(left.featureDefinitionRef, right.featureDefinitionRef));
  unique(terms.map((term) => term.featureDefinitionRef), "model feature");
  // Bind creation time as well as every parameter; this is an immutable content identity, not a version registry.
  const payload = { ...raw, terms, createdAt };
  const scoringModelHash = hashCanonicalPayload(payload);
  return freeze({ ...payload, scoringModelHash, scoringModelRecordId: hashDerivedId("candidate_scoring_model", scoringModelHash) });
}

export function parseCandidateScoringModel(value: unknown): CandidateScoringModel {
  const record = recordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) throw new Error("candidate scoring model must already be canonical");
  const { scoringModelRecordId: ignoredId, scoringModelHash: ignoredHash, ...payload } = record;
  void ignoredId; void ignoredHash;
  const expected = createCandidateScoringModel(payload);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate scoring model identity parameter or order mismatch");
  return expected;
}

export function candidateScoringModelRefFor(value: unknown) {
  const model = parseCandidateScoringModel(value);
  const ref = { scoringModelRecordId: model.scoringModelRecordId, version: model.version, hash: model.scoringModelHash };
  const parsed = candidateScoringModelRefSchema.parse(ref);
  if (!isDeepStrictEqual(ref, parsed)) throw new Error("candidate scoring model cannot be represented by a canonical policy reference");
  return Object.freeze(parsed);
}

/** Pure numeric calculation, not source evidence validation, hard-gate eligibility, allocation or ranking. */
export function calculateCandidateSelectionScore(value: CandidateScoringInput) {
  const parsed = inputSchema.parse(value);
  if (!isDeepStrictEqual(value, parsed)) throw new Error("candidate scoring input must already be canonical");
  const model = parseCandidateScoringModel(parsed.model);
  const features = parsed.features.map((feature) => {
    unique(feature.evidenceRefs, "feature evidence");
    return { ...feature, evidenceRefs: [...feature.evidenceRefs].sort(compareText) };
  }).sort((left, right) => compareText(left.featureDefinitionRef, right.featureDefinitionRef));
  unique(features.map((feature) => feature.featureDefinitionRef), "input feature");
  if (!isDeepStrictEqual(features.map((feature) => feature.featureDefinitionRef), model.terms.map((term) => term.featureDefinitionRef))) {
    throw new Error("candidate scoring input must contain the exact model feature set");
  }
  const totalWeight = model.terms.reduce((sum, term) => sum + term.weight, 0);
  const contributions = model.terms.map((term, index) => {
    const feature = features[index]!;
    const relative = Math.max(0, Math.min(1, (feature.value - term.lowerBound) / (term.upperBound - term.lowerBound)));
    const normalizedValue = term.direction === "higher_is_better" ? relative : 1 - relative;
    // Divide first: tiny positive weights must not underflow the weighted numerator before normalization.
    const normalizedWeight = term.weight / totalWeight;
    return { featureDefinitionRef: term.featureDefinitionRef, normalizedValue, normalizedWeight,
      weightedScore: normalizedValue * normalizedWeight, evidenceRefs: feature.evidenceRefs };
  });
  const selectionScore = Math.min(1, Math.max(0, contributions.reduce((sum, term) => sum + term.weightedScore, 0)));
  if (!Number.isFinite(selectionScore) || Object.is(selectionScore, -0)) throw new Error("candidate score is noncanonical");
  const input = { model, features };
  const inputHash = hashCanonicalPayload(input);
  const payload = { algorithm: CANDIDATE_SCORING_ALGORITHM, scoringModelRecordId: model.scoringModelRecordId,
    scoringModelHash: model.scoringModelHash, scoringModelVersion: model.version, inputHash, selectionScore, contributions };
  return freeze({ input, ...payload, outputHash: hashCanonicalPayload(payload) });
}

export function parseCandidateSelectionScore(value: unknown): ReturnType<typeof calculateCandidateSelectionScore> {
  if (value === null || typeof value !== "object" || !("input" in value)) throw new Error("candidate score input is missing");
  const expected = calculateCandidateSelectionScore(value.input as CandidateScoringInput);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate score complete payload or calculation replay mismatch");
  return expected;
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate candidate scoring ${label}`);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
