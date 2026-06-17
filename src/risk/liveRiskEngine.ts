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

interface NormalizedLiveRiskEvaluationInput {
  intent: LiveOrderIntent;
  snapshot: LiveRiskSnapshot;
  policy: unknown;
  initialRejectCodes: LiveRiskRejectCode[];
}

const INVALID_ORDER_INTENT_ID = "invalid_order_intent";
const INVALID_SIGNAL_ID = "invalid_signal";
const INVALID_IDEMPOTENCY_KEY = "invalid_idempotency_key";
const INVALID_RISK_SNAPSHOT_REF = "invalid_risk_snapshot";
const INVALID_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export class LiveRiskEngine {
  evaluate(input: LiveRiskInput): LiveRiskDecision {
    const normalizedInput = normalizeLiveRiskEvaluationInput(input);
    const { intent, snapshot, policy: rawPolicy } = normalizedInput;
    const policy = createLiveRiskPolicy({ policy: rawPolicy });
    const rejectCodes: LiveRiskRejectCode[] = [
      ...normalizedInput.initialRejectCodes
    ];
    const normalizedSymbol = safeNormalizeLiveRiskSymbol(intent.symbol);

    evaluateRiskPolicyShape(rejectCodes, rawPolicy);
    evaluateOrderIntentShape(rejectCodes, intent);
    evaluateRiskSnapshotShape(rejectCodes, snapshot);
    evaluateKillSwitch(rejectCodes, policy);
    evaluateStaleSignal(rejectCodes, intent, policy);
    evaluateOrderAmount(rejectCodes, intent, policy);
    evaluateRiskSnapshotFreshness(rejectCodes, snapshot, policy);
    evaluateDailyLoss(rejectCodes, snapshot, policy);
    evaluateAllowlists(rejectCodes, intent.market, normalizedSymbol, policy);
    evaluateMarketHours(rejectCodes, intent.market, snapshot, policy);
    evaluateDuplicateOrder(
      rejectCodes,
      intent,
      normalizedSymbol,
      snapshot
    );
    evaluateCooldown(rejectCodes, intent, normalizedSymbol, policy);
    evaluateOpenOrderCount(rejectCodes, snapshot, policy);
    evaluateMarketOrderPolicy(rejectCodes, intent, policy);
    evaluateSellPosition(rejectCodes, intent, normalizedSymbol, snapshot);
    evaluatePreviewRequirement(rejectCodes, intent, policy);
    evaluateExposure(
      rejectCodes,
      intent,
      normalizedSymbol,
      snapshot,
      policy
    );

    return {
      riskDecisionId: `risk_${intent.orderIntentId}_${snapshot.riskSnapshotRef}`,
      orderIntentId: intent.orderIntentId,
      signalId: intent.signalId,
      approved: rejectCodes.length === 0,
      rejectCodes: normalizeLiveRiskRejectCodes(rejectCodes),
      checkedRules: [...LIVE_RISK_RULE_IDS],
      riskSnapshotRef: snapshot.riskSnapshotRef,
      createdAt: policy.now.toISOString()
    };
  }
}

function evaluateRiskPolicyShape(
  rejectCodes: LiveRiskRejectCode[],
  policy: unknown
): void {
  if (hasInvalidLiveRiskPolicyInput(policy)) {
    appendLiveRiskRejectCode(rejectCodes, "INVALID_RISK_POLICY");
  }
}

function normalizeLiveRiskEvaluationInput(
  input: unknown
): NormalizedLiveRiskEvaluationInput {
  const inputRecord = isRecord(input) ? input : undefined;
  const rawIntent = inputRecord?.intent;
  const rawSnapshot = inputRecord?.snapshot;
  const initialRejectCodes: LiveRiskRejectCode[] = [];

  if (!isLiveOrderIntentInput(rawIntent)) {
    appendLiveRiskRejectCode(initialRejectCodes, "INVALID_ORDER_INTENT");
  }
  if (!isLiveRiskSnapshotInput(rawSnapshot)) {
    appendLiveRiskRejectCode(initialRejectCodes, "INVALID_RISK_SNAPSHOT");
  }

  return {
    intent: createSafeOrderIntent(rawIntent),
    snapshot: createSafeRiskSnapshot(rawSnapshot),
    policy: inputRecord?.policy,
    initialRejectCodes
  };
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
    !isParseableTimestamp(intent.createdAt) ||
    !isParseableTimestamp(intent.expiresAt) ||
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

  if (
    !isNonEmptyString(snapshot.riskSnapshotRef) ||
    !isParseableTimestamp(snapshot.capturedAt) ||
    !isNonNegativeFiniteNumber(snapshot.dailyLossKrw)
  ) {
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

function createSafeOrderIntent(value: unknown): LiveOrderIntent {
  const record = isRecord(value) ? value : {};
  return {
    orderIntentId: safeNonEmptyString(
      record.orderIntentId,
      INVALID_ORDER_INTENT_ID
    ),
    signalId: safeNonEmptyString(record.signalId, INVALID_SIGNAL_ID),
    idempotencyKey: safeNonEmptyString(
      record.idempotencyKey,
      INVALID_IDEMPOTENCY_KEY
    ),
    market: isLiveMarket(record.market) ? record.market : "KR",
    symbol: safeNonEmptyString(record.symbol, ""),
    side: isLiveOrderSide(record.side) ? record.side : "BUY",
    orderType: isLiveOrderType(record.orderType) ? record.orderType : "LIMIT",
    quantity: isPositiveFiniteNumber(record.quantity) ? record.quantity : 0,
    estimatedGrossAmountKrw: isPositiveFiniteNumber(
      record.estimatedGrossAmountKrw
    )
      ? record.estimatedGrossAmountKrw
      : 0,
    createdAt: safeTimestamp(record.createdAt),
    expiresAt: safeTimestamp(record.expiresAt),
    preview: safeOrderPreview(record.preview),
    approvals: createSafeOrderApprovals(record.approvals)
  };
}

function createSafeRiskSnapshot(value: unknown): LiveRiskSnapshot {
  const record = isRecord(value) ? value : {};
  return {
    riskSnapshotRef: safeNonEmptyString(
      record.riskSnapshotRef,
      INVALID_RISK_SNAPSHOT_REF
    ),
    capturedAt: safeTimestamp(record.capturedAt),
    dailyLossKrw: isNonNegativeFiniteNumber(record.dailyLossKrw)
      ? record.dailyLossKrw
      : 0,
    positions: Array.isArray(record.positions)
      ? record.positions.filter(isLiveRiskPosition)
      : [],
    openOrders: Array.isArray(record.openOrders)
      ? record.openOrders.filter(isLiveOpenOrder)
      : [],
    marketSessions: createSafeMarketSessions(record.marketSessions)
  };
}

function createSafeOrderApprovals(
  value: unknown
): LiveOrderIntent["approvals"] {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value.marketOrderApproved === "boolean"
    ? { marketOrderApproved: value.marketOrderApproved }
    : {};
}

function createSafeMarketSessions(
  value: unknown
): Partial<Record<Market, LiveMarketSessionStatus>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([market, status]) =>
        isLiveMarket(market) && isLiveMarketSessionStatus(status)
    )
  ) as Partial<Record<Market, LiveMarketSessionStatus>>;
}

function isLiveOrderIntentInput(value: unknown): value is LiveOrderIntent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.orderIntentId) &&
    isNonEmptyString(value.signalId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isLiveMarket(value.market) &&
    isNonEmptyString(value.symbol) &&
    isLiveOrderSide(value.side) &&
    isLiveOrderType(value.orderType) &&
    isPositiveFiniteNumber(value.quantity) &&
    isPositiveFiniteNumber(value.estimatedGrossAmountKrw) &&
    isParseableTimestamp(value.createdAt) &&
    isParseableTimestamp(value.expiresAt) &&
    (value.preview === undefined || isLiveOrderPreviewRef(value.preview)) &&
    (value.approvals === undefined || isLiveOrderApprovals(value.approvals))
  );
}

function isLiveRiskSnapshotInput(value: unknown): value is LiveRiskSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.riskSnapshotRef) &&
    isParseableTimestamp(value.capturedAt) &&
    isNonNegativeFiniteNumber(value.dailyLossKrw) &&
    Array.isArray(value.positions) &&
    value.positions.every(isLiveRiskPosition) &&
    Array.isArray(value.openOrders) &&
    value.openOrders.every(isLiveOpenOrder) &&
    isLiveMarketSessions(value.marketSessions)
  );
}

function isLiveRiskPosition(value: unknown): value is LiveRiskPosition {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isLiveMarket(value.market) &&
    isNonEmptyString(value.symbol) &&
    isNonNegativeFiniteNumber(value.quantity) &&
    isNonNegativeFiniteNumber(value.averagePriceKrw) &&
    (value.marketValueKrw === undefined ||
      isNonNegativeFiniteNumber(value.marketValueKrw))
  );
}

function isLiveOpenOrder(value: unknown): value is LiveOpenOrder {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isNonEmptyString(value.orderIntentId) ||
    (value.signalId !== undefined && !isNonEmptyString(value.signalId)) ||
    !isNonEmptyString(value.idempotencyKey) ||
    !isLiveMarket(value.market) ||
    !isNonEmptyString(value.symbol) ||
    !isLiveOrderSide(value.side)
  ) {
    return false;
  }
  if (
    value.side === "BUY" &&
    !isPositiveFiniteNumber(value.estimatedGrossAmountKrw)
  ) {
    return false;
  }
  return value.side !== "SELL" || isPositiveFiniteNumber(value.quantity);
}

function isLiveOrderApprovals(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.marketOrderApproved === undefined ||
      typeof value.marketOrderApproved === "boolean")
  );
}

function isLiveMarketSessions(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([market, status]) =>
        isLiveMarket(market) && isLiveMarketSessionStatus(status)
    )
  );
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

function evaluateRiskSnapshotFreshness(
  rejectCodes: LiveRiskRejectCode[],
  snapshot: LiveRiskSnapshot,
  policy: LiveRiskPolicy
): void {
  const capturedAtMs = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAtMs)) {
    return;
  }

  const nowMs = policy.now.getTime();
  if (
    capturedAtMs > nowMs ||
    nowMs - capturedAtMs > policy.maxSnapshotAgeMs
  ) {
    appendLiveRiskRejectCode(rejectCodes, "RISK_SNAPSHOT_STALE");
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
  const positionExposure = safeRiskPositions(snapshot.positions)
    .filter(
      (position) =>
        position.market === market &&
        safeNormalizeLiveRiskSymbol(position.symbol) === normalizedSymbol
    )
    .reduce((sum, position) => sum + positionExposureKrw(position), 0);
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
    isParseableTimestamp(value.expiresAt)
  );
}

function safeNonEmptyString(value: unknown, fallback: string): string {
  return isNonEmptyString(value) ? value : fallback;
}

function safeTimestamp(value: unknown): string {
  return isParseableTimestamp(value) ? value : INVALID_TIMESTAMP;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isParseableTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
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

function isLiveMarketSessionStatus(
  value: unknown
): value is LiveMarketSessionStatus {
  return value === "open" || value === "closed";
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
