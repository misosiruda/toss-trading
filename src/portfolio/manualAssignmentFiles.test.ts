import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInvestmentMandateRecord,
  createManualAssignmentEvent,
  type ManualAssignmentEvent
} from "./investmentMandate.js";
import {
  createManualAssignmentPaths,
  ManualAssignmentFileRepository
} from "./manualAssignmentFiles.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import {
  createBucketSelectionPolicyRecord,
  hashCanonicalPayload,
  hashDerivedId,
  hashImmutableRecordLineage,
  selectionPolicyRefFor,
  type BucketSelectionPolicyRecord,
  type StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;
const HASH_D = `sha256:${"d".repeat(64)}` as const;
const HASH_E = `sha256:${"e".repeat(64)}` as const;
const CREATED_AT = "2026-09-01T01:00:00.000Z";
const BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;

test("manual assignment repository converges exact retries and rejects ID collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const left = new ManualAssignmentFileRepository(baseDir);
    const right = new ManualAssignmentFileRepository(baseDir);
    const event = classifyEvent();
    const [leftEvent, rightEvent] = await Promise.all([
      left.append(event),
      right.append(event)
    ]);
    assert.deepEqual(rightEvent, leftEvent);
    assert.deepEqual(await left.resolveById(event.manualAssignmentEventId), event);

    await assert.rejects(
      () =>
        left.append({
          ...event,
          createdAt: "2026-09-01T01:01:00.000Z"
        }),
      /event ID collision/
    );
    const raw = await readFile(
      createManualAssignmentPaths(baseDir).eventsPath,
      "utf8"
    );
    assert.equal(nonblankLineCount(raw), 1);
  });
});

test("manual assignment repository resolves exact active policy and selection lineage", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const selection = selectionPolicy();
    const policy = runtimePolicy(selection);
    const event = classifyEvent({
      policyHash: policy.policyHash,
      selectionPolicyRecordId: selection.selectionPolicyRecordId,
      selectionPolicyHash: selection.hash
    });
    const repository = new ManualAssignmentFileRepository(baseDir);
    await repository.append(event);

    const resolved = await repository.resolvePolicyBinding({
      manualAssignmentEventId: event.manualAssignmentEventId,
      activePolicy: policy,
      selectionPolicy: selection
    });
    assert.equal(resolved.bucketPolicy.bucket, "intraday");
    assert.equal(
      resolved.selectionPolicy.selectionPolicyRecordId,
      event.selectionPolicyRecordId
    );

    const foreignSelection = selectionPolicy("selection.intraday.v2");
    await assert.rejects(
      () =>
        repository.resolvePolicyBinding({
          manualAssignmentEventId: event.manualAssignmentEventId,
          activePolicy: policy,
          selectionPolicy: foreignSelection
        }),
      /selection policy lineage does not match/
    );
    await assert.rejects(
      () =>
        repository.resolvePolicyBinding({
          manualAssignmentEventId: event.manualAssignmentEventId,
          activePolicy: runtimePolicy(selection, ["US"]),
          selectionPolicy: selection
        }),
      /does not match the active policy|market is disabled/
    );
  });
});

test("manual assignment repository binds stored classification and opening ranges", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new ManualAssignmentFileRepository(baseDir);
    const classified = classifyEvent();
    await repository.append(classified);
    const classifyMandate = classificationMandate(classified);
    assert.equal(
      (await repository.resolveMandateBinding(classifyMandate)).event
        .manualAssignmentEventId,
      classified.manualAssignmentEventId
    );
    await assert.rejects(
      () =>
        repository.resolveMandateBinding(classificationMandate(classified, 0.25)),
      /classification range does not match/
    );

    const opened = openEvent();
    await repository.append(opened);
    const openMandate = openingMandate(opened, 700_000);
    assert.equal(
      (await repository.resolveMandateBinding(openMandate)).mandate
        .maximumOpeningNotionalKrw,
      700_000
    );
    assert.throws(
      () => openingMandate(opened, 0),
      /cap and reservation must be positive/
    );
  });
});

test("manual assignment repository fails closed for torn, corrupt, blank, and duplicate lines", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new ManualAssignmentFileRepository(baseDir);
    const event = classifyEvent();
    await repository.append(event);
    const path = createManualAssignmentPaths(baseDir).eventsPath;
    const valid = await readFile(path, "utf8");

    await appendFile(path, "{broken}\n", "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(path, valid.trimEnd(), "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(path, `${valid}\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(path, `${valid}${valid}`, "utf8");
    await assert.rejects(() => repository.readAll(), /duplicate ID/);
  });
});

test("manual assignment repository leaves an abandoned lock fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createManualAssignmentPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new ManualAssignmentFileRepository(baseDir, {
      lockTimeoutMs: 20,
      lockRetryDelayMs: 500
    });

    const startedAt = Date.now();
    await assert.rejects(
      () => repository.readAll(),
      /repository lock is unavailable/
    );
    assert.ok(Date.now() - startedAt < 250);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function classifyEvent(
  overrides: {
    policyHash?: string;
    selectionPolicyRecordId?: string;
    selectionPolicyHash?: string;
  } = {}
): Extract<
  ManualAssignmentEvent,
  { authorizationScope: "classify_existing_reduce_only" }
> {
  return createManualAssignmentEvent({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    market: "KR",
    symbol: "005930",
    bucket: "intraday",
    asOf: "2026-09-01T00:30:00.000Z",
    selectionPolicyRecordId: "selection-policy-1",
    selectionPolicyHash: HASH_B,
    reasonCodes: ["manual-classification"],
    evidenceRefs: ["evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    evidenceValidationHash: HASH_C,
    authorizationRef: "authorization-1",
    authorizationScope: "classify_existing_reduce_only",
    evidenceEligibility: "blocked",
    classificationMinWeightRatio: 0.1,
    classificationTargetWeightRatio: 0.2,
    classificationMaxWeightRatio: 0.3,
    createdAt: CREATED_AT,
    ...overrides
  }) as Extract<
    ManualAssignmentEvent,
    { authorizationScope: "classify_existing_reduce_only" }
  >;
}

function openEvent(): Extract<
  ManualAssignmentEvent,
  { authorizationScope: "open_or_increase" }
> {
  return createManualAssignmentEvent({
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    market: "KR",
    symbol: "000660",
    bucket: "intraday",
    asOf: "2026-09-01T00:30:00.000Z",
    selectionPolicyRecordId: "selection-policy-1",
    selectionPolicyHash: HASH_B,
    reasonCodes: ["manual-opening"],
    evidenceRefs: ["evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    evidenceValidationHash: HASH_C,
    authorizationRef: "authorization-2",
    authorizationScope: "open_or_increase",
    evidenceEligibility: "eligible",
    portfolioSnapshotId: "portfolio-snapshot-1",
    portfolioSnapshotHash: HASH_D,
    sizingInputRecordId: "sizing-input-1",
    minWeightRatio: 0,
    targetWeightRatio: 0.1,
    maxWeightRatio: 0.2,
    maximumNotionalKrw: 1_000_000,
    sizingInputHash: HASH_D,
    sizingOutputHash: HASH_E,
    createdAt: CREATED_AT
  }) as Extract<
    ManualAssignmentEvent,
    { authorizationScope: "open_or_increase" }
  >;
}

function classificationMandate(
  event: Extract<
    ManualAssignmentEvent,
    { authorizationScope: "classify_existing_reduce_only" }
  >,
  targetWeightRatio = event.classificationTargetWeightRatio
) {
  return createInvestmentMandateRecord({
    portfolioId: event.portfolioId,
    market: event.market,
    symbol: event.symbol,
    bucket: event.bucket,
    policyHash: event.policyHash,
    asOf: event.asOf,
    targetWeightRatio,
    minWeightRatio: event.classificationMinWeightRatio,
    maxWeightRatio: event.classificationMaxWeightRatio,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: event.reasonCodes,
    evidenceRefs: event.evidenceRefs,
    evidenceAsOf: event.evidenceAsOf,
    reviewCadence: { mode: "every_tick" },
    validFrom: event.asOf,
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: event.manualAssignmentEventId,
    createdAt: CREATED_AT
  });
}

function openingMandate(
  event: Extract<
    ManualAssignmentEvent,
    { authorizationScope: "open_or_increase" }
  >,
  reservedMaximumNotionalKrw: number
) {
  return createInvestmentMandateRecord({
    portfolioId: event.portfolioId,
    market: event.market,
    symbol: event.symbol,
    bucket: event.bucket,
    policyHash: event.policyHash,
    asOf: event.asOf,
    targetWeightRatio: event.targetWeightRatio,
    minWeightRatio: event.minWeightRatio,
    maxWeightRatio: event.maxWeightRatio,
    maximumOpeningNotionalKrw: reservedMaximumNotionalKrw,
    reasonCodes: event.reasonCodes,
    evidenceRefs: event.evidenceRefs,
    evidenceAsOf: event.evidenceAsOf,
    reviewCadence: { mode: "every_tick" },
    validFrom: event.asOf,
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "open_or_increase",
    manualAssignmentEventId: event.manualAssignmentEventId,
    capacityReservation: {
      manualCapacityReservationId: "manual-reservation-1",
      manualCapacityReservationHash: HASH_E,
      reservedMaximumNotionalKrw,
      reservationKind: "new_position",
      reservedSlotOrdinal: 0
    },
    createdAt: CREATED_AT
  });
}

function selectionPolicy(
  version = "selection.intraday.v1"
): BucketSelectionPolicyRecord {
  return createBucketSelectionPolicyRecord({
    bucket: "intraday",
    version,
    requiredEvidence: [
      {
        evidenceClass: "market_technical",
        sourceContractId: "verified-market-packet.v1",
        maximumAgeSeconds: 60
      }
    ],
    everyTickSourceRequirement: {
      sourceContractId: "verified-market-packet.v1",
      eventType: "verified_market_packet",
      maximumAgeSeconds: 60,
      dedupeKey: "packet_hash"
    },
    hardGateRuleIds: ["liquidity"],
    scoringModelVersion: "selector.intraday.v1",
    featureDefinitionRefs: ["momentum.v1"],
    createdAt: "2026-09-01T00:00:00.000Z"
  });
}

function runtimePolicy(
  selection: BucketSelectionPolicyRecord,
  enabledMarkets: readonly ("KR" | "US")[] = ["KR"]
) {
  const fakeRef = {
    version: "v1",
    hash: HASH_A,
    lineageHash: HASH_B
  };
  const targets = new Map<
    (typeof BUCKETS)[number],
    [number, number, number]
  >([
    ["long_term", [0.35, 0.2, 0.5]],
    ["swing", [0.2, 0.1, 0.3]],
    ["short_term", [0.15, 0, 0.25]],
    ["intraday", [0.1, 0, 0.15]],
    ["hedge", [0.05, 0, 0.15]]
  ]);
  const strategyBuckets: StrategyBucketRuntimePolicy[] = BUCKETS.map(
    (bucket) => {
      const [targetWeightRatio, minWeightRatio, maxWeightRatio] = targets.get(
        bucket
      ) as [number, number, number];
      return {
        bucket,
        targetWeightRatio,
        minWeightRatio,
        maxWeightRatio,
        maxTurnoverRatio: 0.5,
        turnoverWindow: {
          mode: "fixed_utc",
          durationSeconds: 86_400,
          anchor: "unix_epoch",
          denominator: "window_open_portfolio_net_worth_krw"
        },
        maxDrawdownRatio: 0.1,
        drawdownSemanticsRef: {
          drawdownSemanticsRecordId: "drawdown-1",
          ...fakeRef
        },
        reviewCadence:
          bucket === "intraday"
            ? { mode: "every_tick" }
            : {
                mode: "scheduled",
                boundaryRefs: [
                  { scheduleBoundaryRecordId: "boundary-1", ...fakeRef }
                ]
              },
        eventTriggers: [],
        selectionTrigger:
          minWeightRatio > 0
            ? { mode: "below_min" }
            : {
                mode: "entry_floor_on_due_cycle",
                entryWeightRatio:
                  bucket === "short_term" ? 0.05 : 0.02
              },
        minimumHoldingSeconds: 0,
        maximumHoldingSeconds: 86_400,
        exitPolicy: {
          takeProfit: { mode: "disabled" },
          timeExpiryAction: "review_required"
        },
        enabledMarkets: [...enabledMarkets],
        enabledAssetClasses: ["equity"],
        selectionPolicyRef: selectionPolicyRefFor(selection),
        riskRuleSetRef: { riskRuleSetRecordId: "risk-set-1", ...fakeRef }
      };
    }
  );
  const payload = {
    mode: "paper_only" as const,
    recordType: "runtime_portfolio_policy_record" as const,
    portfolioId: "portfolio-1",
    sourcePolicyRecordId: "source-policy-1",
    sourcePolicyRecordHash: HASH_A,
    sourcePolicyHash: "c".repeat(64),
    policyId: "policy-1",
    version: "v1",
    name: "Policy v1",
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
      riskRuleSetRef: { riskRuleSetRecordId: "risk-set-1", ...fakeRef }
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
      createdAt: "2026-09-01T00:00:00.000Z"
    }),
    createdAt: "2026-09-01T00:00:00.000Z"
  });
}

function nonblankLineCount(value: string): number {
  return value.split("\n").filter(Boolean).length;
}

async function withTemporaryDirectory(
  operation: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "manual-assignment-"));
  try {
    await operation(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}
