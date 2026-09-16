import { type TestContext } from "node:test";
import { type VirtualPosition } from "../domain/schemas.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { pendingActionExposureTotals } from "./portfolioSizingInputs.js";
import { hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { START, PORTFOLIO, AT, at, snapshot, fixture as manualFixture, type State as ManualState, type Options } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture, type SelectorCapacityState } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotOpeningCapacity } from "./storedSnapshotOpeningCapacity.js";

export type State = ManualState | SelectorCapacityState;

export const run = (state: State, stored: Awaited<ReturnType<typeof storeSnapshot>>) =>
  resolveStoredSnapshotOpeningCapacity({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });

export const intraday = (result: Awaited<ReturnType<typeof run>>) => result.capacities.find((item) => item.bucket === "intraday")!;

export function capacityPolicy(legacy = false, version = "opening.v1", maximumPositionCount = 4, minimumCashReserveKrw = 100, intradayMaxWeightRatio = 0.5) {
  const fixture = policyFixture();
  const { runtimePolicyRecordId: _id, policyHash: _hash, lineageHash: _lineage, createdAt, ...base } = fixture.policy;
  const payload = { ...base, portfolioId: PORTFOLIO, version, cashPolicy: { ...base.cashPolicy, minimumCashReserveKrw },
    strategyBuckets: base.strategyBuckets.map((bucket) => ({ ...bucket,
      maxWeightRatio: bucket.bucket === "intraday" ? intradayMaxWeightRatio : bucket.maxWeightRatio, ...(legacy ? {} : {
      openingCapacityPolicy: { modelVersion: "bucket_opening_capacity_policy.v1" as const, maximumPositionCount }
    }) })) };
  const policyHash = hashCanonicalPayload(payload), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, runtimePolicyRecordId, policyHash, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  return { ...fixture, policy };
}

export async function storePolicy(directory: string, legacy = false, minimumCashReserveKrw = 100) {
  const fixture = capacityPolicy(legacy, "opening.v1", 4, minimumCashReserveKrw);
  await storePolicyFixture(directory, fixture);
  return fixture;
}

export function position(symbol: string, strategyBucket?: VirtualPosition["strategyBucket"], quantity = 1): VirtualPosition {
  return { market: "KR", symbol, quantity, averagePriceKrw: 10, region: "KR", sector: "Technology", updatedAt: AT,
    ...(strategyBucket === undefined ? {} : { strategyBucket }) };
}

export async function storeSnapshot(state: State, context: TestContext, policyHash: string, cutoff = 170, positions: VirtualPosition[] = [], cashKrw = 1000) {
  context.mock.timers.setTime(START + 200);
  const progress = await resolveStoredPendingPlanActionProgress({ baseDir: state.dir, portfolioId: PORTFOLIO, asOf: at(cutoff) });
  const inputs = progress.projection.pendingActions.map((item) => ({ planId: item.planId, planHash: item.planHash,
    planEventId: item.planEventId, planEventHash: item.planEventHash, actionId: item.action.actionId, actionExecutionTargetHash: item.actionExecutionTargetHash,
    market: item.action.market, symbol: item.action.symbol, side: "BUY" as const, remainingNotionalKrw: item.remainingTargetNotionalKrw!, asOf: at(cutoff),
    openingCapacityReservationId: state.manual.bound.reservationId, openingCapacityReservationHash: state.manual.bound.reservationHash }));
  const base = snapshot(policyHash), exposure = base.exposureSnapshot;
  const total = positions.reduce((sum, item) => sum + item.quantity * 10, 0);
  const bucketExposureKrw = { ...exposure.bucketExposureKrw };
  const symbols = new Map<string, number>();
  let unassigned = 0;
  for (const item of positions) {
    if (item.strategyBucket) bucketExposureKrw[item.strategyBucket] += item.quantity * 10; else unassigned += item.quantity * 10;
    symbols.set(item.symbol, (symbols.get(item.symbol) ?? 0) + item.quantity * 10);
  }
  const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = base;
  return new PortfolioSizingSnapshotFileRepository(state.dir).append(createPortfolioSizingSnapshot({ ...payload, asOf: at(cutoff),
    portfolioVersion: "opening-snapshot", virtualPortfolio: { ...base.virtualPortfolio, cashKrw, positions, updatedAt: at(cutoff) }, pendingActionInputs: inputs,
    valuationInputs: [...symbols.keys()].map((symbol) => ({ kind: "mark_price", market: "KR", symbol, priceKrw: 10, evidenceRef: "fixture-mark", evidenceAsOf: AT })),
    ...createPortfolioExposureSnapshot({ ...exposure, cashKrw, virtualNetWorthKrw: cashKrw + total, bucketExposureKrw,
      ...(unassigned ? { unassignedExposureKrw: unassigned } : {}), symbolExposureKrw: [...symbols].filter(([, amount]) => amount > 0)
        .map(([symbol, exposureKrw]) => ({ market: "KR", symbol, exposureKrw })), marketExposureKrw: { KR: total, US: 0 },
      sectorExposureKrw: total ? { Technology: total } : {}, countryExposureKrw: total ? { KR: total } : {}, currencyExposureKrw: total ? { KRW: total } : {},
      ...pendingActionExposureTotals(inputs) }) }));
}

export async function fixture(context: TestContext, source: "manual" | "selector", options: Options, operation: (state: State) => Promise<void>) {
  if (source === "manual") await manualFixture(context, options, operation); else await selectorFixture(context, options, operation);
}
