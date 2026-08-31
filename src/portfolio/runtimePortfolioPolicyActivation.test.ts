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
  hashCanonicalPayload,
  hashDerivedId,
  hashImmutableRecordLineage,
  riskRuleParameterRefFor,
  riskRuleSetRefFor,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords,
  type StrategyBucket
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import {
  createPortfolioPolicyActivatedEvent,
  createPortfolioPolicyRetiredEvent,
  parsePortfolioPolicyActivationEvent,
  resolveActiveRuntimePortfolioPolicyAsOf,
  type PortfolioPolicyActivatedEvent,
  type PortfolioPolicyRetiredEvent
} from "./runtimePortfolioPolicyActivation.js";
import {
  parseRuntimePortfolioPolicyRecord,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";

const POLICY_CREATED_AT = "2026-08-28T00:00:00.000Z";
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;
const DEPENDENCY_FIXTURE = dependencyFixture();

test("activation event binds the complete policy tuple with a hash-derived ID", () => {
  const policy = runtimePolicy();
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const retry = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });

  assert.deepEqual(retry, event);
  assert.equal(event.effectiveFrom, event.createdAt);
  assert.equal(event.policyRecordId, policy.runtimePolicyRecordId);
  assert.equal(event.policyLineageHash, policy.lineageHash);
  assert.equal(
    event.activationId,
    `portfolio_policy_activation_${event.activationEventHash.slice("sha256:".length)}`
  );
  assert.deepEqual(parsePortfolioPolicyActivationEvent(event), event);
  assert.equal(Object.isFrozen(event), true);

  const hashTamper = structuredClone(event);
  hashTamper.policyVersion = "v2";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(hashTamper),
    /activation event hash mismatch/
  );

  const idTamper = structuredClone(event);
  idTamper.activationId = "portfolio_policy_activation_fabricated";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(idTamper),
    /activation ID mismatch/
  );

  const createdAtTamper = structuredClone(event);
  createdAtTamper.createdAt = "2026-08-28T01:00:01.000Z";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(createdAtTamper),
    /effectiveFrom must equal createdAt/
  );

  const noncanonical = structuredClone(event);
  noncanonical.portfolioId = ` ${noncanonical.portfolioId} `;
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(noncanonical),
    /must already be canonical/
  );
});

test("activation resolver deterministically folds replacement and retirement as of time", () => {
  const firstPolicy = runtimePolicy();
  const secondPolicy = runtimePolicy({ version: "v2", name: "Policy v2" });
  const first = createPortfolioPolicyActivatedEvent({
    policy: firstPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const replacement = createPortfolioPolicyActivatedEvent({
    policy: secondPolicy,
    activationSequence: 2,
    supersedesActivationId: first.activationId,
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  const retirement = createPortfolioPolicyRetiredEvent({
    portfolioId: firstPolicy.portfolioId,
    activationSequence: 3,
    retiredActivationId: replacement.activationId,
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T03:00:00.000Z"
  });
  const reopened = createPortfolioPolicyActivatedEvent({
    policy: firstPolicy,
    activationSequence: 4,
    createdAt: "2026-08-28T04:00:00.000Z"
  });
  const events = [reopened, replacement, retirement, first];
  const policies = [secondPolicy, firstPolicy];

  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T01:30:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    first.activationId
  );
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T02:30:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }).policy.runtimePolicyRecordId,
    secondPolicy.runtimePolicyRecordId
  );
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: firstPolicy.portfolioId,
        asOf: "2026-08-28T03:30:00.000Z",
        events,
        policies,
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /active runtime portfolio policy is required/
  );
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T04:00:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    reopened.activationId
  );
});

test("activation resolver rejects sequence gaps, duplicates, branches, and backdating", () => {
  const policy = runtimePolicy();
  const first = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const sequenceTwo = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 2,
    supersedesActivationId: first.activationId,
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  const resolve = (events: readonly unknown[]) =>
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: policy.portfolioId,
      asOf: "2026-08-28T05:00:00.000Z",
      events,
      policies: [policy],
      dependencies: DEPENDENCY_FIXTURE.repository
    });

  assert.throws(
    () => resolve([sequenceTwo]),
    /sequence must be contiguous from one/
  );
  assert.throws(
    () => resolve([first, first]),
    /event ID must be unique/
  );

  const firstWithSupersedes = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    supersedesActivationId: "portfolio_policy_activation_unknown",
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () => resolve([firstWithSupersedes]),
    /cannot supersede another activation/
  );

  const branch = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 2,
    supersedesActivationId: "portfolio_policy_activation_unknown",
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: policy.portfolioId,
      asOf: "2026-08-28T01:30:00.000Z",
      events: [first, branch],
      policies: [policy],
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    first.activationId
  );
  assert.throws(
    () => resolve([first, branch]),
    /must supersede the current activation/
  );

  const backdated = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 2,
    supersedesActivationId: first.activationId,
    createdAt: "2026-08-28T00:30:00.000Z"
  });
  assert.throws(
    () => resolve([first, backdated]),
    /sequence cannot be backdated/
  );

  const wrongRetirement = createPortfolioPolicyRetiredEvent({
    portfolioId: policy.portfolioId,
    activationSequence: 2,
    retiredActivationId: "portfolio_policy_activation_unknown",
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  assert.throws(
    () => resolve([first, wrongRetirement]),
    /retirement must target the current activation/
  );
});

test("activation parser rejects future and backdated effective time after independent rehash", () => {
  const policy = runtimePolicy();
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });

  assert.throws(
    () =>
      parsePortfolioPolicyActivationEvent(
        rehashActivatedEvent(event, {
          effectiveFrom: "2026-08-28T01:00:01.000Z"
        })
      ),
    /effectiveFrom must equal createdAt/
  );
  assert.throws(
    () =>
      createPortfolioPolicyActivatedEvent({
        policy,
        activationSequence: 1,
        createdAt: "2026-08-28T01:00:00.0001Z"
      }),
    /must use millisecond precision/
  );
  assert.throws(
    () =>
      parsePortfolioPolicyActivationEvent(
        rehashActivatedEvent(event, {
          effectiveFrom: "2026-08-28T00:59:59.000Z"
        })
      ),
    /effectiveFrom must equal createdAt/
  );
});

test("activation resolver requires exact runtime policy identity and chronology", () => {
  const policy = runtimePolicy();
  const anotherPolicy = runtimePolicy({ version: "v2", name: "Policy v2" });
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const resolve = (events: readonly unknown[], policies: readonly unknown[]) =>
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: policy.portfolioId,
      asOf: "2026-08-28T02:00:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    });

  assert.throws(
    () => resolve([event], [anotherPolicy]),
    /policy record does not resolve/
  );

  const lineageMismatch = rehashActivatedEvent(event, {
    policyLineageHash: HASH_A
  });
  assert.throws(
    () => resolve([lineageMismatch], [policy]),
    /policy identity mismatch/
  );

  const futurePolicy = runtimePolicy({
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  const prematureActivation = createPortfolioPolicyActivatedEvent({
    policy: futurePolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () => resolve([prematureActivation], [futurePolicy]),
    /policy cannot postdate its activation/
  );

  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-08-28T02:00:00",
        events: [event],
        policies: [policy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /millisecond precision and include a UTC or numeric timezone offset/
  );
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-08-28T02:00:00.0001Z",
        events: [event],
        policies: [policy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /must use millisecond precision/
  );
});

test("activation resolver independently resolves policy dependencies and boundary markets", () => {
  const policy = runtimePolicy();
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const missingSelection = new ImmutablePolicyDependencyRepository({
    ...DEPENDENCY_FIXTURE.records,
    selectionPolicies: DEPENDENCY_FIXTURE.records.selectionPolicies.filter(
      (record) => record.bucket !== "long_term"
    )
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-08-28T02:00:00.000Z",
        events: [event],
        policies: [policy],
        dependencies: missingSelection
      }),
    /selection policy ref does not resolve/
  );

  const mismatchedMarketPolicy = runtimePolicy({ enabledMarkets: ["US"] });
  const mismatchedMarketEvent = createPortfolioPolicyActivatedEvent({
    policy: mismatchedMarketPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: mismatchedMarketPolicy.portfolioId,
        asOf: "2026-08-28T02:00:00.000Z",
        events: [mismatchedMarketEvent],
        policies: [mismatchedMarketPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /scheduled boundary markets must exactly match enabled markets/
  );
});

test("replacement changes turnover window semantics only at the current window boundary", () => {
  const currentPolicy = runtimePolicy();
  const replacementPolicy = runtimePolicy({
    version: "v2",
    name: "Hourly turnover policy",
    turnoverDurationSeconds: 3_600
  });
  const current = createPortfolioPolicyActivatedEvent({
    policy: currentPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z"
  });
  const midWindowReplacement = createPortfolioPolicyActivatedEvent({
    policy: replacementPolicy,
    activationSequence: 2,
    supersedesActivationId: current.activationId,
    createdAt: "2026-08-28T12:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: currentPolicy.portfolioId,
        asOf: "2026-08-28T12:00:00.000Z",
        events: [current, midWindowReplacement],
        policies: [currentPolicy, replacementPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /turnover window semantics can change only at both window boundaries/
  );

  const boundaryReplacement = createPortfolioPolicyActivatedEvent({
    policy: replacementPolicy,
    activationSequence: 2,
    supersedesActivationId: current.activationId,
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: currentPolicy.portfolioId,
      asOf: "2026-08-29T00:00:00.000Z",
      events: [current, boundaryReplacement],
      policies: [currentPolicy, replacementPolicy],
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    boundaryReplacement.activationId
  );

  const hourlyCurrent = createPortfolioPolicyActivatedEvent({
    policy: replacementPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z"
  });
  const insideDailyReplacement = createPortfolioPolicyActivatedEvent({
    policy: currentPolicy,
    activationSequence: 2,
    supersedesActivationId: hourlyCurrent.activationId,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: currentPolicy.portfolioId,
        asOf: "2026-08-28T01:00:00.000Z",
        events: [hourlyCurrent, insideDailyReplacement],
        policies: [currentPolicy, replacementPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /turnover window semantics can change only at both window boundaries/
  );
});

test("post-retirement activation preserves the last turnover window boundary", () => {
  const dailyPolicy = runtimePolicy();
  const hourlyPolicy = runtimePolicy({
    version: "v2",
    name: "Hourly turnover policy",
    turnoverDurationSeconds: 3_600
  });
  const activated = createPortfolioPolicyActivatedEvent({
    policy: dailyPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z"
  });
  const retired = createPortfolioPolicyRetiredEvent({
    portfolioId: dailyPolicy.portfolioId,
    activationSequence: 2,
    retiredActivationId: activated.activationId,
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const midWindowReopen = createPortfolioPolicyActivatedEvent({
    policy: hourlyPolicy,
    activationSequence: 3,
    createdAt: "2026-08-28T12:00:00.000Z"
  });

  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: dailyPolicy.portfolioId,
        asOf: "2026-08-28T12:00:00.000Z",
        events: [activated, retired, midWindowReopen],
        policies: [dailyPolicy, hourlyPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /turnover window semantics can change only at both window boundaries/
  );

  const boundaryReopen = createPortfolioPolicyActivatedEvent({
    policy: hourlyPolicy,
    activationSequence: 3,
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: dailyPolicy.portfolioId,
      asOf: "2026-08-29T00:00:00.000Z",
      events: [activated, retired, boundaryReopen],
      policies: [dailyPolicy, hourlyPolicy],
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    boundaryReopen.activationId
  );
});

test("retirement event independently binds reason and target", () => {
  const policy = runtimePolicy();
  const activated = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const retired = createPortfolioPolicyRetiredEvent({
    portfolioId: policy.portfolioId,
    activationSequence: 2,
    retiredActivationId: activated.activationId,
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T02:00:00.000Z"
  });

  assert.equal(
    retired.retirementEventId,
    `portfolio_policy_retirement_${retired.activationEventHash.slice("sha256:".length)}`
  );
  assert.deepEqual(parsePortfolioPolicyActivationEvent(retired), retired);

  const reasonTamper = structuredClone(retired);
  reasonTamper.reasonCode = "different_reason";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(reasonTamper),
    /retirement event hash mismatch/
  );
});

function rehashActivatedEvent(
  event: PortfolioPolicyActivatedEvent,
  changes: Partial<
    Pick<
      PortfolioPolicyActivatedEvent,
      "effectiveFrom" | "policyLineageHash" | "portfolioId"
    >
  >
): PortfolioPolicyActivatedEvent {
  const {
    activationId: _activationId,
    activationEventHash: _activationEventHash,
    createdAt,
    ...originalPayload
  } = event;
  const payload = { ...originalPayload, ...changes };
  const activationEventHash = hashCanonicalPayload(payload);
  return {
    ...payload,
    activationId: hashDerivedId(
      "portfolio_policy_activation",
      activationEventHash
    ),
    activationEventHash,
    createdAt
  };
}

function dependencyFixture() {
  const selections = new Map(
    BUCKETS.map((bucket) => [
      bucket,
      createBucketSelectionPolicyRecord({
        bucket,
        version: `selection.${bucket}.v1`,
        requiredEvidence: [
          {
            evidenceClass: "market_technical",
            sourceContractId: "verified-market-packet.v1",
            maximumAgeSeconds: 60
          }
        ],
        ...(bucket === "intraday"
          ? {
              everyTickSourceRequirement: {
                sourceContractId: "verified-market-packet.v1",
                eventType: "verified_market_packet" as const,
                maximumAgeSeconds: 60,
                dedupeKey: "packet_hash" as const
              }
            }
          : {}),
        hardGateRuleIds: ["liquidity"],
        scoringModelVersion: `selector.${bucket}.v1`,
        featureDefinitionRefs: ["momentum.v1"],
        createdAt: POLICY_CREATED_AT
      })
    ])
  );
  const buy = createPortfolioRiskRuleParameterRecord({
    ruleId: "cash_reserve",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { minimumCashRatio: 0.15 },
    createdAt: POLICY_CREATED_AT
  });
  const sell = createPortfolioRiskRuleParameterRecord({
    ruleId: "reduce_only",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { allowIncrease: false },
    createdAt: POLICY_CREATED_AT
  });
  const riskSet = createPortfolioRiskRuleSetRecord({
    version: "risk-set.v1",
    rules: [
      {
        ruleId: "cash_reserve",
        ruleVersion: "v1",
        appliesTo: ["BUY"],
        parameterRef: riskRuleParameterRefFor(buy)
      },
      {
        ruleId: "reduce_only",
        ruleVersion: "v1",
        appliesTo: ["SELL"],
        parameterRef: riskRuleParameterRefFor(sell)
      }
    ],
    createdAt: POLICY_CREATED_AT
  });
  const drawdown = createBucketDrawdownSemanticsRecord({
    version: "unit-nav.v1",
    equityBasis: "bucket_assets_plus_cash",
    unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only",
    highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark",
    emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches",
    createdAt: POLICY_CREATED_AT
  });
  const calendar = createSessionCalendarRecord({
    market: "KR",
    version: "krx.v1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-08-28",
    validThroughExchangeDate: "2026-08-28",
    sessions: [
      {
        exchangeDate: "2026-08-28",
        sessionKind: "regular",
        opensAt: "2026-08-28T09:00:00+09:00",
        closesAt: "2026-08-28T15:30:00+09:00",
        sourceEvidenceRefs: ["official-calendar:krx:2026-08-28"]
      }
    ],
    createdAt: POLICY_CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR",
    version: "daily.v1",
    timeZone: "Asia/Seoul",
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily",
    anchorLocalTime: "15:30:00",
    nonSessionDayRule: "previous_session",
    createdAt: POLICY_CREATED_AT
  });
  const records: ImmutablePolicyDependencyRecords = {
    selectionPolicies: [...selections.values()],
    riskParameters: [buy, sell],
    riskRuleSets: [riskSet],
    drawdownSemantics: [drawdown],
    sessionCalendars: [calendar],
    scheduleBoundaries: [boundary]
  };
  return {
    selections,
    riskSet,
    drawdown,
    boundary,
    records,
    repository: new ImmutablePolicyDependencyRepository(records)
  };
}

function runtimePolicy(options: {
  portfolioId?: string;
  version?: string;
  name?: string;
  createdAt?: string;
  enabledMarkets?: readonly ("KR" | "US")[];
  turnoverDurationSeconds?: number;
} = {}): RuntimePortfolioPolicyRecord {
  const portfolioId = options.portfolioId ?? "paper-main";
  const version = options.version ?? "v1";
  const name = options.name ?? "Policy v1";
  const createdAt = options.createdAt ?? POLICY_CREATED_AT;
  const targets = new Map<StrategyBucket, [number, number, number]>([
    ["long_term", [0.35, 0.2, 0.5]],
    ["swing", [0.2, 0.1, 0.3]],
    ["short_term", [0.15, 0, 0.25]],
    ["intraday", [0.1, 0, 0.15]],
    ["hedge", [0.05, 0, 0.15]]
  ]);
  const strategyBuckets = BUCKETS.map((bucket) => {
    const [targetWeightRatio, minWeightRatio, maxWeightRatio] = targets.get(bucket)!;
    return {
      bucket,
      targetWeightRatio,
      minWeightRatio,
      maxWeightRatio,
      maxTurnoverRatio: 0.5,
      turnoverWindow: {
        mode: "fixed_utc" as const,
        durationSeconds: options.turnoverDurationSeconds ?? 86_400,
        anchor: "unix_epoch" as const,
        denominator: "window_open_portfolio_net_worth_krw" as const
      },
      maxDrawdownRatio: 0.1,
      drawdownSemanticsRef: drawdownSemanticsRefFor(
        DEPENDENCY_FIXTURE.drawdown
      ),
      reviewCadence:
        bucket === "intraday"
          ? ({ mode: "every_tick" as const })
          : ({
              mode: "scheduled" as const,
              boundaryRefs: [
                scheduleBoundaryRefFor(DEPENDENCY_FIXTURE.boundary)
              ]
            }),
      eventTriggers: [],
      selectionTrigger:
        minWeightRatio > 0
          ? ({ mode: "below_min" as const })
          : ({
              mode: "entry_floor_on_due_cycle" as const,
              entryWeightRatio: bucket === "short_term" ? 0.05 : 0.02
            }),
      minimumHoldingSeconds: 0,
      maximumHoldingSeconds: 86_400,
      exitPolicy: {
        takeProfit: { mode: "disabled" as const },
        timeExpiryAction: "review_required" as const
      },
      enabledMarkets: [...(options.enabledMarkets ?? ["KR" as const])],
      enabledAssetClasses: ["equity"],
      selectionPolicyRef: selectionPolicyRefFor(
        DEPENDENCY_FIXTURE.selections.get(bucket)!
      ),
      riskRuleSetRef: riskRuleSetRefFor(DEPENDENCY_FIXTURE.riskSet)
    };
  });
  const payload = {
    mode: "paper_only" as const,
    recordType: "runtime_portfolio_policy_record" as const,
    portfolioId,
    sourcePolicyRecordId: "paper_policy_source_fixture",
    sourcePolicyRecordHash: HASH_A,
    sourcePolicyHash: "c".repeat(64),
    policyId: "balanced-paper",
    version,
    name,
    strategyBuckets,
    cashPolicy: {
      targetCashRatio: 0.15,
      minimumCashReserveKrw: 100_000,
      ruleSource: "static" as const
    },
    hedgePolicy: {
      hedgeEnabled: true,
      hedgeTargetRatio: 0.05,
      maxCostRatio: 0.02
    },
    exposurePolicy: {
      maxSymbolExposureRatio: 0.2,
      maxCountryExposureRatio: 0.8,
      maxCurrencyExposureRatio: 0.8
    },
    legacyReduceOnlyPolicy: {
      allowBuyOrIncrease: false as const,
      maximumParticipationRatio: 0.1,
      riskRuleSetRef: riskRuleSetRefFor(DEPENDENCY_FIXTURE.riskSet)
    }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId(
    "runtime_portfolio_policy",
    policyHash
  );
  return parseRuntimePortfolioPolicyRecord({
    ...payload,
    runtimePolicyRecordId,
    policyHash,
    lineageHash: hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: runtimePolicyRecordId,
      semanticHash: policyHash,
      createdAt
    }),
    createdAt
  });
}
