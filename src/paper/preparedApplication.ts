import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { auditEventSchema, isoDateTimeSchema, marketPacketSchema, sha256HashSchema, virtualDecisionSchema,
  virtualPortfolioSchema, virtualRiskDecisionSchema, virtualTradeSchema, type AuditEvent } from "../domain/schemas.js";
import { bindVirtualDecisionConfidenceBreakdown } from "./decisionConfidence.js";
import { bindVirtualDecisionHash } from "./decisionHash.js";
import { PaperOrderEngine } from "./orderEngine.js";
import { validateVirtualDecisionAgainstPacket } from "./virtualDecisionValidation.js";

const inputSchema = z.object({
  expectedSnapshot: z.object({ portfolio: virtualPortfolioSchema.nullable(), revisionHash: sha256HashSchema.nullable() }).strict(),
  packet: marketPacketSchema,
  providerDecision: virtualDecisionSchema,
  evaluatedAt: isoDateTimeSchema,
  decisionSummary: z.string().min(1)
}).strict();
const stepSchema = z.object({ portfolio: virtualPortfolioSchema, riskDecision: virtualRiskDecisionSchema,
  trade: virtualTradeSchema.nullable(), noOpReason: z.literal("NO_OP_EXIT_DUST_CLOSED").optional() }).strict();
const recordSchema = inputSchema.extend({
  schemaVersion: z.literal("paper_prepared_application.v1"),
  executionModelVersion: z.literal("paper_order_engine.v1"),
  decision: virtualDecisionSchema,
  steps: z.array(stepSchema).max(20),
  auditEvents: z.array(auditEventSchema).max(41),
  portfolio: virtualPortfolioSchema,
  applicationHash: sha256HashSchema
}).strict();
export type PreparedPaperApplicationInput = z.infer<typeof inputSchema>;
export type PreparedPaperApplication = z.infer<typeof recordSchema>;

/** Frozen intent, not a commit receipt. No I/O or provider call occurs during preparation/replay. */
export function preparePaperApplication(value: PreparedPaperApplicationInput): PreparedPaperApplication {
  const input = inputSchema.parse(value);
  if ((input.expectedSnapshot.portfolio !== null && !isDeepStrictEqual(input.expectedSnapshot.portfolio, input.packet.virtualPortfolio)) ||
    (input.expectedSnapshot.portfolio === null && input.expectedSnapshot.revisionHash !== null)) {
    throw new Error("prepared paper application portfolio observation mismatch");
  }
  if (!validateVirtualDecisionAgainstPacket({ packet: input.packet, decision: input.providerDecision }).approved) {
    throw new Error("prepared paper application decision is invalid");
  }
  const decision = bindVirtualDecisionHash(bindVirtualDecisionConfidenceBreakdown({ packet: input.packet, decision: input.providerDecision }));
  const now = new Date(input.evaluatedAt);
  const auditEvents = [paperApplicationAudit("VIRTUAL_DECISION_RECORDED", input.decisionSummary, now)];
  const steps: z.infer<typeof stepSchema>[] = [];
  const engine = new PaperOrderEngine();
  let portfolio = input.packet.virtualPortfolio;
  for (const item of decision.decisions) {
    const step = stepSchema.parse(engine.execute({ packet: input.packet, portfolio, decision: item, riskPolicy: { now } }));
    steps.push(step); portfolio = step.portfolio;
    auditEvents.push(paperApplicationAudit(step.riskDecision.approved ? "VIRTUAL_RISK_APPROVED" : "VIRTUAL_RISK_REJECTED",
      `${item.market}:${item.symbol} ${item.action}`, now));
    if (step.trade) auditEvents.push(paperApplicationAudit("PAPER_ORDER_FILLED",
      `${step.trade.market}:${step.trade.symbol} ${step.trade.action}`, now));
  }
  const payload = { ...input, schemaVersion: "paper_prepared_application.v1" as const,
    executionModelVersion: "paper_order_engine.v1" as const, decision, steps, auditEvents, portfolio };
  return recordSchema.parse({ ...payload, applicationHash: hashPreparedApplicationPayload(payload) });
}

/** Rehash every field and independently recompute all decisions, risk/fill results and audit effects. */
export function verifyPreparedPaperApplication(value: unknown): PreparedPaperApplication {
  const record = recordSchema.parse(value);
  const { applicationHash, ...payload } = record;
  if (applicationHash !== hashPreparedApplicationPayload(payload)) throw new Error("prepared paper application hash mismatch");
  const replay = preparePaperApplication({ expectedSnapshot: record.expectedSnapshot, packet: record.packet,
    providerDecision: record.providerDecision, evaluatedAt: record.evaluatedAt, decisionSummary: record.decisionSummary });
  if (!isDeepStrictEqual(record, replay)) throw new Error("prepared paper application replay mismatch");
  return record;
}

export function hashPreparedApplicationPayload(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)])) : item;
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function paperApplicationAudit(eventType: string, summary: string, now: Date): AuditEvent {
  // Preserve legacy IDs; these are NOT unique application IDs or idempotency keys.
  return { eventId: `audit_${eventType.toLowerCase()}_${now.getTime()}`, eventType, actor: "system", summary,
    maskedRefs: [], createdAt: now.toISOString() };
}
