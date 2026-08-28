import assert from "node:assert/strict";
import test from "node:test";

import { validatePaperPolicyCandidate } from "../api/paperPolicyValidation.js";

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
  riskRuleParameterRefFor,
  riskRuleSetRefFor,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords,
  type StrategyBucket
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import {
  normalizeRuntimePortfolioPolicy,
  parseRuntimePortfolioPolicyRecord,
  type RuntimeBucketNormalizationInput
} from "./runtimePortfolioPolicy.js";

const CREATED_AT = "2026-08-28T00:00:00.000Z";
const BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;

test("normalizer produces canonical immutable runtime policy with full hash", () => {
  const fixture = dependencyFixture();
  const candidate = policyCandidate();
  candidate.strategyBuckets.reverse();
  candidate.strategyBuckets[0]!.enabledAssetClasses = [" etf ", "equity"];
  const record = normalizeRuntimePortfolioPolicy(
    {
      portfolioId: "paper-main",
      sourcePolicyRecord: sourcePolicyRecord(candidate),
      bucketInputs: runtimeBucketInputs(fixture).reverse(),
      legacyReduceOnlyPolicy: {
        allowBuyOrIncrease: false,
        maximumParticipationRatio: 0.1,
        riskRuleSetRef: riskRuleSetRefFor(fixture.riskSet)
      },
      createdAt: CREATED_AT
    },
    fixture.repository
  );

  assert.deepEqual(record.strategyBuckets.map(({ bucket }) => bucket), BUCKETS);
  assert.deepEqual(record.strategyBuckets[4]!.enabledAssetClasses, [
    "equity",
    "etf"
  ]);
  assert.match(record.policyHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    record.runtimePolicyRecordId,
    `runtime_portfolio_policy_${record.policyHash.slice("sha256:".length)}`
  );
  assert.equal(record.sourcePolicyHash.length, 64);
  assert.equal(Object.isFrozen(record.strategyBuckets[0]), true);
  assert.deepEqual(parseRuntimePortfolioPolicyRecord(record), record);
});

test("normalizer rejects invalid source candidate before creating runtime policy", () => {
  const fixture = dependencyFixture();
  const candidate = policyCandidate();
  candidate.cashPolicy.targetCashRatio = 0.5;

  assert.throws(
    () =>
      normalizeRuntimePortfolioPolicy(
        normalizationInput(candidate, fixture),
        fixture.repository
      ),
    /source policy candidate must pass paper validation/
  );
});

test("normalizer binds source record tuple and hash to its candidate", () => {
  const fixture = dependencyFixture();
  const candidate = policyCandidate();
  const input = normalizationInput(candidate, fixture);

  assert.throws(
    () =>
      normalizeRuntimePortfolioPolicy(
        {
          ...input,
          sourcePolicyRecord: {
            ...sourcePolicyRecord(candidate),
            policyHash: "0".repeat(64)
          }
        },
        fixture.repository
      ),
    /source policy record lineage does not match its candidate/
  );
});

test("normalizer rejects missing and duplicate bucket configuration", () => {
  const fixture = dependencyFixture();
  const candidate = policyCandidate();
  const inputs = runtimeBucketInputs(fixture);
  assert.throws(
    () =>
      normalizeRuntimePortfolioPolicy(
        {
          ...normalizationInput(candidate, fixture),
          bucketInputs: inputs.slice(0, 4)
        },
        fixture.repository
      ),
    /configuration count must match source buckets/
  );
  assert.throws(
    () =>
      normalizeRuntimePortfolioPolicy(
        {
          ...normalizationInput(candidate, fixture),
          bucketInputs: [...inputs.slice(0, 4), inputs[0]!]
        },
        fixture.repository
      ),
    /configuration must resolve exactly once/
  );
});

test("normalizer resolves bucket dependencies and parser rejects policy tamper", () => {
  const fixture = dependencyFixture();
  const inputs = runtimeBucketInputs(fixture);
  const swing = inputs.find(
    ({ configuration }) => configuration.bucket === "swing"
  )!;
  assert.throws(
    () =>
      normalizeRuntimePortfolioPolicy(
        {
          ...normalizationInput(policyCandidate(), fixture),
          bucketInputs: inputs.map((input) =>
            input === swing
              ? {
                  ...input,
                  configuration: {
                    ...input.configuration,
                    selectionPolicyRef: selectionPolicyRefFor(
                      fixture.selections.get("long_term")!
                    )
                  }
                }
              : input
          )
        },
        fixture.repository
      ),
    /selection policy bucket does not match runtime policy bucket/
  );

  const record = normalizeRuntimePortfolioPolicy(
    normalizationInput(policyCandidate(), fixture),
    fixture.repository
  );
  assert.throws(
    () =>
      parseRuntimePortfolioPolicyRecord({
        ...record,
        name: "Tampered policy name"
      }),
    /runtime portfolio policy hash mismatch/
  );

  const semanticallyInvalid = {
    ...record,
    strategyBuckets: record.strategyBuckets.map((bucket) =>
      bucket.bucket === "short_term"
        ? { ...bucket, selectionTrigger: { mode: "below_min" as const } }
        : bucket
    )
  };
  const {
    runtimePolicyRecordId: _recordId,
    policyHash: _policyHash,
    createdAt: _createdAt,
    ...invalidPayload
  } = semanticallyInvalid;
  const invalidHash = hashCanonicalPayload(invalidPayload);
  assert.throws(
    () =>
      parseRuntimePortfolioPolicyRecord({
        ...semanticallyInvalid,
        policyHash: invalidHash,
        runtimePolicyRecordId: hashDerivedId(
          "runtime_portfolio_policy",
          invalidHash
        )
      }),
    /must use entry_floor_on_due_cycle/
  );

  const allocationInvalid = {
    ...record,
    cashPolicy: { ...record.cashPolicy, targetCashRatio: 0.2 }
  };
  const {
    runtimePolicyRecordId: _allocationId,
    policyHash: _allocationHash,
    createdAt: _allocationCreatedAt,
    ...allocationPayload
  } = allocationInvalid;
  const allocationHash = hashCanonicalPayload(allocationPayload);
  assert.throws(
    () =>
      parseRuntimePortfolioPolicyRecord({
        ...allocationInvalid,
        policyHash: allocationHash,
        runtimePolicyRecordId: hashDerivedId(
          "runtime_portfolio_policy",
          allocationHash
        )
      }),
    /violates portfolio-wide invariants/
  );
});

test("normalizer resolves every legacy risk rule parameter", () => {
  const fixture = dependencyFixture();
  const missingParameter = createPortfolioRiskRuleParameterRecord({
    ruleId: "legacy_cash_guard",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { minimumCashRatio: 0.15 },
    createdAt: CREATED_AT
  });
  const legacyRiskSet = createPortfolioRiskRuleSetRecord({
    version: "legacy-risk-set.v1",
    rules: [
      {
        ruleId: "legacy_cash_guard",
        ruleVersion: "v1",
        appliesTo: ["BUY"],
        parameterRef: riskRuleParameterRefFor(missingParameter)
      },
      {
        ruleId: "reduce_only",
        ruleVersion: "v1",
        appliesTo: ["SELL"],
        parameterRef: riskRuleParameterRefFor(fixture.sell)
      }
    ],
    createdAt: CREATED_AT
  });
  const repository = new ImmutablePolicyDependencyRepository({
    ...fixture.records,
    riskRuleSets: [...fixture.records.riskRuleSets, legacyRiskSet]
  });

  assert.throws(
    () =>
      normalizeRuntimePortfolioPolicy(
        {
          ...normalizationInput(policyCandidate(), fixture),
          legacyReduceOnlyPolicy: {
            allowBuyOrIncrease: false,
            maximumParticipationRatio: 0.1,
            riskRuleSetRef: riskRuleSetRefFor(legacyRiskSet)
          }
        },
        repository
      ),
    /risk parameter ref does not resolve/
  );
});

function normalizationInput(
  candidate: ReturnType<typeof policyCandidate>,
  fixture: ReturnType<typeof dependencyFixture>
) {
  return {
    portfolioId: "paper-main",
    sourcePolicyRecord: sourcePolicyRecord(candidate),
    bucketInputs: runtimeBucketInputs(fixture),
    legacyReduceOnlyPolicy: {
      allowBuyOrIncrease: false as const,
      maximumParticipationRatio: 0.1,
      riskRuleSetRef: riskRuleSetRefFor(fixture.riskSet)
    },
    createdAt: CREATED_AT
  };
}

function sourcePolicyRecord(candidate: ReturnType<typeof policyCandidate>) {
  const validation = validatePaperPolicyCandidate(candidate, new Date(CREATED_AT));
  return {
    mode: "paper_only" as const,
    recordType: "portfolio_policy_record" as const,
    policyRecordId: "portfolio_policy_source",
    policyId: candidate.policyId,
    version: candidate.version,
    name: candidate.name,
    policyHash: validation.policyHash,
    status: "stored" as const,
    createdAt: CREATED_AT,
    validationStatus: "valid" as const,
    candidate,
    validation: {
      validatedAt: validation.validatedAt,
      issueCount: 0 as const,
      summary: validation.summary
    },
    safety: {
      storageMutationEnabled: true as const,
      liveTradingEnabled: false as const,
      orderPlacementEnabled: false as const,
      replayRunnerStarted: false as const
    }
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
        createdAt: CREATED_AT
      })
    ])
  );
  const buy = createPortfolioRiskRuleParameterRecord({
    ruleId: "cash_reserve",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { minimumCashRatio: 0.15 },
    createdAt: CREATED_AT
  });
  const sell = createPortfolioRiskRuleParameterRecord({
    ruleId: "reduce_only",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { allowIncrease: false },
    createdAt: CREATED_AT
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
    createdAt: CREATED_AT
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
    createdAt: CREATED_AT
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
    createdAt: CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR",
    version: "daily.v1",
    timeZone: "Asia/Seoul",
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    interval: "daily",
    anchorLocalTime: "15:30:00",
    nonSessionDayRule: "previous_session",
    createdAt: CREATED_AT
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
    sell,
    records,
    repository: new ImmutablePolicyDependencyRepository(records)
  };
}

function runtimeBucketInputs(
  fixture: ReturnType<typeof dependencyFixture>
): RuntimeBucketNormalizationInput[] {
  return BUCKETS.map((bucket) => ({
    configuration: {
      bucket,
      turnoverWindow: {
        mode: "fixed_utc",
        durationSeconds: 86_400,
        anchor: "unix_epoch",
        denominator: "window_open_portfolio_net_worth_krw"
      },
      drawdownSemanticsRef: drawdownSemanticsRefFor(fixture.drawdown),
      reviewCadence:
        bucket === "intraday"
          ? { mode: "every_tick" }
          : ({
              mode: "scheduled",
              boundaryRefs: [scheduleBoundaryRefFor(fixture.boundary)]
            }),
      eventTriggers: ["regime_change"],
      selectionTrigger:
        bucket === "long_term" || bucket === "swing"
          ? { mode: "below_min" }
          : ({
              mode: "entry_floor_on_due_cycle",
              entryWeightRatio: bucket === "short_term" ? 0.05 : 0.02
            }),
      minimumHoldingSeconds: 0,
      maximumHoldingSeconds: 86_400,
      exitPolicy: {
        takeProfit: { mode: "disabled" },
        timeExpiryAction: "review_required"
      },
      enabledMarkets: ["KR"],
      selectionPolicyRef: selectionPolicyRefFor(
        fixture.selections.get(bucket)!
      ),
      riskRuleSetRef: riskRuleSetRefFor(fixture.riskSet)
    },
    ...(bucket === "intraday"
      ? {}
      : {
          requiredCalendarDates: [
            { market: "KR" as const, exchangeDate: "2026-08-28" }
          ]
        })
  }));
}

function policyCandidate() {
  return {
    mode: "paper_only" as const,
    policyId: "balanced-paper",
    version: "v1",
    name: "Balanced paper policy",
    strategyBuckets: [
      bucket("long_term", 0.35, 0.2, 0.5, 0.15, 0.18, "multi_month"),
      bucket("swing", 0.2, 0.1, 0.3, 0.35, 0.12, "multi_week"),
      bucket("short_term", 0.15, 0, 0.25, 0.5, 0.08, "multi_day"),
      bucket("intraday", 0.1, 0, 0.15, 1, 0.04, "intraday"),
      bucket("hedge", 0.05, 0, 0.15, 0.4, 0.06, "hedge")
    ],
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
    executionBoundary: {
      liveTradingEnabled: false as const,
      orderPlacementEnabled: false as const,
      backendValidationRequired: true as const
    }
  };
}

function bucket(
  bucketName: StrategyBucket,
  targetWeightRatio: number,
  minWeightRatio: number,
  maxWeightRatio: number,
  maxTurnoverRatio: number,
  maxDrawdownRatio: number,
  holdingPeriodHint:
    | "multi_month"
    | "multi_week"
    | "multi_day"
    | "intraday"
    | "hedge"
) {
  return {
    bucket: bucketName,
    targetWeightRatio,
    minWeightRatio,
    maxWeightRatio,
    maxTurnoverRatio,
    maxDrawdownRatio,
    holdingPeriodHint,
    enabledAssetClasses: ["equity"]
  };
}
