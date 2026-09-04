import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseRebalancePlanRecord, type RebalanceAction } from "./rebalancePlan.js";
import { validateRebalancePlanEventRecordBinding, type RebalancePlanEvent } from "./rebalancePlanEvent.js";

const inputSchema = z.object({ plan: z.unknown(), events: z.array(z.unknown()).min(1).max(100_000) }).strict();
const transitions: Record<RebalancePlanEvent["eventType"], readonly RebalancePlanEvent["eventType"][]> = {
  previewed: ["approved", "rejected", "stale"],
  approved: ["execution_applied", "rejected", "stale"],
  execution_applied: ["execution_applied", "applied", "rejected", "stale"],
  rejected: [], stale: [], applied: []
};
interface ActionProgress {
  actionId: string;
  actionSequence: number;
  fillCount: number;
  cumulativeFilledNotionalKrw: number;
  cumulativeFilledQuantity: number;
  complete: boolean;
}

/**
 * Replays supplied content only. A valid prefix is not the latest stored state,
 * an authentic fill/Risk origin, or permission to execute a portfolio mutation.
 */
export function replayRebalancePlanEvents(input: { plan: unknown; events: readonly unknown[] }) {
  const parsed = inputSchema.parse(input);
  const plan = parseRebalancePlanRecord(parsed.plan);
  const events = parsed.events.map((event) => validateRebalancePlanEventRecordBinding({ plan, event }).event);
  const actions: ActionProgress[] = plan.actions.map((action) => ({
    actionId: action.actionId, actionSequence: action.actionSequence, fillCount: 0,
    cumulativeFilledNotionalKrw: 0, cumulativeFilledQuantity: 0, complete: false
  }));
  const eventIds = new Set<string>();
  const fillIds = new Set<string>();
  const paperFillIds = new Set<string>();
  const riskIds = new Set<string>();
  const executionEventIds: string[] = [];
  let executionPortfolioVersion = plan.portfolioVersion;
  let executionPortfolioSnapshotHash = plan.portfolioSnapshotHash;
  let previous: RebalancePlanEvent | undefined;
  for (const event of events) {
    if (eventIds.has(event.planEventId)) throw new Error("rebalance event replay contains a duplicate event ID");
    eventIds.add(event.planEventId);
    if (previous === undefined) {
      if (event.eventType !== "previewed") throw new Error("rebalance event replay must start with previewed");
    } else {
      if (!("previousPlanEventId" in event) || event.previousPlanEventId !== previous.planEventId) {
        throw new Error("rebalance event replay predecessor is not the immediate prior event");
      }
      if (!transitions[previous.eventType].includes(event.eventType)) throw new Error("rebalance event replay has an invalid or terminal transition");
      if (Date.parse(event.asOf) < Date.parse(previous.asOf)) throw new Error("rebalance event replay time moved backwards");
    }
    if (event.eventType === "execution_applied") {
      const nextAction = actions.find((progress) => !progress.complete);
      if (nextAction === undefined || nextAction.actionSequence !== event.actionSequence) {
        throw new Error("rebalance execution must complete each action in sequence");
      }
      if (event.fillSequence !== nextAction.fillCount || Object.is(event.fillSequence, -0) || Object.is(event.actionSequence, -0)) {
        throw new Error("rebalance action fill sequence must be contiguous and canonical");
      }
      if (fillIds.has(event.fillId) || paperFillIds.has(event.paperFillRecordId) || riskIds.has(event.riskDecisionId)) {
        throw new Error("rebalance event replay reuses a fill or risk decision identity");
      }
      if (event.expectedPrePortfolioVersion !== executionPortfolioVersion || event.expectedPrePortfolioSnapshotHash !== executionPortfolioSnapshotHash) {
        throw new Error("rebalance execution pre-state does not follow prior resulting state");
      }
      assertProgress(plan.actions[event.actionSequence]!, nextAction, event);
      nextAction.fillCount += 1;
      nextAction.cumulativeFilledNotionalKrw = event.cumulativeFilledNotionalKrw;
      nextAction.cumulativeFilledQuantity = event.cumulativeFilledQuantity;
      const target = plan.actions[event.actionSequence]!.executionTarget;
      nextAction.complete = target.targetKind === "fractional_buy_notional"
        ? nextAction.cumulativeFilledNotionalKrw === target.targetNotionalKrw
        : nextAction.cumulativeFilledQuantity === target.targetQuantity;
      fillIds.add(event.fillId); paperFillIds.add(event.paperFillRecordId); riskIds.add(event.riskDecisionId);
      executionEventIds.push(event.planEventId);
      executionPortfolioVersion = event.resultingPortfolioVersion;
      executionPortfolioSnapshotHash = event.resultingPortfolioSnapshotHash;
    } else if (event.eventType === "applied") {
      if (actions.some((action) => !action.complete)) throw new Error("rebalance applied requires every action target to be complete");
      if (!isDeepStrictEqual(event.executionEventIds, executionEventIds)) throw new Error("rebalance applied execution list does not match ordered history");
      if (event.resultingPortfolioVersion !== executionPortfolioVersion || event.resultingPortfolioSnapshotHash !== executionPortfolioSnapshotHash) {
        throw new Error("rebalance applied resulting state does not match last execution");
      }
    }
    previous = event;
  }
  return Object.freeze({
    plan, events: Object.freeze(events), status: previous!.eventType, lastEvent: previous!,
    executionPortfolioVersion, executionPortfolioSnapshotHash,
    executionEventIds: Object.freeze(executionEventIds),
    actions: Object.freeze(actions.map((action) => Object.freeze(action)))
  });
}

function assertProgress(action: RebalanceAction, prior: ActionProgress, event: Extract<RebalancePlanEvent, { eventType: "execution_applied" }>): void {
  for (const amount of [event.requestedNotionalKrw, event.filledNotionalKrw, event.cumulativeFilledNotionalKrw]) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("rebalance execution KRW amounts must be positive safe integers");
  }
  const notional = prior.cumulativeFilledNotionalKrw + event.filledNotionalKrw;
  const quantity = prior.cumulativeFilledQuantity + event.filledQuantity;
  if (!Number.isSafeInteger(notional) || !Number.isFinite(quantity) || quantity > Number.MAX_SAFE_INTEGER ||
    notional !== event.cumulativeFilledNotionalKrw || quantity !== event.cumulativeFilledQuantity) {
    throw new Error("rebalance execution cumulative amounts do not match prior plus fill");
  }
  if (notional > action.maximumNotionalKrw) throw new Error("rebalance execution cumulative notional exceeds action cap");
  const target = action.executionTarget;
  if (target.targetKind === "fractional_buy_notional") {
    const remaining = target.targetNotionalKrw - prior.cumulativeFilledNotionalKrw;
    if (event.requestedNotionalKrw > remaining || event.filledNotionalKrw > event.requestedNotionalKrw || notional > target.targetNotionalKrw) {
      throw new Error("rebalance fractional buy exceeds requested or remaining notional target");
    }
  } else {
    const remaining = target.targetQuantity - prior.cumulativeFilledQuantity;
    if (event.requestedQuantity > remaining || quantity > target.targetQuantity) {
      throw new Error("rebalance quantity execution exceeds remaining target");
    }
    if (target.targetKind === "whole_share_quantity" &&
      [event.requestedQuantity, event.filledQuantity, quantity].some((value) => !Number.isSafeInteger(value))) {
      throw new Error("rebalance whole-share execution requires integer quantities");
    }
  }
}
