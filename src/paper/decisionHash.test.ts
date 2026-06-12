import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualDecision } from "../domain/schemas.js";
import {
  bindVirtualDecisionHash,
  createVirtualDecisionHash
} from "./decisionHash.js";
import { createStaticDecisionIdentityMetadata } from "./decisionIdentity.js";

test("virtual decision hash is deterministic across object key order", () => {
  const first = decision();
  const second = {
    decisions: first.decisions,
    summary: first.summary,
    policyVersion: first.policyVersion,
    schemaVersion: first.schemaVersion,
    modelId: first.modelId,
    promptVersion: first.promptVersion,
    packetHash: first.packetHash,
    packetId: first.packetId
  } as VirtualDecision;

  assert.equal(createVirtualDecisionHash(first), createVirtualDecisionHash(second));
});

test("virtual decision hash ignores an existing decisionHash field", () => {
  const first = decision();
  const second = {
    ...first,
    decisionHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  };

  assert.equal(createVirtualDecisionHash(first), createVirtualDecisionHash(second));
});

test("virtual decision hash changes when decision content changes", () => {
  const first = decision();
  const second = {
    ...first,
    decisions: [
      {
        ...first.decisions[0]!,
        confidence: 0.2
      }
    ]
  };

  assert.notEqual(createVirtualDecisionHash(first), createVirtualDecisionHash(second));
});

test("bindVirtualDecisionHash attaches backend generated hash", () => {
  const bound = bindVirtualDecisionHash(decision());

  assert.match(bound.decisionHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(bound.decisionHash, createVirtualDecisionHash(bound));
});

function decision(): VirtualDecision {
  return {
    packetId: "packet_001",
    packetHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...createStaticDecisionIdentityMetadata(),
    summary: "Paper-only decision hash fixture.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.7,
        budgetKrw: 70_000,
        thesis: "Packet source supports a paper-only virtual buy.",
        riskFactors: ["Paper-only fixture risk."],
        dataRefs: ["source_005930"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}
