import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { createInitialBucketTurnoverState } from "./bucketTurnover.js";
import { bucketTurnoverObservationSchema } from "./bucketTurnoverObservation.js";
import { BucketTurnoverStateFileRepository, getDurableBucketTurnoverObservation, getDurableBucketTurnoverStateSource,
  resolveObservedBucketTurnoverState, type VerifiedBucketTurnoverStateSnapshot } from "./bucketTurnoverStateFiles.js";
import { type VerifiedBucketTurnoverEventHistory } from "./bucketTurnoverEventFiles.js";
import { parsePortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { validateRiskDecisionTurnoverCapacity } from "./portfolioActionRiskDecisionTurnoverCapacity.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const riskDecisionTurnoverOriginSchema = z.object({
  schemaVersion: z.literal("portfolio_risk_turnover_origin.v1"),
  turnoverStateId: z.string().min(1).max(240), turnoverStateHash: sha256HashSchema,
  windowCommitHash: sha256HashSchema, windowCompletionHash: sha256HashSchema,
  lastEventCommitHash: sha256HashSchema.nullable(), lastEventCompletionHash: sha256HashSchema.nullable(),
  availableAt: offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString()),
  observation: bucketTurnoverObservationSchema
}).strict();
export type RiskDecisionTurnoverOrigin = Readonly<z.infer<typeof riskDecisionTurnoverOriginSchema>>;
type Source = ReturnType<typeof getDurableBucketTurnoverStateSource>;

export function parseRiskDecisionTurnoverOrigin(value: unknown): RiskDecisionTurnoverOrigin {
  const origin = riskDecisionTurnoverOriginSchema.parse(value);
  if (!isDeepStrictEqual(value, origin)) throw new Error("Risk turnover origin must already be canonical");
  Object.freeze(origin.observation);
  return Object.freeze(origin);
}

/** Pure record binding; actual source issuance and prefix replay are verified separately. */
export function assertRiskDecisionTurnoverOriginBinding(value: unknown, receipt: unknown): void {
  const decision = parsePortfolioActionRiskDecision(value);
  const origin = parseRiskDecisionTurnoverOrigin(receipt);
  const assessment = decision.turnoverAssessment;
  if (decision.riskRuleScope.scopeKind !== "bucket" || assessment.scopeKind !== "bucket" ||
    assessment.turnoverStateId !== origin.turnoverStateId || assessment.turnoverStateHash !== origin.turnoverStateHash ||
    Date.parse(origin.availableAt) >= Date.parse(decision.decidedAt) ||
    Date.parse(origin.observation.observedAt) > Date.parse(decision.decidedAt) ||
    Date.parse(origin.availableAt) > Date.parse(origin.observation.observedAt)) {
    throw new Error("Risk turnover origin scope, state or chronology mismatch");
  }
}

/** A new receipt can only be produced inside the current projection source lease. */
export function createRiskDecisionTurnoverOrigin(decision: unknown, policy: unknown,
  projection: VerifiedBucketTurnoverStateSnapshot): RiskDecisionTurnoverOrigin {
  const record = parsePortfolioActionRiskDecision(decision);
  if (record.turnoverAssessment.scopeKind !== "bucket") throw new Error("turnover-bound Risk requires a bucket assessment");
  const source = getDurableBucketTurnoverStateSource(projection, record.turnoverAssessment.turnoverStateId);
  validateDecisionSource(record, policy, source);
  const origin = parseRiskDecisionTurnoverOrigin({ schemaVersion: "portfolio_risk_turnover_origin.v1",
    ...sourceIdentity(source), observation: getDurableBucketTurnoverObservation(projection) });
  assertRiskDecisionTurnoverOriginBinding(record, origin);
  return origin;
}

/** Race-safe exact retry under the already-held source locks; never re-enters a repository. */
export function verifyRiskDecisionTurnoverOriginInProjection(decision: unknown, policy: unknown,
  receipt: unknown, projection: VerifiedBucketTurnoverStateSnapshot): void {
  const origin = parseRiskDecisionTurnoverOrigin(receipt);
  const original = resolveObservedBucketTurnoverState(projection, origin.observation, origin.turnoverStateId);
  verifyReceipt(decision, policy, origin, original.source);
}

/** Historical origin replay, not current execution permission. Event readers supply their already-verified preceding prefix. */
export async function resolveRiskDecisionTurnoverOrigin(baseDir: string, decision: unknown, policy: unknown, receipt: unknown,
  options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}, knownEvents?: VerifiedBucketTurnoverEventHistory) {
  const origin = parseRiskDecisionTurnoverOrigin(receipt);
  const original = await new BucketTurnoverStateFileRepository(baseDir, options)
    .resolveObservedState(origin.observation, origin.turnoverStateId, knownEvents);
  verifyReceipt(decision, policy, origin, original.source);
  return origin;
}

function verifyReceipt(decision: unknown, policy: unknown, origin: RiskDecisionTurnoverOrigin, source: Source): void {
  assertRiskDecisionTurnoverOriginBinding(decision, origin);
  validateDecisionSource(decision, policy, source);
  const { schemaVersion: _schema, observation: _observation, ...identity } = origin;
  if (!isDeepStrictEqual(identity, sourceIdentity(source))) throw new Error("Risk turnover origin differs from actual stored sources");
}

function validateDecisionSource(value: unknown, policyValue: unknown, source: Source): void {
  const decision = parsePortfolioActionRiskDecision(value);
  const policy = parseRuntimePortfolioPolicyRecord(policyValue);
  validateRiskDecisionTurnoverCapacity({ decision, policy });
  const assessment = decision.turnoverAssessment;
  const scope = decision.riskRuleScope;
  if (assessment.scopeKind !== "bucket" || scope.scopeKind !== "bucket") throw new Error("turnover-bound Risk requires bucket scope");
  const bucket = policy.strategyBuckets.find((item) => item.bucket === scope.bucket)!;
  const identity = createInitialBucketTurnoverState({ portfolioId: decision.portfolioId, bucket: scope.bucket,
    policyHash: decision.policyHash, asOf: decision.decidedAt, durationSeconds: bucket.turnoverWindow.durationSeconds,
    windowOpenPortfolioNetWorthKrw: 1 });
  if (identity.turnoverStateId !== source.state.turnoverStateId || assessment.turnoverStateId !== source.state.turnoverStateId ||
    assessment.turnoverStateHash !== source.state.turnoverStateHash ||
    assessment.priorBucketTurnoverNotionalKrw !== source.state.cumulativeAbsoluteFilledNotionalKrw ||
    assessment.turnoverWindowOpenPortfolioNetWorthKrw !== source.state.windowOpenPortfolioNetWorthKrw) {
    throw new Error("Risk turnover assessment differs from actual source state");
  }
}

function sourceIdentity(source: Source) {
  if (source.availableAt === null || source.windowCompletionHash === null) throw new Error("Risk turnover source lacks post-fsync completion; legacy requires review");
  return { turnoverStateId: source.state.turnoverStateId, turnoverStateHash: source.state.turnoverStateHash,
    windowCommitHash: source.windowCommitHash, windowCompletionHash: source.windowCompletionHash,
    lastEventCommitHash: source.lastEventCommitHash, lastEventCompletionHash: source.lastEventCompletionHash,
    availableAt: source.availableAt };
}
