import { createHash } from "node:crypto";

import type { VirtualDecision } from "../domain/schemas.js";

export const VIRTUAL_DECISION_HASH_ALGORITHM = "sha256";

export function createVirtualDecisionHash(decision: VirtualDecision): string {
  return `${VIRTUAL_DECISION_HASH_ALGORITHM}:${createHash(
    VIRTUAL_DECISION_HASH_ALGORITHM
  )
    .update(stableStringify(withoutDecisionHash(decision)))
    .digest("hex")}`;
}

export function bindVirtualDecisionHash(
  decision: VirtualDecision
): VirtualDecision {
  return {
    ...decision,
    decisionHash: createVirtualDecisionHash(decision)
  };
}

function withoutDecisionHash(decision: VirtualDecision): Omit<
  VirtualDecision,
  "decisionHash"
> {
  const { decisionHash: _decisionHash, ...rest } = decision;
  return rest;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }

  return value;
}
