import { z } from "zod";

export const marketSchema = z.enum(["KR", "US"]);
export const virtualActionSchema = z.enum([
  "VIRTUAL_BUY",
  "VIRTUAL_SELL",
  "VIRTUAL_HOLD"
]);
export const virtualTradeStatusSchema = z.enum([
  "VIRTUAL_PENDING",
  "VIRTUAL_FILLED",
  "VIRTUAL_REJECTED",
  "VIRTUAL_EXPIRED"
]);

export const isoDateTimeSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}, "Expected an ISO-compatible date-time string");

const nonEmptyStringSchema = z.string().trim().min(1);
const moneyKrwSchema = z.number().int().nonnegative();
const ratioSchema = z.number().min(0).max(1);

export const virtualPositionSchema = z
  .object({
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    quantity: z.number().nonnegative(),
    averagePriceKrw: moneyKrwSchema,
    marketPriceKrw: moneyKrwSchema.optional(),
    marketValueKrw: moneyKrwSchema.optional(),
    unrealizedPnlKrw: z.number().optional(),
    priceUpdatedAt: isoDateTimeSchema.optional(),
    priceStaleAfter: isoDateTimeSchema.optional(),
    priceSourceRefs: z.array(nonEmptyStringSchema).optional(),
    isPriceStale: z.boolean().optional(),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export const virtualPortfolioSchema = z
  .object({
    portfolioId: nonEmptyStringSchema,
    cashKrw: moneyKrwSchema,
    positions: z.array(virtualPositionSchema),
    updatedAt: isoDateTimeSchema
  })
  .strict();

export const marketCandidateSchema = z
  .object({
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    name: nonEmptyStringSchema.optional(),
    sector: nonEmptyStringSchema.optional(),
    industry: nonEmptyStringSchema.optional(),
    lastPriceKrw: moneyKrwSchema.optional(),
    ranking: z.number().int().positive().optional(),
    score: z.number().min(0).max(100).optional(),
    reasonCodes: z.array(nonEmptyStringSchema).default([]),
    eventTags: z.array(nonEmptyStringSchema).optional(),
    newsRefs: z.array(nonEmptyStringSchema).optional(),
    dividendYieldPct: z.number().min(0).max(100).optional(),
    exDividendDate: nonEmptyStringSchema.optional(),
    sourceRefs: z.array(nonEmptyStringSchema).min(1),
    collectedAt: isoDateTimeSchema,
    staleAfter: isoDateTimeSchema
  })
  .strict();

export const historicalMarketSnapshotSchema = z
  .object({
    snapshotId: nonEmptyStringSchema,
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    observedAt: isoDateTimeSchema,
    interval: z.enum(["1m", "5m", "15m", "1h", "1d"]),
    openPriceKrw: moneyKrwSchema.optional(),
    highPriceKrw: moneyKrwSchema.optional(),
    lowPriceKrw: moneyKrwSchema.optional(),
    closePriceKrw: moneyKrwSchema.optional(),
    lastPriceKrw: moneyKrwSchema,
    volume: z.number().nonnegative().optional(),
    sourceRefs: z.array(nonEmptyStringSchema).min(1),
    createdAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.highPriceKrw !== undefined &&
      value.lowPriceKrw !== undefined &&
      value.highPriceKrw < value.lowPriceKrw
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["highPriceKrw"],
        message: "highPriceKrw must be greater than or equal to lowPriceKrw"
      });
    }
  });

export const marketPacketSchema = z
  .object({
    packetId: nonEmptyStringSchema,
    mode: z.literal("paper_only"),
    generatedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    virtualPortfolio: virtualPortfolioSchema,
    candidates: z.array(marketCandidateSchema).max(20),
    constraints: z
      .object({
        maxNewPositions: z.number().int().nonnegative(),
        maxBudgetPerSymbolKrw: moneyKrwSchema,
        allowedActions: z.array(virtualActionSchema).min(1)
      })
      .strict()
  })
  .strict();

export const virtualDecisionItemSchema = z
  .object({
    symbol: nonEmptyStringSchema,
    market: marketSchema,
    action: virtualActionSchema,
    confidence: ratioSchema,
    budgetKrw: moneyKrwSchema,
    thesis: nonEmptyStringSchema,
    riskFactors: z.array(nonEmptyStringSchema),
    dataRefs: z.array(nonEmptyStringSchema).min(1),
    expiresAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action !== "VIRTUAL_HOLD" && value.riskFactors.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["riskFactors"],
        message: "Non-hold virtual decisions must include at least one risk factor"
      });
    }

    if (value.action === "VIRTUAL_HOLD" && value.budgetKrw !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budgetKrw"],
        message: "Hold decisions must not allocate virtual budget"
      });
    }
  });

export const virtualDecisionSchema = z
  .object({
    packetId: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    decisions: z.array(virtualDecisionItemSchema).max(20)
  })
  .strict();

export const virtualRiskDecisionSchema = z
  .object({
    riskDecisionId: nonEmptyStringSchema,
    packetId: nonEmptyStringSchema,
    symbol: nonEmptyStringSchema.optional(),
    approved: z.boolean(),
    rejectCodes: z.array(nonEmptyStringSchema),
    checkedRules: z.array(nonEmptyStringSchema).min(1),
    createdAt: isoDateTimeSchema
  })
  .strict();

export const virtualTradeSchema = z
  .object({
    tradeId: nonEmptyStringSchema,
    packetId: nonEmptyStringSchema,
    decisionId: nonEmptyStringSchema,
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    action: z.enum(["VIRTUAL_BUY", "VIRTUAL_SELL"]),
    quantity: z.number().positive(),
    priceKrw: moneyKrwSchema,
    amountKrw: moneyKrwSchema,
    status: virtualTradeStatusSchema,
    executedAt: isoDateTimeSchema
  })
  .strict();

export const auditEventSchema = z
  .object({
    eventId: nonEmptyStringSchema,
    eventType: nonEmptyStringSchema,
    actor: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    maskedRefs: z.array(nonEmptyStringSchema).default([]),
    createdAt: isoDateTimeSchema
  })
  .strict();

export type Market = z.infer<typeof marketSchema>;
export type VirtualAction = z.infer<typeof virtualActionSchema>;
export type VirtualPosition = z.infer<typeof virtualPositionSchema>;
export type VirtualPortfolio = z.infer<typeof virtualPortfolioSchema>;
export type MarketCandidate = z.infer<typeof marketCandidateSchema>;
export type HistoricalMarketSnapshot = z.infer<
  typeof historicalMarketSnapshotSchema
>;
export type MarketPacket = z.infer<typeof marketPacketSchema>;
export type VirtualDecisionItem = z.infer<typeof virtualDecisionItemSchema>;
export type VirtualDecision = z.infer<typeof virtualDecisionSchema>;
export type VirtualRiskDecision = z.infer<typeof virtualRiskDecisionSchema>;
export type VirtualTrade = z.infer<typeof virtualTradeSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label = "value"
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} failed validation: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function isFresh(expiresAt: string, now = new Date()): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs > now.getTime();
}

export function assertFresh(expiresAt: string, now = new Date()): void {
  if (!isFresh(expiresAt, now)) {
    throw new Error(`stale timestamp: ${expiresAt}`);
  }
}
