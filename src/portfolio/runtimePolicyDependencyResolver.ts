import type {
  BucketDrawdownSemanticsRecord,
  BucketDrawdownSemanticsRef,
  BucketSelectionPolicyRecord,
  BucketSelectionPolicyRef,
  ImmutablePolicyDependencyRecords,
  Market,
  PortfolioRiskRuleParameterRecord,
  PortfolioRiskRuleParameterRef,
  PortfolioRiskRuleSetRecord,
  PortfolioRiskRuleSetRef,
  ScheduleBoundaryRecord,
  ScheduleBoundaryRef,
  SessionCalendarRecord,
  StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";
import {
  parseBucketDrawdownSemanticsRecord,
  parseBucketSelectionPolicyRecord,
  parsePortfolioRiskRuleParameterRecord,
  parsePortfolioRiskRuleSetRecord,
  parseScheduleBoundaryRecord,
  parseSessionCalendarRecord,
  parseStrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";

export interface RequiredCalendarDate {
  market: Market;
  exchangeDate: string;
}

export interface ResolvedPortfolioRiskRule {
  rule: PortfolioRiskRuleSetRecord["rules"][number];
  parameter: PortfolioRiskRuleParameterRecord;
}

export interface ResolvedScheduleBoundary {
  boundary: ScheduleBoundaryRecord;
  calendar: SessionCalendarRecord;
}

export interface ResolvedStrategyBucketRuntimePolicy {
  policy: StrategyBucketRuntimePolicy;
  selectionPolicy: BucketSelectionPolicyRecord;
  riskRuleSet: PortfolioRiskRuleSetRecord;
  riskRules: readonly ResolvedPortfolioRiskRule[];
  drawdownSemantics: BucketDrawdownSemanticsRecord;
  scheduleBoundaries: readonly ResolvedScheduleBoundary[];
}

/**
 * Immutable in-memory view over append-only policy dependency records.
 *
 * Construction validates every record and rejects duplicate hash-derived IDs.
 * Callers therefore cannot resolve through an unrelated corrupt or ambiguous
 * record set. Filesystem loading and corrupt-line handling remain an adapter
 * responsibility.
 */
export class ImmutablePolicyDependencyRepository {
  private readonly selectionPolicies: ReadonlyMap<
    string,
    BucketSelectionPolicyRecord
  >;
  private readonly riskParameters: ReadonlyMap<
    string,
    PortfolioRiskRuleParameterRecord
  >;
  private readonly riskRuleSets: ReadonlyMap<string, PortfolioRiskRuleSetRecord>;
  private readonly drawdownSemantics: ReadonlyMap<
    string,
    BucketDrawdownSemanticsRecord
  >;
  private readonly sessionCalendars: ReadonlyMap<string, SessionCalendarRecord>;
  private readonly scheduleBoundaries: ReadonlyMap<
    string,
    ScheduleBoundaryRecord
  >;

  constructor(records: ImmutablePolicyDependencyRecords) {
    this.selectionPolicies = verifiedRecordMap(
      records.selectionPolicies,
      parseBucketSelectionPolicyRecord,
      (record) => record.selectionPolicyRecordId,
      "selection policy"
    );
    this.riskParameters = verifiedRecordMap(
      records.riskParameters,
      parsePortfolioRiskRuleParameterRecord,
      (record) => record.riskRuleParameterRecordId,
      "risk parameter"
    );
    this.riskRuleSets = verifiedRecordMap(
      records.riskRuleSets,
      parsePortfolioRiskRuleSetRecord,
      (record) => record.riskRuleSetRecordId,
      "risk rule set"
    );
    this.drawdownSemantics = verifiedRecordMap(
      records.drawdownSemantics,
      parseBucketDrawdownSemanticsRecord,
      (record) => record.drawdownSemanticsRecordId,
      "drawdown semantics"
    );
    this.sessionCalendars = verifiedRecordMap(
      records.sessionCalendars,
      parseSessionCalendarRecord,
      (record) => record.sessionCalendarRecordId,
      "session calendar"
    );
    this.scheduleBoundaries = verifiedRecordMap(
      records.scheduleBoundaries,
      parseScheduleBoundaryRecord,
      (record) => record.scheduleBoundaryRecordId,
      "schedule boundary"
    );
  }

  resolveSelectionPolicy(
    ref: BucketSelectionPolicyRef
  ): BucketSelectionPolicyRecord {
    return resolveExactRef(
      this.selectionPolicies,
      ref.selectionPolicyRecordId,
      ref.version,
      ref.hash,
      "selection policy"
    );
  }

  resolveRiskParameter(
    ref: PortfolioRiskRuleParameterRef
  ): PortfolioRiskRuleParameterRecord {
    return resolveExactRef(
      this.riskParameters,
      ref.riskRuleParameterRecordId,
      ref.version,
      ref.hash,
      "risk parameter"
    );
  }

  resolveRiskRuleSet(
    ref: PortfolioRiskRuleSetRef
  ): PortfolioRiskRuleSetRecord {
    return resolveExactRef(
      this.riskRuleSets,
      ref.riskRuleSetRecordId,
      ref.version,
      ref.hash,
      "risk rule set"
    );
  }

  resolveDrawdownSemantics(
    ref: BucketDrawdownSemanticsRef
  ): BucketDrawdownSemanticsRecord {
    return resolveExactRef(
      this.drawdownSemantics,
      ref.drawdownSemanticsRecordId,
      ref.version,
      ref.hash,
      "drawdown semantics"
    );
  }

  resolveScheduleBoundary(
    ref: ScheduleBoundaryRef,
    requiredExchangeDate: string
  ): ResolvedScheduleBoundary {
    const boundary = this.resolveScheduleBoundaryRecord(ref);
    const calendar = resolveExactRef(
      this.sessionCalendars,
      boundary.sessionCalendarRecordId,
      boundary.sessionCalendarVersion,
      boundary.sessionCalendarHash,
      "session calendar"
    );

    if (calendar.market !== boundary.market) {
      throw new Error("schedule boundary and session calendar market mismatch");
    }
    if (calendar.timeZone !== boundary.timeZone) {
      throw new Error("schedule boundary and session calendar timezone mismatch");
    }
    if (
      requiredExchangeDate < calendar.validFromExchangeDate ||
      requiredExchangeDate > calendar.validThroughExchangeDate ||
      !calendar.sessions.some(
        (session) => session.exchangeDate === requiredExchangeDate
      )
    ) {
      throw new Error(
        `session calendar does not cover required exchange date ${requiredExchangeDate}`
      );
    }

    return deepFreeze({ boundary, calendar });
  }

  resolveScheduleBoundaryForMarketDates(
    ref: ScheduleBoundaryRef,
    requiredExchangeDates: ReadonlyMap<Market, string>
  ): ResolvedScheduleBoundary {
    const boundary = this.resolveScheduleBoundaryRecord(ref);
    const requiredExchangeDate = requiredExchangeDates.get(boundary.market);
    if (requiredExchangeDate === undefined) {
      throw new Error(
        "scheduled boundary markets must exactly match enabled markets"
      );
    }
    return this.resolveScheduleBoundary(ref, requiredExchangeDate);
  }

  private resolveScheduleBoundaryRecord(
    ref: ScheduleBoundaryRef
  ): ScheduleBoundaryRecord {
    return resolveExactRef(
      this.scheduleBoundaries,
      ref.scheduleBoundaryRecordId,
      ref.version,
      ref.hash,
      "schedule boundary"
    );
  }
}

export function resolveStrategyBucketRuntimePolicyDependencies(
  value: unknown,
  repository: ImmutablePolicyDependencyRepository,
  requiredCalendarDates: readonly RequiredCalendarDate[] = []
): ResolvedStrategyBucketRuntimePolicy {
  const policy = parseStrategyBucketRuntimePolicy(value);
  const selectionPolicy = repository.resolveSelectionPolicy(
    policy.selectionPolicyRef
  );
  if (selectionPolicy.bucket !== policy.bucket) {
    throw new Error("selection policy bucket does not match runtime policy bucket");
  }

  if (policy.reviewCadence.mode === "every_tick") {
    if (selectionPolicy.everyTickSourceRequirement === undefined) {
      throw new Error(
        "every_tick runtime policy requires a verified market packet source"
      );
    }
  }

  const riskRuleSet = repository.resolveRiskRuleSet(policy.riskRuleSetRef);
  const riskRules = riskRuleSet.rules.map((rule) => {
    const parameter = repository.resolveRiskParameter(rule.parameterRef);
    if (
      parameter.ruleId !== rule.ruleId ||
      parameter.ruleVersion !== rule.ruleVersion
    ) {
      throw new Error("risk rule parameter identity does not match its rule");
    }
    return deepFreeze({ rule, parameter });
  });
  const drawdownSemantics = repository.resolveDrawdownSemantics(
    policy.drawdownSemanticsRef
  );

  let scheduleBoundaries: readonly ResolvedScheduleBoundary[] = [];
  if (policy.reviewCadence.mode === "scheduled") {
    const calendarDates = exactCalendarDateMap(
      requiredCalendarDates,
      policy.enabledMarkets
    );
    scheduleBoundaries = policy.reviewCadence.boundaryRefs.map((ref) =>
      repository.resolveScheduleBoundaryForMarketDates(ref, calendarDates)
    );
    const boundaryMarkets = scheduleBoundaries.map(
      ({ boundary }) => boundary.market
    );
    assertSameCanonicalSet(
      boundaryMarkets,
      policy.enabledMarkets,
      "scheduled boundary markets"
    );
  } else if (requiredCalendarDates.length > 0) {
    throw new Error("every_tick runtime policy cannot accept calendar dates");
  }

  return deepFreeze({
    policy,
    selectionPolicy,
    riskRuleSet,
    riskRules,
    drawdownSemantics,
    scheduleBoundaries
  });
}

function exactCalendarDateMap(
  requirements: readonly RequiredCalendarDate[],
  enabledMarkets: readonly Market[]
): ReadonlyMap<Market, string> {
  const dates = new Map<Market, string>();
  for (const requirement of requirements) {
    if (dates.has(requirement.market)) {
      throw new Error("required calendar dates contain a duplicate market");
    }
    dates.set(requirement.market, requirement.exchangeDate);
  }
  assertSameCanonicalSet(
    [...dates.keys()],
    enabledMarkets,
    "required calendar date markets"
  );
  return dates;
}

function verifiedRecordMap<T>(
  records: readonly T[],
  parse: (record: T) => T,
  idFor: (record: T) => string,
  label: string
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of records) {
    const record = parse(value);
    const id = idFor(record);
    if (result.has(id)) {
      throw new Error(`${label} record ID must resolve exactly once`);
    }
    result.set(id, record);
  }
  return result;
}

function resolveExactRef<T extends { version: string; hash: string }>(
  records: ReadonlyMap<string, T>,
  id: string,
  version: string,
  hash: string,
  label: string
): T {
  const record = records.get(id);
  if (record === undefined) {
    throw new Error(`${label} ref does not resolve`);
  }
  if (record.version !== version || record.hash !== hash) {
    throw new Error(`${label} ref version/hash mismatch`);
  }
  return record;
}

function assertSameCanonicalSet<T extends string>(
  actual: readonly T[],
  expected: readonly T[],
  label: string
): void {
  const canonicalActual = [...new Set(actual)].sort();
  const canonicalExpected = [...new Set(expected)].sort();
  if (
    actual.length !== canonicalActual.length ||
    expected.length !== canonicalExpected.length ||
    canonicalActual.length !== canonicalExpected.length ||
    canonicalActual.some((value, index) => value !== canonicalExpected[index])
  ) {
    throw new Error(`${label} must exactly match enabled markets`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
