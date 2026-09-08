import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createInitialBucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverWindowFileRepository, resolveVerifiedBucketTurnoverWindowOrigin } from "./bucketTurnoverWindowFiles.js";
import { PaperFillExecutionFileRepository, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { assertRiskExecutionFillBinding } from "./portfolioActionRiskDecisionExecutionContext.js";
import { resolvePortfolioActionRiskDecisionExecution } from "./portfolioActionRiskDecisionExecutionResolver.js";

const identifier = z.string().min(1).max(240).refine((value) => value === value.trim());
const inputSchema = z.object({ baseDir: z.string().min(1), paperFillRecordId: identifier }).strict();

/**
 * Historical turnover source binding through actual stored Risk, plan, mandate,
 * price, liquidity and window origins. Not event persistence, cumulative-state
 * validation, current Risk authorization or an accounting transaction.
 */
export async function resolveBucketTurnoverFillOrigin(value: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(value, input)) throw new Error("turnover fill request must already be canonical");
  const fills = await new PaperFillExecutionFileRepository(input.baseDir).readVerifiedHistory();
  const fillOrigin = resolvePersistedPaperFillExecutionOrigin(fills, input.paperFillRecordId);
  const fill = fillOrigin.record;
  if (fillOrigin.riskOrigin === null) throw new Error("turnover fill requires a persisted Risk origin");
  const risk = await resolvePortfolioActionRiskDecisionExecution({ baseDir: input.baseDir,
    riskDecisionId: fillOrigin.riskOrigin.riskDecisionId });
  const decision = risk.decision;
  const expectedRiskOrigin = { riskDecisionId: decision.riskDecisionId, riskDecisionHash: decision.riskDecisionHash,
    appendedAt: risk.origin.appendedAt, commitHash: risk.origin.commitHash };
  if (!isDeepStrictEqual(fillOrigin.riskOrigin, expectedRiskOrigin) || decision.decision !== "approved") {
    throw new Error("turnover fill persisted Risk origin or approval mismatch");
  }
  if (risk.action.lineageKind !== "mandate" || risk.mandate === null || risk.bucketPolicy == null ||
    decision.riskRuleScope.scopeKind !== "bucket" || decision.turnoverAssessment.scopeKind !== "bucket") {
    throw new Error("legacy reduce-only fills must not create bucket turnover");
  }
  if (fillOrigin.completion === null) throw new Error("turnover fill requires post-fsync completion proof");
  if (fill.portfolioId !== decision.portfolioId || fill.rebalancePlanId !== risk.plan.planId ||
    fill.rebalanceActionId !== risk.action.actionId || fill.market !== risk.action.market ||
    fill.symbol !== risk.action.symbol || fill.side !== risk.action.side ||
    risk.mandate.record.bucket !== decision.riskRuleScope.bucket || risk.bucketPolicy.bucket !== decision.riskRuleScope.bucket) {
    throw new Error("turnover fill plan, action or bucket scope mismatch");
  }
  assertRiskExecutionFillBinding(fill, risk.executionOrigin);
  if (fill.filledNotionalKrw > decision.approvedMaximumFillNotionalKrw ||
    (decision.cashAssessment.side === "BUY" && fill.netAmountKrw > decision.cashAssessment.approvedMaximumNetCashDebitKrw) ||
    (decision.cashAssessment.side === "SELL" && fill.netAmountKrw < decision.cashAssessment.expectedMinimumNetCashCreditKrw)) {
    throw new Error("turnover fill exceeds the stored Risk execution bounds");
  }
  const windowIdentity = createInitialBucketTurnoverState({ portfolioId: fill.portfolioId,
    bucket: decision.riskRuleScope.bucket, policyHash: decision.policyHash, asOf: fill.asOf,
    durationSeconds: risk.bucketPolicy.turnoverWindow.durationSeconds, windowOpenPortfolioNetWorthKrw: 1 });
  const windows = await new BucketTurnoverWindowFileRepository(input.baseDir).readVerifiedHistory();
  const windowOrigin = resolveVerifiedBucketTurnoverWindowOrigin(windows, windowIdentity.turnoverStateId);
  const initial = windowOrigin.snapshotOrigin.initialState;
  const assessment = decision.turnoverAssessment;
  if (assessment.turnoverStateId !== initial.turnoverStateId ||
    assessment.turnoverWindowOpenPortfolioNetWorthKrw !== initial.windowOpenPortfolioNetWorthKrw) {
    throw new Error("turnover Risk window identity or fixed denominator mismatch");
  }
  const now = Date.now();
  if (Date.parse(windowOrigin.appendedAt) >= Date.parse(decision.decidedAt) ||
    Date.parse(decision.decidedAt) < Date.parse(initial.windowStartedAt) ||
    Date.parse(risk.origin.appendedAt) >= Date.parse(fill.asOf) ||
    Date.parse(fill.asOf) > Date.parse(fill.createdAt) || Date.parse(fill.createdAt) > Date.parse(fillOrigin.appendedAt) ||
    Date.parse(fillOrigin.completion.completedAt) > now || Date.parse(fillOrigin.completion.completedAt) >= Date.parse(initial.windowEndsAt)) {
    throw new Error("turnover fill source chronology or window boundary mismatch");
  }
  // Amount and asOf come from the actual fill, never the requested amount, net cash or read time.
  return deepFreeze({ portfolioId: fill.portfolioId, bucket: decision.riskRuleScope.bucket,
    policyHash: decision.policyHash, rebalancePlanId: risk.plan.planId, rebalanceActionId: risk.action.actionId,
    fillId: fill.fillId, absoluteFilledNotionalKrw: fill.filledNotionalKrw, asOf: new Date(fill.asOf).toISOString(),
    windowOrigin, planHash: risk.plan.planHash, mandateId: risk.mandate.record.mandateId,
    mandateHash: risk.mandate.record.mandateHash, riskOrigin: expectedRiskOrigin, turnoverAssessment: assessment,
    paperFillOrigin: { paperFillRecordId: fill.paperFillRecordId, paperFillHash: fill.paperFillHash,
      appendedAt: fillOrigin.appendedAt, completion: fillOrigin.completion } });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
