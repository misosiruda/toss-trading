import {
  classifyMarketRegime,
  type MarketRegimeClassification,
  type MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  replayWindowCandidates,
  type ReplayWindowCandidateFilter,
  type ReplayWindowSelection
} from "./replayWindowSampler.js";

export const DEFAULT_BALANCED_REGIME_TARGETS: MarketRegimeLabel[] = [
  "bull",
  "bear",
  "sideways",
  "mixed"
];

export interface RegimeBalancedWindowSamplerOptions {
  snapshots: HistoricalMarketSnapshot[];
  rangeStart: Date;
  rangeEnd: Date;
  seed: string | number;
  runIndex: number;
  windowMonths?: number;
  timezoneOffsetMinutes?: number;
  targetRegimes?: MarketRegimeLabel[];
  candidateFilter?: ReplayWindowCandidateFilter;
}

export interface RegimeBalancedWindowSamplerPlan {
  mode: "balanced_regime";
  requestedTargetRegimes: MarketRegimeLabel[];
  activeTargetRegimes: MarketRegimeLabel[];
  unavailableTargetRegimes: MarketRegimeLabel[];
  candidateCount: number;
  bucketCounts: Record<MarketRegimeLabel, number>;
}

export interface RegimeBalancedWindowSelectionResult {
  window: ReplayWindowSelection;
  targetRegime: MarketRegimeLabel;
  targetCandidateCount: number;
  marketRegime: MarketRegimeClassification;
  plan: RegimeBalancedWindowSamplerPlan;
}

interface ClassifiedReplayWindowCandidate {
  candidateIndex: number;
  selectedMonth: string;
  localStartDate: string;
  localEndDate: string;
  startMs: number;
  endMs: number;
  marketRegime: MarketRegimeClassification;
}

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 540;
const DEFAULT_WINDOW_MONTHS = 1;
const ALL_REGIME_LABELS: MarketRegimeLabel[] = [
  "bull",
  "bear",
  "sideways",
  "mixed",
  "insufficient_data"
];

export function selectRegimeBalancedReplayWindow(
  options: RegimeBalancedWindowSamplerOptions
): RegimeBalancedWindowSelectionResult {
  validateSamplerOptions(options);

  const seed = String(options.seed);
  const runIndex = options.runIndex;
  const windowMonths = options.windowMonths ?? DEFAULT_WINDOW_MONTHS;
  const timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES;
  const classifiedCandidates = classifiedReplayWindowCandidates({
    snapshots: options.snapshots,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
    windowMonths,
    timezoneOffsetMinutes,
    ...(options.candidateFilter === undefined
      ? {}
      : { candidateFilter: options.candidateFilter })
  });

  if (classifiedCandidates.length === 0) {
    throw new Error("No full replay window fits inside the configured range");
  }

  const requestedTargetRegimes = normalizeTargetRegimes(options.targetRegimes);
  const buckets = bucketByRegime(classifiedCandidates);
  const bucketCounts = regimeBucketCounts(buckets);
  const activeTargetRegimes = requestedTargetRegimes.filter(
    (label) => (bucketCounts[label] ?? 0) > 0
  );
  const unavailableTargetRegimes = requestedTargetRegimes.filter(
    (label) => (bucketCounts[label] ?? 0) === 0
  );

  if (activeTargetRegimes.length === 0) {
    throw new Error("No requested market regime windows are available");
  }

  const targetRegime =
    activeTargetRegimes[runIndex % activeTargetRegimes.length]!;
  const targetCandidates = buckets.get(targetRegime) ?? [];
  const targetCandidateIndex = seededIndex(
    [
      seed,
      String(runIndex),
      targetRegime,
      options.rangeStart.toISOString(),
      options.rangeEnd.toISOString(),
      String(windowMonths),
      String(timezoneOffsetMinutes)
    ].join("|"),
    targetCandidates.length
  );
  const selected = targetCandidates[targetCandidateIndex]!;
  const plan: RegimeBalancedWindowSamplerPlan = {
    mode: "balanced_regime",
    requestedTargetRegimes,
    activeTargetRegimes,
    unavailableTargetRegimes,
    candidateCount: classifiedCandidates.length,
    bucketCounts
  };

  return {
    window: toReplayWindowSelection({
      candidate: selected,
      seed,
      rangeStart: options.rangeStart,
      rangeEnd: options.rangeEnd,
      windowMonths,
      timezoneOffsetMinutes,
      candidateCount: classifiedCandidates.length
    }),
    targetRegime,
    targetCandidateCount: targetCandidates.length,
    marketRegime: selected.marketRegime,
    plan
  };
}

function classifiedReplayWindowCandidates(input: {
  snapshots: HistoricalMarketSnapshot[];
  rangeStart: Date;
  rangeEnd: Date;
  windowMonths: number;
  timezoneOffsetMinutes: number;
  candidateFilter?: ReplayWindowCandidateFilter;
}): ClassifiedReplayWindowCandidate[] {
  return replayWindowCandidates(input).map((candidate, candidateIndex) => ({
    candidateIndex,
    ...candidate,
    marketRegime: classifyMarketRegime({
      snapshots: input.snapshots,
      windowStart: new Date(candidate.startMs),
      windowEnd: new Date(candidate.endMs)
    })
  }));
}

function toReplayWindowSelection(input: {
  candidate: ClassifiedReplayWindowCandidate;
  seed: string;
  rangeStart: Date;
  rangeEnd: Date;
  windowMonths: number;
  timezoneOffsetMinutes: number;
  candidateCount: number;
}): ReplayWindowSelection {
  return {
    seed: input.seed,
    rangeStart: input.rangeStart.toISOString(),
    rangeEnd: input.rangeEnd.toISOString(),
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    candidateCount: input.candidateCount,
    selectedCandidateIndex: input.candidate.candidateIndex,
    selectedMonth: input.candidate.selectedMonth,
    localStartDate: input.candidate.localStartDate,
    localEndDate: input.candidate.localEndDate,
    startAt: new Date(input.candidate.startMs).toISOString(),
    endAt: new Date(input.candidate.endMs).toISOString()
  };
}

function bucketByRegime(
  candidates: ClassifiedReplayWindowCandidate[]
): Map<MarketRegimeLabel, ClassifiedReplayWindowCandidate[]> {
  const buckets = new Map<MarketRegimeLabel, ClassifiedReplayWindowCandidate[]>();
  for (const candidate of candidates) {
    const label = candidate.marketRegime.label;
    const existing = buckets.get(label);
    if (existing === undefined) {
      buckets.set(label, [candidate]);
      continue;
    }
    existing.push(candidate);
  }
  return buckets;
}

function regimeBucketCounts(
  buckets: Map<MarketRegimeLabel, ClassifiedReplayWindowCandidate[]>
): Record<MarketRegimeLabel, number> {
  return {
    bull: buckets.get("bull")?.length ?? 0,
    bear: buckets.get("bear")?.length ?? 0,
    sideways: buckets.get("sideways")?.length ?? 0,
    mixed: buckets.get("mixed")?.length ?? 0,
    insufficient_data: buckets.get("insufficient_data")?.length ?? 0
  };
}

function normalizeTargetRegimes(
  targetRegimes: MarketRegimeLabel[] | undefined
): MarketRegimeLabel[] {
  const rawTargets = targetRegimes ?? DEFAULT_BALANCED_REGIME_TARGETS;
  const normalized = Array.from(new Set(rawTargets));
  if (normalized.length === 0) {
    throw new Error("targetRegimes must not be empty");
  }
  for (const target of normalized) {
    if (!ALL_REGIME_LABELS.includes(target)) {
      throw new Error(`Unsupported market regime target: ${target}`);
    }
  }
  return normalized;
}

function validateSamplerOptions(
  options: RegimeBalancedWindowSamplerOptions
): void {
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }
  if (!Number.isInteger(options.runIndex) || options.runIndex < 0) {
    throw new Error("runIndex must be a non-negative integer");
  }
  if (String(options.seed).trim().length === 0) {
    throw new Error("seed must not be empty");
  }
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function seededIndex(seedMaterial: string, candidateCount: number): number {
  const random = mulberry32(fnv1a(seedMaterial))();
  return Math.min(candidateCount - 1, Math.floor(random * candidateCount));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
