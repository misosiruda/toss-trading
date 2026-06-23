import type {
  MarketCandidate,
  VirtualPortfolio,
  VirtualPosition
} from "../domain/schemas.js";
import {
  buildPortfolioExposureAggregate,
  positionExposureValueKrw
} from "./portfolioExposureAggregator.js";
import type { VirtualRiskRejectCode } from "./riskPolicy.js";

const DEFAULT_LEVERAGED_EXPOSURE_MULTIPLIER = 3;

export interface HedgePolicy {
  maxGrossExposureKrw?: number | undefined;
  maxGrossExposureRatio?: number | undefined;
  requireHedgeBucket?: boolean | undefined;
}

export interface EvaluateHedgePolicyInput {
  portfolio: VirtualPortfolio;
  candidate: MarketCandidate | undefined;
  notionalKrw: number;
  policy?: HedgePolicy | undefined;
}

export function evaluateHedgePolicy(
  input: EvaluateHedgePolicyInput
): VirtualRiskRejectCode[] {
  if (input.policy === undefined || input.notionalKrw <= 0) {
    return [];
  }

  const candidate = input.candidate;
  const hedgeIntent = resolveHedgeIntent(candidate);
  if (!hedgeIntent.hedgeLike) {
    return [];
  }

  const rejectCodes: VirtualRiskRejectCode[] = [];
  const requireHedgeBucket = input.policy.requireHedgeBucket ?? true;

  if (hedgeIntent.metadataMissing) {
    appendRejectCode(rejectCodes, "VIRTUAL_HEDGE_METADATA_MISSING");
  }

  if (
    requireHedgeBucket &&
    candidate?.strategyBucket !== undefined &&
    candidate.strategyBucket !== "hedge"
  ) {
    appendRejectCode(rejectCodes, "VIRTUAL_HEDGE_NOT_REDUCE_RISK");
  }

  if (!hedgeIntent.inverseExposure) {
    appendRejectCode(rejectCodes, "VIRTUAL_HEDGE_NOT_REDUCE_RISK");
  }

  const downsideExposure = currentNetDownsideExposureKrw(input.portfolio);
  const hedgeGrossExposureKrw =
    candidate === undefined
      ? input.notionalKrw
      : effectiveExposureKrw(candidate, input.notionalKrw);
  const hedgeDeltaKrw = hedgeIntent.inverseExposure
    ? -hedgeGrossExposureKrw
    : hedgeGrossExposureKrw;
  if (downsideExposure.metadataMissing) {
    appendRejectCode(rejectCodes, "VIRTUAL_HEDGE_METADATA_MISSING");
  }

  if (
    !reducesNetDownsideExposure({
      currentNetDownsideExposureKrw: downsideExposure.value,
      hedgeDeltaKrw
    })
  ) {
    appendRejectCode(rejectCodes, "VIRTUAL_HEDGE_NOT_REDUCE_RISK");
  }

  if (
    exceedsGrossExposureLimit({
      portfolio: input.portfolio,
      hedgeGrossExposureKrw,
      policy: input.policy
    })
  ) {
    appendRejectCode(rejectCodes, "VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED");
  }

  return rejectCodes;
}

function resolveHedgeIntent(candidate: MarketCandidate | undefined): {
  hedgeLike: boolean;
  inverseExposure: boolean;
  metadataMissing: boolean;
} {
  if (candidate === undefined) {
    return {
      hedgeLike: false,
      inverseExposure: false,
      metadataMissing: false
    };
  }

  const inverseExposure = isInverseExposure(candidate);
  const hedgeLike =
    candidate.strategyBucket === "hedge" || inverseExposure;

  return {
    hedgeLike,
    inverseExposure,
    metadataMissing:
      hedgeLike &&
      (candidate.assetType === undefined ||
        candidate.assetClass === undefined ||
        candidate.strategyBucket === undefined)
  };
}

function currentNetDownsideExposureKrw(portfolio: VirtualPortfolio): {
  value: number;
  metadataMissing: boolean;
} {
  let value = 0;
  let metadataMissing = false;

  for (const position of portfolio.positions) {
    const contribution = downsideExposureContribution(position);
    value += contribution.value;
    metadataMissing = metadataMissing || contribution.metadataMissing;
  }

  return { value, metadataMissing };
}

function downsideExposureContribution(
  position: VirtualPosition
): { value: number; metadataMissing: boolean } {
  const exposureKrw = positionExposureValueKrw(position);
  const grossExposureKrw = effectiveExposureKrw(position, exposureKrw);

  if (isInverseExposure(position)) {
    return {
      value: -grossExposureKrw,
      metadataMissing: position.assetClass === undefined
    };
  }

  if (
    position.assetClass === "equity" ||
    position.assetClass === "leveraged" ||
    position.assetType === "STOCK"
  ) {
    return {
      value: grossExposureKrw,
      metadataMissing: position.assetClass === undefined
    };
  }

  return {
    value: 0,
    metadataMissing: position.assetClass === undefined
  };
}

function reducesNetDownsideExposure(input: {
  currentNetDownsideExposureKrw: number;
  hedgeDeltaKrw: number;
}): boolean {
  if (input.currentNetDownsideExposureKrw <= 0) {
    return false;
  }

  const nextNetDownsideExposureKrw =
    input.currentNetDownsideExposureKrw + input.hedgeDeltaKrw;
  return (
    nextNetDownsideExposureKrw >= 0 &&
    nextNetDownsideExposureKrw < input.currentNetDownsideExposureKrw
  );
}

function exceedsGrossExposureLimit(input: {
  portfolio: VirtualPortfolio;
  hedgeGrossExposureKrw: number;
  policy: HedgePolicy;
}): boolean {
  const aggregate = buildPortfolioExposureAggregate(input.portfolio);
  const nextGrossExposureKrw =
    currentEffectiveGrossExposureKrw(input.portfolio) +
    input.hedgeGrossExposureKrw;

  if (
    input.policy.maxGrossExposureKrw !== undefined &&
    Number.isFinite(input.policy.maxGrossExposureKrw) &&
    nextGrossExposureKrw > input.policy.maxGrossExposureKrw
  ) {
    return true;
  }

  return (
    input.policy.maxGrossExposureRatio !== undefined &&
    Number.isFinite(input.policy.maxGrossExposureRatio) &&
    aggregate.virtualNetWorthKrw > 0 &&
    nextGrossExposureKrw / aggregate.virtualNetWorthKrw >
      input.policy.maxGrossExposureRatio
  );
}

function currentEffectiveGrossExposureKrw(portfolio: VirtualPortfolio): number {
  return portfolio.positions.reduce(
    (sum, position) =>
      sum + effectiveExposureKrw(position, positionExposureValueKrw(position)),
    0
  );
}

function isInverseExposure(
  value: Pick<MarketCandidate | VirtualPosition, "assetClass" | "riskTags">
): boolean {
  return (
    value.assetClass === "inverse" ||
    value.riskTags?.includes("inverse") === true
  );
}

function effectiveExposureKrw(
  value: Pick<MarketCandidate | VirtualPosition, "assetClass" | "riskTags">,
  exposureKrw: number
): number {
  return Math.abs(exposureKrw) * exposureMultiplier(value);
}

function exposureMultiplier(
  value: Pick<MarketCandidate | VirtualPosition, "assetClass" | "riskTags">
): number {
  return isLeveragedExposure(value)
    ? DEFAULT_LEVERAGED_EXPOSURE_MULTIPLIER
    : 1;
}

function isLeveragedExposure(
  value: Pick<MarketCandidate | VirtualPosition, "assetClass" | "riskTags">
): boolean {
  return (
    value.assetClass === "leveraged" ||
    value.riskTags?.includes("leveraged") === true
  );
}

function appendRejectCode(
  target: VirtualRiskRejectCode[],
  code: VirtualRiskRejectCode
): void {
  if (!target.includes(code)) {
    target.push(code);
  }
}
