import type {
  HistoricalMarketSnapshot,
  Market
} from "../domain/schemas.js";
import {
  classifyMarketCalendarTimestamp,
  localDatePart,
  MarketCalendarFixtureIndex,
  type MarketCalendarFixture,
  type MarketCalendarStatus,
  type MarketCalendarTimezone,
  type MarketCalendarWarningCode
} from "./marketCalendar.js";

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
  calendarValidation?: HistoricalDataAvailabilityCalendarOptions;
}

export interface HistoricalDataAvailabilityCalendarRule {
  market: Market;
  exchange: string;
  timezone: MarketCalendarTimezone;
}

export interface HistoricalDataAvailabilityCalendarOptions {
  fixtures: MarketCalendarFixture[];
  rules: HistoricalDataAvailabilityCalendarRule[];
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

export interface HistoricalDataAvailabilityCalendarSnapshotSummary {
  snapshotId: string;
  market: Market;
  symbol: string;
  observedAt: string;
  exchange: string | null;
  timezone: MarketCalendarTimezone | null;
  sessionDate: string | null;
  calendarId: string | null;
  status: MarketCalendarStatus;
  warningCodes: MarketCalendarWarningCode[];
}

export type HistoricalDataAvailabilityCalendarWarningCounts = Record<
  MarketCalendarWarningCode,
  number
>;

export interface HistoricalDataAvailabilityCalendarReport {
  fixtureCount: number;
  ruleCount: number;
  checkedSnapshotCount: number;
  rejectedSnapshotCount: number;
  warningCounts: HistoricalDataAvailabilityCalendarWarningCounts;
  rejectedSnapshots: HistoricalDataAvailabilityCalendarSnapshotSummary[];
  issues: MarketCalendarWarningCode[];
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
  calendarValidation: HistoricalDataAvailabilityCalendarReport | null;
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
  const calendarValidation =
    options.calendarValidation === undefined
      ? null
      : assessCalendarValidation({
          snapshots: windowSnapshots,
          calendarValidation: options.calendarValidation
        });
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
    insufficientRequiredSymbols,
    calendarValidation
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
    calendarValidation,
    issues
  };
}

function assessCalendarValidation(input: {
  snapshots: HistoricalMarketSnapshot[];
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
}): HistoricalDataAvailabilityCalendarReport {
  const ruleByMarket = marketCalendarRuleMap(input.calendarValidation.rules);
  const fixtureIndex = new MarketCalendarFixtureIndex(
    input.calendarValidation.fixtures
  );
  const rejectedSnapshots: HistoricalDataAvailabilityCalendarSnapshotSummary[] = [];
  const warningCounts = emptyCalendarWarningCounts();

  for (const snapshot of input.snapshots) {
    const rule = ruleByMarket.get(snapshot.market);
    const summary =
      rule === undefined
        ? missingCalendarRuleSummary(snapshot)
        : calendarSnapshotSummary({
            snapshot,
            rule,
            fixtureIndex
          });

    for (const warningCode of summary.warningCodes) {
      warningCounts[warningCode] += 1;
    }

    if (summary.warningCodes.length > 0 || summary.status !== "session_open") {
      rejectedSnapshots.push(summary);
    }
  }

  return {
    fixtureCount: input.calendarValidation.fixtures.length,
    ruleCount: ruleByMarket.size,
    checkedSnapshotCount: input.snapshots.length,
    rejectedSnapshotCount: rejectedSnapshots.length,
    warningCounts,
    rejectedSnapshots,
    issues: calendarIssues(warningCounts)
  };
}

function calendarSnapshotSummary(input: {
  snapshot: HistoricalMarketSnapshot;
  rule: HistoricalDataAvailabilityCalendarRule;
  fixtureIndex: MarketCalendarFixtureIndex;
}): HistoricalDataAvailabilityCalendarSnapshotSummary {
  const observedAt = new Date(input.snapshot.observedAt);
  const sessionDate = localDatePart(observedAt, input.rule.timezone);
  const fixture = input.fixtureIndex.get({
    exchange: input.rule.exchange,
    sessionDate
  });
  const matchingFixture =
    fixture !== undefined &&
    fixture.market === input.snapshot.market &&
    fixture.market === input.rule.market &&
    fixture.timezone === input.rule.timezone
      ? fixture
      : undefined;
  const classification = classifyMarketCalendarTimestamp({
    observedAt: input.snapshot.observedAt,
    fixture: matchingFixture
  });

  return {
    snapshotId: input.snapshot.snapshotId,
    market: input.snapshot.market,
    symbol: input.snapshot.symbol,
    observedAt: input.snapshot.observedAt,
    exchange: input.rule.exchange,
    timezone: input.rule.timezone,
    sessionDate,
    calendarId: classification.calendarId,
    status: classification.status,
    warningCodes: classification.warningCodes
  };
}

function missingCalendarRuleSummary(
  snapshot: HistoricalMarketSnapshot
): HistoricalDataAvailabilityCalendarSnapshotSummary {
  return {
    snapshotId: snapshot.snapshotId,
    market: snapshot.market,
    symbol: snapshot.symbol,
    observedAt: snapshot.observedAt,
    exchange: null,
    timezone: null,
    sessionDate: null,
    calendarId: null,
    status: "fixture_missing",
    warningCodes: ["CALENDAR_FIXTURE_MISSING"]
  };
}

function marketCalendarRuleMap(
  rules: HistoricalDataAvailabilityCalendarRule[]
): Map<Market, HistoricalDataAvailabilityCalendarRule> {
  if (rules.length === 0) {
    throw new Error("calendarValidation.rules must not be empty");
  }

  const rulesByMarket = new Map<Market, HistoricalDataAvailabilityCalendarRule>();
  for (const rule of rules) {
    if (rule.exchange.trim().length === 0) {
      throw new Error("calendarValidation rule exchange must not be empty");
    }
    if (rulesByMarket.has(rule.market)) {
      throw new Error(
        `duplicate calendarValidation rule for market: ${rule.market}`
      );
    }
    rulesByMarket.set(rule.market, rule);
  }
  return rulesByMarket;
}

function emptyCalendarWarningCounts():
  HistoricalDataAvailabilityCalendarWarningCounts {
  return {
    CALENDAR_FIXTURE_MISSING: 0,
    CALENDAR_HOLIDAY_SAMPLE: 0,
    CALENDAR_SESSION_MISMATCH: 0,
    CALENDAR_TIMEZONE_MISMATCH: 0
  };
}

function calendarIssues(
  warningCounts: HistoricalDataAvailabilityCalendarWarningCounts
): MarketCalendarWarningCode[] {
  return (
    Object.entries(warningCounts) as Array<[MarketCalendarWarningCode, number]>
  )
    .filter(([, count]) => count > 0)
    .map(([warningCode]) => warningCode);
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
  calendarValidation: HistoricalDataAvailabilityCalendarReport | null;
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
  if (
    input.calendarValidation !== null &&
    input.calendarValidation.rejectedSnapshotCount > 0
  ) {
    issues.push(...input.calendarValidation.issues);
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
