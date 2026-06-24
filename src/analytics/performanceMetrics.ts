import type { VirtualTrade } from "../domain/schemas.js";

export const PERFORMANCE_METRIC_FORMULA_VERSION = "performance_metrics.v1";

export interface ReturnDistributionMetrics {
  formulaVersion: typeof PERFORMANCE_METRIC_FORMULA_VERSION;
  sampleCount: number;
  hitRatio: number | null;
  profitFactor: number | null;
  averageWinRatio: number | null;
  averageLossRatio: number | null;
  tailLossRatio: number | null;
  sharpeRatio: number | null;
  sharpeAnnualizationStatus: "not_annualized";
  warnings: string[];
}

export interface ReplayPerformanceMetrics extends ReturnDistributionMetrics {
  initialNetWorthKrw: number | null;
  finalNetWorthKrw: number | null;
  totalReturnRatio: number | null;
  grossTotalReturnRatio: number | null;
  costAdjustedTotalReturnRatio: number | null;
  costDragRatio: number | null;
  cagrRatio: number | null;
  maxDrawdownRatio: number | null;
  calmarRatio: number | null;
  exposureAdjustedReturnRatio: number | null;
}

export interface NetWorthTimelinePoint {
  simulatedAt: string;
  virtualNetWorthKrw: number;
}

const MIN_TAIL_SAMPLE_COUNT = 20;
const MIN_SHARPE_SAMPLE_COUNT = 3;
const MIN_CAGR_DURATION_DAYS = 30;

export function summarizeReturnDistributionMetrics(
  returns: number[]
): ReturnDistributionMetrics {
  const cleanReturns = finiteValues(returns);
  const warnings: string[] = [];
  const wins = cleanReturns.filter((value) => value > 0);
  const losses = cleanReturns.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = losses.reduce((sum, value) => sum + Math.abs(value), 0);
  const sharpeRatio = calculateSharpeRatio(cleanReturns, warnings);
  const tailLossRatio = calculateTailLossRatio(cleanReturns, warnings);

  if (cleanReturns.length === 0) {
    warnings.push(
      "Performance metrics unavailable: at least one return sample is required"
    );
  }
  if (grossLoss === 0 && cleanReturns.length > 0) {
    warnings.push(
      "profitFactor unavailable: at least one losing return sample is required"
    );
  }

  return {
    formulaVersion: PERFORMANCE_METRIC_FORMULA_VERSION,
    sampleCount: cleanReturns.length,
    hitRatio:
      cleanReturns.length === 0 ? null : roundRatio(wins.length / cleanReturns.length),
    profitFactor: grossLoss === 0 ? null : roundRatio(grossProfit / grossLoss),
    averageWinRatio: wins.length === 0 ? null : roundRatio(average(wins)),
    averageLossRatio: losses.length === 0 ? null : roundRatio(average(losses)),
    tailLossRatio,
    sharpeRatio,
    sharpeAnnualizationStatus: "not_annualized",
    warnings
  };
}

export function summarizeReplayPerformanceMetrics(input: {
  timeline: NetWorthTimelinePoint[];
  trades: VirtualTrade[];
  averageExposureRatio: number | null;
  initialNetWorthKrw?: number | null;
}): ReplayPerformanceMetrics {
  const timeline = input.timeline.filter((point) =>
    Number.isFinite(point.virtualNetWorthKrw)
  );
  const timelineCurve = timeline.map((point) => point.virtualNetWorthKrw);
  const initialNetWorthKrw = resolveInitialNetWorthKrw(
    timelineCurve[0] ?? null,
    input.initialNetWorthKrw
  );
  const performanceCurve = buildPerformanceCurve(
    initialNetWorthKrw,
    timelineCurve
  );
  const returns = tickReturns(performanceCurve);
  const distribution = summarizeReturnDistributionMetrics(returns);
  const warnings = [...distribution.warnings];
  const finalNetWorthKrw = timelineCurve.at(-1) ?? null;
  const totalReturnRatio =
    initialNetWorthKrw !== null &&
    finalNetWorthKrw !== null &&
    initialNetWorthKrw > 0
      ? roundRatio((finalNetWorthKrw - initialNetWorthKrw) / initialNetWorthKrw)
      : null;
  const totalCostKrw = sumTradeCosts(input.trades);
  const grossTotalReturnRatio =
    initialNetWorthKrw !== null &&
    finalNetWorthKrw !== null &&
    initialNetWorthKrw > 0
      ? roundRatio(
          (finalNetWorthKrw + totalCostKrw - initialNetWorthKrw) /
            initialNetWorthKrw
        )
      : null;
  const costDragRatio =
    initialNetWorthKrw !== null && initialNetWorthKrw > 0
      ? roundRatio(totalCostKrw / initialNetWorthKrw)
      : null;
  const cagrRatio = calculateCagrRatio(timeline, initialNetWorthKrw, warnings);
  const maxDrawdownRatio = calculateMaxDrawdownRatio(performanceCurve, warnings);
  const calmarRatio =
    cagrRatio !== null && maxDrawdownRatio !== null && maxDrawdownRatio < 0
      ? roundRatio(cagrRatio / Math.abs(maxDrawdownRatio))
      : null;
  if (cagrRatio !== null && (maxDrawdownRatio === null || maxDrawdownRatio === 0)) {
    warnings.push(
      "calmarRatio unavailable: max drawdown is zero or unavailable"
    );
  }
  const exposureAdjustedReturnRatio =
    totalReturnRatio !== null &&
    input.averageExposureRatio !== null &&
    input.averageExposureRatio > 0
      ? roundRatio(totalReturnRatio / input.averageExposureRatio)
      : null;
  if (
    totalReturnRatio !== null &&
    (input.averageExposureRatio === null || input.averageExposureRatio <= 0)
  ) {
    warnings.push(
      "exposureAdjustedReturnRatio unavailable: positive average exposure ratio is required"
    );
  }

  return {
    ...distribution,
    initialNetWorthKrw,
    finalNetWorthKrw,
    totalReturnRatio,
    grossTotalReturnRatio,
    costAdjustedTotalReturnRatio: totalReturnRatio,
    costDragRatio,
    cagrRatio,
    maxDrawdownRatio,
    calmarRatio,
    exposureAdjustedReturnRatio,
    warnings
  };
}

function calculateSharpeRatio(returns: number[], warnings: string[]): number | null {
  if (returns.length < MIN_SHARPE_SAMPLE_COUNT) {
    warnings.push(
      `sharpeRatio unavailable: at least ${MIN_SHARPE_SAMPLE_COUNT} return samples are required`
    );
    return null;
  }
  const mean = average(returns);
  const volatility = sampleStandardDeviation(returns);
  if (volatility === 0) {
    warnings.push("sharpeRatio unavailable: return volatility is zero");
    return null;
  }
  warnings.push(
    "sharpeRatio is per-sample and not annualized; serial correlation adjustment is not applied"
  );
  return roundRatio(mean / volatility);
}

function calculateTailLossRatio(returns: number[], warnings: string[]): number | null {
  if (returns.length < MIN_TAIL_SAMPLE_COUNT) {
    warnings.push(
      `tailLossRatio unavailable: at least ${MIN_TAIL_SAMPLE_COUNT} return samples are required`
    );
    return null;
  }
  const sorted = [...returns].sort((left, right) => left - right);
  const tailCount = Math.max(1, Math.ceil(sorted.length * 0.05));
  return roundRatio(average(sorted.slice(0, tailCount)));
}

function calculateCagrRatio(
  timeline: NetWorthTimelinePoint[],
  initialNetWorthKrw: number | null,
  warnings: string[]
): number | null {
  const first = timeline[0];
  const last = timeline.at(-1);
  if (first === undefined || last === undefined || timeline.length < 2) {
    warnings.push("cagrRatio unavailable: at least two timeline points are required");
    return null;
  }
  if (
    initialNetWorthKrw === null ||
    initialNetWorthKrw <= 0 ||
    last.virtualNetWorthKrw <= 0
  ) {
    warnings.push("cagrRatio unavailable: positive net worth values are required");
    return null;
  }
  const durationDays =
    (Date.parse(last.simulatedAt) - Date.parse(first.simulatedAt)) /
    (24 * 60 * 60 * 1000);
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    warnings.push("cagrRatio unavailable: valid increasing timestamps are required");
    return null;
  }
  if (durationDays < MIN_CAGR_DURATION_DAYS) {
    warnings.push(
      `cagrRatio unavailable: replay duration must be at least ${MIN_CAGR_DURATION_DAYS} days`
    );
    return null;
  }
  return roundRatio(
    (last.virtualNetWorthKrw / initialNetWorthKrw) **
      (365.25 / durationDays) -
      1
  );
}

function resolveInitialNetWorthKrw(
  timelineInitialNetWorthKrw: number | null,
  explicitInitialNetWorthKrw: number | null | undefined
): number | null {
  if (
    explicitInitialNetWorthKrw !== undefined &&
    explicitInitialNetWorthKrw !== null &&
    Number.isFinite(explicitInitialNetWorthKrw)
  ) {
    return explicitInitialNetWorthKrw;
  }
  return timelineInitialNetWorthKrw;
}

function buildPerformanceCurve(
  initialNetWorthKrw: number | null,
  timelineCurve: number[]
): number[] {
  if (initialNetWorthKrw === null) {
    return timelineCurve;
  }
  if (timelineCurve.length === 0) {
    return [initialNetWorthKrw];
  }
  if (timelineCurve[0] === initialNetWorthKrw) {
    return timelineCurve;
  }
  return [initialNetWorthKrw, ...timelineCurve];
}

function calculateMaxDrawdownRatio(
  curve: number[],
  warnings: string[]
): number | null {
  if (curve.length < 2) {
    warnings.push(
      "maxDrawdownRatio unavailable: at least two net worth samples are required"
    );
    return null;
  }
  let peak = curve[0] ?? 0;
  let maxDrawdown = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, (value - peak) / peak);
    }
  }
  return roundRatio(maxDrawdown);
}

function tickReturns(curve: number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1] ?? 0;
    const current = curve[index] ?? 0;
    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }
  return returns;
}

function sumTradeCosts(trades: VirtualTrade[]): number {
  return trades.reduce((sum, trade) => {
    const componentTotal =
      (trade.feeKrw ?? 0) +
      (trade.taxKrw ?? 0) +
      (trade.slippageKrw ?? 0) +
      (trade.spreadCostKrw ?? 0) +
      (trade.impactCostKrw ?? 0);
    return sum + (componentTotal > 0 ? componentTotal : trade.totalCostKrw ?? 0);
  }, 0);
}

function finiteValues(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function sampleStandardDeviation(values: number[]): number {
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}
