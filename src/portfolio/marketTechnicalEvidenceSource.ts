import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { HistoricalMarketSnapshotFileSource, getDurableHistoricalMarketSnapshotObservation,
  historicalMarketSnapshotObservationSchema, resolveObservedHistoricalMarketSnapshotHistory,
  type HistoricalMarketSnapshotSourceOptions, type VerifiedHistoricalMarketSnapshotHistory } from "../storage/historicalMarketSnapshotSource.js";
import { createMarketTechnicalCandidateEvidenceRecord, parseMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { marketTechnicalCandidateFeatureInputSchema, normalizeMarketTechnicalCandidateFeatureInput } from "./marketTechnicalCandidateFeatures.js";

const querySchema = marketTechnicalCandidateFeatureInputSchema.omit({ snapshots: true }).strict();
const inputSchema = z.object({ sourceContractId: z.string().min(1).max(240), query: querySchema }).strict();
const envelopeSchema = z.object({ schemaVersion: z.literal("market_technical_source_binding.v1"),
  evidence: z.unknown(), sourceObservation: historicalMarketSnapshotObservationSchema }).strict();
export type MarketTechnicalEvidenceSourceInput = z.input<typeof inputSchema>;
export type MarketTechnicalEvidenceSourceBinding = ReturnType<typeof createMarketTechnicalEvidenceFromHistory>;

/** Extract all matching observations; no caller-supplied snapshots or silent truncation. */
export function createMarketTechnicalEvidenceFromHistory(history: VerifiedHistoricalMarketSnapshotHistory, value: MarketTechnicalEvidenceSourceInput) {
  const sourceObservation = getDurableHistoricalMarketSnapshotObservation(history);
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("market technical source input must already be canonical");
  const createdAt = new Date().toISOString();
  if (Date.parse(createdAt) < Date.parse(sourceObservation.observedAt)) throw new Error("market technical source creation clock moved backwards");
  const evidence = createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: input.sourceContractId,
    calculationInput: selectWindow(history.records, input.query), createdAt });
  return Object.freeze({ schemaVersion: "market_technical_source_binding.v1" as const, evidence, sourceObservation });
}

/** Replays supplied content against an observed source prefix. Not proof of a persisted commit or provider authority. */
export function resolveMarketTechnicalEvidenceSourceBinding(history: VerifiedHistoricalMarketSnapshotHistory, value: unknown): MarketTechnicalEvidenceSourceBinding {
  const envelope = envelopeSchema.parse(value);
  if (!isDeepStrictEqual(value, envelope)) throw new Error("market technical source binding must already be canonical");
  const evidence = parseMarketTechnicalCandidateEvidenceRecord(envelope.evidence);
  const records = resolveObservedHistoricalMarketSnapshotHistory(history, envelope.sourceObservation);
  if (Date.parse(evidence.createdAt) < Date.parse(envelope.sourceObservation.observedAt)) {
    throw new Error("market technical evidence predates source observation");
  }
  const { snapshots: supplied, ...query } = evidence.calculationInput;
  void supplied;
  const expected = selectWindow(records, query);
  if (!isDeepStrictEqual(evidence.calculationInput, expected)) throw new Error("market technical evidence does not match complete source window");
  return Object.freeze({ schemaVersion: envelope.schemaVersion, evidence,
    sourceObservation: Object.freeze(envelope.sourceObservation) });
}

/** File-backed construction while the actual source writer lock remains held through the consumer. */
export class MarketTechnicalEvidenceFileSource {
  private readonly source: HistoricalMarketSnapshotFileSource;
  constructor(filePath: string, options: HistoricalMarketSnapshotSourceOptions = {}) {
    this.source = new HistoricalMarketSnapshotFileSource(filePath, options);
  }
  async withEvidence<T>(value: MarketTechnicalEvidenceSourceInput,
    operation: (binding: MarketTechnicalEvidenceSourceBinding, history: VerifiedHistoricalMarketSnapshotHistory) => Promise<T>): Promise<T> {
    // Copy caller input before the asynchronous file/lock boundary.
    const input = inputSchema.parse(value);
    if (!isDeepStrictEqual(input, value)) throw new Error("market technical source input must already be canonical");
    return this.source.withDurableVerifiedHistory(async (history) => {
      const binding = createMarketTechnicalEvidenceFromHistory(history, input);
      return operation(binding, history);
    });
  }
}

function selectWindow(records: readonly HistoricalMarketSnapshot[], query: z.infer<typeof querySchema>) {
  const start = Date.parse(query.windowStart), end = Date.parse(query.asOf);
  const snapshots = records.filter((record) => record.market === query.market && record.symbol === query.symbol &&
    record.interval === query.interval && Date.parse(record.observedAt) >= start && Date.parse(record.observedAt) <= end);
  // The shared normalizer enforces minimum/maximum size, freshness, unique instants,
  // complete safe volume/prices and canonical nested arrays. Never pre-limit the source.
  return normalizeMarketTechnicalCandidateFeatureInput({ ...query, snapshots });
}
