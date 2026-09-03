import { isDeepStrictEqual } from "node:util";

import {
  strategyBucketSchema,
  type StrategyBucket
} from "../domain/schemas.js";
import {
  parseBucketSelectionRequest,
  type BucketSelectionRequest
} from "./bucketSelectionRequest.js";
import {
  analyzePortfolioGaps,
  type BucketPortfolioGap,
  type PortfolioGapAnalysis,
  type PortfolioGapAnalysisInput
} from "./portfolioGapAnalyzer.js";
import {
  resolvePortfolioSizingSnapshot,
  type ResolvedPortfolioSizingSnapshot
} from "./portfolioSizingSnapshotResolver.js";
import {
  offsetQualifiedIsoDateTimeSchema,
  parseBucketSelectionPolicyRecord,
  type BucketSelectionPolicyRecord,
  type StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";
import {
  resolveEveryTickPortfolioCycleTrigger,
  type CanonicalMarketPacketHistory,
  type ResolvedEveryTickPortfolioCycleTrigger
} from "./everyTickPortfolioCycleTriggerResolver.js";
import {
  resolveScheduledPortfolioCycleTrigger,
  type ResolvedScheduledPortfolioCycleTrigger
} from "./scheduledPortfolioCycleTriggerResolver.js";
import {
  resolvePortfolioCycleTrigger,
  type PortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";
import {
  parseRuntimePortfolioPolicyRecord,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";

export type BucketSelectionOpeningCapacity =
  PortfolioGapAnalysisInput["exposure"]["bucketOpeningCapacities"][number];

export const EVERY_TICK_MARKET_PACKET_SOURCE_CONTRACT_ID =
  "verified-market-packet.v1";

export interface ResolvedBucketSelectionRequest {
  request: BucketSelectionRequest;
  sizingSnapshot: ResolvedPortfolioSizingSnapshot["snapshot"];
  verifiedExposure: ResolvedPortfolioSizingSnapshot["verifiedExposure"];
  policy: RuntimePortfolioPolicyRecord;
  bucketPolicy: StrategyBucketRuntimePolicy;
  cycleTrigger: ResolvedPortfolioCycleTrigger;
  triggerSource?: ResolvedBucketSelectionTriggerSource;
  analysis: PortfolioGapAnalysis;
  gap: BucketPortfolioGap;
}

export interface ScheduledBucketSelectionTriggerSourceInput {
  scheduleBoundary: unknown;
  sessionCalendar: unknown;
}

export interface EveryTickBucketSelectionTriggerSourceInput {
  marketPacketHistory: CanonicalMarketPacketHistory;
  selectionPolicy: unknown;
}

export interface ResolvedEveryTickBucketSelectionTriggerSource {
  sourceKind: "market_packet";
  cycleTrigger: ResolvedEveryTickPortfolioCycleTrigger;
  selectionPolicy: BucketSelectionPolicyRecord;
}

export interface ResolvedScheduledBucketSelectionTriggerSource {
  sourceKind: "schedule_slot";
  cycleTrigger: ResolvedScheduledPortfolioCycleTrigger;
}

export type ResolvedBucketSelectionTriggerSource =
  | ResolvedEveryTickBucketSelectionTriggerSource
  | ResolvedScheduledBucketSelectionTriggerSource;

/**
 * Resolves a stored selection request against immutable sizing and policy data.
 *
 * `activePolicy` must be obtained by an activation-aware caller for the request
 * timestamp. Opening-capacity counts must come from the mandate/reservation
 * replay boundary. Every-tick requests additionally require the raw canonical
 * packet history and exact immutable selection policy so this resolver can
 * bind the source artifact, freshness, portfolio, and market scope.
 */
export function resolveBucketSelectionRequest(input: {
  value: unknown;
  sizingSnapshot: unknown;
  activePolicy: unknown;
  cycleTrigger: unknown;
  scheduledTriggerSource?: ScheduledBucketSelectionTriggerSourceInput;
  everyTickTriggerSource?: EveryTickBucketSelectionTriggerSourceInput;
  bucketOpeningCapacities: readonly BucketSelectionOpeningCapacity[];
}): ResolvedBucketSelectionRequest {
  const request = parseBucketSelectionRequest(input.value);
  const resolvedSnapshot = resolvePortfolioSizingSnapshot(
    input.sizingSnapshot
  );
  const policy = parseRuntimePortfolioPolicyRecord(input.activePolicy);
  const cycleTrigger = resolvePortfolioCycleTrigger(input.cycleTrigger);
  assertSnapshotBinding(request, resolvedSnapshot.snapshot);
  assertPolicyBinding(request, policy);

  const bucketPolicy = resolveBucketPolicy(policy, request.bucket);
  assertTriggerBinding(request, bucketPolicy, cycleTrigger);
  const triggerSource = resolveTriggerSource({
    request,
    policy,
    bucketPolicy,
    cycleTrigger,
    cycleTriggerValue: input.cycleTrigger,
    ...(input.scheduledTriggerSource === undefined
      ? {}
      : { scheduledTriggerSource: input.scheduledTriggerSource }),
    ...(input.everyTickTriggerSource === undefined
      ? {}
      : { everyTickTriggerSource: input.everyTickTriggerSource })
  });
  const analysis = analyzePortfolioGaps({
    policy,
    exposure: {
      portfolioId: request.portfolioId,
      policyHash: request.policyHash,
      virtualNetWorthKrw:
        resolvedSnapshot.snapshot.exposureSnapshot.virtualNetWorthKrw,
      cashKrw: resolvedSnapshot.snapshot.exposureSnapshot.cashKrw,
      pendingBuyExposureKrw:
        resolvedSnapshot.snapshot.exposureSnapshot.pendingBuyExposureKrw,
      bucketExposures: strategyBucketSchema.options.map((bucket) => ({
        bucket,
        exposureKrw:
          resolvedSnapshot.snapshot.exposureSnapshot.bucketExposureKrw[
            bucket
          ]
      })),
      bucketOpeningCapacities: [...input.bucketOpeningCapacities]
    },
    dueBuckets:
      bucketPolicy.selectionTrigger.mode === "entry_floor_on_due_cycle"
        ? [request.bucket]
        : []
  });
  const gap = resolveBucketGap(analysis, request.bucket);
  if (!gap.requestEligible) {
    throw new Error("bucket selection request is not eligible after gap replay");
  }
  if (
    !isDeepStrictEqual(
      {
        gapBasis: request.gapBasis,
        gapKrw: request.gapKrw,
        availableSlots: request.availableSlots,
        maximumAdditionalExposureKrw:
          request.maximumAdditionalExposureKrw
      },
      {
        gapBasis: gap.gapBasis,
        gapKrw: gap.gapKrw,
        availableSlots: gap.availableSlots,
        maximumAdditionalExposureKrw: gap.maximumAdditionalExposureKrw
      }
    )
  ) {
    throw new Error(
      "bucket selection request gap, slot, or capacity does not match replay"
    );
  }

  return deepFreeze({
    request,
    sizingSnapshot: resolvedSnapshot.snapshot,
    verifiedExposure: resolvedSnapshot.verifiedExposure,
    policy,
    bucketPolicy,
    cycleTrigger,
    ...(triggerSource === undefined ? {} : { triggerSource }),
    analysis,
    gap
  });
}

function resolveTriggerSource(input: {
  request: BucketSelectionRequest;
  policy: RuntimePortfolioPolicyRecord;
  bucketPolicy: StrategyBucketRuntimePolicy;
  cycleTrigger: ResolvedPortfolioCycleTrigger;
  cycleTriggerValue: unknown;
  scheduledTriggerSource?: ScheduledBucketSelectionTriggerSourceInput;
  everyTickTriggerSource?: EveryTickBucketSelectionTriggerSourceInput;
}): ResolvedBucketSelectionTriggerSource | undefined {
  if (input.cycleTrigger.trigger.triggerKind === "scheduled") {
    if (input.everyTickTriggerSource !== undefined) {
      throw new Error(
        "every-tick trigger source is allowed only for an every_tick trigger"
      );
    }
    if (input.scheduledTriggerSource === undefined) {
      throw new Error("scheduled selection request requires its slot source");
    }
    const cycleTrigger = resolveScheduledPortfolioCycleTrigger({
      value: input.cycleTriggerValue,
      scheduleBoundary: input.scheduledTriggerSource.scheduleBoundary,
      sessionCalendar: input.scheduledTriggerSource.sessionCalendar
    });
    assertScheduledSourceBinding(input.policy, input.bucketPolicy, cycleTrigger);
    return deepFreeze({ sourceKind: "schedule_slot", cycleTrigger });
  }
  if (input.scheduledTriggerSource !== undefined) {
    throw new Error(
      "scheduled trigger source is allowed only for a scheduled trigger"
    );
  }
  if (input.cycleTrigger.trigger.triggerKind !== "every_tick") {
    if (input.everyTickTriggerSource !== undefined) {
      throw new Error(
        "every-tick trigger source is allowed only for an every_tick trigger"
      );
    }
    return undefined;
  }
  if (input.everyTickTriggerSource === undefined) {
    throw new Error("every_tick selection request requires its packet source");
  }

  const cycleTrigger = resolveEveryTickPortfolioCycleTrigger({
    value: input.cycleTriggerValue,
    marketPacketHistory: input.everyTickTriggerSource.marketPacketHistory
  });
  const selectionPolicy = parseBucketSelectionPolicyRecord(
    input.everyTickTriggerSource.selectionPolicy
  );
  assertEveryTickSelectionPolicyBinding(
    input.request,
    input.policy,
    input.bucketPolicy,
    selectionPolicy
  );
  assertEveryTickMarketPacketBinding(
    input.request,
    input.bucketPolicy,
    selectionPolicy,
    cycleTrigger
  );
  return deepFreeze({
    sourceKind: "market_packet",
    cycleTrigger,
    selectionPolicy
  });
}

function assertScheduledSourceBinding(
  policy: RuntimePortfolioPolicyRecord,
  bucketPolicy: StrategyBucketRuntimePolicy,
  source: ResolvedScheduledPortfolioCycleTrigger
): void {
  if (bucketPolicy.reviewCadence.mode !== "scheduled") {
    throw new Error("scheduled source requires scheduled bucket cadence");
  }
  const boundary = source.boundary;
  if (
    !bucketPolicy.reviewCadence.boundaryRefs.some(
      (reference) =>
        reference.scheduleBoundaryRecordId ===
          boundary.scheduleBoundaryRecordId &&
        reference.version === boundary.version &&
        reference.hash === boundary.hash &&
        reference.lineageHash === boundary.lineageHash
    )
  ) {
    throw new Error("scheduled source boundary ref mismatch");
  }
  if (!bucketPolicy.enabledMarkets.includes(boundary.market)) {
    throw new Error("scheduled source market is disabled for bucket");
  }
  if (Date.parse(boundary.createdAt) > Date.parse(policy.createdAt)) {
    throw new Error("scheduled source boundary postdates runtime policy");
  }
}

function assertEveryTickSelectionPolicyBinding(
  request: BucketSelectionRequest,
  policy: RuntimePortfolioPolicyRecord,
  bucketPolicy: StrategyBucketRuntimePolicy,
  selectionPolicy: BucketSelectionPolicyRecord
): void {
  const reference = bucketPolicy.selectionPolicyRef;
  if (
    selectionPolicy.bucket !== request.bucket ||
    selectionPolicy.selectionPolicyRecordId !==
      reference.selectionPolicyRecordId ||
    selectionPolicy.version !== reference.version ||
    selectionPolicy.hash !== reference.hash ||
    selectionPolicy.lineageHash !== reference.lineageHash
  ) {
    throw new Error("every_tick selection policy binding mismatch");
  }
  if (selectionPolicy.everyTickSourceRequirement === undefined) {
    throw new Error(
      "every_tick selection policy requires a market packet source"
    );
  }
  if (
    selectionPolicy.everyTickSourceRequirement.sourceContractId !==
      EVERY_TICK_MARKET_PACKET_SOURCE_CONTRACT_ID ||
    !selectionPolicy.requiredEvidence.some(
      (requirement) =>
        requirement.evidenceClass === "market_technical" &&
        requirement.sourceContractId ===
          EVERY_TICK_MARKET_PACKET_SOURCE_CONTRACT_ID
    )
  ) {
    throw new Error(
      "every_tick selection policy does not bind the verified packet contract"
    );
  }
  if (
    selectionPolicy.requiredEvidence.some(
      (requirement) =>
        requirement.evidenceClass === "market_technical" &&
        requirement.sourceContractId ===
          EVERY_TICK_MARKET_PACKET_SOURCE_CONTRACT_ID &&
        requirement.minimumObservationCount !== undefined
    )
  ) {
    throw new Error(
      "every_tick packet cannot prove the minimum market observation count"
    );
  }
  if (Date.parse(selectionPolicy.createdAt) > Date.parse(policy.createdAt)) {
    throw new Error(
      "every_tick selection policy postdates the runtime policy"
    );
  }
  if (Date.parse(selectionPolicy.createdAt) > Date.parse(request.asOf)) {
    throw new Error("every_tick selection policy postdates the request");
  }
}

function assertEveryTickMarketPacketBinding(
  request: BucketSelectionRequest,
  bucketPolicy: StrategyBucketRuntimePolicy,
  selectionPolicy: BucketSelectionPolicyRecord,
  source: ResolvedEveryTickPortfolioCycleTrigger
): void {
  const packet = source.marketPacket;
  assertOffsetQualifiedPacketEvidenceTimestamp(
    packet.generatedAt,
    "generatedAt"
  );
  assertOffsetQualifiedPacketEvidenceTimestamp(packet.expiresAt, "expiresAt");
  if (packet.virtualPortfolio.portfolioId !== request.portfolioId) {
    throw new Error("every_tick packet portfolio mismatch");
  }
  const ageMilliseconds =
    Date.parse(request.asOf) - Date.parse(packet.generatedAt);
  if (ageMilliseconds < 0) {
    throw new Error("every_tick packet postdates the selection request");
  }
  const requirement = selectionPolicy.everyTickSourceRequirement;
  if (requirement === undefined) {
    throw new Error("every_tick packet source requirement is missing");
  }
  const maximumAgeSeconds = selectionPolicy.requiredEvidence
    .filter(
      (evidence) =>
        evidence.evidenceClass === "market_technical" &&
        evidence.sourceContractId ===
          EVERY_TICK_MARKET_PACKET_SOURCE_CONTRACT_ID
    )
    .reduce(
      (maximumAge, evidence) =>
        Math.min(maximumAge, evidence.maximumAgeSeconds),
      requirement.maximumAgeSeconds
    );
  if (
    ageMilliseconds / 1_000 > maximumAgeSeconds ||
    Date.parse(request.asOf) >= Date.parse(packet.expiresAt)
  ) {
    throw new Error("every_tick packet is stale for the selection request");
  }

  const packetGeneratedAt = Date.parse(packet.generatedAt);
  const requestAsOf = Date.parse(request.asOf);
  for (const candidate of packet.candidates) {
    assertOffsetQualifiedPacketEvidenceTimestamp(
      candidate.collectedAt,
      "candidate.collectedAt"
    );
    assertOffsetQualifiedPacketEvidenceTimestamp(
      candidate.staleAfter,
      "candidate.staleAfter"
    );
    const collectedAt = Date.parse(candidate.collectedAt);
    const staleAfter = Date.parse(candidate.staleAfter);
    if (collectedAt > packetGeneratedAt) {
      throw new Error(
        "every_tick packet candidate evidence postdates the market packet"
      );
    }
    if (
      staleAfter <= collectedAt ||
      requestAsOf - collectedAt > maximumAgeSeconds * 1_000 ||
      requestAsOf >= staleAfter
    ) {
      throw new Error(
        "every_tick packet candidate evidence is stale for the selection request"
      );
    }
  }
  if (
    packet.candidates.some(
      (candidate) => !bucketPolicy.enabledMarkets.includes(candidate.market)
    )
  ) {
    throw new Error("every_tick packet candidate market is disabled for bucket");
  }
}

function assertOffsetQualifiedPacketEvidenceTimestamp(
  value: string,
  field: string
): void {
  if (!offsetQualifiedIsoDateTimeSchema.safeParse(value).success) {
    throw new Error(
      `every_tick packet ${field} must be an offset-qualified timestamp`
    );
  }
}

function assertTriggerBinding(
  request: BucketSelectionRequest,
  bucketPolicy: StrategyBucketRuntimePolicy,
  resolved: ResolvedPortfolioCycleTrigger
): void {
  if (
    request.triggerIdentity !== resolved.triggerIdentity ||
    request.triggerRef !== resolved.triggerRef ||
    request.evidenceCutoffAt !== resolved.evidenceCutoffAt
  ) {
    throw new Error("bucket selection request trigger binding mismatch");
  }
  assertTriggerCompatibility(bucketPolicy, resolved.trigger);
}

function assertTriggerCompatibility(
  bucketPolicy: StrategyBucketRuntimePolicy,
  trigger: PortfolioCycleTrigger
): void {
  if (trigger.triggerKind === "risk_breach") {
    throw new Error(
      "risk-breach cycle cannot create a bucket selection request"
    );
  }
  if (trigger.triggerKind === "scheduled") {
    if (
      bucketPolicy.reviewCadence.mode !== "scheduled" ||
      !bucketPolicy.reviewCadence.boundaryRefs.some(
        (reference) => reference.hash === trigger.scheduleBoundaryHash
      )
    ) {
      throw new Error(
        "scheduled cycle trigger does not match bucket review cadence"
      );
    }
    return;
  }
  if (trigger.triggerKind === "every_tick") {
    if (bucketPolicy.reviewCadence.mode !== "every_tick") {
      throw new Error(
        "every-tick cycle trigger does not match bucket review cadence"
      );
    }
    return;
  }
  if (
    trigger.triggerKind === "policy_event" &&
    !bucketPolicy.eventTriggers.includes(trigger.eventType)
  ) {
    throw new Error("policy event trigger is not enabled for bucket");
  }
}

function assertSnapshotBinding(
  request: BucketSelectionRequest,
  snapshot: ResolvedPortfolioSizingSnapshot["snapshot"]
): void {
  if (
    request.portfolioSnapshotId !== snapshot.portfolioSnapshotId ||
    request.portfolioSnapshotHash !== snapshot.portfolioSnapshotHash
  ) {
    throw new Error("bucket selection request snapshot identity mismatch");
  }
  if (
    request.portfolioId !== snapshot.portfolioId ||
    request.policyHash !== snapshot.policyHash ||
    request.asOf !== snapshot.asOf
  ) {
    throw new Error("bucket selection request snapshot scope mismatch");
  }
}

function assertPolicyBinding(
  request: BucketSelectionRequest,
  policy: RuntimePortfolioPolicyRecord
): void {
  if (
    request.portfolioId !== policy.portfolioId ||
    request.policyHash !== policy.policyHash
  ) {
    throw new Error("bucket selection request active policy mismatch");
  }
  if (Date.parse(policy.createdAt) > Date.parse(request.asOf)) {
    throw new Error("bucket selection request predates its runtime policy");
  }
}

function resolveBucketPolicy(
  policy: RuntimePortfolioPolicyRecord,
  bucket: StrategyBucket
): StrategyBucketRuntimePolicy {
  const matches = policy.strategyBuckets.filter(
    (candidate) => candidate.bucket === bucket
  );
  if (matches.length !== 1) {
    throw new Error("bucket selection request policy does not resolve exactly once");
  }
  return matches[0] as StrategyBucketRuntimePolicy;
}

function resolveBucketGap(
  analysis: PortfolioGapAnalysis,
  bucket: StrategyBucket
): BucketPortfolioGap {
  const matches = analysis.bucketGaps.filter(
    (candidate) => candidate.bucket === bucket
  );
  if (matches.length !== 1) {
    throw new Error("bucket selection request gap does not resolve exactly once");
  }
  return matches[0] as BucketPortfolioGap;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
