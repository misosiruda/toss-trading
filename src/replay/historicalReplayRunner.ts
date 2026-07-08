import type {
  AuditEvent,
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualDecision,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import {
  HistoricalMarketPacketBuilder,
  HistoricalMarketSnapshotIndex
} from "../market/historicalPacketBuilder.js";
import { firstCandidateDecisionDataRef } from "../market/candidateDataRefs.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import {
  buildPaperExitPolicyDecision,
  createPaperExitPolicyState,
  normalizePaperExitPolicy,
  prunePaperExitPolicyState,
  type NormalizedPaperExitPolicy,
  type PaperExitPolicy
} from "../paper/exitPolicy.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import {
  buildMarketRegimeAllocationPolicy,
  type MarketRegimeAllocationPolicy
} from "../paper/marketRegimeAllocationPolicy.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import type { PaperExecutionPolicy } from "../paper/executionModel.js";
import {
  markPortfolioToMarket,
  pricePointsFromHistoricalSnapshots
} from "../portfolio/markToMarket.js";
import {
  fingerprintMarketPacketCandidates,
  type ReplaySamplingDecision,
  type ReplaySamplingPolicy,
  type ReplaySamplingPolicyMetadata
} from "./replaySamplingPolicy.js";
import { riskPolicyForReplayTick } from "./replayRiskPolicy.js";
import {
  appendHistoricalReplayAuditEvent,
  enforceProviderDecisionExecutionCaps,
  executeHistoricalReplayDecisionItems,
  recordHistoricalReplayDecision,
  suppressDecisionItemsForSymbols
} from "./historicalReplayDecisionBoundary.js";
import type { HistoricalUniverseManifest } from "./historicalUniverseCoverage.js";
import type { SimulatedClock, SimulatedTick } from "./simulatedClock.js";

export interface HistoricalReplayDecisionContext {
  simulatedAt: Date;
  tick: SimulatedTick;
}

export interface HistoricalReplayDecisionProvider {
  decide(
    packet: MarketPacket,
    context: HistoricalReplayDecisionContext
  ): VirtualDecision;
}

export interface HistoricalReplayRunnerOptions {
  clock: SimulatedClock;
  decisionProvider: HistoricalReplayDecisionProvider;
  samplingPolicy?: ReplaySamplingPolicy;
  packetIdPrefix: string;
  packetExpiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
  riskPolicy?: Partial<VirtualRiskPolicy>;
  executionPolicy?: Partial<PaperExecutionPolicy> | undefined;
  allocationPolicy?: PaperAllocationPolicy;
  marketRegimeAllocationPolicy?: MarketRegimeAllocationPolicy;
  paperExitPolicy?: PaperExitPolicy;
  universeManifest?: HistoricalUniverseManifest;
}

export interface HistoricalReplayInput {
  initialPortfolio: VirtualPortfolio;
  snapshots: HistoricalMarketSnapshot[];
}

export interface HistoricalPortfolioTimelineItem {
  simulatedAt: string;
  cashKrw: number;
  positionCount: number;
  positionMarketValueKrw: number;
  virtualNetWorthKrw: number;
}

export interface HistoricalReplaySamplingRecord {
  simulatedAt: string;
  packetId: string;
  shouldEvaluate: boolean;
  reason: ReplaySamplingDecision["reason"];
  decisionCallsUsed: number;
  candidateFingerprint: string;
}

export interface HistoricalReplayProgressSummary {
  totalTicks: number;
  packetsCreated: number;
  decisionsRequested: number;
  decisionsSkipped: number;
  tradesCreated: number;
  maxCandidatesPerStep: number;
}

export interface HistoricalReplayResult {
  status: "completed";
  mode: "paper_only";
  tickCount: number;
  packetCount: number;
  decisionProviderCallCount: number;
  decisionSkippedCount: number;
  decisionRecordCount: number;
  decisionItemCount: number;
  tradeCount: number;
  rejectedCount: number;
  packets: MarketPacket[];
  decisions: VirtualDecision[];
  riskDecisions: VirtualRiskDecision[];
  trades: VirtualTrade[];
  auditEvents: AuditEvent[];
  warnings: string[];
  samplingPolicy: ReplaySamplingPolicyMetadata | null;
  allocationPolicy: PaperAllocationPolicy | null;
  paperExitPolicy: NormalizedPaperExitPolicy | null;
  samplingDecisions: HistoricalReplaySamplingRecord[];
  progressSummary: HistoricalReplayProgressSummary;
  initialPortfolio: VirtualPortfolio;
  finalPortfolio: VirtualPortfolio;
  portfolioTimeline: HistoricalPortfolioTimelineItem[];
}

export class FirstPricedHistoricalDecisionProvider
  implements HistoricalReplayDecisionProvider
{
  decide(packet: MarketPacket): VirtualDecision {
    return {
      packetId: packet.packetId,
      summary: "Deterministic paper-only historical replay decision.",
      decisions: firstPricedDecisions(packet)
    };
  }
}

function firstPricedDecisions(packet: MarketPacket): VirtualDecisionItem[] {
  const candidates = packet.candidates.filter(
    (item) => item.lastPriceKrw !== undefined
  );
  const firstCandidate = candidates[0];
  if (firstCandidate === undefined) {
    return [];
  }

  const allocation = packet.portfolioAllocation;
  if (allocation === undefined) {
    return [
      firstPricedDecision({
        packet,
        candidate: firstCandidate,
        budgetKrw: legacySingleShareBudgetKrw(packet, firstCandidate)
      })
    ];
  }

  const decisions: VirtualDecisionItem[] = [];
  const projectedExposureBySymbol = currentExposureBySymbol(packet);
  const remainingMarketBudgetByMarket = new Map(
    Object.entries(allocation.marketAllocations ?? {}).map(
      ([market, marketAllocation]) => [
        market,
        marketAllocation.maxAdditionalBuyBudgetKrw
      ]
    )
  );
  let remainingAdditionalBudgetKrw = allocation.maxAdditionalBuyBudgetKrw;
  let remainingDecisionBudgetKrw = allocation.maxBudgetPerDecisionKrw;
  let remainingCashBudgetKrw = Math.max(
    0,
    packet.virtualPortfolio.cashKrw - allocation.minCashReserveKrw
  );

  for (const candidate of candidates) {
    if (candidate.buyEligible === false) {
      continue;
    }
    if (decisions.length >= packet.constraints.maxNewPositions) {
      break;
    }

    const symbolKey = `${candidate.market}:${candidate.symbol}`;
    const currentSymbolExposureKrw =
      projectedExposureBySymbol.get(symbolKey) ?? 0;
    const budgetKrw = firstPricedBudgetKrw({
      packet,
      candidate,
      currentSymbolExposureKrw,
      remainingAdditionalBudgetKrw,
      remainingDecisionBudgetKrw,
      remainingCashBudgetKrw,
      remainingMarketBudgetKrw: remainingMarketBudgetByMarket.get(
        candidate.market
      )
    });
    if (budgetKrw <= 0) {
      continue;
    }

    decisions.push(firstPricedDecision({ packet, candidate, budgetKrw }));
    projectedExposureBySymbol.set(
      symbolKey,
      currentSymbolExposureKrw + budgetKrw
    );
    remainingAdditionalBudgetKrw -= budgetKrw;
    remainingDecisionBudgetKrw -= budgetKrw;
    remainingCashBudgetKrw -= budgetKrw;
    const remainingMarketBudget = remainingMarketBudgetByMarket.get(
      candidate.market
    );
    if (remainingMarketBudget !== undefined) {
      remainingMarketBudgetByMarket.set(
        candidate.market,
        remainingMarketBudget - budgetKrw
      );
    }
  }

  if (decisions.length > 0) {
    return decisions;
  }

  return [
    firstPricedHoldDecision({
      packet,
      candidate: firstCandidate
    })
  ];
}

function firstPricedDecision(input: {
  packet: MarketPacket;
  candidate: MarketPacket["candidates"][number];
  budgetKrw: number;
}): VirtualDecisionItem {
  const sourceRef = firstSourceRef(input.packet, input.candidate);

  return {
    market: input.candidate.market,
    symbol: input.candidate.symbol,
    action: "VIRTUAL_BUY",
    confidence: 0.55,
    budgetKrw: input.budgetKrw,
    thesis:
      "Deterministic historical replay fixture uses the first priced candidate.",
    riskFactors: [
      "Historical replay fixture is not a live trading signal."
    ],
    dataRefs: [sourceRef],
    claimSupport: [
      {
        claim:
          "Deterministic historical replay fixture uses the first priced candidate.",
        dataRefs: [sourceRef]
      }
    ],
    expiresAt: input.packet.expiresAt
  };
}

function firstPricedHoldDecision(input: {
  packet: MarketPacket;
  candidate: MarketPacket["candidates"][number];
}): VirtualDecisionItem {
  const sourceRef = firstSourceRef(input.packet, input.candidate);
  return {
    market: input.candidate.market,
    symbol: input.candidate.symbol,
    action: "VIRTUAL_HOLD",
    confidence: 0.55,
    budgetKrw: 0,
    thesis:
      "Deterministic historical replay fixture found no remaining allocation budget.",
    riskFactors: [],
    dataRefs: [sourceRef],
    claimSupport: [
      {
        claim:
          "Deterministic historical replay fixture found no remaining allocation budget.",
        dataRefs: [sourceRef]
      }
    ],
    holdReasonCode: "PORTFOLIO_CONFLICT",
    expiresAt: input.packet.expiresAt
  };
}

function legacySingleShareBudgetKrw(
  packet: MarketPacket,
  candidate: MarketPacket["candidates"][number]
): number {
  return Math.min(
    packet.constraints.maxBudgetPerSymbolKrw,
    candidate.lastPriceKrw ?? packet.constraints.maxBudgetPerSymbolKrw
  );
}

function firstPricedBudgetKrw(input: {
  packet: MarketPacket;
  candidate: MarketPacket["candidates"][number];
  currentSymbolExposureKrw: number;
  remainingAdditionalBudgetKrw: number;
  remainingDecisionBudgetKrw: number;
  remainingCashBudgetKrw: number;
  remainingMarketBudgetKrw?: number | undefined;
}): number {
  const allocation = input.packet.portfolioAllocation;
  if (allocation === undefined) {
    return legacySingleShareBudgetKrw(input.packet, input.candidate);
  }

  const symbolHeadroomKrw = Math.max(
    0,
    allocation.maxSymbolExposureKrw - input.currentSymbolExposureKrw
  );

  return Math.max(
    0,
    Math.floor(
      Math.min(
        input.packet.constraints.maxBudgetPerSymbolKrw,
        allocation.maxBudgetPerDecisionKrw,
        input.remainingDecisionBudgetKrw,
        input.remainingAdditionalBudgetKrw,
        symbolHeadroomKrw,
        input.remainingCashBudgetKrw,
        input.remainingMarketBudgetKrw ?? Number.MAX_SAFE_INTEGER
      )
    )
  );
}

function currentExposureBySymbol(packet: MarketPacket): Map<string, number> {
  const values = new Map<string, number>();
  for (const position of packet.virtualPortfolio.positions) {
    values.set(
      `${position.market}:${position.symbol}`,
      position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)
    );
  }
  return values;
}

function firstSourceRef(
  packet: MarketPacket,
  candidate: MarketPacket["candidates"][number]
): string {
  return firstCandidateDecisionDataRef(candidate, `packet:${packet.packetId}`);
}

export function runHistoricalReplay(
  options: HistoricalReplayRunnerOptions,
  input: HistoricalReplayInput
): HistoricalReplayResult {
  let currentPortfolio = clonePortfolio(input.initialPortfolio);
  const initialPortfolio = clonePortfolio(currentPortfolio);
  const packets: MarketPacket[] = [];
  const decisions: VirtualDecision[] = [];
  const riskDecisions: VirtualRiskDecision[] = [];
  const trades: VirtualTrade[] = [];
  const auditEvents: AuditEvent[] = [];
  const warnings: string[] = [];
  const samplingDecisions: HistoricalReplaySamplingRecord[] = [];
  const portfolioTimeline: HistoricalPortfolioTimelineItem[] = [];
  let decisionProviderCallCount = 0;
  let decisionSkippedCount = 0;
  const engine = new PaperOrderEngine();
  const ticks = options.clock.ticks();
  const snapshotIndex = new HistoricalMarketSnapshotIndex(input.snapshots);
  const paperExitPolicy = normalizePaperExitPolicy(options.paperExitPolicy);
  const paperExitPolicyState = createPaperExitPolicyState();
  appendExitPolicyWarnings(warnings, options.riskPolicy, paperExitPolicy);
  appendMarketRegimeAllocationWarnings(warnings, options);

  for (const tick of ticks) {
    const simulatedAt = new Date(tick.epochMs);
    const pricePoints = pricePointsFromHistoricalSnapshots(
      snapshotIndex.latestFreshSnapshots({
        simulatedAt,
        maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds
      }),
      options.maxSnapshotAgeSeconds
    );
    currentPortfolio = markPortfolioToMarket({
      portfolio: currentPortfolio,
      prices: pricePoints,
      asOf: simulatedAt
    });
    const allocationPolicy = allocationPolicyForTick({
      basePolicy: options.allocationPolicy,
      marketRegimeAllocationPolicy: options.marketRegimeAllocationPolicy,
      snapshots: input.snapshots,
      simulatedAt,
      tick
    });
    const packetBuild = new HistoricalMarketPacketBuilder({
      packetId: `${options.packetIdPrefix}_${tick.stepIndex}`,
      simulatedAt,
      expiresInSeconds: options.packetExpiresInSeconds,
      maxCandidates: options.maxCandidates,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
      constraints: options.constraints,
      ...(allocationPolicy === undefined
        ? {}
        : { allocationPolicy }),
      ...(options.universeManifest === undefined
        ? {}
        : { universeManifest: options.universeManifest })
    }).build({
      portfolio: currentPortfolio,
      snapshotIndex
    });

    warnings.push(...packetBuild.warnings);

    if (packetBuild.status === "failed") {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_PACKET_SKIPPED",
        `No historical candidates at ${simulatedAt.toISOString()}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      continue;
    }

    const packet = packetBuild.packet;
    const context: HistoricalReplayDecisionContext = {
      simulatedAt,
      tick
    };
    packets.push(packet);
    appendHistoricalReplayAuditEvent(
      auditEvents,
      "HISTORICAL_MARKET_PACKET_CREATED",
      `${packet.packetId} candidates=${packet.candidates.length}`,
      tick
    );

    const exitedSymbolKeys = new Set<string>();
    const exitDecision = buildPaperExitPolicyDecision({
      packet,
      portfolio: currentPortfolio,
      policy: paperExitPolicy ?? undefined,
      state: paperExitPolicyState
    });
    if (exitDecision !== null) {
      const recordedExitDecision = recordHistoricalReplayDecision({
        packet,
        decision: exitDecision,
        source: "paper_exit_policy",
        decisions,
        auditEvents,
        tick
      });
      currentPortfolio = executeHistoricalReplayDecisionItems({
        packet,
        portfolio: currentPortfolio,
        recordedDecision: recordedExitDecision,
        engine,
        riskPolicy: riskPolicyForReplayTick({
          policy: options.riskPolicy,
          now: simulatedAt,
          packet,
          snapshots: input.snapshots,
          simulatedAt
        }),
        ...(options.executionPolicy === undefined
          ? {}
          : { executionPolicy: options.executionPolicy }),
        paperExitPolicyState,
        auditEvents,
        riskDecisions,
        trades,
        tick,
        exitSuppressionSymbolKeys: exitedSymbolKeys
      }).portfolio;
    }

    const samplingDecision = evaluateSamplingPolicy(
      options.samplingPolicy,
      packet,
      context,
      decisionProviderCallCount
    );
    samplingDecisions.push({
      simulatedAt: simulatedAt.toISOString(),
      packetId: packet.packetId,
      shouldEvaluate: samplingDecision.shouldEvaluate,
      reason: samplingDecision.reason,
      decisionCallsUsed: samplingDecision.decisionCallsUsed,
      candidateFingerprint: samplingDecision.candidateFingerprint
    });

    if (!samplingDecision.shouldEvaluate) {
      decisionSkippedCount += 1;
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_SKIPPED",
        `${packet.packetId} ${samplingDecision.reason}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      continue;
    }

    decisionProviderCallCount += 1;
    const decision = options.decisionProvider.decide(packet, context);
    if (decision.packetId !== packet.packetId) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_REJECTED",
        `Decision packet mismatch for ${packet.packetId}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      continue;
    }

    const filteredDecision = suppressDecisionItemsForSymbols(
      decision,
      exitedSymbolKeys
    );
    if (filteredDecision.suppressedCount > 0) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_ITEM_SUPPRESSED",
        `${filteredDecision.suppressedCount} provider decision item(s) suppressed after paper exit`,
        tick
      );
    }
    if (
      filteredDecision.decision.decisions.length === 0 &&
      decision.decisions.length > 0
    ) {
      currentPortfolio = markPortfolioToMarket({
        portfolio: currentPortfolio,
        prices: pricePoints,
        asOf: simulatedAt
      });
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      continue;
    }

    const cappedDecision = enforceProviderDecisionExecutionCaps({
      packet,
      portfolio: currentPortfolio,
      decision: filteredDecision.decision
    });
    if (
      cappedDecision.cappedItemCount > 0 ||
      cappedDecision.heldItemCount > 0
    ) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_ALLOCATION_CAPPED",
        `${cappedDecision.cappedItemCount} BUY item(s) capped, ${cappedDecision.heldItemCount} BUY item(s) converted to HOLD`,
        tick
      );
    }

    const recordedDecision = recordHistoricalReplayDecision({
      packet,
      decision: cappedDecision.decision,
      source: "provider",
      decisions,
      auditEvents,
      tick
    });
    currentPortfolio = executeHistoricalReplayDecisionItems({
      packet,
      portfolio: currentPortfolio,
      recordedDecision,
      engine,
      riskPolicy: riskPolicyForReplayTick({
        policy: options.riskPolicy,
        now: simulatedAt,
        packet,
        snapshots: input.snapshots,
        simulatedAt
      }),
      ...(options.executionPolicy === undefined
        ? {}
        : { executionPolicy: options.executionPolicy }),
      paperExitPolicyState,
      auditEvents,
      riskDecisions,
      trades,
      tick
    }).portfolio;

    currentPortfolio = markPortfolioToMarket({
      portfolio: currentPortfolio,
      prices: pricePoints,
      asOf: simulatedAt
    });
    prunePaperExitPolicyState(paperExitPolicyState, currentPortfolio);
    portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
  }

  return {
    status: "completed",
    mode: "paper_only",
    tickCount: ticks.length,
    packetCount: packets.length,
    decisionProviderCallCount,
    decisionSkippedCount,
    decisionRecordCount: decisions.length,
    decisionItemCount: decisions.reduce(
      (sum, decision) => sum + decision.decisions.length,
      0
    ),
    tradeCount: trades.length,
    rejectedCount: riskDecisions.filter((decision) => !decision.approved).length,
    packets,
    decisions,
    riskDecisions,
    trades,
    auditEvents,
    warnings,
    samplingPolicy: options.samplingPolicy?.metadata() ?? null,
    allocationPolicy: options.allocationPolicy ?? null,
    paperExitPolicy,
    samplingDecisions,
    progressSummary: {
      totalTicks: ticks.length,
      packetsCreated: packets.length,
      decisionsRequested: decisionProviderCallCount,
      decisionsSkipped: decisionSkippedCount,
      tradesCreated: trades.length,
      maxCandidatesPerStep: options.maxCandidates
    },
    initialPortfolio,
    finalPortfolio: currentPortfolio,
    portfolioTimeline
  };
}

function allocationPolicyForTick(input: {
  basePolicy: PaperAllocationPolicy | undefined;
  marketRegimeAllocationPolicy: MarketRegimeAllocationPolicy | undefined;
  snapshots: HistoricalMarketSnapshot[];
  simulatedAt: Date;
  tick: SimulatedTick;
}): PaperAllocationPolicy | undefined {
  if (input.basePolicy === undefined) {
    return undefined;
  }
  if (input.marketRegimeAllocationPolicy === undefined) {
    return allocationPolicyWithRampDayIndex(input.basePolicy, input.tick);
  }

  return allocationPolicyWithRampDayIndex(buildMarketRegimeAllocationPolicy({
    basePolicy: input.basePolicy,
    snapshots: input.snapshots,
    simulatedAt: input.simulatedAt,
    policy: input.marketRegimeAllocationPolicy
  }).allocationPolicy, input.tick);
}

function allocationPolicyWithRampDayIndex(
  policy: PaperAllocationPolicy,
  tick: SimulatedTick
): PaperAllocationPolicy {
  if (
    policy.deploymentRampDays === undefined ||
    policy.rampDayIndex !== undefined
  ) {
    return policy;
  }

  return {
    ...policy,
    rampDayIndex: tick.stepIndex + 1
  };
}

function appendExitPolicyWarnings(
  warnings: string[],
  riskPolicy: Partial<VirtualRiskPolicy> | undefined,
  paperExitPolicy: NormalizedPaperExitPolicy | null
): void {
  const riskMaxPositionWeightRatio = riskPolicy?.maxPositionWeightRatio;
  const rebalanceMaxPositionWeightRatio =
    paperExitPolicy?.rebalanceMaxPositionWeightRatio;
  if (
    riskMaxPositionWeightRatio !== undefined &&
    rebalanceMaxPositionWeightRatio !== undefined &&
    rebalanceMaxPositionWeightRatio < riskMaxPositionWeightRatio
  ) {
    warnings.push(
      `paper exit rebalanceMaxPositionWeightRatio (${rebalanceMaxPositionWeightRatio}) is below risk maxPositionWeightRatio (${riskMaxPositionWeightRatio})`
    );
  }
}

function appendMarketRegimeAllocationWarnings(
  warnings: string[],
  options: Pick<
    HistoricalReplayRunnerOptions,
    "allocationPolicy" | "marketRegimeAllocationPolicy"
  >
): void {
  if (
    options.marketRegimeAllocationPolicy !== undefined &&
    options.allocationPolicy === undefined
  ) {
    warnings.push(
      "market regime allocation policy ignored: allocationPolicy is not configured"
    );
  }
}

function evaluateSamplingPolicy(
  samplingPolicy: ReplaySamplingPolicy | undefined,
  packet: MarketPacket,
  context: HistoricalReplayDecisionContext,
  currentDecisionProviderCallCount: number
): ReplaySamplingDecision {
  if (samplingPolicy !== undefined) {
    return samplingPolicy.evaluate(packet, context);
  }

  return {
    shouldEvaluate: true,
    reason: "POLICY_ALLOWED",
    decisionCallsUsed: currentDecisionProviderCallCount + 1,
    candidateFingerprint: fingerprintMarketPacketCandidates(packet)
  };
}

function timelineItem(
  simulatedAt: Date,
  portfolio: VirtualPortfolio
): HistoricalPortfolioTimelineItem {
  const positionMarketValueKrw = portfolio.positions.reduce(
    (sum, position) =>
      sum +
      (position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)),
    0
  );

  return {
    simulatedAt: simulatedAt.toISOString(),
    cashKrw: portfolio.cashKrw,
    positionCount: portfolio.positions.length,
    positionMarketValueKrw,
    virtualNetWorthKrw: portfolio.cashKrw + positionMarketValueKrw
  };
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}
