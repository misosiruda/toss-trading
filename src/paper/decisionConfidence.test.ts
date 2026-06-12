import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket, VirtualDecision } from "../domain/schemas.js";
import { createMockMarketPacket } from "../market/packetBuilder.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  bindDecisionIdentityMetadata,
  createStaticDecisionIdentityMetadata
} from "./decisionIdentity.js";
import {
  assessVirtualDecisionConfidence,
  bindVirtualDecisionConfidenceBreakdown
} from "./decisionConfidence.js";

const now = new Date("2026-06-11T09:00:00+09:00");

test("confidence assessment keeps model confidence as audit-only input", () => {
  const packet = packetFixture();
  const decision = decisionFixture(packet);
  const assessment = assessVirtualDecisionConfidence({
    packet,
    decision: decision.decisions[0]!
  });

  assert.equal(assessment.modelConfidence, 0.7);
  assert.equal(assessment.evidenceQualityScore, 100);
  assert.equal(assessment.dataCompletenessScore, 100);
  assert.equal(assessment.policyEligibilityScore, 100);
  assert.equal(assessment.executionRiskScore, 100);
  assert.equal(assessment.overallScore, 100);
  assert.equal(assessment.reasonCodes.includes("MODEL_CONFIDENCE_HIGH"), true);
});

test("confidence assessment reports policy blocked candidates separately", () => {
  const packet = {
    ...packetFixture(),
    candidates: [
      {
        ...packetFixture().candidates[0]!,
        buyEligible: false,
        budgetTierAllowed: "NONE" as const,
        blockedReasonCodes: ["MAX_NEW_POSITIONS_REACHED"]
      }
    ]
  };
  const assessment = assessVirtualDecisionConfidence({
    packet,
    decision: decisionFixture(packet).decisions[0]!
  });

  assert.equal(assessment.modelConfidence, 0.7);
  assert.equal(assessment.policyEligibilityScore, 0);
  assert.equal(
    assessment.reasonCodes.includes("POLICY_ELIGIBILITY_LOW"),
    true
  );
});

test("confidence breakdown binding attaches backend generated item metadata", () => {
  const packet = packetFixture();
  const decision = decisionFixture(packet);
  const bound = bindVirtualDecisionConfidenceBreakdown({ decision, packet });

  assert.equal(
    decision.decisions[0]?.confidenceBreakdown,
    undefined
  );
  assert.equal(
    bound.decisions[0]?.confidenceBreakdown?.modelConfidence,
    0.7
  );
  assert.equal(bound.decisions[0]?.confidenceBreakdown?.overallScore, 100);
});

function packetFixture(): MarketPacket {
  return createMockMarketPacket({
    portfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: now.toISOString()
    },
    now
  }).packet;
}

function decisionFixture(packet: MarketPacket): VirtualDecision {
  const featureRef = "candidate.KR.005930.buyEligible";
  return bindDecisionIdentityMetadata(
    {
      packetId: packet.packetId,
      packetHash: createMarketPacketHash(packet),
      summary: "Paper-only confidence fixture.",
      decisions: [
        {
          market: "KR",
          symbol: "005930",
          action: "VIRTUAL_BUY",
          confidence: 0.7,
          budgetKrw: 70_000,
          thesis: "Mock packet supports a paper-only virtual buy.",
          riskFactors: ["Paper trading risk."],
          dataRefs: ["mock_source_001"],
          featureRefs: [featureRef],
          claimSupport: [
            {
              claim: "Mock packet supports a paper-only virtual buy.",
              dataRefs: ["mock_source_001"],
              featureRefs: [featureRef]
            }
          ],
          expiresAt: packet.expiresAt
        }
      ]
    },
    createStaticDecisionIdentityMetadata()
  );
}
