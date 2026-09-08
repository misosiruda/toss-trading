import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths } from "../storage/repositories.js";
import { readCanonicalMarketPacketHistory } from "./everyTickPortfolioCycleTriggerResolver.js";
import { parsePaperFillExecutionRecord } from "./paperFillExecution.js";
import { parsePortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { parsePortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema, portfolioRiskRuleParameterRefSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((value) => value === value.trim());
export const riskExecutionLiquidityContextSchema = z.object({
  sourceContractId: z.literal("stored-market-packet-liquidity.v1"), packetId: identifier, packetHash: sha256HashSchema,
  portfolioId: identifier, market: marketSchema, symbol: identifier, sourceRefs: z.array(identifier).min(1),
  collectedAt: offsetQualifiedIsoDateTimeSchema, staleAfter: offsetQualifiedIsoDateTimeSchema,
  generatedAt: offsetQualifiedIsoDateTimeSchema, expiresAt: offsetQualifiedIsoDateTimeSchema,
  readAt: offsetQualifiedIsoDateTimeSchema, historyRecordCount: z.number().int().positive().safe(), historyHash: sha256HashSchema
}).strict();

export const riskDecisionExecutionOriginSchema = z.object({
  schemaVersion: z.literal("portfolio_risk_execution_input.v1"),
  preview: z.unknown(), executionParameterRef: portfolioRiskRuleParameterRefSchema,
  maximumPriceAgeSeconds: z.number().int().positive().safe(), liquidity: riskExecutionLiquidityContextSchema
}).strict();

/** Frozen local model inputs, not durable market-source provenance or complete Risk authorization. */
export function parseRiskDecisionExecutionOrigin(value: unknown) {
  const parsed = riskDecisionExecutionOriginSchema.parse(value);
  const preview = parsePortfolioActionExecutionPreview(parsed.preview);
  const result = { ...parsed, preview };
  if (!isDeepStrictEqual(value, result)) throw new Error("risk execution origin must already be canonical");
  const liquidity = result.liquidity;
  const price = preview.input.sourcePriceEvidence;
  if (price.market !== liquidity.market || price.symbol !== liquidity.symbol ||
    preview.execution.fillStatus === "rejected" || preview.execution.quantity <= 0 ||
    preview.execution.liquidityStatus === "not_modeled" || preview.input.liquidityStale ||
    (preview.input.volume === null && preview.input.averageVolume === null)) {
    throw new Error("risk execution origin requires an accepted modeled fill with matching liquidity scope");
  }
  assertRiskExecutionFresh(result, preview.input.asOf);
  return deepFreeze(result);
}

export type RiskDecisionExecutionOrigin = ReturnType<typeof parseRiskDecisionExecutionOrigin>;

export function assertRiskExecutionFresh(origin: {
  preview: ReturnType<typeof parsePortfolioActionExecutionPreview>;
  maximumPriceAgeSeconds: number;
  liquidity: z.infer<typeof riskExecutionLiquidityContextSchema>;
}, asOf: string): void {
  const cutoff = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(asOf));
  const liquidity = origin.liquidity;
  const collectedAt = Date.parse(liquidity.collectedAt);
  const generatedAt = Date.parse(liquidity.generatedAt);
  const price = origin.preview.input.sourcePriceEvidence;
  if (collectedAt > generatedAt || generatedAt > cutoff || Date.parse(liquidity.readAt) > cutoff ||
    Date.parse(liquidity.expiresAt) <= cutoff || Date.parse(liquidity.staleAfter) <= cutoff ||
    collectedAt >= Date.parse(liquidity.staleAfter) || Date.parse(origin.preview.input.asOf) > cutoff ||
    Date.parse(price.observedAt) > cutoff || Date.parse(price.createdAt) > cutoff ||
    (cutoff - Date.parse(price.observedAt)) / 1000 > origin.maximumPriceAgeSeconds) {
    throw new Error("risk execution inputs are stale or temporally inconsistent");
  }
}

/** Independently checks the originally read prefix, including after later packet appends. */
export async function verifyRiskExecutionLiquidity(baseDir: string, origin: RiskDecisionExecutionOrigin): Promise<void> {
  const history = await readCanonicalMarketPacketHistory(createStoragePaths(baseDir).marketPacketsPath);
  const liquidity = origin.liquidity;
  const prefix = history.records.slice(0, liquidity.historyRecordCount);
  if (history.corruptLineCount !== 0 || prefix.length !== liquidity.historyRecordCount || hashCanonicalPayload(prefix) !== liquidity.historyHash) {
    throw new Error("risk execution liquidity prefix does not match stored history");
  }
  const matches = prefix.filter((packet) => createMarketPacketHash(packet) === liquidity.packetHash);
  const packet = matches.length === 1 ? matches[0] : undefined;
  if (packet === undefined || packet.packetId !== liquidity.packetId ||
    prefix.filter((entry) => entry.packetId === packet.packetId).length !== 1 ||
    packet.virtualPortfolio.portfolioId !== liquidity.portfolioId || packet.generatedAt !== liquidity.generatedAt || packet.expiresAt !== liquidity.expiresAt) {
    throw new Error("risk execution liquidity packet does not resolve exactly once");
  }
  const candidates = packet.candidates.filter((candidate) => candidate.market === liquidity.market && candidate.symbol === liquidity.symbol);
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  if (candidate === undefined || candidate.collectedAt !== liquidity.collectedAt || candidate.staleAfter !== liquidity.staleAfter ||
    !isDeepStrictEqual(candidate.sourceRefs, liquidity.sourceRefs) ||
    (candidate.volume ?? null) !== origin.preview.input.volume || (candidate.averageVolume ?? null) !== origin.preview.input.averageVolume) {
    throw new Error("risk execution liquidity candidate differs from modeled input");
  }
}

/** Necessary model bounds; other policy-selected Risk rules still require evaluation. */
export function assertRiskExecutionDecisionBinding(value: unknown, origin: RiskDecisionExecutionOrigin): void {
  const decision = parsePortfolioActionRiskDecision(value);
  const { input, execution, requestedQuantity } = origin.preview;
  const price = input.sourcePriceEvidence;
  if (decision.portfolioId !== origin.liquidity.portfolioId || decision.market !== price.market || decision.symbol !== price.symbol ||
    decision.side !== input.side || decision.decidedAt !== input.asOf || decision.requestedNotionalKrw !== input.requestedNotionalKrw || decision.requestedQuantity !== requestedQuantity ||
    !decision.riskEvidenceRefs.includes(price.evidenceRef) || decision.worstCaseFillNotionalKrw < execution.grossAmountKrw ||
    (decision.cashAssessment.side === "BUY" && decision.cashAssessment.worstCaseNetCashDebitKrw < execution.netAmountKrw) ||
    (decision.cashAssessment.side === "SELL" && decision.cashAssessment.expectedMinimumNetCashCreditKrw > execution.netAmountKrw)) {
    throw new Error("risk decision differs from modeled execution input or cost bound");
  }
  const rule = decision.ruleResults.find((result) => result.ruleId === "paper_execution");
  if (rule?.result !== "pass") throw new Error("accepted execution input requires its paper_execution rule result");
  assertRiskExecutionFresh(origin, decision.decidedAt);
}

/** Later fills may not substitute a cheaper model or another liquidity/quantity input. */
export function assertRiskExecutionFillBinding(value: unknown, origin: RiskDecisionExecutionOrigin): void {
  const fill = parsePaperFillExecutionRecord(value);
  const { input, execution, requestedQuantity } = origin.preview;
  const price = input.sourcePriceEvidence;
  const priceProjection = { sourceContractId: price.sourceContractId, evidenceRef: price.evidenceRef,
    evidenceHash: price.evidenceHash, market: price.market, symbol: price.symbol, priceField: price.priceField, observedAt: price.observedAt };
  if (fill.portfolioId !== origin.liquidity.portfolioId || fill.market !== price.market || fill.symbol !== price.symbol || fill.side !== input.side ||
    !isDeepStrictEqual(fill.sourcePriceEvidence, priceProjection) ||
    fill.sourcePriceKrw !== price.priceKrw ||
    fill.requestedNotionalKrw !== input.requestedNotionalKrw || fill.requestedQuantity !== requestedQuantity || fill.quantityOverride !== input.quantityOverride ||
    fill.volume !== input.volume || fill.averageVolume !== input.averageVolume || fill.liquidityStale !== input.liquidityStale ||
    !isDeepStrictEqual(fill.executionPolicy, input.executionPolicy) || fill.quantity !== execution.quantity ||
    fill.fillPriceKrw !== execution.fillPriceKrw || fill.grossAmountKrw !== execution.grossAmountKrw || fill.netAmountKrw !== execution.netAmountKrw ||
    !isDeepStrictEqual(fill.costBreakdown, execution.costBreakdown)) {
    throw new Error("paper fill differs from the Risk decision's frozen execution input");
  }
  assertRiskExecutionFresh(origin, fill.asOf);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
