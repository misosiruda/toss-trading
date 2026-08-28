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
  parseBucketSelectionPolicyRecord,
  parsePortfolioRiskRuleParameterRecord,
  parsePortfolioRiskRuleSetRecord,
  parseScheduleBoundaryRecord,
  parseSessionCalendarRecord,
  parseStrategyBucketRuntimePolicy,
  riskRuleParameterRefFor,
  riskRuleSetRefFor,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor
} from "./runtimePolicyContracts.js";

const CREATED_AT = "2026-08-28T00:00:00.000Z";

test("selection policy canonicalizes ordered sets and verifies full payload hash", () => {
  const record = selectionPolicyRecord();
  const retriedRecord = createBucketSelectionPolicyRecord({
    ...selectionPolicyInput(),
    createdAt: "2026-08-28T01:00:00.000Z"
  });

  assert.deepEqual(record.requiredEvidence.map((entry) => entry.evidenceClass), [
    "fundamental_quality",
    "market_technical"
  ]);
  assert.deepEqual(record.hardGateRuleIds, ["lifecycle", "liquidity"]);
  assert.deepEqual(record.featureDefinitionRefs, ["momentum.v1", "volume.v1"]);
  assert.match(record.hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    record.selectionPolicyRecordId,
    `selection_policy_${record.hash.slice("sha256:".length)}`
  );
  assert.equal(retriedRecord.hash, record.hash);
  assert.equal(
    retriedRecord.selectionPolicyRecordId,
    record.selectionPolicyRecordId
  );
  assert.deepEqual(selectionPolicyRefFor(record), {
    selectionPolicyRecordId: record.selectionPolicyRecordId,
    version: record.version,
    hash: record.hash
  });

  assert.throws(
    () =>
      parseBucketSelectionPolicyRecord({
        ...record,
        scoringModelVersion: "selector.v2"
      }),
    /record hash mismatch/
  );
  assert.throws(
    () =>
      parseBucketSelectionPolicyRecord({
        ...record,
        hardGateRuleIds: [...record.hardGateRuleIds].reverse()
      }),
    /canonical order/
  );
});

test("selection policy rejects duplicate canonical evidence and rule keys", () => {
  assert.throws(
    () =>
      createBucketSelectionPolicyRecord({
        ...selectionPolicyInput(),
        requiredEvidence: [
          selectionPolicyInput().requiredEvidence[0]!,
          selectionPolicyInput().requiredEvidence[0]!
        ]
      }),
    /duplicate canonical keys/
  );
  assert.throws(
    () =>
      createBucketSelectionPolicyRecord({
        ...selectionPolicyInput(),
        hardGateRuleIds: ["liquidity", "liquidity"]
      }),
    /duplicate canonical keys/
  );
});

test("risk parameter hash binds nested canonical parameter payload", () => {
  const record = riskParameterRecord("cash_reserve", ["BUY"]);

  assert.deepEqual(riskRuleParameterRefFor(record), {
    riskRuleParameterRecordId: record.riskRuleParameterRecordId,
    version: record.version,
    hash: record.hash
  });
  assert.throws(
    () =>
      parsePortfolioRiskRuleParameterRecord({
        ...record,
        parameters: {
          ...record.parameters,
          maximumRatio: 0.2
        }
      }),
    /record hash mismatch/
  );
  assert.throws(
    () =>
      createPortfolioRiskRuleParameterRecord({
        ruleId: "invalid",
        ruleVersion: "v1",
        version: "record.v1",
        parameters: { threshold: Number.NaN },
        createdAt: CREATED_AT
      }),
    /expected number/i
  );
});

test("risk rule set canonicalizes rules and requires BUY and SELL coverage", () => {
  const buyParameter = riskParameterRecord("cash_reserve", ["BUY"]);
  const sellParameter = riskParameterRecord("reduce_only", ["SELL"]);
  const record = createPortfolioRiskRuleSetRecord({
    version: "risk-set.v1",
    rules: [
      {
        ruleId: "reduce_only",
        ruleVersion: "v1",
        appliesTo: ["SELL"],
        parameterRef: riskRuleParameterRefFor(sellParameter)
      },
      {
        ruleId: "cash_reserve",
        ruleVersion: "v1",
        appliesTo: ["BUY"],
        parameterRef: riskRuleParameterRefFor(buyParameter)
      }
    ],
    createdAt: CREATED_AT
  });

  assert.deepEqual(record.rules.map((rule) => rule.ruleId), [
    "cash_reserve",
    "reduce_only"
  ]);
  assert.deepEqual(riskRuleSetRefFor(record), {
    riskRuleSetRecordId: record.riskRuleSetRecordId,
    version: record.version,
    hash: record.hash
  });
  assert.throws(
    () =>
      createPortfolioRiskRuleSetRecord({
        version: "risk-set.v1",
        rules: [
          {
            ruleId: "cash_reserve",
            ruleVersion: "v1",
            appliesTo: ["BUY"],
            parameterRef: riskRuleParameterRefFor(buyParameter)
          }
        ],
        createdAt: CREATED_AT
      }),
    /at least one SELL rule/
  );
  assert.throws(
    () =>
      parsePortfolioRiskRuleSetRecord({
        ...record,
        rules: [...record.rules].reverse()
      }),
    /canonical ruleId order/
  );
  assert.throws(
    () =>
      createPortfolioRiskRuleSetRecord({
        version: "risk-set.v1",
        rules: [
          {
            ruleId: "cash_reserve",
            ruleVersion: "v1",
            appliesTo: ["BUY"],
            parameterRef: riskRuleParameterRefFor(buyParameter)
          },
          {
            ruleId: " cash_reserve ",
            ruleVersion: "v1",
            appliesTo: ["SELL"],
            parameterRef: riskRuleParameterRefFor(sellParameter)
          }
        ],
        createdAt: CREATED_AT
      }),
    /duplicate canonical keys/
  );
});

test("immutable contract helpers deep-freeze nested verified payloads", () => {
  const selection = selectionPolicyRecord();
  const buyParameter = riskParameterRecord("cash_reserve", ["BUY"]);
  const sellParameter = riskParameterRecord("reduce_only", ["SELL"]);
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
    createdAt: CREATED_AT
  });

  assert.equal(Object.isFrozen(selection.requiredEvidence), true);
  assert.equal(Object.isFrozen(selection.requiredEvidence[0]), true);
  assert.equal(Object.isFrozen(riskSet.rules), true);
  assert.equal(Object.isFrozen(riskSet.rules[0]?.parameterRef), true);
  assert.throws(() => {
    selection.requiredEvidence[0]!.maximumAgeSeconds = 1;
  }, TypeError);
  assert.throws(() => {
    riskSet.rules[0]!.parameterRef.hash = `sha256:${"0".repeat(64)}`;
  }, TypeError);
});

test("drawdown semantics accepts only the versioned invariant tuple", () => {
  const record = createBucketDrawdownSemanticsRecord({
    ...drawdownSemanticsInput(),
    createdAt: CREATED_AT
  });

  assert.deepEqual(drawdownSemanticsRefFor(record), {
    drawdownSemanticsRecordId: record.drawdownSemanticsRecordId,
    version: record.version,
    hash: record.hash
  });
  assert.throws(() =>
    createBucketDrawdownSemanticsRecord({
      ...drawdownSemanticsInput(),
      pnlRule: "notional_flow_as_profit" as never,
      createdAt: CREATED_AT
    })
  );
});

test("session calendar canonicalizes dates and rejects coverage gaps", () => {
  const record = createSessionCalendarRecord({
    market: "KR",
    version: "krx-calendar.v1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-08-28",
    validThroughExchangeDate: "2026-08-30",
    sessions: [
      closedSession("2026-08-30"),
      openSession("2026-08-28"),
      closedSession("2026-08-29")
    ],
    createdAt: CREATED_AT
  });

  assert.deepEqual(record.sessions.map((entry) => entry.exchangeDate), [
    "2026-08-28",
    "2026-08-29",
    "2026-08-30"
  ]);
  assert.equal(
    parseSessionCalendarRecord(record).sessionCalendarRecordId,
    record.sessionCalendarRecordId
  );
  assert.throws(
    () =>
      createSessionCalendarRecord({
        market: "KR",
        version: "krx-calendar.v1",
        timeZone: "Asia/Seoul",
        validFromExchangeDate: "2026-08-28",
        validThroughExchangeDate: "2026-08-30",
        sessions: [openSession("2026-08-28"), closedSession("2026-08-30")],
        createdAt: CREATED_AT
      }),
    /cover every date/
  );
  assert.throws(
    () =>
      createSessionCalendarRecord({
        market: "KR",
        version: "krx-calendar.v1",
        timeZone: "Invalid\/Timezone",
        validFromExchangeDate: "2026-08-28",
        validThroughExchangeDate: "2026-08-28",
        sessions: [openSession("2026-08-28")],
        createdAt: CREATED_AT
      }),
    /valid IANA timezone/
  );
  assert.throws(() =>
    createSessionCalendarRecord({
      market: "KR",
      version: "krx-calendar.v1",
      timeZone: "Asia/Seoul",
      validFromExchangeDate: "2026-08-28",
      validThroughExchangeDate: "2026-08-28",
      sessions: [
        {
          exchangeDate: "2026-08-28",
          sessionKind: "regular",
          opensAt: "2026-08-28T09:00:00",
          closesAt: "2026-08-28T15:30:00",
          sourceEvidenceRefs: ["official-calendar:krx:2026-08-28"]
        }
      ],
      createdAt: CREATED_AT
    })
  );
  assert.throws(
    () =>
      createSessionCalendarRecord({
        market: "KR",
        version: "krx-calendar.v1",
        timeZone: "Asia/Seoul",
        validFromExchangeDate: "2026-08-28",
        validThroughExchangeDate: "2026-08-28",
        sessions: [
          {
            ...openSession("2026-08-28"),
            opensAt: "2026-08-27T09:00:00+09:00"
          }
        ],
        createdAt: CREATED_AT
      }),
    /must resolve to the exchange date/
  );
});

test("schedule boundary binds calendar identity and validates interval shape", () => {
  const calendar = createSessionCalendarRecord({
    market: "US",
    version: "nyse-calendar.v1",
    timeZone: "America/New_York",
    validFromExchangeDate: "2026-08-28",
    validThroughExchangeDate: "2026-08-28",
    sessions: [
      {
        exchangeDate: "2026-08-28",
        sessionKind: "regular",
        opensAt: "2026-08-28T09:30:00-04:00",
        closesAt: "2026-08-28T16:00:00-04:00",
        sourceEvidenceRefs: ["official-calendar:nyse:2026-08-28"]
      }
    ],
    createdAt: CREATED_AT
  });
  const record = createScheduleBoundaryRecord({
    market: "US",
    version: "weekly-close.v1",
    timeZone: calendar.timeZone,
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    interval: "weekly",
    anchorLocalTime: "16:00:00",
    weeklyAnchorDay: "friday",
    nonSessionDayRule: "previous_session",
    createdAt: CREATED_AT
  });

  assert.deepEqual(scheduleBoundaryRefFor(record), {
    scheduleBoundaryRecordId: record.scheduleBoundaryRecordId,
    version: record.version,
    hash: record.hash
  });
  assert.throws(
    () =>
      parseScheduleBoundaryRecord({
        ...record,
        sessionCalendarHash: `sha256:${"0".repeat(64)}`
      }),
    /record hash mismatch/
  );
  assert.throws(
    () =>
      createScheduleBoundaryRecord({
        market: "US",
        version: "weekly-close.v1",
        timeZone: calendar.timeZone,
        sessionCalendarRecordId: calendar.sessionCalendarRecordId,
        sessionCalendarVersion: calendar.version,
        sessionCalendarHash: calendar.hash,
        interval: "weekly",
        anchorLocalTime: "16:00",
        nonSessionDayRule: "previous_session",
        createdAt: CREATED_AT
      }),
    /requires weeklyAnchorDay/
  );
});

test("strategy bucket runtime policy enforces bootstrap cadence and holding boundaries", () => {
  const selection = selectionPolicyRecord();
  const drawdown = createBucketDrawdownSemanticsRecord({
    ...drawdownSemanticsInput(),
    createdAt: CREATED_AT
  });
  const buyParameter = riskParameterRecord("cash_reserve", ["BUY"]);
  const sellParameter = riskParameterRecord("reduce_only", ["SELL"]);
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
    createdAt: CREATED_AT
  });
  const base = {
    bucket: "intraday" as const,
    targetWeightRatio: 0.1,
    minWeightRatio: 0,
    maxWeightRatio: 0.15,
    maxTurnoverRatio: 1,
    turnoverWindow: {
      mode: "fixed_utc" as const,
      durationSeconds: 86_400,
      anchor: "unix_epoch" as const,
      denominator: "window_open_portfolio_net_worth_krw" as const
    },
    maxDrawdownRatio: 0.04,
    drawdownSemanticsRef: drawdownSemanticsRefFor(drawdown),
    reviewCadence: { mode: "every_tick" as const },
    eventTriggers: ["regime_change", "thesis_evidence_change"] as const,
    selectionTrigger: {
      mode: "entry_floor_on_due_cycle" as const,
      entryWeightRatio: 0.02
    },
    minimumHoldingSeconds: 0,
    maximumHoldingSeconds: 28_800,
    exitPolicy: {
      takeProfit: { mode: "disabled" as const },
      timeExpiryAction: "sell_all" as const
    },
    enabledMarkets: ["KR"] as const,
    enabledAssetClasses: ["equity"],
    selectionPolicyRef: selectionPolicyRefFor(selection),
    riskRuleSetRef: riskRuleSetRefFor(riskSet)
  };

  assert.equal(parseStrategyBucketRuntimePolicy(base).bucket, "intraday");
  assert.throws(
    () =>
      parseStrategyBucketRuntimePolicy({
        ...base,
        selectionTrigger: { mode: "below_min" }
      }),
    /must use entry_floor_on_due_cycle/
  );
  assert.throws(
    () =>
      parseStrategyBucketRuntimePolicy({
        ...base,
        bucket: "swing"
      }),
    /restricted to intraday/
  );
  assert.throws(
    () =>
      parseStrategyBucketRuntimePolicy({
        ...base,
        minimumHoldingSeconds: 28_800
      }),
    /must be below maximum/
  );
});

function selectionPolicyRecord() {
  return createBucketSelectionPolicyRecord(selectionPolicyInput());
}

function selectionPolicyInput() {
  return {
    bucket: "intraday" as const,
    version: "selection.v1",
    requiredEvidence: [
      {
        evidenceClass: "market_technical" as const,
        sourceContractId: "verified-market-packet.v1",
        maximumAgeSeconds: 60,
        minimumObservationCount: 20
      },
      {
        evidenceClass: "fundamental_quality" as const,
        sourceContractId: "official-fundamental.v1",
        maximumAgeSeconds: 86_400
      }
    ],
    everyTickSourceRequirement: {
      sourceContractId: "verified-market-packet.v1",
      eventType: "verified_market_packet" as const,
      maximumAgeSeconds: 60,
      dedupeKey: "packet_hash" as const
    },
    hardGateRuleIds: ["lifecycle", "liquidity"],
    scoringModelVersion: "selector.v1",
    featureDefinitionRefs: ["volume.v1", "momentum.v1"],
    createdAt: CREATED_AT
  };
}

function riskParameterRecord(
  ruleId: string,
  appliesTo: readonly ("BUY" | "SELL")[]
) {
  return createPortfolioRiskRuleParameterRecord({
    ruleId,
    ruleVersion: "v1",
    version: "record.v1",
    parameters: {
      appliesTo: [...appliesTo],
      maximumRatio: 0.1,
      nested: { enabled: true, labels: ["paper_only"] }
    },
    createdAt: CREATED_AT
  });
}

function drawdownSemanticsInput() {
  return {
    version: "unit-nav.v1",
    equityBasis: "bucket_assets_plus_cash" as const,
    unitFlowRule: "mint_burn_at_pre_flow_unit_nav" as const,
    pnlRule: "mark_to_market_and_execution_cost_only" as const,
    highWaterMarkRule: "max_previous_and_resulting_unit_nav" as const,
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark" as const,
    emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch" as const,
    activationCarryRule: "carry_when_semantics_hash_matches" as const
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
