import {
  parsePortfolioPolicyTriggerEvent,
  type PortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import {
  getVerifiedPortfolioPolicyTriggerEventRecords,
  type VerifiedPortfolioPolicyTriggerEventHistory
} from "./portfolioPolicyTriggerEventFiles.js";
import {
  resolvePortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";

export interface ResolvedPolicyEventPortfolioCycleTrigger
  extends ResolvedPortfolioCycleTrigger {
  trigger: Extract<
    ResolvedPortfolioCycleTrigger["trigger"],
    { triggerKind: "policy_event" }
  >;
  policyTriggerEvent: PortfolioPolicyTriggerEvent;
}

/** Resolves a policy-event trigger against a complete immutable event history. */
export function resolvePolicyEventPortfolioCycleTrigger(input: {
  value: unknown;
  policyTriggerEventHistory: VerifiedPortfolioPolicyTriggerEventHistory;
  expectedPortfolioId: string;
  expectedPolicyHash: string;
}): ResolvedPolicyEventPortfolioCycleTrigger {
  const resolved = resolvePortfolioCycleTrigger(input.value);
  if (resolved.trigger.triggerKind !== "policy_event") {
    throw new Error(
      "policy-event trigger resolver requires a policy_event trigger"
    );
  }
  const trigger = resolved.trigger;
  const events = getVerifiedPortfolioPolicyTriggerEventRecords(
    input.policyTriggerEventHistory
  ).map((event) =>
    parsePortfolioPolicyTriggerEvent(event)
  );
  assertUniqueEventHistory(events);
  const matches = events.filter(
    (event) => event.policyTriggerEventId === trigger.policyTriggerEventId
  );
  if (matches.length !== 1) {
    throw new Error(
      `policy-event trigger event must resolve exactly once; resolved ${matches.length}`
    );
  }

  const policyTriggerEvent = matches[0] as PortfolioPolicyTriggerEvent;
  if (
    policyTriggerEvent.portfolioId !== input.expectedPortfolioId ||
    policyTriggerEvent.policyHash !== input.expectedPolicyHash
  ) {
    throw new Error("policy-event trigger source scope mismatch");
  }
  if (
    policyTriggerEvent.eventHash !== trigger.eventHash ||
    policyTriggerEvent.eventType !== trigger.eventType ||
    policyTriggerEvent.asOf !== trigger.eventAsOf
  ) {
    throw new Error("policy-event trigger does not match its immutable event");
  }

  return deepFreeze({
    ...resolved,
    trigger,
    policyTriggerEvent
  });
}

function assertUniqueEventHistory(
  events: readonly PortfolioPolicyTriggerEvent[]
): void {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const event of events) {
    if (ids.has(event.policyTriggerEventId)) {
      throw new Error("policy trigger event history contains a duplicate ID");
    }
    if (hashes.has(event.eventHash)) {
      throw new Error("policy trigger event history contains a duplicate hash");
    }
    ids.add(event.policyTriggerEventId);
    hashes.add(event.eventHash);
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
