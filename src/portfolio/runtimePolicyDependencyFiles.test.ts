import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonlStore } from "../storage/jsonlStore.js";
import {
  bucketSelectionPolicyRecordSchema,
  createBucketDrawdownSemanticsRecord,
  createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord,
  createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord,
  createSessionCalendarRecord,
  riskRuleParameterRefFor,
  riskRuleSetRefFor,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor
} from "./runtimePolicyContracts.js";
import {
  ImmutablePolicyDependencyFileLoader,
  createImmutablePolicyDependencyPaths,
  loadConsistentImmutablePolicyDependencies
} from "./runtimePolicyDependencyFiles.js";

const CREATED_AT = "2026-08-28T00:00:00.000Z";

test("dependency loader returns an empty fail-closed repository for missing files", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir).load();

    assert.deepEqual(loaded.records.selectionPolicies, []);
    assert.equal(Object.isFrozen(loaded.records), true);
    assert.throws(
      () =>
        loaded.repository.resolveSelectionPolicy({
          selectionPolicyRecordId: "selection_policy_missing",
          version: "selection.v1",
          hash: `sha256:${"0".repeat(64)}`,
          lineageHash: `sha256:${"0".repeat(64)}`
        }),
      /selection policy ref does not resolve/
    );
  });
});

test("dependency loader reads verified records from the documented artifact path", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await new JsonlStore(
      paths.selectionPolicies,
      bucketSelectionPolicyRecordSchema,
      "bucketSelectionPolicyRecord"
    ).append(record);

    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir).load();
    assert.equal(loaded.records.selectionPolicies.length, 1);
    assert.deepEqual(
      loaded.repository.resolveSelectionPolicy(selectionPolicyRefFor(record)),
      record
    );
    assert.equal(
      paths.selectionPolicies,
      join(baseDir, "bucket-selection-policy-records.jsonl")
    );
  });
});

test("dependency loader backfills legacy lineage in memory without rewriting files", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixture = fullDependencyFixture();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    const legacyRiskSet = omitLineage(fixture.riskSet);
    const legacyBoundary = omitLineage(fixture.boundary);
    await appendJsonLine(
      paths.selectionPolicies,
      omitLineage(fixture.selection)
    );
    for (const record of fixture.riskParameters) {
      await appendJsonLine(paths.riskParameters, omitLineage(record));
    }
    await appendJsonLine(paths.riskRuleSets, {
      ...legacyRiskSet,
      rules: legacyRiskSet.rules.map((rule) => ({
        ...rule,
        parameterRef: omitLineage(rule.parameterRef)
      }))
    });
    await appendJsonLine(
      paths.drawdownSemantics,
      omitLineage(fixture.drawdown)
    );
    await appendJsonLine(
      paths.sessionCalendars,
      omitLineage(fixture.calendar)
    );
    await appendJsonLine(paths.scheduleBoundaries, {
      ...legacyBoundary,
      sessionCalendarLineageHash: undefined
    });
    const filePaths = Object.values(paths);
    const before = await Promise.all(
      filePaths.map((path) => readFile(path, "utf8"))
    );

    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir).load();
    const after = await Promise.all(
      filePaths.map((path) => readFile(path, "utf8"))
    );

    assert.deepEqual(loaded.records, fixture.records);
    assert.deepEqual(after, before);
    assert.deepEqual(
      loaded.repository.resolveRiskRuleSet(riskRuleSetRefFor(fixture.riskSet)),
      fixture.riskSet
    );
    assert.equal(
      loaded.repository.resolveScheduleBoundary(
        scheduleBoundaryRefFor(fixture.boundary),
        "2026-08-28"
      ).calendar.lineageHash,
      fixture.calendar.lineageHash
    );
  });
});

test("dependency loader canonicalizes legacy record and nested ref identities", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixture = fullDependencyFixture();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await appendJsonLine(paths.selectionPolicies, {
      ...omitLineage(fixture.selection),
      selectionPolicyRecordId: ` ${fixture.selection.selectionPolicyRecordId} `
    });
    for (const record of fixture.riskParameters) {
      await appendJsonLine(paths.riskParameters, {
        ...omitLineage(record),
        riskRuleParameterRecordId: ` ${record.riskRuleParameterRecordId} `
      });
    }
    const legacyRiskSet = omitLineage(fixture.riskSet);
    await appendJsonLine(paths.riskRuleSets, {
      ...legacyRiskSet,
      riskRuleSetRecordId: ` ${legacyRiskSet.riskRuleSetRecordId} `,
      rules: legacyRiskSet.rules.map((rule) => ({
        ...rule,
        parameterRef: {
          ...omitLineage(rule.parameterRef),
          riskRuleParameterRecordId: ` ${rule.parameterRef.riskRuleParameterRecordId} `,
          version: ` ${rule.parameterRef.version} `
        }
      }))
    });
    await appendJsonLine(paths.drawdownSemantics, {
      ...omitLineage(fixture.drawdown),
      drawdownSemanticsRecordId: ` ${fixture.drawdown.drawdownSemanticsRecordId} `
    });
    await appendJsonLine(paths.sessionCalendars, {
      ...omitLineage(fixture.calendar),
      sessionCalendarRecordId: ` ${fixture.calendar.sessionCalendarRecordId} `
    });
    const legacyBoundary = omitLineage(fixture.boundary);
    await appendJsonLine(paths.scheduleBoundaries, {
      ...legacyBoundary,
      scheduleBoundaryRecordId: ` ${legacyBoundary.scheduleBoundaryRecordId} `,
      sessionCalendarRecordId: ` ${legacyBoundary.sessionCalendarRecordId} `,
      sessionCalendarVersion: ` ${legacyBoundary.sessionCalendarVersion} `,
      sessionCalendarLineageHash: undefined
    });

    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir).load();

    assert.deepEqual(loaded.records, fixture.records);
  });
});

test("dependency loader requires an explicit offset for legacy offsetless timestamps", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await appendJsonLine(paths.selectionPolicies, {
      ...omitLineage(record),
      createdAt: "2026-08-28T00:00:00"
    });
    const before = await readFile(paths.selectionPolicies, "utf8");

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /set legacyOffsetlessCreatedAtOffset explicitly/
    );
    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir, {
      legacyOffsetlessCreatedAtOffset: "+09:00"
    }).load();

    assert.equal(
      loaded.records.selectionPolicies[0]?.createdAt,
      "2026-08-28T00:00:00+09:00"
    );
    assert.equal(
      loaded.records.selectionPolicies[0]?.selectionPolicyRecordId,
      record.selectionPolicyRecordId
    );
    assert.equal(await readFile(paths.selectionPolicies, "utf8"), before);
    assert.throws(
      () =>
        new ImmutablePolicyDependencyFileLoader(baseDir, {
          legacyOffsetlessCreatedAtOffset: "+15:00"
        }),
      /must be Z or a numeric offset/
    );
  });
});

test("dependency loader migrates legacy date-only timestamps at explicit midnight", async () => {
  const cases = [
    ["2026-08-28", "2026-08-28T00:00:00+09:00"],
    ["2026/08/28", "2026-08-27T15:00:00.000Z"],
    ["08/28/2026", "2026-08-27T15:00:00.000Z"]
  ] as const;

  for (const [createdAt, expected] of cases) {
    await withTemporaryDirectory(async (baseDir) => {
      const record = selectionPolicyRecord();
      const paths = createImmutablePolicyDependencyPaths(baseDir);
      await appendJsonLine(paths.selectionPolicies, {
        ...omitLineage(record),
        createdAt
      });
      const before = await readFile(paths.selectionPolicies, "utf8");

      const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir, {
        legacyOffsetlessCreatedAtOffset: "+09:00"
      }).load();

      assert.equal(loaded.records.selectionPolicies[0]?.createdAt, expected);
      assert.equal(
        loaded.records.selectionPolicies[0]?.selectionPolicyRecordId,
        record.selectionPolicyRecordId
      );
      assert.equal(await readFile(paths.selectionPolicies, "utf8"), before);
    });
  }
});

test("dependency loader canonicalizes timezone-qualified legacy timestamp forms", async () => {
  const cases = [
    ["Thu, 28 Aug 2026 00:00:00 GMT", "2026-08-28T00:00:00.000Z", null],
    [
      " Thu, 28 Aug 2026 00:00:00 GMT ",
      "2026-08-28T00:00:00.000Z",
      "+09:00"
    ],
    ["Fri, 28 Aug 2026 09:00:00 +0900", "2026-08-28T00:00:00.000Z", null],
    ["2026-08-28 00:00:00+09", "2026-08-27T15:00:00.000Z", "Z"],
    [
      "Fri Aug 28 2026 09:00:00 GMT+0900 (Korean Standard Time)",
      "2026-08-28T00:00:00.000Z",
      null
    ],
    ["Fri Aug 28 2026 00:00:00 GMT+9", "2026-08-27T15:00:00.000Z", "Z"],
    ["Fri Aug 28 2026 00:00:00 GMT+9:00", "2026-08-27T15:00:00.000Z", "Z"],
    ["Fri Aug 28 2026 00:00:00 -5:30", "2026-08-28T05:30:00.000Z", "+09:00"],
    ["Fri Aug 28 2026 00:00:00 GMT0", "2026-08-28T00:00:00.000Z", "+09:00"],
    ["Fri Aug 28 2026 00:00:00 UT00", "2026-08-28T00:00:00.000Z", "+09:00"],
    ["Fri Aug 28 2026 00:00:00 UTC0000", "2026-08-28T00:00:00.000Z", "+09:00"],
    ["2026-08-28T00:00:00+0900", "2026-08-27T15:00:00.000Z", null],
    ["2026-08-28 00:00:00Z", "2026-08-28T00:00:00.000Z", null],
    ["2026-08-28T00:00:00z", "2026-08-28T00:00:00.000Z", null]
  ] as const;

  for (const [createdAt, expected, explicitOffset] of cases) {
    await withTemporaryDirectory(async (baseDir) => {
      const record = selectionPolicyRecord();
      const paths = createImmutablePolicyDependencyPaths(baseDir);
      await appendJsonLine(paths.selectionPolicies, {
        ...omitLineage(record),
        createdAt
      });
      const before = await readFile(paths.selectionPolicies, "utf8");

      const loader =
        explicitOffset === null
          ? new ImmutablePolicyDependencyFileLoader(baseDir)
          : new ImmutablePolicyDependencyFileLoader(baseDir, {
              legacyOffsetlessCreatedAtOffset: explicitOffset
            });
      const loaded = await loader.load();

      assert.equal(loaded.records.selectionPolicies[0]?.createdAt, expected);
      assert.equal(await readFile(paths.selectionPolicies, "utf8"), before);
    });
  }
});

test("dependency loader applies an explicit offset to non-ISO legacy timestamps", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await appendJsonLine(paths.selectionPolicies, {
      ...omitLineage(record),
      createdAt: "August 28, 2026 00:00:00"
    });

    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir, {
      legacyOffsetlessCreatedAtOffset: "+09:00"
    }).load();

    assert.equal(
      loaded.records.selectionPolicies[0]?.createdAt,
      "2026-08-27T15:00:00.000Z"
    );
  });
});

test("dependency loader rejects malformed JSONL instead of accepting a partial set", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await appendFile(paths.riskRuleSets, "{not-json}\n", "utf8");

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /riskRuleSets:1/
    );
  });
});

test("dependency loader retries a mixed append-only raw generation", async () => {
  const fixture = fullDependencyFixture();
  const legacyRiskSet = legacyRiskRuleSet(fixture.riskSet);
  const mixed = rawDependencyGeneration({
    ...fixture.records,
    riskParameters: [],
    riskRuleSets: [legacyRiskSet]
  });
  const complete = rawDependencyGeneration({
    ...fixture.records,
    riskRuleSets: [legacyRiskSet]
  });
  let readCount = 0;

  const loaded = await loadConsistentImmutablePolicyDependencies({
    readGeneration: async () => {
      readCount += 1;
      return readCount === 1 ? mixed : complete;
    }
  });

  assert.equal(readCount, 2);
  assert.equal(loaded.records.riskParameters.length, 2);
  assert.deepEqual(
    loaded.repository.resolveRiskRuleSet(riskRuleSetRefFor(fixture.riskSet)),
    fixture.riskSet
  );
});

test("dependency loader keeps a stable mixed generation fail-closed", async () => {
  const fixture = fullDependencyFixture();
  const mixed = rawDependencyGeneration({
    ...fixture.records,
    riskParameters: [],
    riskRuleSets: [legacyRiskRuleSet(fixture.riskSet)]
  });
  let readCount = 0;

  await assert.rejects(
    loadConsistentImmutablePolicyDependencies({
      readGeneration: async () => {
        readCount += 1;
        return mixed;
      }
    }),
    /legacy risk rule parameter ref does not resolve/
  );

  assert.equal(readCount, 2);
});

test("dependency loader rejects a replaced raw generation during retry", async () => {
  const fixture = fullDependencyFixture();
  const legacyRiskSet = legacyRiskRuleSet(fixture.riskSet);
  const mixed = rawDependencyGeneration({
    ...fixture.records,
    riskParameters: [],
    riskRuleSets: [legacyRiskSet]
  });
  const replaced = rawDependencyGeneration({
    ...fixture.records,
    selectionPolicies: [],
    riskRuleSets: [legacyRiskSet]
  });
  let readCount = 0;

  await assert.rejects(
    loadConsistentImmutablePolicyDependencies({
      readGeneration: async () => {
        readCount += 1;
        return readCount === 1 ? mixed : replaced;
      }
    }),
    /dependency files must be append-only extensions/
  );

  assert.equal(readCount, 2);
});

test("dependency loader rejects semantic hash tamper after JSON schema parsing", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await new JsonlStore(
      paths.selectionPolicies,
      bucketSelectionPolicyRecordSchema,
      "bucketSelectionPolicyRecord"
    ).append({ ...record, scoringModelVersion: "selector.v2" });

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /record hash mismatch/
    );
  });
});

test("dependency loader rejects duplicate immutable IDs", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    const store = new JsonlStore(
      paths.selectionPolicies,
      bucketSelectionPolicyRecordSchema,
      "bucketSelectionPolicyRecord"
    );
    await store.append(record);
    await store.append(record);

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /record ID must resolve exactly once/
    );
  });
});

function selectionPolicyRecord() {
  return createBucketSelectionPolicyRecord({
    bucket: "swing",
    version: "selection.v1",
    requiredEvidence: [
      {
        evidenceClass: "market_technical",
        sourceContractId: "verified-market-packet.v1",
        maximumAgeSeconds: 60
      }
    ],
    hardGateRuleIds: ["liquidity"],
    scoringModelVersion: "selector.v1",
    featureDefinitionRefs: ["momentum.v1"],
    createdAt: CREATED_AT
  });
}

function fullDependencyFixture() {
  const selection = selectionPolicyRecord();
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
    timeZone: calendar.timeZone,
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily",
    anchorLocalTime: "15:30:00",
    nonSessionDayRule: "previous_session",
    createdAt: CREATED_AT
  });
  return {
    selection,
    riskParameters: [buy, sell],
    riskSet,
    drawdown,
    calendar,
    boundary,
    records: {
      selectionPolicies: [selection],
      riskParameters: [buy, sell],
      riskRuleSets: [riskSet],
      drawdownSemantics: [drawdown],
      sessionCalendars: [calendar],
      scheduleBoundaries: [boundary]
    }
  };
}

function legacyRiskRuleSet(
  riskSet: ReturnType<typeof createPortfolioRiskRuleSetRecord>
) {
  const legacy = omitLineage(riskSet);
  return {
    ...legacy,
    rules: legacy.rules.map((rule) => ({
      ...rule,
      parameterRef: omitLineage(rule.parameterRef)
    }))
  };
}

function rawDependencyGeneration(records: {
  selectionPolicies: readonly unknown[];
  riskParameters: readonly unknown[];
  riskRuleSets: readonly unknown[];
  drawdownSemantics: readonly unknown[];
  sessionCalendars: readonly unknown[];
  scheduleBoundaries: readonly unknown[];
}) {
  return {
    selectionPolicies: {
      records: [...records.selectionPolicies],
      corruptLineCount: 0
    },
    riskParameters: {
      records: [...records.riskParameters],
      corruptLineCount: 0
    },
    riskRuleSets: {
      records: [...records.riskRuleSets],
      corruptLineCount: 0
    },
    drawdownSemantics: {
      records: [...records.drawdownSemantics],
      corruptLineCount: 0
    },
    sessionCalendars: {
      records: [...records.sessionCalendars],
      corruptLineCount: 0
    },
    scheduleBoundaries: {
      records: [...records.scheduleBoundaries],
      corruptLineCount: 0
    }
  };
}

function omitLineage<T extends { lineageHash: string }>(
  value: T
): Omit<T, "lineageHash"> {
  const { lineageHash: _lineageHash, ...legacy } = value;
  return legacy;
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "policy-dependencies-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}
