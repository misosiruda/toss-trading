import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePortfolioGaps,
  type PortfolioGapAnalysisInput
} from "./portfolioGapAnalyzer.js";
import {
  hashCanonicalPayload,
  hashDerivedId,
  hashImmutableRecordLineage,
  type StrategyBucket,
  type StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";
import type { RuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";

const CREATED_AT = "2026-09-02T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}` as const;
const BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;

test("below-min gaps create capacity without chasing target inside the band", () => {
  const analysis = analyzePortfolioGaps(
    input({
      bucketExposureKrw: {
        long_term: 100_000,
        swing: 150_000,
        short_term: 50_000,
        intraday: 20_000,
        hedge: 20_000
      }
    })
  );

  const longTerm = gap(analysis, "long_term");
  assert.equal(longTerm.underweightKrw, 100_000);
  assert.equal(longTerm.targetGapKrw, 250_000);
  assert.equal(longTerm.selectionTriggerSatisfied, true);
  assert.equal(longTerm.gapBasis, "min");
  assert.equal(longTerm.gapKrw, 100_000);
  assert.equal(longTerm.maximumAdditionalExposureKrw, 100_000);
  assert.equal(longTerm.requestEligible, true);

  const swing = gap(analysis, "swing");
  assert.equal(swing.targetGapKrw, 50_000);
  assert.equal(swing.underweightKrw, 0);
  assert.equal(swing.selectionTriggerSatisfied, false);
  assert.equal(swing.maximumAdditionalExposureKrw, 0);
  assert.deepEqual(swing.blockingReasons, ["trigger_not_satisfied"]);
});

test("overweight buckets never become candidate requests", () => {
  const analysis = analyzePortfolioGaps(
    input({
      bucketExposureKrw: {
        long_term: 510_000,
        swing: 100_000,
        short_term: 50_000,
        intraday: 20_000,
        hedge: 20_000
      }
    })
  );

  const longTerm = gap(analysis, "long_term");
  assert.equal(longTerm.overweightKrw, 10_000);
  assert.equal(longTerm.selectionTriggerSatisfied, false);
  assert.equal(longTerm.maximumAdditionalExposureKrw, 0);
  assert.equal(longTerm.requestEligible, false);
  assert.deepEqual(longTerm.blockingReasons, [
    "trigger_not_satisfied",
    "overweight"
  ]);
});

test("entry-floor buckets require a due cycle and stop at the floor", () => {
  const notDue = analyzePortfolioGaps(input());
  const shortTermNotDue = gap(notDue, "short_term");
  assert.equal(shortTermNotDue.entryWeightKrw, 50_000);
  assert.equal(shortTermNotDue.entryGapKrw, 50_000);
  assert.equal(shortTermNotDue.selectionTriggerSatisfied, false);

  const due = analyzePortfolioGaps(input({ dueBuckets: ["short_term"] }));
  const shortTermDue = gap(due, "short_term");
  assert.equal(shortTermDue.selectionTriggerSatisfied, true);
  assert.equal(shortTermDue.gapBasis, "entry_floor");
  assert.equal(shortTermDue.gapKrw, 50_000);
  assert.equal(shortTermDue.requestEligible, true);

  const floorReached = analyzePortfolioGaps(
    input({
      dueBuckets: ["short_term"],
      bucketExposureKrw: {
        long_term: 200_000,
        swing: 100_000,
        short_term: 50_000,
        intraday: 20_000,
        hedge: 20_000
      }
    })
  );
  const shortTermAtFloor = gap(floorReached, "short_term");
  assert.equal(shortTermAtFloor.targetGapKrw, 100_000);
  assert.equal(shortTermAtFloor.entryGapKrw, 0);
  assert.equal(shortTermAtFloor.selectionTriggerSatisfied, false);
  assert.equal(shortTermAtFloor.requestEligible, false);
});

test("cash reserve shortfall and occupied slots fail closed", () => {
  const cashBlocked = analyzePortfolioGaps(
    input({
      cashKrw: 140_000,
      pendingBuyExposureKrw: 10_000,
      bucketExposureKrw: {
        long_term: 100_000,
        swing: 100_000,
        short_term: 50_000,
        intraday: 20_000,
        hedge: 20_000
      }
    })
  );
  assert.equal(cashBlocked.minimumCashReserveKrw, 150_000);
  assert.equal(cashBlocked.cashOpeningCapacityKrw, 0);
  assert.equal(
    cashBlocked.bucketGaps.every(
      ({ maximumAdditionalExposureKrw }) => maximumAdditionalExposureKrw === 0
    ),
    true
  );
  assert.deepEqual(gap(cashBlocked, "long_term").blockingReasons, [
    "cash_opening_capacity_exhausted"
  ]);

  const slotsBlocked = analyzePortfolioGaps(
    input({
      longTermCapacity: {
        maximumPositionCount: 3,
        activePositionCount: 1,
        pendingReservationCount: 1,
        mandateBoundUnusedSlotCount: 1
      },
      bucketExposureKrw: {
        long_term: 100_000,
        swing: 100_000,
        short_term: 50_000,
        intraday: 20_000,
        hedge: 20_000
      }
    })
  );
  const longTerm = gap(slotsBlocked, "long_term");
  assert.equal(longTerm.availableSlots, 0);
  assert.equal(longTerm.selectionTriggerSatisfied, true);
  assert.equal(longTerm.maximumAdditionalExposureKrw, 0);
  assert.equal(longTerm.requestEligible, false);
  assert.deepEqual(longTerm.blockingReasons, ["no_available_slot"]);
});

test("analyzer rejects stale scope and noncanonical complete bucket inputs", () => {
  const valid = input();
  assert.throws(
    () =>
      analyzePortfolioGaps({
        ...valid,
        exposure: { ...valid.exposure, portfolioId: "other" }
      }),
    /scope does not match/
  );
  assert.throws(
    () =>
      analyzePortfolioGaps({
        ...valid,
        exposure: {
          ...valid.exposure,
          bucketExposures: [...valid.exposure.bucketExposures].reverse()
        }
      }),
    /canonical bucket order/
  );
  assert.throws(
    () => analyzePortfolioGaps({ ...valid, dueBuckets: ["hedge", "swing"] }),
    /canonical bucket order/
  );
  assert.equal(Object.isFrozen(analyzePortfolioGaps(valid).bucketGaps), true);
});

test("analyzer rejects negative-zero opening capacity counts", () => {
  for (const field of [
    "activePositionCount",
    "pendingReservationCount",
    "mandateBoundUnusedSlotCount"
  ] as const) {
    const valid = input();
    assert.throws(
      () =>
        analyzePortfolioGaps({
          ...valid,
          exposure: {
            ...valid.exposure,
            bucketOpeningCapacities:
              valid.exposure.bucketOpeningCapacities.map((capacity, index) =>
                index === 0 ? { ...capacity, [field]: -0 } : capacity
              )
          }
        }),
      /count must not be negative zero/
    );
  }
});

function input(
  overrides: {
    cashKrw?: number;
    pendingBuyExposureKrw?: number;
    dueBuckets?: StrategyBucket[];
    bucketExposureKrw?: Record<StrategyBucket, number>;
    longTermCapacity?: {
      maximumPositionCount: number;
      activePositionCount: number;
      pendingReservationCount: number;
      mandateBoundUnusedSlotCount: number;
    };
  } = {}
): PortfolioGapAnalysisInput {
  const policy = runtimePolicy();
  const bucketExposureKrw = overrides.bucketExposureKrw ?? {
    long_term: 200_000,
    swing: 100_000,
    short_term: 0,
    intraday: 0,
    hedge: 0
  };
  return {
    policy,
    exposure: {
      portfolioId: policy.portfolioId,
      policyHash: policy.policyHash,
      virtualNetWorthKrw: 1_000_000,
      cashKrw: overrides.cashKrw ?? 500_000,
      pendingBuyExposureKrw: overrides.pendingBuyExposureKrw ?? 0,
      bucketExposures: BUCKETS.map((bucket) => ({
        bucket,
        exposureKrw: bucketExposureKrw[bucket]
      })),
      bucketOpeningCapacities: BUCKETS.map((bucket) => ({
        bucket,
        ...(bucket === "long_term" && overrides.longTermCapacity !== undefined
          ? overrides.longTermCapacity
          : {
              maximumPositionCount: 4,
              activePositionCount: 0,
              pendingReservationCount: 0,
              mandateBoundUnusedSlotCount: 0
            })
      }))
    },
    dueBuckets: overrides.dueBuckets ?? []
  };
}

function gap(
  analysis: ReturnType<typeof analyzePortfolioGaps>,
  bucket: StrategyBucket
) {
  return analysis.bucketGaps.find((item) => item.bucket === bucket)!;
}

function runtimePolicy(): RuntimePortfolioPolicyRecord {
  const payload = {
    mode: "paper_only" as const,
    recordType: "runtime_portfolio_policy_record" as const,
    portfolioId: "portfolio-1",
    sourcePolicyRecordId: "source-policy-1",
    sourcePolicyRecordHash: HASH,
    sourcePolicyHash: "b".repeat(64),
    policyId: "balanced-paper",
    version: "v1",
    name: "Balanced paper policy",
    strategyBuckets: BUCKETS.map(bucketPolicy),
    cashPolicy: {
      targetCashRatio: 0.15,
      minimumCashReserveKrw: 100_000,
      ruleSource: "static" as const
    },
    hedgePolicy: {
      hedgeEnabled: true,
      hedgeTargetRatio: 0.05,
      maxCostRatio: 0.01
    },
    exposurePolicy: {
      maxSymbolExposureRatio: 0.1,
      maxCountryExposureRatio: 0.8,
      maxCurrencyExposureRatio: 0.8
    },
    legacyReduceOnlyPolicy: {
      allowBuyOrIncrease: false as const,
      maximumParticipationRatio: 0.1,
      riskRuleSetRef: dependencyRef("legacy-risk", "riskRuleSetRecordId")
    }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId(
    "runtime_portfolio_policy",
    policyHash
  );
  return {
    ...payload,
    runtimePolicyRecordId,
    policyHash,
    lineageHash: hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: runtimePolicyRecordId,
      semanticHash: policyHash,
      createdAt: CREATED_AT
    }),
    createdAt: CREATED_AT
  };
}

function bucketPolicy(bucket: StrategyBucket): StrategyBucketRuntimePolicy {
  const weights = {
    long_term: [0.35, 0.2, 0.5, "below_min", 0] as const,
    swing: [0.2, 0.1, 0.3, "below_min", 0] as const,
    short_term: [0.15, 0, 0.25, "entry_floor_on_due_cycle", 0.05] as const,
    intraday: [0.1, 0, 0.15, "entry_floor_on_due_cycle", 0.02] as const,
    hedge: [0.05, 0, 0.15, "entry_floor_on_due_cycle", 0.02] as const
  }[bucket];
  const [targetWeightRatio, minWeightRatio, maxWeightRatio, mode, entry] =
    weights;
  return {
    bucket,
    targetWeightRatio,
    minWeightRatio,
    maxWeightRatio,
    maxTurnoverRatio: bucket === "long_term" ? 0.15 : 0.5,
    turnoverWindow: {
      mode: "fixed_utc" as const,
      durationSeconds: 86_400,
      anchor: "unix_epoch" as const,
      denominator: "window_open_portfolio_net_worth_krw" as const
    },
    maxDrawdownRatio: 0.1,
    drawdownSemanticsRef: dependencyRef(
      `${bucket}-drawdown`,
      "drawdownSemanticsRecordId"
    ),
    reviewCadence:
      bucket === "intraday"
        ? { mode: "every_tick" }
        : {
            mode: "scheduled",
            boundaryRefs: [
              {
                scheduleBoundaryRecordId: `${bucket}-boundary`,
                version: "v1",
                hash: HASH,
                lineageHash: HASH
              }
            ]
          },
    eventTriggers: [],
    selectionTrigger:
      mode === "below_min"
        ? ({ mode } as const)
        : ({ mode, entryWeightRatio: entry } as const),
    exitPolicy: {
      takeProfit: { mode: "disabled" as const },
      timeExpiryAction: "review_required" as const
    },
    enabledMarkets: ["KR", "US"],
    enabledAssetClasses: ["equity"],
    selectionPolicyRef: dependencyRef(
      `${bucket}-selection`,
      "selectionPolicyRecordId"
    ),
    riskRuleSetRef: dependencyRef(`${bucket}-risk`, "riskRuleSetRecordId")
  };
}

function dependencyRef(
  id: string,
  idKey:
    | "selectionPolicyRecordId"
    | "riskRuleSetRecordId"
    | "drawdownSemanticsRecordId"
) {
  return {
    [idKey]: id,
    version: "v1",
    hash: HASH,
    lineageHash: HASH
  } as Record<typeof idKey, string> & {
    version: string;
    hash: typeof HASH;
    lineageHash: typeof HASH;
  };
}
