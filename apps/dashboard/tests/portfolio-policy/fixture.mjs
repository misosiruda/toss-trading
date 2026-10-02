import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPaperPolicyRecord } from "../../../../dist/api/paperPolicyRecords.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, drawdownSemanticsRefFor,
  riskRuleParameterRefFor, riskRuleSetRefFor, scheduleBoundaryRefFor, selectionPolicyRefFor
} from "../../../../dist/portfolio/runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths } from "../../../../dist/portfolio/runtimePolicyDependencyFiles.js";
import { ImmutablePolicyDependencyRepository } from "../../../../dist/portfolio/runtimePolicyDependencyResolver.js";
import { normalizeRuntimePortfolioPolicy } from "../../../../dist/portfolio/runtimePortfolioPolicy.js";
import { RuntimePortfolioPolicyFileRepository } from "../../../../dist/portfolio/runtimePortfolioPolicyFiles.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "../../../../dist/portfolio/runtimePortfolioPolicyActivationFiles.js";
import { portfolioSnapshot, readPortfolioScenario } from "./scenarios.mjs";

const createdAt = "2026-06-26T00:00:00.000Z";
const buckets = ["long_term", "swing", "short_term", "intraday", "hedge"];

export function portfolioScenarioDirectory(value) {
  const scenario = readPortfolioScenario(value);
  return fileURLToPath(new URL(`../../.e2e-data/portfolio-policy/${scenario}/`, import.meta.url));
}

// Local synthetic artifacts only. Production factories validate the source,
// immutable dependencies, runtime hash/lineage and portfolio-bound activation.
export async function writePortfolioFixture(dataDir, scenario, options = {}) {
  readPortfolioScenario(scenario);
  const portfolio = portfolioSnapshot();
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "virtual-portfolio.json"), `${JSON.stringify(portfolio, null, 2)}\n`);
  if (scenario === "missing") return { portfolio, policy: null, activation: null };

  const hedgeEnabled = scenario === "enabled";
  const fixture = dependencyFixture();
  const paths = createImmutablePolicyDependencyPaths(dataDir);
  for (const [kind, records] of Object.entries(fixture.records)) {
    await writeFile(paths[kind], records.map((record) => `${JSON.stringify(record)}\n`).join(""));
  }
  const candidate = policyCandidate(hedgeEnabled);
  const source = await createPaperPolicyRecord(candidate, {
    storageBaseDir: dataDir, now: () => new Date(createdAt)
  });
  const sourcePolicyRecord = JSON.parse((await readFile(source.recordPath, "utf8")).trim());
  const policy = normalizeRuntimePortfolioPolicy({
    portfolioId: portfolio.portfolioId,
    sourcePolicyRecord,
    bucketInputs: buckets.map((bucket, index) => ({
      configuration: {
        bucket,
        turnoverWindow: {
          mode: "fixed_utc", durationSeconds: 86_400, anchor: "unix_epoch",
          denominator: "window_open_portfolio_net_worth_krw"
        },
        drawdownSemanticsRef: drawdownSemanticsRefFor(fixture.drawdown),
        reviewCadence: { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(fixture.boundary)] },
        eventTriggers: [],
        selectionTrigger: bucket === "hedge" && !hedgeEnabled
          ? { mode: "below_min" }
          : { mode: "entry_floor_on_due_cycle", entryWeightRatio: 0.02 },
        minimumHoldingSeconds: 0, maximumHoldingSeconds: 86_400,
        exitPolicy: { takeProfit: { mode: "disabled" }, timeExpiryAction: "review_required" },
        enabledMarkets: ["KR"],
        selectionPolicyRef: selectionPolicyRefFor(fixture.records.selectionPolicies[index]),
        riskRuleSetRef: riskRuleSetRefFor(fixture.riskSet)
      },
      requiredCalendarDates: [{ market: "KR", exchangeDate: "2026-06-26" }]
    })),
    legacyReduceOnlyPolicy: {
      allowBuyOrIncrease: false, maximumParticipationRatio: 0.1,
      riskRuleSetRef: riskRuleSetRefFor(fixture.riskSet)
    },
    createdAt
  }, fixture.repository);
  await new RuntimePortfolioPolicyFileRepository(dataDir, fixture.repository).append(policy);
  const activation = await new RuntimePortfolioPolicyActivationFileRepository(
    dataDir, [policy], fixture.repository
  ).appendActivated({ policy, createdAt: options.activationAt ?? portfolio.updatedAt });
  return { portfolio, policy, activation };
}

function dependencyFixture() {
  const selectionPolicies = buckets.map((bucket) => createBucketSelectionPolicyRecord({
    bucket, version: `e2e.selection.${bucket}.v1`,
    requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "e2e.synthetic.v1", maximumAgeSeconds: 60 }],
    hardGateRuleIds: ["liquidity"], scoringModelVersion: `e2e.selector.${bucket}.v1`,
    featureDefinitionRefs: ["e2e.momentum.v1"], createdAt
  }));
  const buy = createPortfolioRiskRuleParameterRecord({
    ruleId: "cash_reserve", ruleVersion: "v1", version: "e2e.v1",
    parameters: { minimumCashRatio: 0.15 }, createdAt
  });
  const sell = createPortfolioRiskRuleParameterRecord({
    ruleId: "reduce_only", ruleVersion: "v1", version: "e2e.v1",
    parameters: { allowIncrease: false }, createdAt
  });
  const riskSet = createPortfolioRiskRuleSetRecord({
    version: "e2e.risk.v1",
    rules: [
      { ruleId: "cash_reserve", ruleVersion: "v1", appliesTo: ["BUY"], parameterRef: riskRuleParameterRefFor(buy) },
      { ruleId: "reduce_only", ruleVersion: "v1", appliesTo: ["SELL"], parameterRef: riskRuleParameterRefFor(sell) }
    ], createdAt
  });
  const drawdown = createBucketDrawdownSemanticsRecord({
    version: "e2e.unit-nav.v1", equityBasis: "bucket_assets_plus_cash",
    unitFlowRule: "mint_burn_at_pre_flow_unit_nav", pnlRule: "mark_to_market_and_execution_cost_only",
    highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark",
    emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches", createdAt
  });
  const calendar = createSessionCalendarRecord({
    market: "KR", version: "e2e.synthetic-calendar.v1", timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-06-26", validThroughExchangeDate: "2026-06-26",
    sessions: [{
      exchangeDate: "2026-06-26", sessionKind: "regular",
      opensAt: "2026-06-26T09:00:00+09:00", closesAt: "2026-06-26T15:30:00+09:00",
      sourceEvidenceRefs: ["synthetic-e2e-calendar:2026-06-26"]
    }], createdAt
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR", version: "e2e.daily.v1", timeZone: "Asia/Seoul",
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version, sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily", anchorLocalTime: "15:30:00", nonSessionDayRule: "previous_session", createdAt
  });
  const records = {
    selectionPolicies, riskParameters: [buy, sell], riskRuleSets: [riskSet],
    drawdownSemantics: [drawdown], sessionCalendars: [calendar], scheduleBoundaries: [boundary]
  };
  return { records, riskSet, drawdown, boundary, repository: new ImmutablePolicyDependencyRepository(records) };
}

function policyCandidate(hedgeEnabled) {
  const targets = [0.35, 0.2, 0.15, 0.1, hedgeEnabled ? 0.05 : 0];
  const holdingPeriods = ["multi_month", "multi_week", "multi_day", "intraday", "hedge"];
  return {
    mode: "paper_only", policyId: "portfolio-e2e", version: "v1", name: "Synthetic E2E policy",
    strategyBuckets: buckets.map((bucket, index) => ({
      bucket, targetWeightRatio: targets[index], minWeightRatio: 0, maxWeightRatio: 0.5,
      maxTurnoverRatio: 0.5, maxDrawdownRatio: 0.1,
      holdingPeriodHint: holdingPeriods[index], enabledAssetClasses: ["equity"]
    })),
    cashPolicy: { targetCashRatio: hedgeEnabled ? 0.15 : 0.2, minimumCashReserveKrw: 100_000, ruleSource: "static" },
    hedgePolicy: { hedgeEnabled, hedgeTargetRatio: hedgeEnabled ? 0.05 : 0, maxCostRatio: 0.02 },
    exposurePolicy: { maxSymbolExposureRatio: 0.2, maxCountryExposureRatio: 0.8, maxCurrencyExposureRatio: 0.8 },
    executionBoundary: { liveTradingEnabled: false, orderPlacementEnabled: false, backendValidationRequired: true }
  };
}
