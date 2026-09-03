import {
  parsePortfolioRiskStateUpdateRecord,
  type PortfolioRiskStateUpdateRecord
} from "./portfolioRiskStateUpdate.js";
import {
  getVerifiedPortfolioRiskStateUpdateRecords,
  type VerifiedPortfolioRiskStateUpdateHistory
} from "./portfolioRiskStateUpdateFiles.js";
import {
  resolvePortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";
import {
  resolvePortfolioSizingSnapshot,
  type ResolvedPortfolioSizingSnapshot
} from "./portfolioSizingSnapshotResolver.js";
import {
  parseBucketEquityEvent,
  parseBucketRiskState,
  type BucketEquityEvent,
  type BucketRiskState
} from "./bucketEquity.js";

export interface ResolvedRiskBreachPortfolioCycleTrigger
  extends ResolvedPortfolioCycleTrigger {
  trigger: Extract<
    ResolvedPortfolioCycleTrigger["trigger"],
    { triggerKind: "risk_breach" }
  >;
  riskStateUpdate: PortfolioRiskStateUpdateRecord;
  marketMarkSnapshot?: ResolvedPortfolioSizingSnapshot["snapshot"];
  bucketRiskState?: BucketRiskState;
  bucketEquityEvent?: BucketEquityEvent;
}

/** Resolves a risk-breach trigger against a complete immutable update history. */
export function resolveRiskBreachPortfolioCycleTrigger(input: {
  value: unknown;
  riskStateUpdateHistory: VerifiedPortfolioRiskStateUpdateHistory;
  marketMarkSource?: unknown;
  bucketRiskStateSource?: unknown;
  bucketEquityEventSource?: unknown;
  expectedPortfolioId: string;
  expectedPolicyHash: string;
}): ResolvedRiskBreachPortfolioCycleTrigger {
  const resolved = resolvePortfolioCycleTrigger(input.value);
  if (resolved.trigger.triggerKind !== "risk_breach") {
    throw new Error(
      "risk-breach trigger resolver requires a risk_breach trigger"
    );
  }
  const trigger = resolved.trigger;
  const records = getVerifiedPortfolioRiskStateUpdateRecords(
    input.riskStateUpdateHistory
  ).map((record) => parsePortfolioRiskStateUpdateRecord(record));
  assertUniqueUpdateHistory(records);
  const matches = records.filter(
    (record) =>
      record.riskStateUpdateRecordId === trigger.riskStateUpdateRecordId
  );
  if (matches.length !== 1) {
    throw new Error(
      `risk-breach trigger update must resolve exactly once; resolved ${matches.length}`
    );
  }

  const riskStateUpdate = matches[0] as PortfolioRiskStateUpdateRecord;
  if (
    riskStateUpdate.portfolioId !== input.expectedPortfolioId ||
    riskStateUpdate.policyHash !== input.expectedPolicyHash
  ) {
    throw new Error("risk-breach trigger source scope mismatch");
  }
  if (
    riskStateUpdate.stateUpdateHash !== trigger.stateUpdateHash ||
    riskStateUpdate.stateUpdateKind !== trigger.stateUpdateKind ||
    riskStateUpdate.asOf !== trigger.stateUpdateAsOf
  ) {
    throw new Error(
      "risk-breach trigger does not match its immutable state update"
    );
  }
  const marketMarkSnapshot = resolveMarketMarkSource(
    riskStateUpdate,
    input.marketMarkSource
  );
  const bucketRiskState = resolveBucketRiskStateSource(
    riskStateUpdate,
    input.bucketRiskStateSource
  );
  const bucketEquityEvent = resolveBucketEquityEventSource(
    riskStateUpdate,
    input.bucketEquityEventSource
  );

  return deepFreeze({
    ...resolved,
    trigger,
    riskStateUpdate,
    ...(marketMarkSnapshot === undefined ? {} : { marketMarkSnapshot }),
    ...(bucketRiskState === undefined ? {} : { bucketRiskState }),
    ...(bucketEquityEvent === undefined ? {} : { bucketEquityEvent })
  });
}

function resolveMarketMarkSource(
  update: PortfolioRiskStateUpdateRecord,
  source: unknown
): ResolvedPortfolioSizingSnapshot["snapshot"] | undefined {
  if (update.stateUpdateKind !== "market_mark") {
    if (source !== undefined) {
      throw new Error(
        "market-mark source is allowed only for a market_mark update"
      );
    }
    return undefined;
  }
  if (source === undefined) {
    throw new Error("market_mark update requires its portfolio snapshot source");
  }
  const snapshot = resolvePortfolioSizingSnapshot(source).snapshot;
  if (
    snapshot.portfolioSnapshotId !== update.portfolioSnapshotId ||
    snapshot.portfolioSnapshotHash !== update.portfolioSnapshotHash
  ) {
    throw new Error("market_mark update origin identity mismatch");
  }
  if (
    snapshot.portfolioId !== update.portfolioId ||
    snapshot.policyHash !== update.policyHash ||
    snapshot.asOf !== update.asOf
  ) {
    throw new Error("market_mark update origin scope mismatch");
  }
  return snapshot;
}

function resolveBucketRiskStateSource(
  update: PortfolioRiskStateUpdateRecord,
  source: unknown
): BucketRiskState | undefined {
  if (update.stateUpdateKind !== "risk_state") {
    if (source !== undefined) {
      throw new Error(
        "bucket risk-state source is allowed only for a risk_state update"
      );
    }
    return undefined;
  }
  if (source === undefined) {
    throw new Error("risk_state update requires its bucket risk-state source");
  }
  const state = parseBucketRiskState(source);
  if (
    state.riskStateEpochId !== update.riskStateEpochId ||
    state.lastBucketEquityEventId !== update.lastBucketEquityEventId ||
    state.riskStateHash !== update.riskStateHash
  ) {
    throw new Error("risk_state update origin identity mismatch");
  }
  if (
    state.portfolioId !== update.portfolioId ||
    state.policyHash !== update.policyHash ||
    state.bucket !== update.bucket ||
    state.asOf !== update.asOf
  ) {
    throw new Error("risk_state update origin scope mismatch");
  }
  return state;
}

function resolveBucketEquityEventSource(
  update: PortfolioRiskStateUpdateRecord,
  source: unknown
): BucketEquityEvent | undefined {
  if (update.stateUpdateKind !== "fee" && update.stateUpdateKind !== "cash_flow") {
    if (source !== undefined) {
      throw new Error(
        "bucket equity-event source is allowed only for a fee or cash_flow update"
      );
    }
    return undefined;
  }
  if (source === undefined) {
    throw new Error(
      `${update.stateUpdateKind} update requires its bucket equity-event source`
    );
  }
  const event = parseBucketEquityEvent(source);
  const expectedEventType =
    update.stateUpdateKind === "fee" ? "execution_cost" : "capital_flow";
  if (
    event.bucketEquityEventId !== update.bucketEquityEventId ||
    event.eventType !== expectedEventType ||
    event.rebalancePlanId !== update.rebalancePlanId ||
    event.rebalanceActionId !== update.rebalanceActionId ||
    event.fillId !== update.fillId
  ) {
    throw new Error(`${update.stateUpdateKind} update origin identity mismatch`);
  }
  if (
    event.portfolioId !== update.portfolioId ||
    event.policyHash !== update.policyHash ||
    event.asOf !== update.asOf
  ) {
    throw new Error(`${update.stateUpdateKind} update origin scope mismatch`);
  }
  return event;
}

function assertUniqueUpdateHistory(
  records: readonly PortfolioRiskStateUpdateRecord[]
): void {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const record of records) {
    if (ids.has(record.riskStateUpdateRecordId)) {
      throw new Error("risk state update history contains a duplicate ID");
    }
    if (hashes.has(record.stateUpdateHash)) {
      throw new Error("risk state update history contains a duplicate hash");
    }
    ids.add(record.riskStateUpdateRecordId);
    hashes.add(record.stateUpdateHash);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
