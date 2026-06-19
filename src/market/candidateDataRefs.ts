import type { MarketCandidate } from "../domain/schemas.js";

interface CandidateDataRefInput {
  market: MarketCandidate["market"];
  symbol: string;
  sourceRefs?: readonly string[];
  dataRefs?: readonly string[];
}

export function buildCandidateDataRefs(
  candidate: CandidateDataRefInput
): string[] {
  return (candidate.sourceRefs ?? []).map(
    (_sourceRef, index) => `${candidateDataRefPrefix(candidate)}.source.${index}`
  );
}

export function candidateDecisionDataRefs(
  candidate: Pick<MarketCandidate, "sourceRefs" | "dataRefs">
): readonly string[] {
  return candidate.dataRefs && candidate.dataRefs.length > 0
    ? candidate.dataRefs
    : candidate.sourceRefs;
}

export function firstCandidateDecisionDataRef(
  candidate: Pick<MarketCandidate, "sourceRefs" | "dataRefs">,
  fallback: string
): string {
  return candidateDecisionDataRefs(candidate)[0] ?? fallback;
}

function candidateDataRefPrefix(
  candidate: Pick<CandidateDataRefInput, "market" | "symbol">
): string {
  return `candidate.${candidate.market}.${candidate.symbol}`;
}
