import type { Market } from "../domain/schemas.js";
import {
  appendLiveRiskRejectCode,
  createLiveRiskPolicy,
  hasInvalidLiveRiskPolicyInput,
  LIVE_RISK_RULE_IDS,
  normalizeLiveRiskRejectCodes,
  normalizeLiveRiskSymbol,
  type LiveMarketSessionStatus,
  type LiveOrderSide,
  type LiveOrderType,
  type LiveRiskPolicy,
  type LiveRiskRejectCode
} from "./liveRiskPolicy.js";

export type {
  LiveMarketOrderPolicy,
  LiveMarketSessionStatus,
  LiveOrderSide,
  LiveOrderType,
  LiveRiskCooldownEntry,
  LiveRiskPolicy,
  LiveRiskRejectCode,
  LiveRiskRuleId
} from "./liveRiskPolicy.js";

export interface LiveOrderPreviewRef {
  previewId: string;
  orderIntentId: string;
  estimatedGrossAmountKrw: number;
  expiresAt: string;
}

export interface LiveOrderIntent {
  orderIntentId: string;
  signalId: string;
  idempotencyKey: string;
  market: Market;
  symbol: string;
  side: LiveOrderSide;
  orderType: LiveOrderType;
  quantity: number;
  estimatedGrossAmountKrw: number;
  createdAt: string;
  expiresAt: string;
  preview?: LiveOrderPreviewRef | undefined;
  approvals?: {
    marketOrderApproved?: boolean | undefined;
  } | undefined;
}

export interface LiveRiskPosition {
  market: Market;
  symbol: string;
  quantity: number;
  averagePriceKrw: number;
  marketValueKrw?: number | undefined;
}

export interface LiveOpenOrder {
  orderIntentId: string;
  signalId?: string | undefined;
  idempotencyKey: string;
  market: Market;
  symbol: string;
  side: LiveOrderSide;
  estimatedGrossAmountKrw?: number | undefined;
  quantity?: number | undefined;
}

export interface LiveRiskSnapshot {
  riskSnapshotRef: string;
  capturedAt: string;
  dailyLossKrw: number;
  positions: readonly LiveRiskPosition[];
  openOrders: readonly LiveOpenOrder[];
  marketSessions: Partial<Record<Market, LiveMarketSessionStatus>>;
}

export interface LiveRiskInput {
  intent: LiveOrderIntent;
  snapshot: LiveRiskSnapshot;
  policy?: Partial<LiveRiskPolicy> | undefined;
}

export interface LiveRiskDecision {
  riskDecisionId: string;
  orderIntentId: string;
  signalId: string;
  approved: boolean;
  rejectCodes: LiveRiskRejectCode[];
  checkedRules: string[];
  riskSnapshotRef: string;
  createdAt: string;
}

export class LiveRiskEngine {
  evaluate(input: LiveRiskInput): LiveRiskDecision {
    const policy = createLiveRiskPolicy({ policy: input.policy });
    const rejectCodes: LiveRiskRejectCode[] = [];
    const normalizedSymbol = safeNormalizeLiveRiskSymbol(input.intent.symbol);

    evaluateRiskPolicyShape(rejectCodes, input.policy);
    evaluateOrderIntentShape(rejectCodes, input.intent);
    evaluateRiskSnapshotShape(rejectCodes, input.snapshot);
    evaluateKillSwitch(rejectCodes, policy);
    evaluateStaleSignal(rejectCodes, input.intent, policy);
    evaluateOrderAmount(rejectCodes, input.intent, policy);
    evaluateDailyLoss(rejectCodes, input.snapshot, policy);
    evaluateAllowlists(rejectCodes, input.intent.market, normalizedSymbol, policy);
    evaluateMarketHours(rejectCodes, input.intent.market, input.snapshot, policy);
    evaluateDuplicateOrder(
      rejectCodes,
      input.intent,
      normalizedSymbol,
      input.snapshot
    );
    evaluateCooldown(rejectCodes, input.intent, normalizedSymbol, policy);
    evaluateOpenOrderCount(rejectCodes, input.snapshot, policy);
    evaluateMarketOrderPolicy(rejectCodes, input.intent, policy);
    evaluateSellPosition(rejectCodes, input.intent, normalizedSymbol, input.snapshot);
    evaluatePreviewRequirement(rejectCodes, input.intent, policy);
    evaluateExposure(
      rejectCodes,
      input.intent,
      normalizedSymbol,
      input.snapshot,
      policy
    );

    return {
      riskDecisionId: `risk_${input.intent.orderIntentId}_${input.snapshot.riskSnapshotRef}`,
      orderIntentId: input.intent.orderIntentId,
      signalId: input.intent.signalId,
      approved: rejectCodes.length === 0,
      rejectCodes: normalizeLiveRiskRejectCodes(rejectCodes),
      checkedRules: [...LIVE_RISK_RULE_IDS],
      riskSnapshotRef: input.snapshot.riskSnapshotRef,
      createdAt: policy.now.toISOString()
    };
  }
}

function evaluateRiskPolicyShape(
  rejectCodes: LiveRiskRejectCode[],
  policy: Partial<LiveRiskPolicy> | undefined
): void {
  if (hasInvalidLiveRiskPolicyInput(policy)) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_RISK_POLICY");
  }
}

function evaluateOrderIntentShape(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent
): void {
  if (
    !isNonEmptyString(intent.orderIntentId) ||
    !isNonEmptyString(intent.signalId) ||
    !isNonEmptyString(intent.idempotencyKey) ||
    !isLiveMarket(intent.market) ||
    !isNonEmptyString(intent.symbol) ||
    !isLiveOrderSide(intent.side) ||
    !isLiveOrderType(intent.orderType) ||
    !isPositiveFiniteNumber(intent.quantity) ||
    !isPositiveFiniteNumber(intent.estimatedGrossAmountKrw) ||
    hasInvalidOrderPreviewShape(intent.preview)
  ) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_ORDER_INTENT");
  }
}

function evaluateRiskSnapshotShape(
  rejectCodes: LiveRiskRejectCode[],
  snapshot: LiveRiskSnapshot
): void {
  const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
  const openOrders = Array.isArray(snapshot.openOrders)
    ? snapshot.openOrders
    : [];

  if (!isNonNegativeFiniteNumber(snapshot.dailyLossKrw)) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_RISK_SNAPSHOT");
  }

  if (
    !Array.isArray(snapshot.positions) ||
    !Array.isArray(snapshot.openOrders) ||
    !isRecord(snapshot.marketSessions)
  ) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_RISK_SNAPSHOT");
  }

  const hasInvalidPosition = positions.some((position) => {
    if (!isRecord(position)) {
      return true;
    }
    if (
      !isLiveMarket(position.market) ||
      !isNonEmptyString(position.symbol) ||
      !isNonNegativeFiniteNumber(position.quantity) ||
      !isNonNegativeFiniteNumber(position.averagePriceKrw)
    ) {
      return true;
    }
    return (
      position.marketValueKrw !== undefined &&
      !isNonNegativeFiniteNumber(position.marketValueKrw)
    );
  });

  if (hasInvalidPosition) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_RISK_SNAPSHOT");
  }

  const hasInvalidOpenOrder = openOrders.some((openOrder) => {
    if (!isRecord(openOrder)) {
      return true;
    }
    if (
      !isNonEmptyString(openOrder.orderIntentId) ||
      (openOrder.signalId !== undefined &&
        !isNonEmptyString(openOrder.signalId)) ||
      !isNonEmptyString(openOrder.idempotencyKey) ||
      !isLiveMarket(openOrder.market) ||
      !isNonEmptyString(openOrder.symbol) ||
      !isLiveOrderSide(openOrder.side)
    ) {
      return true;
    }
    if (
      openOrder.side === "BUY" &&
      !isPositiveFiniteNumber(openOrder.estimatedGrossAmountKrw)
    ) {
      return true;
    }
    return (
      openOrder.side === "SELL" &&
      !isPositiveFiniteNumber(openOrder.quantity)
    );
  });

  if (hasInvalidOpenOrder) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_RISK_SNAPSHOT");
  }
}

function evaluateKillSwitch(
  rejectCodes: LiveRiskRejectCode[],
  policy: LiveRiskPolicy
): void {
  if (policy.killSwitch) {
    appendLiveRiskRejectCode(rejectCodes, "KILL_SWITCH_ACTIVE");
  }
}

function evaluateStaleSignal(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  policy: LiveRiskPolicy
): void {
  if (!isFresh(intent.expiresAt, policy.now)) {
    appendLiveRiskRejectCode(rejectCodes, "SIGNAL_STALE");
  }
}

function evaluateOrderAmount(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  policy: LiveRiskPolicy
): void {
  if (intent.estimatedGrossAmountKrw > policy.maxOrderAmountKrw) {
    appendLiveRiskRejectCode(rejectCodes, "MAX_ORDER_AMOUNT_EXCEEDED");
  }
}

function evaluateDailyLoss(
  rejectCodes: LiveRiskRejectCode[],
  snapshot: LiveRiskSnapshot,
  policy: LiveRiskPolicy
): void {
  if (snapshot.dailyLossKrw > policy.maxDailyLossKrw) {
    appendLiveRiskRejectCode(rejectCodes, "MAX_DAILY_LOSS_EXCEEDED");
  }
}

function evaluateAllowlists(
  rejectCodes: LiveRiskRejectCode[],
  market: Market,
  normalizedSymbol: string,
  policy: LiveRiskPolicy
): void {
  if (!policy.allowedSymbols.includes(normalizedSymbol)) {
    appendLiveRiskRejectCode(rejectCodes, "SYMBOL_NOT_ALLOWED");
  }

  if (!policy.allowedMarkets.includes(market)) {
    appendLiveRiskRejectCode(rejectCodes, "MARKET_NOT_ALLOWED");
  }
}

function evaluateMarketHours(
  rejectCodes: LiveRiskRejectCode[],
  market: Market,
  snapshot: LiveRiskSnapshot,
  policy: LiveRiskPolicy
): void {
  if (!policy.requireMarketOpen) {
    return;
  }

  const session = safeMarketSessions(snapshot.marketSessions)[market];
  if (session === undefined) {
    appendLiveRiskRejectCode(rejectCodes, "MARKET_HOURS_UNKNOWN");
    return;
  }
  if (session !== "open") {
    appendLiveRiskRejectCode(rejectCodes, "MARKET_CLOSED");
  }
}

function evaluateDuplicateOrder(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  normalizedSymbol: string,
  snapshot: LiveRiskSnapshot
): void {
  for (const openOrder of safeOpenOrders(snapshot.openOrders)) {
    if (openOrder.orderIntentId === intent.orderIntentId) {
      appendLiveRiskRejectCode(rejectCodes, "DUPLICATE_ORDER_INTENT");
    }

    if (openOrder.idempotencyKey === intent.idempotencyKey) {
      appendLiveRiskRejectCode(rejectCodes, "IDEMPOTENCY_KEY_REUSED");
    }

    if (
      openOrder.signalId === intent.signalId &&
      openOrder.market === intent.market &&
      safeNormalizeLiveRiskSymbol(openOrder.symbol) === normalizedSymbol &&
      openOrder.side === intent.side
    ) {
      appendLiveRiskRejectCode(rejectCodes, "DUPLICATE_ORDER_INTENT");
    }
  }
}

function evaluateCooldown(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  normalizedSymbol: string,
  policy: LiveRiskPolicy
): void {
  const active = policy.cooldownEntries.some((entry) => {
    if (!isFresh(entry.activeUntil, policy.now)) {
      return false;
    }
    if (entry.market !== undefined && entry.market !== intent.market) {
      return false;
    }
    if (normalizeLiveRiskSymbol(entry.symbol) !== normalizedSymbol) {
      return false;
    }
    return entry.side === undefined || entry.side === intent.side;
  });

  if (active) {
    appendLiveRiskRejectCode(rejectCodes, "COOLDOWN_ACTIVE");
  }
}

function evaluateOpenOrderCount(
  rejectCodes: LiveRiskRejectCode[],
  snapshot: LiveRiskSnapshot,
  policy: LiveRiskPolicy
): void {
  if (safeOpenOrders(snapshot.openOrders).length >= policy.maxOpenOrders) {
    appendLiveRiskRejectCode(rejectCodes, "OPEN_ORDER_LIMIT_EXCEEDED");
  }
}

function evaluateMarketOrderPolicy(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  policy: LiveRiskPolicy
): void {
  if (intent.orderType !== "MARKET") {
    return;
  }

  if (policy.marketOrderPolicy === "disabled") {
    appendLiveRiskRejectCode(rejectCodes, "MARKET_ORDER_DISABLED");
    return;
  }

  if (
    policy.marketOrderPolicy === "requires_approval" &&
    intent.approvals?.marketOrderApproved !== true
  ) {
    appendLiveRiskRejectCode(rejectCodes, "MARKET_ORDER_REQUIRES_APPROVAL");
  }
}

function evaluateSellPosition(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  normalizedSymbol: string,
  snapshot: LiveRiskSnapshot
): void {
  if (intent.side !== "SELL") {
    return;
  }

  const position = findPosition(snapshot, intent.market, normalizedSymbol);
  if (position === undefined) {
    appendLiveRiskRejectCode(rejectCodes, "POSITION_NOT_FOUND");
    return;
  }

  const pendingSellQuantity = currentOpenSellQuantity(
    snapshot,
    intent.market,
    normalizedSymbol
  );

  if (intent.quantity + pendingSellQuantity > position.quantity) {
    appendLiveRiskRejectCode(rejectCodes, "SELL_QUANTITY_EXCEEDED");
  }
}

function evaluatePreviewRequirement(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  policy: LiveRiskPolicy
): void {
  if (!policy.requirePreview) {
    return;
  }

  if (intent.preview === undefined) {
    appendLiveRiskRejectCode(rejectCodes, "PREVIEW_REQUIRED");
    return;
  }

  const preview = safeOrderPreview(intent.preview);
  if (preview === undefined) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_ORDER_INTENT");
    return;
  }

  if (!isFresh(preview.expiresAt, policy.now)) {
    appendLiveRiskRejectCode(rejectCodes, "PREVIEW_EXPIRED");
  }

  if (
    preview.orderIntentId !== intent.orderIntentId ||
    preview.estimatedGrossAmountKrw !== intent.estimatedGrossAmountKrw
  ) {
    appendLiveRiskRejectCode(rejectCodes, "PREVIEW_MISMATCH");
  }
}

function evaluateExposure(
  rejectCodes: LiveRiskRejectCode[],
  intent: LiveOrderIntent,
  normalizedSymbol: string,
  snapshot: LiveRiskSnapshot,
  policy: LiveRiskPolicy
): void {
  if (intent.side !== "BUY") {
    return;
  }

  const additionalExposure = intent.estimatedGrossAmountKrw;
  const symbolExposure =
    currentSymbolExposureKrw(snapshot, intent.market, normalizedSymbol) +
    additionalExposure;
  const marketExposure =
    currentMarketExposureKrw(snapshot, intent.market) + additionalExposure;
  const totalExposure = currentTotalExposureKrw(snapshot) + additionalExposure;

  if (symbolExposure > policy.maxSymbolExposureKrw) {
    appendLiveRiskRejectCode(rejectCodes, "MAX_SYMBOL_EXPOSURE_EXCEEDED");
  }
  if (marketExposure > policy.maxMarketExposureKrw) {
    appendLiveRiskRejectCode(rejectCodes, "MAX_MARKET_EXPOSURE_EXCEEDED");
  }
  if (totalExposure > policy.maxTotalExposureKrw) {
    appendLiveRiskRejectCode(rejectCodes, "MAX_TOTAL_EXPOSURE_EXCEEDED");
  }
}

function currentSymbolExposureKrw(
  snapshot: LiveRiskSnapshot,
  market: Market,
  normalizedSymbol: string
): number {
  const position = findPosition(snapshot, market, normalizedSymbol);
  const positionExposure =
    position === undefined ? 0 : positionExposureKrw(position);
  return (
    positionExposure +
    currentOpenBuySymbolExposureKrw(snapshot, market, normalizedSymbol)
  );
}

function currentMarketExposureKrw(
  snapshot: LiveRiskSnapshot,
  market: Market
): number {
  return safeRiskPositions(snapshot.positions)
    .filter((position) => position.market === market)
    .reduce((sum, position) => sum + positionExposureKrw(position), 0) +
    currentOpenBuyMarketExposureKrw(snapshot, market);
}

function currentTotalExposureKrw(snapshot: LiveRiskSnapshot): number {
  return safeRiskPositions(snapshot.positions).reduce(
    (sum, position) => sum + positionExposureKrw(position),
    0
  ) + currentOpenBuyTotalExposureKrw(snapshot);
}

function currentOpenBuySymbolExposureKrw(
  snapshot: LiveRiskSnapshot,
  market: Market,
  normalizedSymbol: string
): number {
  return safeOpenOrders(snapshot.openOrders)
    .filter(
      (openOrder) =>
        openOrder.side === "BUY" &&
        openOrder.market === market &&
        safeNormalizeLiveRiskSymbol(openOrder.symbol) === normalizedSymbol
    )
    .reduce((sum, openOrder) => sum + openOrderExposureKrw(openOrder), 0);
}

function currentOpenBuyMarketExposureKrw(
  snapshot: LiveRiskSnapshot,
  market: Market
): number {
  return safeOpenOrders(snapshot.openOrders)
    .filter(
      (openOrder) => openOrder.side === "BUY" && openOrder.market === market
    )
    .reduce((sum, openOrder) => sum + openOrderExposureKrw(openOrder), 0);
}

function currentOpenBuyTotalExposureKrw(snapshot: LiveRiskSnapshot): number {
  return safeOpenOrders(snapshot.openOrders)
    .filter((openOrder) => openOrder.side === "BUY")
    .reduce((sum, openOrder) => sum + openOrderExposureKrw(openOrder), 0);
}

function currentOpenSellQuantity(
  snapshot: LiveRiskSnapshot,
  market: Market,
  normalizedSymbol: string
): number {
  return safeOpenOrders(snapshot.openOrders)
    .filter(
      (openOrder) =>
        openOrder.side === "SELL" &&
        openOrder.market === market &&
        safeNormalizeLiveRiskSymbol(openOrder.symbol) === normalizedSymbol
    )
    .reduce((sum, openOrder) => sum + openOrderQuantity(openOrder), 0);
}

function findPosition(
  snapshot: LiveRiskSnapshot,
  market: Market,
  normalizedSymbol: string
): LiveRiskPosition | undefined {
  return safeRiskPositions(snapshot.positions).find(
    (position) =>
      position.market === market &&
      safeNormalizeLiveRiskSymbol(position.symbol) === normalizedSymbol
  );
}

function positionExposureKrw(position: LiveRiskPosition): number {
  return (
    position.marketValueKrw ??
    Math.round(position.quantity * position.averagePriceKrw)
  );
}

function isFresh(expiresAt: string, now: Date): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
}

function safeNormalizeLiveRiskSymbol(value: unknown): string {
  return isNonEmptyString(value) ? normalizeLiveRiskSymbol(value) : "";
}

function safeRiskPositions(value: unknown): readonly LiveRiskPosition[] {
  return Array.isArray(value)
    ? (value.filter(isRecord) as unknown as readonly LiveRiskPosition[])
    : [];
}

function safeOpenOrders(value: unknown): readonly LiveOpenOrder[] {
  return Array.isArray(value)
    ? (value.filter(isRecord) as unknown as readonly LiveOpenOrder[])
    : [];
}

function safeMarketSessions(
  value: unknown
): Partial<Record<Market, LiveMarketSessionStatus>> {
  return isRecord(value)
    ? (value as Partial<Record<Market, LiveMarketSessionStatus>>)
    : {};
}

function safeOrderPreview(value: unknown): LiveOrderPreviewRef | undefined {
  return isLiveOrderPreviewRef(value) ? value : undefined;
}

function hasInvalidOrderPreviewShape(value: unknown): boolean {
  return value !== undefined && !isLiveOrderPreviewRef(value);
}

function isLiveOrderPreviewRef(value: unknown): value is LiveOrderPreviewRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.previewId) &&
    isNonEmptyString(value.orderIntentId) &&
    isPositiveFiniteNumber(value.estimatedGrossAmountKrw) &&
    isNonEmptyString(value.expiresAt)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLiveMarket(value: unknown): value is Market {
  return value === "KR" || value === "US";
}

function isLiveOrderSide(value: unknown): value is LiveOrderSide {
  return value === "BUY" || value === "SELL";
}

function isLiveOrderType(value: unknown): value is LiveOrderType {
  return value === "LIMIT" || value === "MARKET";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openOrderExposureKrw(openOrder: LiveOpenOrder): number {
  return openOrder.estimatedGrossAmountKrw ?? 0;
}

function openOrderQuantity(openOrder: LiveOpenOrder): number {
  return openOrder.quantity ?? 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
