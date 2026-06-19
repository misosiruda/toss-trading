import type {
  MarketCandidate,
  MarketPacket,
  VirtualBudgetTier,
  VirtualDecision,
  VirtualDecisionConfidenceBreakdown,
  VirtualDecisionItem
} from "../domain/schemas.js";
import { candidateDecisionDataRefs } from "../market/candidateDataRefs.js";

export function bindVirtualDecisionConfidenceBreakdown(input: {
  decision: VirtualDecision;
  packet: MarketPacket;
}): VirtualDecision {
  return {
    ...input.decision,
    decisions: input.decision.decisions.map((decisionItem) => ({
      ...decisionItem,
      confidenceBreakdown: assessVirtualDecisionConfidence({
        packet: input.packet,
        decision: decisionItem
      })
    }))
  };
}

export function assessVirtualDecisionConfidence(input: {
  packet: MarketPacket;
  decision: VirtualDecisionItem;
}): VirtualDecisionConfidenceBreakdown {
  const candidate = findCandidate(input.packet, input.decision);
  const modelConfidence = input.decision.confidence;
  const dataCompletenessScore = dataCompleteness(input.decision, candidate);
  const evidenceQualityScore = evidenceQuality(
    input.decision,
    candidate,
    dataCompletenessScore
  );
  const policyEligibilityScore = policyEligibility(input.decision, candidate);
  const executionRiskScore = executionRisk(input.packet, input.decision, candidate);
  const overallScore = weightedScore([
    [evidenceQualityScore, 0.35],
    [dataCompletenessScore, 0.25],
    [policyEligibilityScore, 0.25],
    [executionRiskScore, 0.15]
  ]);

  return {
    modelConfidence,
    evidenceQualityScore,
    dataCompletenessScore,
    policyEligibilityScore,
    executionRiskScore,
    overallScore,
    reasonCodes: [
      confidenceBucket("MODEL_CONFIDENCE", modelConfidence * 100),
      confidenceBucket("EVIDENCE_QUALITY", evidenceQualityScore),
      confidenceBucket("DATA_COMPLETENESS", dataCompletenessScore),
      confidenceBucket("POLICY_ELIGIBILITY", policyEligibilityScore),
      confidenceBucket("EXECUTION_RISK_CONTROL", executionRiskScore)
    ]
  };
}

function dataCompleteness(
  decision: VirtualDecisionItem,
  candidate: MarketCandidate | undefined
): number {
  if (candidate === undefined) {
    return 0;
  }

  const sourceRefs = new Set(candidateDecisionDataRefs(candidate));
  const decisionRefs = new Set(decision.dataRefs);
  const coveredSourceCount = Array.from(decisionRefs).filter((dataRef) =>
    sourceRefs.has(dataRef)
  ).length;
  const dataRefCoverage =
    sourceRefs.size === 0 ? 0 : (coveredSourceCount / sourceRefs.size) * 100;
  const claimSupportScore =
    decision.claimSupport !== undefined && decision.claimSupport.length > 0
      ? 100
      : 0;

  const candidateFeatureRefs = new Set(candidate.featureRefs ?? []);
  const decisionFeatureRefs = referencedFeatureRefs(decision);
  const featureRefCoverage =
    candidateFeatureRefs.size === 0
      ? 100
      : decisionFeatureRefs.size === 0
        ? 50
        : (Array.from(decisionFeatureRefs).filter((featureRef) =>
            candidateFeatureRefs.has(featureRef)
          ).length /
            decisionFeatureRefs.size) *
          100;

  return weightedScore([
    [dataRefCoverage, 0.5],
    [claimSupportScore, 0.3],
    [featureRefCoverage, 0.2]
  ]);
}

function evidenceQuality(
  decision: VirtualDecisionItem,
  candidate: MarketCandidate | undefined,
  dataCompletenessScore: number
): number {
  if (candidate === undefined) {
    return 0;
  }

  const featureRefs = referencedFeatureRefs(decision);
  const featureScores =
    candidate.featureScores
      ?.filter((featureScore) => featureRefs.has(featureScore.featureRef))
      .map((featureScore) => featureScore.score) ?? [];
  const featureScoreAverage =
    featureScores.length > 0 ? average(featureScores) : candidate.score ?? 50;
  const candidateScore = candidate.score ?? featureScoreAverage;

  return weightedScore([
    [candidateScore, 0.4],
    [featureScoreAverage, 0.4],
    [dataCompletenessScore, 0.2]
  ]);
}

function policyEligibility(
  decision: VirtualDecisionItem,
  candidate: MarketCandidate | undefined
): number {
  if (candidate === undefined) {
    return 0;
  }

  if (decision.action === "VIRTUAL_HOLD") {
    return decision.holdReasonCode === undefined ? 0 : 100;
  }

  if (decision.action === "VIRTUAL_BUY") {
    if (candidate.buyEligible === false) {
      return 0;
    }
    if (candidate.buyEligible === true) {
      return budgetTierScore(candidate.budgetTierAllowed ?? "NONE");
    }
    return 50;
  }

  if (decision.action === "VIRTUAL_SELL") {
    if (candidate.sellEligible === false) {
      return 0;
    }
    if (candidate.sellEligible === true) {
      return 100;
    }
    return 50;
  }

  return 0;
}

function executionRisk(
  packet: MarketPacket,
  decision: VirtualDecisionItem,
  candidate: MarketCandidate | undefined
): number {
  if (candidate === undefined) {
    return 0;
  }

  if (decision.action === "VIRTUAL_HOLD") {
    return 100;
  }

  if (candidate.lastPriceKrw === undefined || candidate.lastPriceKrw <= 0) {
    return 0;
  }

  if (decision.action === "VIRTUAL_BUY") {
    return decision.budgetKrw <= packet.constraints.maxBudgetPerSymbolKrw
      ? 100
      : 0;
  }

  if (decision.action === "VIRTUAL_SELL") {
    return decision.reduceOnly === true ? 100 : 60;
  }

  return 0;
}

function referencedFeatureRefs(decision: VirtualDecisionItem): Set<string> {
  return new Set([
    ...(decision.featureRefs ?? []),
    ...(decision.claimSupport ?? []).flatMap(
      (claimSupport) => claimSupport.featureRefs ?? []
    )
  ]);
}

function findCandidate(
  packet: MarketPacket,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): MarketCandidate | undefined {
  return packet.candidates.find(
    (candidate) =>
      candidate.market === decision.market && candidate.symbol === decision.symbol
  );
}

function budgetTierScore(tier: VirtualBudgetTier): number {
  switch (tier) {
    case "LARGE":
      return 100;
    case "MEDIUM":
      return 66;
    case "SMALL":
      return 33;
    case "NONE":
      return 0;
  }
}

function confidenceBucket(prefix: string, score: number): string {
  if (score >= 67) {
    return `${prefix}_HIGH`;
  }
  if (score >= 34) {
    return `${prefix}_MEDIUM`;
  }
  return `${prefix}_LOW`;
}

function weightedScore(weightedValues: Array<[number, number]>): number {
  const totalWeight = weightedValues.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  const weightedTotal = weightedValues.reduce(
    (sum, [value, weight]) => sum + clampScore(value) * weight,
    0
  );
  return clampScore(weightedTotal / totalWeight);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
