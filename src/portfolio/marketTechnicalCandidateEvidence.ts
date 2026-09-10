import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { parseCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { calculateMarketTechnicalCandidateFeatures, marketTechnicalCandidateFeatureInputSchema,
  normalizeMarketTechnicalCandidateFeatureInput } from "./marketTechnicalCandidateFeatures.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const inputSchema = z.object({ sourceContractId: identifier,
  calculationInput: marketTechnicalCandidateFeatureInputSchema, createdAt: offsetQualifiedIsoDateTimeSchema }).strict();
const recordSchema = inputSchema.extend({ recordType: z.literal("market_technical_candidate_evidence.v1"),
  evidenceRef: identifier, evidenceHash: sha256HashSchema, calculation: z.unknown() }).strict();

export type MarketTechnicalCandidateEvidenceRecord = ReturnType<typeof createMarketTechnicalCandidateEvidenceRecord>;

/** Replayable content only. sourceContractId is a declaration, not verified provider/storage provenance. */
export function createMarketTechnicalCandidateEvidenceRecord(value: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("market technical evidence input must already be canonical");
  const calculationInput = normalizeMarketTechnicalCandidateFeatureInput(input.calculationInput);
  const createdAt = Date.parse(input.createdAt);
  if (createdAt < Date.parse(calculationInput.asOf) ||
    calculationInput.snapshots.some((snapshot) => Date.parse(snapshot.createdAt) > createdAt)) {
    throw new Error("market technical evidence predates its asOf or source materialization");
  }
  const calculation = calculateMarketTechnicalCandidateFeatures(calculationInput);
  const payload = { recordType: "market_technical_candidate_evidence.v1" as const,
    sourceContractId: input.sourceContractId, calculationInput, calculation,
    evidenceRef: calculation.evidenceRef, createdAt: input.createdAt };
  // Bind createdAt as well as the complete calculation/input. evidenceRef remains
  // the calculator's input identity; different record hashes are not exact retries.
  return Object.freeze({ ...payload, evidenceHash: hashCanonicalPayload(payload) });
}

/** Independently re-executes every feature and compares the entire canonical record, not only caller-supplied hashes. */
export function parseMarketTechnicalCandidateEvidenceRecord(value: unknown): MarketTechnicalCandidateEvidenceRecord {
  const record = recordSchema.parse(value);
  if (!isDeepStrictEqual(record, value)) throw new Error("market technical evidence record must already be canonical");
  const expected = createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: record.sourceContractId,
    calculationInput: record.calculationInput, createdAt: record.createdAt });
  if (!isDeepStrictEqual(record, expected)) throw new Error("market technical evidence complete payload or calculation replay mismatch");
  return expected;
}

/** Binds only the six calculated features. Does not authenticate sources/policy or evaluate other features, score, caps, cost or sizing. */
export function resolveMarketTechnicalCandidateSizingFeatures(input: { sizingInput: unknown; evidence: unknown }) {
  const sizingInput = parseCandidateSizingInputRecord(input.sizingInput);
  const evidence = parseMarketTechnicalCandidateEvidenceRecord(input.evidence);
  const calculation = evidence.calculation;
  if (sizingInput.market !== calculation.market || sizingInput.symbol !== calculation.symbol ||
    Date.parse(sizingInput.asOf) !== Date.parse(calculation.asOf) || Date.parse(sizingInput.createdAt) < Date.parse(evidence.createdAt)) {
    throw new Error("market technical sizing feature scope or chronology mismatch");
  }
  for (const expected of calculation.featureInputs) {
    const actual = sizingInput.featureInputs.find((feature) => feature.featureDefinitionRef === expected.featureDefinitionRef);
    if (!isDeepStrictEqual(actual, expected)) throw new Error("market technical sizing feature value or evidence reference mismatch");
  }
  return Object.freeze({ sizingInput, evidence });
}
