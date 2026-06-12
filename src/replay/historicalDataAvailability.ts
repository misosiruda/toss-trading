import type {
  HistoricalMarketSnapshot,
  Market
} from "../domain/schemas.js";

export interface HistoricalDataAvailabilitySymbolRequirement {
  market: Market;
  symbol: string;
}

export interface HistoricalDataAvailabilityOptions {
  snapshots: HistoricalMarketSnapshot[];
  windowStart: Date;
  windowEnd: Date;
  corruptLineCount?: number;
  minWindowSnapshots?: number;
  minSnapshotsPerRequiredSymbol?: number;
  requiredSymbols?: HistoricalDataAvailabilitySymbolRequirement[];
}

export interface HistoricalDataAvailabilitySymbolSummary {
  market: Market;
  symbol: string;
  totalSnapshotCount: number;
  windowSnapshotCount: number;
  earliestObservedAt: string | null;
  latestObservedAt: string | null;
  firstWindowObservedAt: string | null;
  lastWindowObservedAt: string | null;
  required: boolean;
  available: boolean;
}

export interface HistoricalDataAvailabilityReport {
  status: "available" | "insufficient";
  mode: "paper_only";
  windowStart: string;
  windowEnd: string;
  totalSnapshotCount: number;
  windowSnapshotCount: number;
  corruptLineCount: number;
  minWindowSnapshots: number;
  minSnapshotsPerRequiredSymbol: number;
  earliestObservedAt: string | null;
  latestObservedAt: string | null;
  symbolCount: number;
  requiredSymbolCount: number;
  availableRequiredSymbolCount: number;
  missingRequiredSymbols: HistoricalDataAvailabilitySymbolRequirement[];
  insufficientRequiredSymbols: HistoricalDataAvailabilitySymbolSummary[];
  symbolSummaries: HistoricalDataAvailabilitySymbolSummary[];
  issues: string[];
}

const DEFAULT_MIN_WINDOW_SNAPSHOTS = 1;
const DEFAULT_MIN_SNAPSHOTS_PER_REQUIRED_SYMBOL = 1;

export function assessHistoricalDataAvailability(
  options: HistoricalDataAvailabilityOptions
): HistoricalDataAvailabilityReport {
  validateDate(options.windowStart, "windowStart");
  validateDate(options.windowEnd, "windowEnd");
  if (options.windowStart.getTime() > options.windowEnd.getTime()) {
    throw new Error("windowStart must be before or equal to windowEnd");
  }

  const minWindowSnapshots =
    options.minWindowSnapshots ?? DEFAULT_MIN_WINDOW_SNAPSHOTS;
  const minSnapshotsPerRequiredSymbol =
    options.minSnapshotsPerRequiredSymbol ??
    DEFAULT_MIN_SNAPSHOTS_PER_REQUIRED_SYMBOL;
  validateNonNegativeInteger(minWindowSnapshots, "minWindowSnapshots");
  validateNonNegativeInteger(
    minSnapshotsPerRequiredSymbol,
    "minSnapshotsPerRequiredSymbol"
  );

  const corruptLineCount = options.corruptLineCount ?? 0;
  validateNonNegativeInteger(corruptLineCount, "corruptLineCount");

  const sortedSnapshots = [...options.snapshots].sort(compareSnapshots);
  const windowSnapshots = sortedSnapshots.filter((snapshot) =>
    isInsideWindow(snapshot, options.windowStart, options.windowEnd)
  );
  const requiredSymbols = dedupeRequirements(options.requiredSymbols ?? []);
  const requiredKeys = new Set(requiredSymbols.map(symbolKey));
  const symbolSummaries = summarizeSymbols({
    snapshots: sortedSnapshots,
    windowSnapshots,
    requiredKeys,
    minSnapshotsPerRequiredSymbol
  });
  const missingRequiredSymbols = requiredSymbols.filter(
    (requirement) =>
      !symbolSummaries.some(
        (summary) => symbolKey(summary) === symbolKey(requirement)
      )
  );
  const insufficientRequiredSymbols = symbolSummaries.filter(
    (summary) => summary.required && !summary.available
  );
  const issues = availabilityIssues({
    corruptLineCount,
    windowSnapshotCount: windowSnapshots.length,
    minWindowSnapshots,
    missingRequiredSymbols,
    insufficientRequiredSymbols
  });

  return {
    status: issues.length === 0 ? "available" : "insufficient",
    mode: "paper_only",
    windowStart: options.windowStart.toISOString(),
    windowEnd: options.windowEnd.toISOString(),
    totalSnapshotCount: sortedSnapshots.length,
    windowSnapshotCount: windowSnapshots.length,
    corruptLineCount,
    minWindowSnapshots,
    minSnapshotsPerRequiredSymbol,
    earliestObservedAt: sortedSnapshots[0]?.observedAt ?? null,
    latestObservedAt: sortedSnapshots.at(-1)?.observedAt ?? null,
    symbolCount: symbolSummaries.length,
    requiredSymbolCount: requiredSymbols.length,
    availableRequiredSymbolCount: symbolSummaries.filter(
      (summary) => summary.required && summary.available
    ).length,
    missingRequiredSymbols,
    insufficientRequiredSymbols,
    symbolSummaries,
    issues
  };
}

function summarizeSymbols(input: {
  snapshots: HistoricalMarketSnapshot[];
  windowSnapshots: HistoricalMarketSnapshot[];
  requiredKeys: Set<string>;
  minSnapshotsPerRequiredSymbol: number;
}): HistoricalDataAvailabilitySymbolSummary[] {
  const bySymbol = new Map<string, HistoricalMarketSnapshot[]>();
  const windowBySymbol = new Map<string, HistoricalMarketSnapshot[]>();

  for (const snapshot of input.snapshots) {
    appendToMap(bySymbol, symbolKey(snapshot), snapshot);
  }

  for (const snapshot of input.windowSnapshots) {
    appendToMap(windowBySymbol, symbolKey(snapshot), snapshot);
  }

  return Array.from(bySymbol.entries())
    .map(([key, snapshots]) => {
      const windowSnapshots = windowBySymbol.get(key) ?? [];
      const firstSnapshot = snapshots[0]!;
      const required = input.requiredKeys.has(key);
      const available =
        !required ||
        windowSnapshots.length >= input.minSnapshotsPerRequiredSymbol;

      return {
        market: firstSnapshot.market,
        symbol: firstSnapshot.symbol,
        totalSnapshotCount: snapshots.length,
        windowSnapshotCount: windowSnapshots.length,
        earliestObservedAt: snapshots[0]?.observedAt ?? null,
        latestObservedAt: snapshots.at(-1)?.observedAt ?? null,
        firstWindowObservedAt: windowSnapshots[0]?.observedAt ?? null,
        lastWindowObservedAt: windowSnapshots.at(-1)?.observedAt ?? null,
        required,
        available
      };
    })
    .sort(compareSymbolSummaries);
}

function availabilityIssues(input: {
  corruptLineCount: number;
  windowSnapshotCount: number;
  minWindowSnapshots: number;
  missingRequiredSymbols: HistoricalDataAvailabilitySymbolRequirement[];
  insufficientRequiredSymbols: HistoricalDataAvailabilitySymbolSummary[];
}): string[] {
  const issues: string[] = [];

  if (input.corruptLineCount > 0) {
    issues.push("CORRUPT_SNAPSHOT_LINES");
  }
  if (input.windowSnapshotCount === 0) {
    issues.push("WINDOW_SNAPSHOT_MISSING");
  }
  if (input.windowSnapshotCount < input.minWindowSnapshots) {
    issues.push("WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM");
  }
  if (input.missingRequiredSymbols.length > 0) {
    issues.push("REQUIRED_SYMBOL_MISSING");
  }
  if (input.insufficientRequiredSymbols.length > 0) {
    issues.push("REQUIRED_SYMBOL_SNAPSHOT_COUNT_BELOW_MINIMUM");
  }

  return Array.from(new Set(issues));
}

function isInsideWindow(
  snapshot: HistoricalMarketSnapshot,
  windowStart: Date,
  windowEnd: Date
): boolean {
  const observedAt = Date.parse(snapshot.observedAt);
  return observedAt >= windowStart.getTime() && observedAt <= windowEnd.getTime();
}

function dedupeRequirements(
  requirements: HistoricalDataAvailabilitySymbolRequirement[]
): HistoricalDataAvailabilitySymbolRequirement[] {
  const deduped = new Map<string, HistoricalDataAvailabilitySymbolRequirement>();
  for (const requirement of requirements) {
    deduped.set(symbolKey(requirement), requirement);
  }
  return Array.from(deduped.values()).sort(compareRequirements);
}

function appendToMap(
  map: Map<string, HistoricalMarketSnapshot[]>,
  key: string,
  value: HistoricalMarketSnapshot
): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
    return;
  }
  values.push(value);
}

function compareSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  const timeDiff = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  const symbolDiff = left.symbol.localeCompare(right.symbol);
  if (symbolDiff !== 0) {
    return symbolDiff;
  }
  return left.snapshotId.localeCompare(right.snapshotId);
}

function compareSymbolSummaries(
  left: HistoricalDataAvailabilitySymbolSummary,
  right: HistoricalDataAvailabilitySymbolSummary
): number {
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  return left.symbol.localeCompare(right.symbol);
}

function compareRequirements(
  left: HistoricalDataAvailabilitySymbolRequirement,
  right: HistoricalDataAvailabilitySymbolRequirement
): number {
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  return left.symbol.localeCompare(right.symbol);
}

function symbolKey(input: { market: Market; symbol: string }): string {
  return `${input.market}:${input.symbol}`;
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}
