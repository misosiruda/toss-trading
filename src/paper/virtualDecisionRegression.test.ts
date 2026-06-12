import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecision,
  VirtualDecisionItem
} from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { bindVirtualDecisionConfidenceBreakdown } from "./decisionConfidence.js";
import { createStaticDecisionIdentityMetadata } from "./decisionIdentity.js";
import {
  summarizeVirtualDecisionValidation,
  type VirtualDecisionValidationRejectCode,
  validateVirtualDecisionAgainstPacket
} from "./virtualDecisionValidation.js";

test("golden virtual decision packet passes validation and backend confidence binding", () => {
  const packet = goldenPacket();
  const decision = goldenDecision(packet);

  const result = validateVirtualDecisionAgainstPacket({ packet, decision });

  assert.equal(result.approved, true);
  assert.deepEqual(result.rejectCodes, []);
  assert.equal(decision.decisions[0]?.confidenceBreakdown, undefined);

  const boundDecision = bindVirtualDecisionConfidenceBreakdown({
    packet,
    decision
  });
  const confidenceBreakdown = boundDecision.decisions[0]?.confidenceBreakdown;

  assert.equal(confidenceBreakdown?.modelConfidence, 0.72);
  assert.ok((confidenceBreakdown?.evidenceQualityScore ?? 0) > 0);
  assert.ok((confidenceBreakdown?.dataCompletenessScore ?? 0) > 0);
  assert.equal(confidenceBreakdown?.policyEligibilityScore, 100);
  assert.equal(confidenceBreakdown?.executionRiskScore, 100);
  assert.ok((confidenceBreakdown?.overallScore ?? 0) > 0);
  assert.ok(
    confidenceBreakdown?.reasonCodes.includes("POLICY_ELIGIBILITY_HIGH")
  );
});

const adversarialCases: Array<{
  name: string;
  arrange: () => {
    packet: MarketPacket;
    decision: VirtualDecision;
  };
  expectedRejectCode: VirtualDecisionValidationRejectCode;
  summaryPattern?: RegExp;
}> = [
  {
    name: "unknown dataRef",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [
            {
              ...goldenDecisionItem(),
              dataRefs: ["source_missing"]
            }
          ]
        })
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE",
    summaryPattern: /source_missing/
  },
  {
    name: "cross-symbol dataRef",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [
            {
              ...goldenDecisionItem(),
              dataRefs: ["source_000660"]
            }
          ]
        })
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE",
    summaryPattern: /source_000660/
  },
  {
    name: "unknown featureRef",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [
            {
              ...goldenDecisionItem(),
              featureRefs: ["candidate.KR.005930.futureReturn"]
            }
          ]
        })
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_FEATURE_REF_NOT_IN_CANDIDATE",
    summaryPattern: /futureReturn/
  },
  {
    name: "missing claimSupport",
    arrange: () => {
      const item = goldenDecisionItem();
      delete item.claimSupport;

      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [item]
        })
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_CLAIM_SUPPORT_REQUIRED"
  },
  {
    name: "claimSupport dataRef outside candidate",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [
            {
              ...goldenDecisionItem(),
              claimSupport: [
                {
                  claim: "다른 종목 source가 이 결정을 뒷받침합니다.",
                  dataRefs: ["source_000660"]
                }
              ]
            }
          ]
        })
      };
    },
    expectedRejectCode:
      "VIRTUAL_DECISION_CLAIM_SUPPORT_DATA_REF_NOT_IN_CANDIDATE",
    summaryPattern: /source_000660/
  },
  {
    name: "claimSupport featureRef outside candidate",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [
            {
              ...goldenDecisionItem(),
              claimSupport: [
                {
                  claim: "packet 밖 feature가 이 결정을 뒷받침합니다.",
                  featureRefs: ["candidate.KR.005930.futureReturn"]
                }
              ]
            }
          ]
        })
      };
    },
    expectedRejectCode:
      "VIRTUAL_DECISION_CLAIM_SUPPORT_FEATURE_REF_NOT_IN_CANDIDATE",
    summaryPattern: /futureReturn/
  },
  {
    name: "AI-supplied decisionHash",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisionHash:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        })
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_HASH_NOT_ALLOWED"
  },
  {
    name: "AI-supplied confidenceBreakdown",
    arrange: () => {
      const packet = goldenPacket();
      return {
        packet,
        decision: goldenDecision(packet, {
          decisions: [
            {
              ...goldenDecisionItem(),
              confidenceBreakdown: {
                modelConfidence: 0.72,
                evidenceQualityScore: 100,
                dataCompletenessScore: 100,
                policyEligibilityScore: 100,
                executionRiskScore: 100,
                overallScore: 100,
                reasonCodes: ["AI_SUPPLIED"]
              }
            }
          ]
        })
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_CONFIDENCE_BREAKDOWN_NOT_ALLOWED"
  },
  {
    name: "BUY action on ineligible candidate",
    arrange: () => {
      const packet = goldenPacket({
        candidates: [
          {
            ...samsungCandidate(),
            buyEligible: false,
            blockedReasonCodes: ["MAX_NEW_POSITIONS_REACHED"],
            budgetTierAllowed: "NONE",
            positionExists: false,
            cooldownActive: false
          },
          skHynixCandidate()
        ]
      });

      return {
        packet,
        decision: goldenDecision(packet)
      };
    },
    expectedRejectCode: "VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE"
  }
];

for (const regressionCase of adversarialCases) {
  test(`adversarial virtual decision regression: ${regressionCase.name}`, () => {
    const { packet, decision } = regressionCase.arrange();

    const result = validateVirtualDecisionAgainstPacket({ packet, decision });

    assert.equal(result.approved, false);
    assert.ok(result.rejectCodes.includes(regressionCase.expectedRejectCode));
    if (regressionCase.summaryPattern) {
      assert.match(
        summarizeVirtualDecisionValidation(result),
        regressionCase.summaryPattern
      );
    }
  });
}

function goldenPacket(overrides: Partial<MarketPacket> = {}): MarketPacket {
  return {
    packetId: "packet_regression_001",
    mode: "paper_only",
    generatedAt: "2026-06-12T09:00:00+09:00",
    expiresAt: "2026-06-12T09:05:00+09:00",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-06-12T09:00:00+09:00"
    },
    candidates: [samsungCandidate(), skHynixCandidate()],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    ...overrides
  };
}

function samsungCandidate(): MarketCandidate {
  const featureRefs = [
    "candidate.KR.005930.ranking",
    "candidate.KR.005930.score",
    "candidate.KR.005930.buyEligible",
    "candidate.KR.005930.budgetTierAllowed"
  ];

  return {
    market: "KR",
    symbol: "005930",
    name: "Samsung Electronics",
    lastPriceKrw: 70_000,
    ranking: 1,
    score: 82,
    reasonCodes: ["RANKING", "BUY_ELIGIBLE"],
    featureRefs,
    featureScores: [
      {
        featureRef: featureRefs[0]!,
        score: 100,
        scoreType: "RANKING",
        reasonCode: "TOP_RANK"
      },
      {
        featureRef: featureRefs[1]!,
        score: 82,
        scoreType: "VALUE",
        reasonCode: "SCREEN_SCORE"
      },
      {
        featureRef: featureRefs[2]!,
        score: 100,
        scoreType: "POLICY",
        reasonCode: "BUY_ELIGIBLE"
      },
      {
        featureRef: featureRefs[3]!,
        score: 100,
        scoreType: "POLICY",
        reasonCode: "BUDGET_TIER_LARGE"
      }
    ],
    buyEligible: true,
    sellEligible: false,
    blockedReasonCodes: [],
    budgetTierAllowed: "LARGE",
    positionExists: false,
    cooldownActive: false,
    sourceRefs: ["source_005930"],
    collectedAt: "2026-06-12T09:00:00+09:00",
    staleAfter: "2026-06-12T09:05:00+09:00"
  };
}

function skHynixCandidate(): MarketCandidate {
  const featureRefs = [
    "candidate.KR.000660.ranking",
    "candidate.KR.000660.score",
    "candidate.KR.000660.buyEligible"
  ];

  return {
    market: "KR",
    symbol: "000660",
    name: "SK Hynix",
    lastPriceKrw: 120_000,
    ranking: 2,
    score: 76,
    reasonCodes: ["RANKING"],
    featureRefs,
    featureScores: [
      {
        featureRef: featureRefs[0]!,
        score: 90,
        scoreType: "RANKING",
        reasonCode: "SECOND_RANK"
      },
      {
        featureRef: featureRefs[1]!,
        score: 76,
        scoreType: "VALUE",
        reasonCode: "SCREEN_SCORE"
      },
      {
        featureRef: featureRefs[2]!,
        score: 100,
        scoreType: "POLICY",
        reasonCode: "BUY_ELIGIBLE"
      }
    ],
    buyEligible: true,
    sellEligible: false,
    blockedReasonCodes: [],
    budgetTierAllowed: "MEDIUM",
    positionExists: false,
    cooldownActive: false,
    sourceRefs: ["source_000660"],
    collectedAt: "2026-06-12T09:00:00+09:00",
    staleAfter: "2026-06-12T09:05:00+09:00"
  };
}

function goldenDecision(
  packet: MarketPacket,
  overrides: Partial<VirtualDecision> = {}
): VirtualDecision {
  return {
    packetId: packet.packetId,
    packetHash: createMarketPacketHash(packet),
    ...createStaticDecisionIdentityMetadata(),
    summary: "paper-only regression fixture",
    decisions: [goldenDecisionItem()],
    ...overrides
  };
}

function goldenDecisionItem(
  overrides: Partial<VirtualDecisionItem> = {}
): VirtualDecisionItem {
  return {
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    confidence: 0.72,
    budgetKrw: 70_000,
    thesis: "packet 내부 source와 feature가 paper-only 가상 매수 판단을 뒷받침합니다.",
    riskFactors: ["가상 투자 판단이며 live order로 연결되지 않습니다."],
    dataRefs: ["source_005930"],
    featureRefs: [
      "candidate.KR.005930.score",
      "candidate.KR.005930.buyEligible"
    ],
    claimSupport: [
      {
        claim: "screen score와 buy eligibility가 가상 매수 판단을 뒷받침합니다.",
        dataRefs: ["source_005930"],
        featureRefs: [
          "candidate.KR.005930.score",
          "candidate.KR.005930.buyEligible"
        ]
      }
    ],
    expiresAt: "2026-06-12T09:05:00+09:00",
    ...overrides
  };
}
