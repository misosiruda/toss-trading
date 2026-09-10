import { resolve } from "node:path";
import { CandidateSizingInputFileRepository, getDurableCandidateSizingInputObservation,
  type VerifiedCandidateSizingInputHistory, type VerifiedCandidateSizingInputOrigin } from "./candidateSizingInputFiles.js";
import { resolveMarketTechnicalCandidateSizingFeatures } from "./marketTechnicalCandidateEvidence.js";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";
import { MarketTechnicalEvidenceFileRepository, getDurableMarketTechnicalEvidenceObservation,
  type VerifiedMarketTechnicalEvidenceHistory, type VerifiedMarketTechnicalEvidenceOrigin } from "./marketTechnicalEvidenceFiles.js";

export interface VerifiedCandidateMarketTechnicalFeatures {
  readonly sizingInputOrigin: VerifiedCandidateSizingInputOrigin;
  readonly evidenceOrigin: VerifiedMarketTechnicalEvidenceOrigin;
}
const leases = new WeakMap<VerifiedCandidateMarketTechnicalFeatures, {
  inputs: VerifiedCandidateSizingInputHistory; evidence: VerifiedMarketTechnicalEvidenceHistory;
}>();

/** A live binding for six market features only, not eligibility, score, caps, cost or sizing approval. */
export function getCandidateMarketTechnicalFeatureSources(binding: VerifiedCandidateMarketTechnicalFeatures) {
  const sources = leases.get(binding);
  if (!sources) throw new Error("candidate market technical feature binding lacks a live source lease");
  return Object.freeze({ inputObservedAt: getDurableCandidateSizingInputObservation(sources.inputs),
    evidenceObservation: getDurableMarketTechnicalEvidenceObservation(sources.evidence) });
}

/** Request -> snapshot -> input -> historical source -> evidence. Keep every source lock through the consumer. */
export class CandidateMarketTechnicalFeatureResolver {
  private readonly inputs: CandidateSizingInputFileRepository;
  private readonly evidence: MarketTechnicalEvidenceFileRepository;
  constructor(baseDir: string, options: { historicalPath?: string; lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    const directory = resolve(baseDir);
    this.inputs = new CandidateSizingInputFileRepository(directory, options);
    this.evidence = new MarketTechnicalEvidenceFileRepository(directory, options);
  }
  async withResolvedFeatures<T>(sizingInputRecordId: string,
    operation: (binding: VerifiedCandidateMarketTechnicalFeatures) => Promise<T>): Promise<T> {
    if (typeof sizingInputRecordId !== "string" || !sizingInputRecordId.length || sizingInputRecordId.trim() !== sizingInputRecordId) {
      throw new Error("candidate sizing input record identity is invalid");
    }
    return this.inputs.withDurableVerifiedHistory((inputs) => this.evidence.withDurableVerifiedHistory(async (evidence) => {
      const binding = resolveStoredFeatures(inputs, evidence, sizingInputRecordId);
      leases.set(binding, { inputs, evidence });
      try { return await operation(binding); } finally { leases.delete(binding); }
    }));
  }
}

function resolveStoredFeatures(inputs: VerifiedCandidateSizingInputHistory, evidence: VerifiedMarketTechnicalEvidenceHistory,
  sizingInputRecordId: string): VerifiedCandidateMarketTechnicalFeatures {
  getDurableCandidateSizingInputObservation(inputs);
  getDurableMarketTechnicalEvidenceObservation(evidence);
  const sizingInputOrigin = inputs.origins.find((origin) => origin.record.sizingInputRecordId === sizingInputRecordId);
  if (!sizingInputOrigin) throw new Error("stored candidate sizing input is missing");
  const feature = sizingInputOrigin.record.featureInputs.find((item) => item.featureDefinitionRef === MARKET_TECHNICAL_FEATURE_DEFINITIONS.windowReturnRatio);
  if (!feature || feature.evidenceRefs.length !== 1) throw new Error("candidate market technical evidence reference is missing or ambiguous");
  const evidenceOrigin = evidence.origins.find((origin) => origin.binding.evidence.evidenceRef === feature.evidenceRefs[0]);
  if (!evidenceOrigin) throw new Error("committed market technical evidence is missing");
  resolveMarketTechnicalCandidateSizingFeatures({ sizingInput: sizingInputOrigin.record, evidence: evidenceOrigin.binding.evidence });
  if (Date.parse(evidenceOrigin.committedAt) > Date.parse(sizingInputOrigin.record.createdAt) ||
    Date.parse(evidenceOrigin.committedAt) > Date.parse(sizingInputOrigin.appendStartedAt)) {
    throw new Error("candidate sizing input predates committed market technical evidence");
  }
  return Object.freeze({ sizingInputOrigin, evidenceOrigin });
}
