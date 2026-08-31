import assert from "node:assert/strict";
import test from "node:test";

import {
  createBucketDrawdownSemanticsRecord,
  createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord,
  createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord,
  createSessionCalendarRecord,
  drawdownSemanticsRefFor,
  riskRuleParameterRefFor,
  riskRuleSetRefFor,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor,
  type BucketSelectionPolicyRecord,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import {
  ImmutablePolicyDependencyRepository,
  resolveStrategyBucketRuntimePolicyDependencies
} from "./runtimePolicyDependencyResolver.js";

const CREATED_AT = "2026-08-28T00:00:00.000Z";

test("scheduled policy resolves exact immutable dependencies and calendar coverage", () => {
  const fixture = dependencyFixture();
  const resolved = resolveStrategyBucketRuntimePolicyDependencies(
    scheduledPolicy(fixture),
    new ImmutablePolicyDependencyRepository(fixture.records),
    [{ market: "KR", exchangeDate: "2026-08-28" }]
  );

  assert.equal(resolved.selectionPolicy.hash, fixture.selection.hash);
  assert.equal(resolved.riskRuleSet.hash, fixture.riskSet.hash);
  assert.deepEqual(
    resolved.riskRules.map(({ rule, parameter }) => [
      rule.ruleId,
      parameter.ruleId
    ]),
    [
      ["cash_reserve", "cash_reserve"],
      ["reduce_only", "reduce_only"]
    ]
  );
  assert.equal(
    resolved.drawdownSemantics.hash,
    fixture.drawdownSemantics.hash
  );
  assert.equal(resolved.scheduleBoundaries[0]?.boundary.market, "KR");
  assert.equal(
    resolved.scheduleBoundaries[0]?.calendar.sessionCalendarRecordId,
    fixture.calendar.sessionCalendarRecordId
  );
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.riskRules), true);
});

test("scheduled policy rejects distinct boundary records for the same market", () => {
  const fixture = dependencyFixture();
  const secondBoundary = createScheduleBoundaryRecord({
    market: fixture.boundary.market,
    version: "daily-close.v2",
    timeZone: fixture.boundary.timeZone,
    sessionCalendarRecordId: fixture.calendar.sessionCalendarRecordId,
    sessionCalendarVersion: fixture.calendar.version,
    sessionCalendarHash: fixture.calendar.hash,
    sessionCalendarLineageHash: fixture.calendar.lineageHash,
    interval: "daily",
    anchorLocalTime: "14:30:00",
    nonSessionDayRule: "previous_session",
    createdAt: CREATED_AT
  });
  const boundaryRefs = [
    scheduleBoundaryRefFor(fixture.boundary),
    scheduleBoundaryRefFor(secondBoundary)
  ].sort((left, right) =>
    left.scheduleBoundaryRecordId.localeCompare(
      right.scheduleBoundaryRecordId,
      "en"
    )
  );
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        {
          ...scheduledPolicy(fixture),
          reviewCadence: { mode: "scheduled", boundaryRefs }
        },
        new ImmutablePolicyDependencyRepository({
          ...fixture.records,
          scheduleBoundaries: [fixture.boundary, secondBoundary]
        }),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /scheduled boundary markets must not contain duplicate markets/
  );
});

test("repository rejects corrupt and duplicate immutable records before resolution", () => {
  const fixture = dependencyFixture();
  const corruptedSelection = {
    ...fixture.selection,
    scoringModelVersion: "selector.v2"
  } as BucketSelectionPolicyRecord;

  assert.throws(
    () =>
      new ImmutablePolicyDependencyRepository({
        ...fixture.records,
        selectionPolicies: [corruptedSelection]
      }),
    /record hash mismatch/
  );
  assert.throws(
    () =>
      new ImmutablePolicyDependencyRepository({
        ...fixture.records,
        selectionPolicies: [fixture.selection, fixture.selection]
      }),
    /record ID must resolve exactly once/
  );
});

test("resolver rejects missing or mismatched exact refs", () => {
  const fixture = dependencyFixture();
  const repository = new ImmutablePolicyDependencyRepository(fixture.records);
  const policy = scheduledPolicy(fixture);

  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        {
          ...policy,
          selectionPolicyRef: {
            ...policy.selectionPolicyRef,
            selectionPolicyRecordId: "selection_policy_missing"
          }
        },
        repository,
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /selection policy ref does not resolve/
  );
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        {
          ...policy,
          riskRuleSetRef: {
            ...policy.riskRuleSetRef,
            version: "risk-set.v2"
          }
        },
        repository,
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /risk rule set ref version\/hash\/lineage mismatch/
  );
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        {
          ...policy,
          selectionPolicyRef: {
            ...policy.selectionPolicyRef,
            lineageHash: `sha256:${"0".repeat(64)}`
          }
        },
        repository,
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /selection policy ref version\/hash\/lineage mismatch/
  );
});

test("resolver rejects selection policies for another strategy bucket", () => {
  const fixture = dependencyFixture({ selectionBucket: "intraday" });

  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        scheduledPolicy(fixture),
        new ImmutablePolicyDependencyRepository(fixture.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /selection policy bucket does not match runtime policy bucket/
  );
});

test("resolver binds every risk rule to the same rule ID and version parameter", () => {
  const fixture = dependencyFixture({ mismatchBuyParameterIdentity: true });

  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        scheduledPolicy(fixture),
        new ImmutablePolicyDependencyRepository(fixture.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /risk rule parameter identity does not match its rule/
  );
});

test("resolver rejects nested dependencies that postdate their parent record", () => {
  const lateParameter = dependencyFixture({
    riskParameterCreatedAt: "2026-08-28T00:00:01.000Z"
  });
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        scheduledPolicy(lateParameter),
        new ImmutablePolicyDependencyRepository(lateParameter.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /risk rule parameter cannot postdate its risk rule set/
  );

  const lateCalendar = dependencyFixture({
    calendarCreatedAt: "2026-08-28T00:00:01.000Z"
  });
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        scheduledPolicy(lateCalendar),
        new ImmutablePolicyDependencyRepository(lateCalendar.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /session calendar cannot postdate its schedule boundary/
  );
});

test("scheduled resolver requires exact enabled-market dates and coverage", () => {
  const fixture = dependencyFixture();
  const repository = new ImmutablePolicyDependencyRepository(fixture.records);
  const policy = scheduledPolicy(fixture);

  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(policy, repository),
    /required calendar date markets must exactly match enabled markets/
  );
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        policy,
        repository,
        [{ market: "KR", exchangeDate: "2026-08-30" }]
      ),
    /does not cover required exchange date/
  );
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        policy,
        repository,
        [
          { market: "KR", exchangeDate: "2026-08-28" },
          { market: "KR", exchangeDate: "2026-08-29" }
        ]
      ),
    /duplicate market/
  );
});

test("scheduled resolver rejects boundary market and timezone divergence", () => {
  const fixture = dependencyFixture({ boundaryTimeZone: "UTC" });
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        scheduledPolicy(fixture),
        new ImmutablePolicyDependencyRepository(fixture.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /timezone mismatch/
  );

  const usFixture = dependencyFixture({ boundaryMarket: "US" });
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        scheduledPolicy(usFixture),
        new ImmutablePolicyDependencyRepository(usFixture.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /scheduled boundary markets must exactly match enabled markets/
  );
});

test("every_tick policy requires immutable verified packet source and no calendar input", () => {
  const valid = dependencyFixture({ selectionBucket: "intraday" });
  const resolved = resolveStrategyBucketRuntimePolicyDependencies(
    everyTickPolicy(valid),
    new ImmutablePolicyDependencyRepository(valid.records)
  );
  assert.equal(resolved.scheduleBoundaries.length, 0);

  const missingSource = dependencyFixture({
    selectionBucket: "intraday",
    omitEveryTickSource: true
  });
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        everyTickPolicy(missingSource),
        new ImmutablePolicyDependencyRepository(missingSource.records)
      ),
    /requires a verified market packet source/
  );
  assert.throws(
    () =>
      resolveStrategyBucketRuntimePolicyDependencies(
        everyTickPolicy(valid),
        new ImmutablePolicyDependencyRepository(valid.records),
        [{ market: "KR", exchangeDate: "2026-08-28" }]
      ),
    /cannot accept calendar dates/
  );
});

type FixtureOptions = {
  selectionBucket?: "swing" | "intraday";
  omitEveryTickSource?: boolean;
  mismatchBuyParameterIdentity?: boolean;
  boundaryMarket?: "KR" | "US";
  boundaryTimeZone?: string;
  riskParameterCreatedAt?: string;
  riskSetCreatedAt?: string;
  calendarCreatedAt?: string;
  boundaryCreatedAt?: string;
};

function dependencyFixture(options: FixtureOptions = {}) {
  const selectionBucket = options.selectionBucket ?? "swing";
  const selection = createBucketSelectionPolicyRecord({
    bucket: selectionBucket,
    version: "selection.v1",
    requiredEvidence: [
      {
        evidenceClass: "market_technical",
        sourceContractId: "verified-market-packet.v1",
        maximumAgeSeconds: 60
      }
    ],
    ...(options.omitEveryTickSource
      ? {}
      : {
          everyTickSourceRequirement: {
            sourceContractId: "verified-market-packet.v1",
            eventType: "verified_market_packet" as const,
            maximumAgeSeconds: 60,
            dedupeKey: "packet_hash" as const
          }
        }),
    hardGateRuleIds: ["liquidity"],
    scoringModelVersion: "selector.v1",
    featureDefinitionRefs: ["momentum.v1"],
    createdAt: CREATED_AT
  });
  const buyParameter = createPortfolioRiskRuleParameterRecord({
    ruleId: options.mismatchBuyParameterIdentity
      ? "different_cash_rule"
      : "cash_reserve",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { minimumCashRatio: 0.15 },
    createdAt: options.riskParameterCreatedAt ?? CREATED_AT
  });
  const sellParameter = createPortfolioRiskRuleParameterRecord({
    ruleId: "reduce_only",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { allowIncrease: false },
    createdAt: options.riskParameterCreatedAt ?? CREATED_AT
  });
  const riskSet = createPortfolioRiskRuleSetRecord({
    version: "risk-set.v1",
    rules: [
      {
        ruleId: "cash_reserve",
        ruleVersion: "v1",
        appliesTo: ["BUY"],
        parameterRef: riskRuleParameterRefFor(buyParameter)
      },
      {
        ruleId: "reduce_only",
        ruleVersion: "v1",
        appliesTo: ["SELL"],
        parameterRef: riskRuleParameterRefFor(sellParameter)
      }
    ],
    createdAt: options.riskSetCreatedAt ?? CREATED_AT
  });
  const drawdownSemantics = createBucketDrawdownSemanticsRecord({
    version: "unit-nav.v1",
    equityBasis: "bucket_assets_plus_cash",
    unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only",
    highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark",
    emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches",
    createdAt: CREATED_AT
  });
  const calendar = createSessionCalendarRecord({
    market: "KR",
    version: "krx-calendar.v1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-08-28",
    validThroughExchangeDate: "2026-08-29",
    sessions: [openSession("2026-08-28"), closedSession("2026-08-29")],
    createdAt: options.calendarCreatedAt ?? CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: options.boundaryMarket ?? "KR",
    version: "daily-close.v1",
    timeZone: options.boundaryTimeZone ?? "Asia/Seoul",
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily",
    anchorLocalTime: "15:30:00",
    nonSessionDayRule: "previous_session",
    createdAt: options.boundaryCreatedAt ?? CREATED_AT
  });
  const records: ImmutablePolicyDependencyRecords = {
    selectionPolicies: [selection],
    riskParameters: [buyParameter, sellParameter],
    riskRuleSets: [riskSet],
    drawdownSemantics: [drawdownSemantics],
    sessionCalendars: [calendar],
    scheduleBoundaries: [boundary]
  };
  return {
    selection,
    buyParameter,
    sellParameter,
    riskSet,
    drawdownSemantics,
    calendar,
    boundary,
    records
  };
}

function scheduledPolicy(fixture: ReturnType<typeof dependencyFixture>) {
  return {
    bucket: "swing" as const,
    targetWeightRatio: 0.2,
    minWeightRatio: 0.1,
    maxWeightRatio: 0.3,
    maxTurnoverRatio: 0.35,
    turnoverWindow: {
      mode: "fixed_utc" as const,
      durationSeconds: 604_800,
      anchor: "unix_epoch" as const,
      denominator: "window_open_portfolio_net_worth_krw" as const
    },
    maxDrawdownRatio: 0.12,
    drawdownSemanticsRef: drawdownSemanticsRefFor(
      fixture.drawdownSemantics
    ),
    reviewCadence: {
      mode: "scheduled" as const,
      boundaryRefs: [scheduleBoundaryRefFor(fixture.boundary)]
    },
    eventTriggers: ["regime_change"] as const,
    selectionTrigger: { mode: "below_min" as const },
    minimumHoldingSeconds: 86_400,
    maximumHoldingSeconds: 2_419_200,
    exitPolicy: {
      takeProfit: { mode: "disabled" as const },
      timeExpiryAction: "review_required" as const
    },
    enabledMarkets: ["KR"] as const,
    enabledAssetClasses: ["equity"],
    selectionPolicyRef: selectionPolicyRefFor(fixture.selection),
    riskRuleSetRef: riskRuleSetRefFor(fixture.riskSet)
  };
}

function everyTickPolicy(fixture: ReturnType<typeof dependencyFixture>) {
  return {
    ...scheduledPolicy(fixture),
    bucket: "intraday" as const,
    targetWeightRatio: 0.1,
    minWeightRatio: 0,
    maxWeightRatio: 0.15,
    maxTurnoverRatio: 1,
    reviewCadence: { mode: "every_tick" as const },
    selectionTrigger: {
      mode: "entry_floor_on_due_cycle" as const,
      entryWeightRatio: 0.02
    }
  };
}

function openSession(exchangeDate: string) {
  return {
    exchangeDate,
    sessionKind: "regular" as const,
    opensAt: `${exchangeDate}T09:00:00+09:00`,
    closesAt: `${exchangeDate}T15:30:00+09:00`,
    sourceEvidenceRefs: [`official-calendar:krx:${exchangeDate}`]
  };
}

function closedSession(exchangeDate: string) {
  return {
    exchangeDate,
    sessionKind: "closed" as const,
    sourceEvidenceRefs: [`official-calendar:krx:${exchangeDate}`]
  };
}
