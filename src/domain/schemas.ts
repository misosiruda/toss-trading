import { z } from "zod";

export const marketSchema = z.enum(["KR", "US"]);
export const assetTypeSchema = z.enum(["STOCK", "ETF"]);
export const assetClassSchema = z.enum([
  "equity",
  "bond",
  "cash_like",
  "commodity",
  "currency",
  "inverse",
  "leveraged"
]);
export const assetRegionSchema = z.enum(["KR", "US", "GLOBAL"]);
export const assetRiskTagSchema = z.enum([
  "inverse",
  "leveraged",
  "currency_exposed",
  "sector_concentrated"
]);
export const virtualActionSchema = z.enum([
  "VIRTUAL_BUY",
  "VIRTUAL_SELL",
  "VIRTUAL_HOLD"
]);
export const virtualHoldReasonCodeSchema = z.enum([
  "INSUFFICIENT_EVIDENCE",
  "STALE_DATA",
  "CONTRADICTORY_SIGNALS",
  "POLICY_BLOCKED",
  "PORTFOLIO_CONFLICT",
  "NO_POSITION_TO_SELL",
  "NOT_IN_CANDIDATES",
  "LOW_LIQUIDITY"
]);
export const virtualBudgetTierSchema = z.enum([
  "NONE",
  "SMALL",
  "MEDIUM",
  "LARGE"
]);
export const marketCandidateFeatureScoreTypeSchema = z.enum([
  "AVAILABILITY",
  "RANKING",
  "VALUE",
  "POLICY",
  "STATE"
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
export const sha256HashSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/,
    "Expected a sha256 hash with `sha256:` prefix"
  );

const nonEmptyStringSchema = z.string().trim().min(1);
const moneyKrwSchema = z.number().int().nonnegative();
const ratioSchema = z.number().min(0).max(1);

export const virtualPositionSchema = z
  .object({
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    assetType: assetTypeSchema.optional(),
    assetClass: assetClassSchema.optional(),
    region: assetRegionSchema.optional(),
    riskTags: z.array(assetRiskTagSchema).optional(),
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

export const marketCandidateFeatureScoreSchema = z
  .object({
    featureRef: nonEmptyStringSchema,
    score: z.number().min(0).max(100),
    scoreType: marketCandidateFeatureScoreTypeSchema,
    reasonCode: nonEmptyStringSchema
  })
  .strict();

export const marketCandidateSchema = z
  .object({
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    name: nonEmptyStringSchema.optional(),
    assetType: assetTypeSchema.optional(),
    assetClass: assetClassSchema.optional(),
    region: assetRegionSchema.optional(),
    riskTags: z.array(assetRiskTagSchema).optional(),
    sector: nonEmptyStringSchema.optional(),
    industry: nonEmptyStringSchema.optional(),
    lastPriceKrw: moneyKrwSchema.optional(),
    volume: z.number().nonnegative().optional(),
    averageVolume: z.number().nonnegative().optional(),
    ranking: z.number().int().positive().optional(),
    score: z.number().min(0).max(100).optional(),
    reasonCodes: z.array(nonEmptyStringSchema).default([]),
    eventTags: z.array(nonEmptyStringSchema).optional(),
    newsRefs: z.array(nonEmptyStringSchema).optional(),
    featureRefs: z.array(nonEmptyStringSchema).optional(),
    featureScores: z.array(marketCandidateFeatureScoreSchema).optional(),
    dividendYieldPct: z.number().min(0).max(100).optional(),
    exDividendDate: nonEmptyStringSchema.optional(),
    buyEligible: z.boolean().optional(),
    sellEligible: z.boolean().optional(),
    blockedReasonCodes: z.array(nonEmptyStringSchema).optional(),
    budgetTierAllowed: virtualBudgetTierSchema.optional(),
    positionExists: z.boolean().optional(),
    cooldownActive: z.boolean().optional(),
    dataRefs: z.array(nonEmptyStringSchema).min(1).optional(),
    sourceRefs: z.array(nonEmptyStringSchema).min(1),
    collectedAt: isoDateTimeSchema,
    staleAfter: isoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    const featureRefs = value.featureRefs ?? [];
    for (const [index, featureScore] of (value.featureScores ?? []).entries()) {
      if (!featureRefs.includes(featureScore.featureRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["featureScores", index, "featureRef"],
          message: "featureScore.featureRef must be included in featureRefs"
        });
      }
    }
  });

export const historicalMarketSnapshotSchema = z
  .object({
    snapshotId: nonEmptyStringSchema,
    market: marketSchema,
    symbol: nonEmptyStringSchema,
    name: nonEmptyStringSchema.optional(),
    assetType: assetTypeSchema.optional(),
    assetClass: assetClassSchema.optional(),
    region: assetRegionSchema.optional(),
    riskTags: z.array(assetRiskTagSchema).optional(),
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

export const portfolioAllocationSchema = z
  .object({
    policyName: nonEmptyStringSchema,
    targetExposureRatio: ratioSchema,
    minCashReserveRatio: ratioSchema,
    maxBudgetPerDecisionRatio: ratioSchema,
    maxSymbolExposureRatio: ratioSchema,
    deploymentRampDays: z.number().int().positive().optional(),
    rampDayIndex: z.number().int().positive().optional(),
    maxInitialDeploymentRatio: ratioSchema.optional(),
    maxDailyGrossBuyRatio: ratioSchema.optional(),
    maxInitialOpenPositions: z.number().int().nonnegative().optional(),
    maxNewPositionsPerDay: z.number().int().nonnegative().optional(),
    maxConcurrentPositions: z.number().int().nonnegative().optional(),
    positionSlotRampDays: z.number().int().positive().optional(),
    marketTargetExposureRatios: z
      .partialRecord(marketSchema, ratioSchema)
      .optional(),
    currentExposureRatio: ratioSchema,
    currentCashRatio: ratioSchema,
    targetCashRatio: ratioSchema,
    targetExposureGapRatio: ratioSchema,
    targetExposureGapKrw: moneyKrwSchema,
    maxAdditionalBuyBudgetKrw: moneyKrwSchema,
    maxBudgetPerDecisionKrw: moneyKrwSchema,
    maxSymbolExposureKrw: moneyKrwSchema,
    minCashReserveKrw: moneyKrwSchema,
    scheduledExposureCeilingRatio: ratioSchema.optional(),
    scheduledExposureHeadroomKrw: moneyKrwSchema.optional(),
    maxDailyGrossBuyBudgetKrw: moneyKrwSchema.optional(),
    opportunityReserveRatio: ratioSchema.optional(),
    scheduledOpenPositionCeiling: z.number().int().nonnegative().optional(),
    remainingScheduledOpenPositionSlots: z
      .number()
      .int()
      .nonnegative()
      .optional(),
    remainingNewPositionSlots: z.number().int().nonnegative().optional(),
    marketAllocations: z
      .partialRecord(
        marketSchema,
        z
          .object({
            market: marketSchema,
            targetExposureRatio: ratioSchema,
            scheduledTargetExposureRatio: ratioSchema.optional(),
            currentExposureRatio: ratioSchema,
            targetExposureGapRatio: ratioSchema,
            targetExposureGapKrw: moneyKrwSchema,
            maxAdditionalBuyBudgetKrw: moneyKrwSchema,
            currentOpenPositionCount: z.number().int().nonnegative().optional(),
            scheduledOpenPositionCeiling: z
              .number()
              .int()
              .nonnegative()
              .optional(),
            remainingScheduledOpenPositionSlots: z
              .number()
              .int()
              .nonnegative()
              .optional()
          })
          .strict()
      )
      .optional()
  })
  .strict();

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
      .strict(),
    portfolioAllocation: portfolioAllocationSchema.optional()
  })
  .strict();

export const replayResearchManifestSchema = z
  .object({
    manifestVersion: z.literal("replay_research_manifest.v1"),
    mode: z.literal("paper_only"),
    runId: nonEmptyStringSchema,
    batchId: nonEmptyStringSchema.nullable(),
    createdAt: isoDateTimeSchema,
    configHash: sha256HashSchema,
    dataSnapshotHash: sha256HashSchema,
    universeHash: sha256HashSchema,
    coverageHash: sha256HashSchema,
    promptHash: sha256HashSchema,
    schemaHash: sha256HashSchema,
    riskPolicyHash: sha256HashSchema,
    costModelHash: sha256HashSchema,
    executionModelVersion: nonEmptyStringSchema,
    warnings: z.array(nonEmptyStringSchema).default([])
  })
  .strict();

export const virtualDecisionClaimSupportSchema = z
  .object({
    claim: nonEmptyStringSchema,
    dataRefs: z.array(nonEmptyStringSchema).optional(),
    featureRefs: z.array(nonEmptyStringSchema).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const refCount =
      (value.dataRefs?.length ?? 0) + (value.featureRefs?.length ?? 0);
    if (refCount === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataRefs"],
        message: "Claim support must include at least one dataRef or featureRef"
      });
    }
  });

export const virtualDecisionConfidenceBreakdownSchema = z
  .object({
    modelConfidence: ratioSchema,
    evidenceQualityScore: z.number().min(0).max(100),
    dataCompletenessScore: z.number().min(0).max(100),
    policyEligibilityScore: z.number().min(0).max(100),
    executionRiskScore: z.number().min(0).max(100),
    overallScore: z.number().min(0).max(100),
    reasonCodes: z.array(nonEmptyStringSchema).min(1)
  })
  .strict();

export const virtualDecisionItemSchema = z
  .object({
    symbol: nonEmptyStringSchema,
    market: marketSchema,
    action: virtualActionSchema,
    holdReasonCode: virtualHoldReasonCodeSchema.optional(),
    confidence: ratioSchema,
    budgetKrw: moneyKrwSchema,
    maxBudgetKrw: moneyKrwSchema.optional(),
    sellQuantity: z.number().positive().optional(),
    sellRatio: z.number().gt(0).max(1).optional(),
    targetWeightPct: ratioSchema.optional(),
    sellAll: z.boolean().optional(),
    reduceOnly: z.boolean().optional(),
    thesis: nonEmptyStringSchema,
    riskFactors: z.array(nonEmptyStringSchema),
    dataRefs: z.array(nonEmptyStringSchema).min(1),
    featureRefs: z.array(nonEmptyStringSchema).optional(),
    claimSupport: z.array(virtualDecisionClaimSupportSchema).optional(),
    confidenceBreakdown: virtualDecisionConfidenceBreakdownSchema.optional(),
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

    if (
      value.action === "VIRTUAL_SELL" &&
      !hasVirtualSellSizing(value)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budgetKrw"],
        message:
          "Sell decisions must include budgetKrw, sellQuantity, sellRatio, targetWeightPct, or sellAll"
      });
    }

    if (value.action === "VIRTUAL_SELL" && value.reduceOnly === false) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reduceOnly"],
        message: "Sell decisions must be reduce-only"
      });
    }

    if (
      value.action === "VIRTUAL_SELL" &&
      hasVirtualSellSizingV2(value) &&
      value.reduceOnly !== true
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reduceOnly"],
        message: "V2 sell sizing must set reduceOnly to true"
      });
    }
  });

export const virtualDecisionSchema = z
  .object({
    packetId: nonEmptyStringSchema,
    packetHash: nonEmptyStringSchema.optional(),
    decisionHash: nonEmptyStringSchema.optional(),
    promptVersion: nonEmptyStringSchema.optional(),
    modelId: nonEmptyStringSchema.optional(),
    schemaVersion: nonEmptyStringSchema.optional(),
    policyVersion: nonEmptyStringSchema.optional(),
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
    sourcePriceKrw: moneyKrwSchema.optional(),
    priceKrw: moneyKrwSchema,
    fillPriceRule: z.enum(["current_candidate_last_price"]).optional(),
    grossAmountKrw: moneyKrwSchema.optional(),
    amountKrw: moneyKrwSchema,
    netAmountKrw: moneyKrwSchema.optional(),
    feeKrw: moneyKrwSchema.optional(),
    taxKrw: moneyKrwSchema.optional(),
    slippageKrw: moneyKrwSchema.optional(),
    spreadCostKrw: moneyKrwSchema.optional(),
    impactCostKrw: moneyKrwSchema.optional(),
    totalCostKrw: moneyKrwSchema.optional(),
    costModelVersion: nonEmptyStringSchema.optional(),
    requestedNotionalKrw: moneyKrwSchema.optional(),
    filledNotionalKrw: moneyKrwSchema.optional(),
    fillStatus: z.enum(["filled", "partial", "rejected"]).optional(),
    liquidityStatus: z
      .enum(["not_modeled", "sufficient", "partial", "rejected", "stale"])
      .optional(),
    participationRate: ratioSchema.optional(),
    maxParticipationRate: ratioSchema.optional(),
    volume: z.number().nonnegative().optional(),
    averageVolume: z.number().nonnegative().optional(),
    realizedPnlKrw: z.number().optional(),
    priceSourceRefs: z.array(nonEmptyStringSchema).optional(),
    fillRatio: z.number().gt(0).max(1).optional(),
    fractionalShares: z.boolean().optional(),
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
export type AssetType = z.infer<typeof assetTypeSchema>;
export type AssetClass = z.infer<typeof assetClassSchema>;
export type AssetRegion = z.infer<typeof assetRegionSchema>;
export type AssetRiskTag = z.infer<typeof assetRiskTagSchema>;
export type VirtualAction = z.infer<typeof virtualActionSchema>;
export type VirtualHoldReasonCode = z.infer<typeof virtualHoldReasonCodeSchema>;
export type VirtualBudgetTier = z.infer<typeof virtualBudgetTierSchema>;
export type MarketCandidateFeatureScoreType = z.infer<
  typeof marketCandidateFeatureScoreTypeSchema
>;
export type VirtualPosition = z.infer<typeof virtualPositionSchema>;
export type VirtualPortfolio = z.infer<typeof virtualPortfolioSchema>;
export type MarketCandidateFeatureScore = z.infer<
  typeof marketCandidateFeatureScoreSchema
>;
export type MarketCandidate = z.infer<typeof marketCandidateSchema>;
export type HistoricalMarketSnapshot = z.infer<
  typeof historicalMarketSnapshotSchema
>;
export type PortfolioAllocation = z.infer<typeof portfolioAllocationSchema>;
export type MarketPacket = z.infer<typeof marketPacketSchema>;
export type Sha256Hash = z.infer<typeof sha256HashSchema>;
export type ReplayResearchManifest = z.infer<
  typeof replayResearchManifestSchema
>;
export type VirtualDecisionClaimSupport = z.infer<
  typeof virtualDecisionClaimSupportSchema
>;
export type VirtualDecisionConfidenceBreakdown = z.infer<
  typeof virtualDecisionConfidenceBreakdownSchema
>;
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

function hasVirtualSellSizing(value: {
  budgetKrw: number;
  sellQuantity?: number | undefined;
  sellRatio?: number | undefined;
  targetWeightPct?: number | undefined;
  sellAll?: boolean | undefined;
}): boolean {
  return (
    value.budgetKrw > 0 ||
    value.sellQuantity !== undefined ||
    value.sellRatio !== undefined ||
    value.targetWeightPct !== undefined ||
    value.sellAll === true
  );
}

function hasVirtualSellSizingV2(value: {
  sellQuantity?: number | undefined;
  sellRatio?: number | undefined;
  targetWeightPct?: number | undefined;
  sellAll?: boolean | undefined;
}): boolean {
  return (
    value.sellQuantity !== undefined ||
    value.sellRatio !== undefined ||
    value.targetWeightPct !== undefined ||
    value.sellAll === true
  );
}
