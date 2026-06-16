import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket, VirtualDecision } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStaticDecisionIdentityMetadata } from "./decisionIdentity.js";
import {
  summarizeVirtualDecisionValidation,
  validateVirtualDecisionAgainstPacket
} from "./virtualDecisionValidation.js";

test("validates decision references against packet candidate source refs", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision()
  });

  assert.equal(result.approved, true);
  assert.deepEqual(result.rejectCodes, []);
});

test("rejects packet mismatches before paper order execution", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({ packetId: "packet_other" })
  });

  assert.equal(result.approved, false);
  assert.ok(result.rejectCodes.includes("VIRTUAL_DECISION_PACKET_MISMATCH"));
});

test("rejects decisions without packet hash", () => {
  const invalidDecision = decision();
  delete invalidDecision.packetHash;

  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: invalidDecision
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_PACKET_HASH_REQUIRED")
  );
});

test("rejects decisions for changed packet content with same packet id", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet({
      candidates: [
        {
          ...packet().candidates[0]!,
          score: 99
        }
      ]
    }),
    decision: decision()
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_PACKET_HASH_MISMATCH")
  );
});

test("rejects AI-supplied decision hash before storage", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisionHash:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    })
  });

  assert.equal(result.approved, false);
  assert.ok(result.rejectCodes.includes("VIRTUAL_DECISION_HASH_NOT_ALLOWED"));
});

test("rejects AI-supplied confidence breakdown before storage", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          confidenceBreakdown: {
            modelConfidence: 0.7,
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
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes(
      "VIRTUAL_DECISION_CONFIDENCE_BREAKDOWN_NOT_ALLOWED"
    )
  );
});

test("rejects decisions without identity metadata", () => {
  const invalidDecision = decision();
  delete invalidDecision.modelId;

  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: invalidDecision
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes(
      "VIRTUAL_DECISION_IDENTITY_METADATA_REQUIRED"
    )
  );
  assert.match(
    summarizeVirtualDecisionValidation(result),
    /metadataField=modelId/
  );
});

test("rejects decisions for symbols outside the packet", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          symbol: "999999",
          dataRefs: ["source_missing"]
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(result.rejectCodes.includes("VIRTUAL_DECISION_SYMBOL_NOT_IN_PACKET"));
});

test("rejects hallucinated data refs not present on the candidate", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          dataRefs: ["source_hallucinated"]
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE")
  );
  assert.match(summarizeVirtualDecisionValidation(result), /source_hallucinated/);
});

test("rejects cross-symbol data refs from another packet candidate", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          dataRefs: ["source_000660"]
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE")
  );
});

test("accepts feature refs copied from the same packet candidate", () => {
  const featurePacket = packet({
    candidates: [
      {
        ...packet().candidates[0]!,
        featureRefs: ["candidate.KR.005930.score"]
      }
    ]
  });
  const result = validateVirtualDecisionAgainstPacket({
    packet: featurePacket,
    decision: decision({
      packetHash: createMarketPacketHash(featurePacket),
      decisions: [
        {
          ...decision().decisions[0]!,
          featureRefs: ["candidate.KR.005930.score"]
        }
      ]
    })
  });

  assert.equal(result.approved, true);
  assert.deepEqual(result.rejectCodes, []);
});

test("accepts claim support feature refs copied from the same packet candidate", () => {
  const featurePacket = packet({
    candidates: [
      {
        ...packet().candidates[0]!,
        featureRefs: ["candidate.KR.005930.score"]
      }
    ]
  });
  const result = validateVirtualDecisionAgainstPacket({
    packet: featurePacket,
    decision: decision({
      packetHash: createMarketPacketHash(featurePacket),
      decisions: [
        {
          ...decision().decisions[0]!,
          featureRefs: ["candidate.KR.005930.score"],
          claimSupport: [
            {
              claim: "Candidate score feature supports this thesis.",
              featureRefs: ["candidate.KR.005930.score"]
            }
          ]
        }
      ]
    })
  });

  assert.equal(result.approved, true);
  assert.deepEqual(result.rejectCodes, []);
});

test("rejects hallucinated feature refs not present on the candidate", () => {
  const featurePacket = packet({
    candidates: [
      {
        ...packet().candidates[0]!,
        featureRefs: ["candidate.KR.005930.score"]
      }
    ]
  });
  const result = validateVirtualDecisionAgainstPacket({
    packet: featurePacket,
    decision: decision({
      packetHash: createMarketPacketHash(featurePacket),
      decisions: [
        {
          ...decision().decisions[0]!,
          featureRefs: ["candidate.KR.005930.futureReturn"]
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes(
      "VIRTUAL_DECISION_FEATURE_REF_NOT_IN_CANDIDATE"
    )
  );
  assert.match(summarizeVirtualDecisionValidation(result), /futureReturn/);
});

test("rejects decisions without claim support", () => {
  const item = { ...decision().decisions[0]! };
  delete item.claimSupport;

  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [item]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_CLAIM_SUPPORT_REQUIRED")
  );
});

test("rejects claim support data refs outside the candidate", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          claimSupport: [
            {
              claim: "Hallucinated source supports this thesis.",
              dataRefs: ["source_hallucinated"]
            }
          ]
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes(
      "VIRTUAL_DECISION_CLAIM_SUPPORT_DATA_REF_NOT_IN_CANDIDATE"
    )
  );
  assert.match(summarizeVirtualDecisionValidation(result), /source_hallucinated/);
});

test("rejects claim support feature refs outside the candidate", () => {
  const featurePacket = packet({
    candidates: [
      {
        ...packet().candidates[0]!,
        featureRefs: ["candidate.KR.005930.score"]
      }
    ]
  });
  const result = validateVirtualDecisionAgainstPacket({
    packet: featurePacket,
    decision: decision({
      packetHash: createMarketPacketHash(featurePacket),
      decisions: [
        {
          ...decision().decisions[0]!,
          featureRefs: ["candidate.KR.005930.score"],
          claimSupport: [
            {
              claim: "A future return feature supports this thesis.",
              featureRefs: ["candidate.KR.005930.futureReturn"]
            }
          ]
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes(
      "VIRTUAL_DECISION_CLAIM_SUPPORT_FEATURE_REF_NOT_IN_CANDIDATE"
    )
  );
  assert.match(summarizeVirtualDecisionValidation(result), /futureReturn/);
});

test("rejects duplicate decisions for the same market and symbol", () => {
  const base = decision().decisions[0]!;
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        base,
        {
          ...base,
          action: "VIRTUAL_HOLD",
          holdReasonCode: "INSUFFICIENT_EVIDENCE",
          budgetKrw: 0,
          riskFactors: []
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(result.rejectCodes.includes("VIRTUAL_DECISION_DUPLICATE_SYMBOL"));
});

test("rejects actions outside packet constraints", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet({
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 100_000,
        allowedActions: ["VIRTUAL_HOLD"]
      }
    }),
    decision: decision()
  });

  assert.equal(result.approved, false);
  assert.ok(result.rejectCodes.includes("VIRTUAL_DECISION_ACTION_NOT_ALLOWED"));
});

test("rejects actions outside candidate eligibility", () => {
  const ineligiblePacket = packet({
    candidates: [
      {
        ...packet().candidates[0]!,
        buyEligible: false,
        blockedReasonCodes: ["MAX_NEW_POSITIONS_REACHED"],
        budgetTierAllowed: "NONE",
        positionExists: false,
        cooldownActive: false
      }
    ]
  });
  const result = validateVirtualDecisionAgainstPacket({
    packet: ineligiblePacket,
    decision: decision({
      packetHash: createMarketPacketHash(ineligiblePacket)
    })
  });

  assert.equal(result.approved, false);
  assert.ok(result.rejectCodes.includes("VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE"));
});

test("rejects hold decisions without a hold reason code", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          action: "VIRTUAL_HOLD",
          budgetKrw: 0,
          riskFactors: []
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_HOLD_REASON_REQUIRED")
  );
});

test("rejects hold reason codes on non-hold decisions", () => {
  const result = validateVirtualDecisionAgainstPacket({
    packet: packet(),
    decision: decision({
      decisions: [
        {
          ...decision().decisions[0]!,
          holdReasonCode: "LOW_LIQUIDITY"
        }
      ]
    })
  });

  assert.equal(result.approved, false);
  assert.ok(
    result.rejectCodes.includes("VIRTUAL_DECISION_HOLD_REASON_NOT_ALLOWED")
  );
});

function packet(overrides: Partial<MarketPacket> = {}): MarketPacket {
  return {
    packetId: "packet_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T08:59:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-06-11T08:59:00+09:00"
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Samsung",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["RANKING"],
        sourceRefs: ["source_005930"],
        collectedAt: "2026-06-11T08:59:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      },
      {
        market: "KR",
        symbol: "000660",
        name: "SK Hynix",
        lastPriceKrw: 120_000,
        ranking: 2,
        reasonCodes: ["RANKING"],
        sourceRefs: ["source_000660"],
        collectedAt: "2026-06-11T08:59:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    ...overrides
  };
}

function decision(overrides: Partial<VirtualDecision> = {}): VirtualDecision {
  return {
    packetId: "packet_001",
    packetHash: createMarketPacketHash(packet()),
    ...createStaticDecisionIdentityMetadata(),
    summary: "Paper-only validation fixture.",
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
        claimSupport: [
          {
            claim: "Packet source supports a paper-only virtual buy.",
            dataRefs: ["source_005930"]
          }
        ],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ],
    ...overrides
  };
}
