import { type TestContext } from "node:test";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { pendingActionExposureTotals } from "./portfolioSizingInputs.js";
import { createRebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { HASH, START, PORTFOLIO, at, snapshot, fixture as manualFixture, type State as ManualState, type Options } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture, type SelectorCapacityState } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotPendingReservationOrigins } from "./storedSnapshotPendingReservationOrigins.js";

export type State = ManualState | SelectorCapacityState;

export type Stored = { state: State; snapshot: Awaited<ReturnType<typeof storeSnapshot>> };

export const run = ({ state, snapshot }: Stored) => resolveStoredSnapshotPendingReservationOrigins({ baseDir: state.dir, portfolioSnapshotId: snapshot.portfolioSnapshotId });


export async function storeSnapshot(state: State, context: TestContext, options: { cutoff?: number; policyHash?: string; patch?: Record<string, string> } = {}) {
  const cutoff = options.cutoff ?? 170;
  context.mock.timers.setTime(START + 200);
  const progress = await resolveStoredPendingPlanActionProgress({ baseDir: state.dir, portfolioId: PORTFOLIO, asOf: at(cutoff) });
  const inputs = progress.projection.pendingActions.map((item) => ({ planId: item.planId, planHash: item.planHash,
    planEventId: item.planEventId, planEventHash: item.planEventHash, actionId: item.action.actionId, actionExecutionTargetHash: item.actionExecutionTargetHash,
    market: item.action.market, symbol: item.action.symbol, side: "BUY" as const, remainingNotionalKrw: item.remainingTargetNotionalKrw!, asOf: at(cutoff),
    openingCapacityReservationId: state.manual.bound.reservationId, openingCapacityReservationHash: state.manual.bound.reservationHash, ...options.patch }));
  const base = snapshot(options.policyHash ?? HASH);
  const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = base;
  return new PortfolioSizingSnapshotFileRepository(state.dir).append(createPortfolioSizingSnapshot({ ...payload, asOf: at(cutoff),
    portfolioVersion: "pending-snapshot", virtualPortfolio: { ...base.virtualPortfolio, updatedAt: at(cutoff) }, pendingActionInputs: inputs,
    ...createPortfolioExposureSnapshot({ ...base.exposureSnapshot, ...pendingActionExposureTotals(inputs) }) }));
}

export async function appendOtherPlan(state: State, context: TestContext) {
  const { planId: _id, planHash: _hash, ...payload } = state.plan;
  context.mock.timers.setTime(START + 160);
  const plans = new RebalancePlanFileRepository(state.dir), plan = await plans.append(createRebalancePlanRecord({ ...payload,
    cycleId: "other-cycle", createdAt: at(160) }));
  const events = new RebalancePlanEventFileRepository(state.dir, plans);
  const base = { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash };
  context.mock.timers.setTime(START + 175);
  const preview = await events.append(createRebalancePlanEvent({ ...base, eventType: "previewed", asOf: at(175) }));
  context.mock.timers.setTime(START + 180);
  await events.append(createRebalancePlanEvent({ ...base, eventType: "approved", asOf: at(180), previousPlanEventId: preview.planEventId, reasonCodes: ["synthetic"] }));
}

export async function fixture(context: TestContext, source: "manual" | "selector", options: Options, operation: (state: State) => Promise<void>) {
  if (source === "manual") await manualFixture(context, options, operation);
  else await selectorFixture(context, options, operation);
}
