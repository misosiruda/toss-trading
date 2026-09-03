import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { StrategyBucket } from "../domain/schemas.js";
import { createMockMarketPacket } from "../market/packetBuilder.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  createBucketSelectionRequest,
  type CreateBucketSelectionRequestInput
} from "./bucketSelectionRequest.js";
import {
  parseCanonicalMarketPacketHistoryText,
} from "./everyTickPortfolioCycleTriggerResolver.js";
import {
  resolveBucketSelectionRequest,
  type BucketSelectionOpeningCapacity
} from "./bucketSelectionRequestResolver.js";
import type { PortfolioCycleTrigger } from "./portfolioCycleTrigger.js";
import {
  createPortfolioPolicyTriggerEvent,
  type PortfolioPolicyTriggerEvent
} from "./portfolioPolicyTriggerEvent.js";
import { parseVerifiedPortfolioPolicyTriggerEventHistory } from "./portfolioPolicyTriggerEventFiles.js";
import {
  createPortfolioPolicyTriggerEvidenceRecord,
  type PortfolioPolicyTriggerEvidenceRecord
} from "./portfolioPolicyTriggerEvidence.js";
import { parseVerifiedPortfolioPolicyTriggerEvidenceHistory } from "./portfolioPolicyTriggerEvidenceFiles.js";
import {
  createInvestmentMandateEvent,
  createInvestmentMandateRecord,
  type InvestmentMandateEvent,
  type InvestmentMandateRecord
} from "./investmentMandate.js";
import {
  InvestmentMandateFileRepository,
  type VerifiedInvestmentMandateHistory
} from "./investmentMandateFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import {
  createPortfolioSizingSnapshot,
  type PortfolioSizingSnapshot
} from "./portfolioSizingSnapshot.js";
import {
  createBucketSelectionPolicyRecord,
  hashCanonicalPayload,
  hashDerivedId,
  hashImmutableRecordLineage,
  createScheduleBoundaryRecord,
  createSessionCalendarRecord,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor,
  type BucketSelectionPolicyRef,
  type StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";
import { generateCanonicalScheduleSlots } from "./scheduledPortfolioCycleTriggerResolver.js";
import type { RuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";

const HASH = `sha256:${"a".repeat(64)}` as const;
const POLICY_CREATED_AT = "2026-09-01T00:00:00.000Z";
const AS_OF = "2026-09-02T00:00:00.000Z";
const BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;

test("selection request resolver binds snapshot, policy, and replayed gap", () => {
  const fixture = selectionFixture();
  const resolved = resolveBucketSelectionRequest({
    value: fixture.request,
    sizingSnapshot: fixture.snapshot,
    activePolicy: fixture.policy,
    cycleTrigger: fixture.trigger,
    policyEventTriggerSource: fixture.policyEventTriggerSource,
    bucketOpeningCapacities: openingCapacities()
  });

  assert.deepEqual(resolved.request, fixture.request);
  assert.deepEqual(resolved.sizingSnapshot, fixture.snapshot);
  assert.equal(resolved.gap.gapBasis, "min");
  assert.equal(resolved.gap.gapKrw, 200_000);
  assert.equal(resolved.gap.availableSlots, 4);
  assert.equal(resolved.gap.maximumAdditionalExposureKrw, 200_000);
  assert.equal(resolved.triggerSource?.sourceKind, "policy_event");
  assert.equal(Object.isFrozen(resolved), true);
});

test("selection request resolver replays entry-floor eligibility as due", () => {
  const fixture = scheduledSelectionFixture();
  const resolved = resolveBucketSelectionRequest({
    value: fixture.request,
    sizingSnapshot: fixture.snapshot,
    activePolicy: fixture.policy,
    cycleTrigger: fixture.trigger,
    scheduledTriggerSource: fixture.scheduledTriggerSource,
    bucketOpeningCapacities: openingCapacities()
  });

  assert.equal(resolved.bucketPolicy.selectionTrigger.mode, "entry_floor_on_due_cycle");
  assert.equal(resolved.gap.triggerDue, true);
  assert.equal(resolved.gap.gapBasis, "entry_floor");
  assert.equal(resolved.gap.gapKrw, 50_000);
  assert.equal(resolved.gap.maximumAdditionalExposureKrw, 50_000);
  assert.equal(resolved.triggerSource?.sourceKind, "schedule_slot");
});

test("selection request resolver requires the exact scheduled slot source", () => {
  const fixture = scheduledSelectionFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /requires its slot source/
  );
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        scheduledTriggerSource: {
          ...fixture.scheduledTriggerSource,
          scheduleBoundary: createScheduleBoundaryRecord({
            market: fixture.scheduledTriggerSource.scheduleBoundary.market,
            version: "v2",
            timeZone: fixture.scheduledTriggerSource.scheduleBoundary.timeZone,
            sessionCalendarRecordId:
              fixture.scheduledTriggerSource.scheduleBoundary
                .sessionCalendarRecordId,
            sessionCalendarVersion:
              fixture.scheduledTriggerSource.scheduleBoundary
                .sessionCalendarVersion,
            sessionCalendarHash:
              fixture.scheduledTriggerSource.scheduleBoundary
                .sessionCalendarHash,
            sessionCalendarLineageHash:
              fixture.scheduledTriggerSource.scheduleBoundary
                .sessionCalendarLineageHash,
            interval: fixture.scheduledTriggerSource.scheduleBoundary.interval,
            anchorLocalTime:
              fixture.scheduledTriggerSource.scheduleBoundary.anchorLocalTime,
            nonSessionDayRule:
              fixture.scheduledTriggerSource.scheduleBoundary.nonSessionDayRule,
            createdAt: "2026-09-01T00:00:00.000Z"
          })
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /boundary hash mismatch|boundary ref mismatch/
  );
});

test("selection request resolver requires an exact policy-event source", () => {
  const fixture = selectionFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /requires its event source/
  );
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        policyEventTriggerSource: {
          ...fixture.policyEventTriggerSource,
          policyTriggerEventHistory: {
            records: [fixture.policyEventTriggerSource.event]
          } as never
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /history is not verified/
  );

  const scheduled = scheduledSelectionFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: scheduled.request,
        sizingSnapshot: scheduled.snapshot,
        activePolicy: scheduled.policy,
        cycleTrigger: scheduled.trigger,
        scheduledTriggerSource: scheduled.scheduledTriggerSource,
        policyEventTriggerSource: fixture.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities()
      }),
    /non-scheduled trigger source/
  );
});

test("selection request resolver rejects policy-event market and knowledge drift", () => {
  const disabledMarket = selectionFixture({
    longTermEnabledMarkets: ["US"]
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: disabledMarket.request,
        sizingSnapshot: disabledMarket.snapshot,
        activePolicy: disabledMarket.policy,
        cycleTrigger: disabledMarket.trigger,
        policyEventTriggerSource: disabledMarket.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities()
      }),
    /source market is disabled/
  );

  const futureEvent = selectionFixture({
    eventCreatedAt: "2026-09-02T00:00:02.000Z"
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: futureEvent.request,
        sizingSnapshot: futureEvent.snapshot,
        activePolicy: futureEvent.policy,
        cycleTrigger: futureEvent.trigger,
        policyEventTriggerSource: futureEvent.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities()
      }),
    /source postdates the selection request/
  );
});

test("selection request resolver binds thesis events to the active mandate", async () => {
  const fixture = thesisSelectionFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        policyEventTriggerSource: fixture.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities()
      }),
    /requires investment mandate history/
  );
  await withVerifiedMandateHistory(
    [fixture.mandate],
    [fixture.mandateActivation],
    (investmentMandateHistory) => {
      const resolved = resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        policyEventTriggerSource: {
          ...fixture.policyEventTriggerSource,
          investmentMandateHistory
        },
        bucketOpeningCapacities: openingCapacities()
      });
      assert.equal(resolved.triggerSource?.sourceKind, "policy_event");
      assert.equal(
        resolved.triggerSource?.cycleTrigger.activeMandate?.record.mandateId,
        fixture.mandate.mandateId
      );
    }
  );

  const wrongBucket = thesisSelectionFixture({ mandateBucket: "swing" });
  await withVerifiedMandateHistory(
    [wrongBucket.mandate],
    [wrongBucket.mandateActivation],
    (investmentMandateHistory) => {
      assert.throws(
        () =>
          resolveBucketSelectionRequest({
            value: wrongBucket.request,
            sizingSnapshot: wrongBucket.snapshot,
            activePolicy: wrongBucket.policy,
            cycleTrigger: wrongBucket.trigger,
            policyEventTriggerSource: {
              ...wrongBucket.policyEventTriggerSource,
              investmentMandateHistory
            },
            bucketOpeningCapacities: openingCapacities()
          }),
        /mandate bucket binding mismatch/
      );
    }
  );
});

test("selection request resolver rejects snapshot and policy lineage mismatch", () => {
  const fixture = selectionFixture();
  const wrongSnapshotRequest = createBucketSelectionRequest({
    ...requestInput(fixture.snapshot, "long_term"),
    portfolioSnapshotId: "portfolio-sizing-snapshot-other"
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: wrongSnapshotRequest,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /snapshot identity mismatch/
  );

  const replacementPolicy = runtimePolicy({ minimumCashReserveKrw: 1 });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: replacementPolicy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /active policy mismatch/
  );

  const corruptSnapshot = {
    ...fixture.snapshot,
    portfolioSnapshotHash: HASH
  };
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: corruptSnapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /identity does not match payload/
  );
});

test("selection request resolver requires exact snapshot time and a pre-existing policy", () => {
  const fixture = selectionFixture();
  const staleRequest = createBucketSelectionRequest({
    ...requestInput(fixture.snapshot, "long_term"),
    asOf: "2026-09-01T23:59:59.000Z",
    evidenceCutoffAt: "2026-09-01T23:59:58.000Z"
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: staleRequest,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /snapshot scope mismatch/
  );

  const futureCreatedAt = "2026-09-03T00:00:00.000Z";
  const futurePolicy = {
    ...fixture.policy,
    lineageHash: hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: fixture.policy.runtimePolicyRecordId,
      semanticHash: fixture.policy.policyHash,
      createdAt: futureCreatedAt
    }),
    createdAt: futureCreatedAt
  };
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: futurePolicy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /predates its runtime policy/
  );
});

test("selection request resolver rejects replayed gap, slot, and cap drift", () => {
  const fixture = selectionFixture();
  for (const override of [
    { gapKrw: 199_999, maximumAdditionalExposureKrw: 199_999 },
    { availableSlots: 3 },
    { maximumAdditionalExposureKrw: 100_000 }
  ]) {
    const request = createBucketSelectionRequest({
      ...requestInput(fixture.snapshot, "long_term"),
      ...override
    });
    assert.throws(
      () =>
        resolveBucketSelectionRequest({
          value: request,
          sizingSnapshot: fixture.snapshot,
          activePolicy: fixture.policy,
          cycleTrigger: fixture.trigger,
          policyEventTriggerSource: fixture.policyEventTriggerSource,
          bucketOpeningCapacities: openingCapacities()
        }),
      /does not match replay/
    );
  }

  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        policyEventTriggerSource: fixture.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities({
          bucket: "long_term",
          activePositionCount: 1
        })
      }),
    /does not match replay/
  );
});

test("selection request resolver fails closed when replay removes eligibility", () => {
  const fixture = selectionFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        policyEventTriggerSource: fixture.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities({
          bucket: "long_term",
          maximumPositionCount: 1,
          activePositionCount: 1
        })
      }),
    /not eligible after gap replay/
  );
});

test("selection request resolver rejects trigger basis inconsistent with policy", () => {
  const fixture = selectionFixture();
  const request = createBucketSelectionRequest({
    ...requestInput(fixture.snapshot, "long_term"),
    gapBasis: "entry_floor"
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        policyEventTriggerSource: fixture.policyEventTriggerSource,
        bucketOpeningCapacities: openingCapacities()
      }),
    /does not match replay/
  );
});

test("selection request resolver rejects trigger identity and cutoff drift", () => {
  const fixture = selectionFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: {
          ...fixture.trigger,
          eventAsOf: "2026-09-01T23:58:00.000Z"
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /trigger binding mismatch/
  );

  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: {
          triggerKind: "every_tick",
          packetHash: HASH,
          packetAsOf: "2026-09-01T23:59:00.000Z"
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /trigger binding mismatch/
  );
});

test("selection request resolver enforces cadence and policy-event declarations", () => {
  const scheduledFixture = selectionFixture({ bucket: "short_term" });
  const otherBoundaryHash = `sha256:${"c".repeat(64)}` as const;
  const otherBoundaryTrigger = {
    ...scheduledFixture.trigger,
    scheduleBoundaryHash: otherBoundaryHash
  };
  const otherBoundaryRequest = createBucketSelectionRequest({
    ...requestInput(scheduledFixture.snapshot, "short_term"),
    triggerIdentity: `scheduled:${otherBoundaryHash}`
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: otherBoundaryRequest,
        sizingSnapshot: scheduledFixture.snapshot,
        activePolicy: scheduledFixture.policy,
        cycleTrigger: otherBoundaryTrigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /does not match bucket review cadence/
  );

  const policyWithoutEvent = runtimePolicy({ enabledLongTermEvents: false });
  const snapshot = emptySizingSnapshot(policyWithoutEvent.policyHash);
  const request = createBucketSelectionRequest(requestInput(snapshot, "long_term"));
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: request,
        sizingSnapshot: snapshot,
        activePolicy: policyWithoutEvent,
        cycleTrigger: cycleTrigger("long_term", snapshot.policyHash),
        bucketOpeningCapacities: openingCapacities()
      }),
    /not enabled for bucket/
  );
});

test("selection request resolver rejects risk-breach candidate selection", () => {
  const fixture = selectionFixture();
  const request = createBucketSelectionRequest({
    ...requestInput(fixture.snapshot, "long_term"),
    triggerIdentity: "risk_breach:market_mark",
    triggerRef: HASH
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: {
          triggerKind: "risk_breach",
          stateUpdateKind: "market_mark",
          riskStateUpdateRecordId: "risk-state-update-1",
          stateUpdateHash: HASH,
          stateUpdateAsOf: "2026-09-01T23:59:00.000Z"
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /cannot create a bucket selection request/
  );
});

test("selection request resolver binds every-tick packet and source policy", () => {
  const fixture = everyTickFixture();
  const resolved = resolveBucketSelectionRequest({
    value: fixture.request,
    sizingSnapshot: fixture.snapshot,
    activePolicy: fixture.policy,
    cycleTrigger: fixture.trigger,
    everyTickTriggerSource: {
      marketPacketHistory: fixture.history,
      selectionPolicy: fixture.selectionPolicy
    },
    bucketOpeningCapacities: openingCapacities()
  });

  assert.equal(resolved.triggerSource?.sourceKind, "market_packet");
  assert.equal(
    resolved.triggerSource?.cycleTrigger.marketPacket.packetId,
    fixture.packet.packetId
  );
  assert.equal(resolved.gap.gapBasis, "entry_floor");
  assert.equal(resolved.gap.gapKrw, 20_000);
});

test("selection request resolver requires every-tick source and rejects stale packet", () => {
  const fixture = everyTickFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        bucketOpeningCapacities: openingCapacities()
      }),
    /requires its packet source/
  );

  const stale = everyTickFixture({
    packetGeneratedAt: "2026-09-01T23:58:59.000Z"
  });
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: stale.request,
        sizingSnapshot: stale.snapshot,
        activePolicy: stale.policy,
        cycleTrigger: stale.trigger,
        everyTickTriggerSource: {
          marketPacketHistory: stale.history,
          selectionPolicy: stale.selectionPolicy
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /packet is stale/
  );

  const evidenceStale = everyTickFixture({
    packetGeneratedAt: "2026-09-01T23:59:30.000Z",
    evidenceMaximumAgeSeconds: 10
  });
  assert.throws(
    () => resolveEveryTickFixture(evidenceStale),
    /packet is stale/
  );

  const expiredAtBoundary = everyTickFixture({
    packetGeneratedAt: "2026-09-01T23:55:00.000Z",
    sourceMaximumAgeSeconds: 300,
    evidenceMaximumAgeSeconds: 300
  });
  assert.equal(expiredAtBoundary.packet.expiresAt, AS_OF);
  assert.throws(
    () => resolveEveryTickFixture(expiredAtBoundary),
    /packet is stale/
  );

  const unsupportedContract = everyTickFixture({
    sourceContractId: "unregistered-packet.v1"
  });
  assert.throws(
    () => resolveEveryTickFixture(unsupportedContract),
    /does not bind the verified packet contract/
  );

  const unprovenObservationCount = everyTickFixture({
    minimumObservationCount: 20
  });
  assert.throws(
    () => resolveEveryTickFixture(unprovenObservationCount),
    /cannot prove the minimum market observation count/
  );

  const futureDependency = everyTickFixture({
    selectionPolicyCreatedAt: "2026-09-01T12:00:00.000Z"
  });
  assert.throws(
    () => resolveEveryTickFixture(futureDependency),
    /selection policy postdates the runtime policy/
  );
});

test("selection request resolver rejects every-tick portfolio and market scope drift", () => {
  const wrongPortfolio = everyTickFixture({ packetPortfolioId: "portfolio-2" });
  assert.throws(
    () => resolveEveryTickFixture(wrongPortfolio),
    /packet portfolio mismatch/
  );

  const disabledMarket = everyTickFixture({ enabledMarkets: ["US"] });
  assert.throws(
    () => resolveEveryTickFixture(disabledMarket),
    /candidate market is disabled/
  );
});

test("selection request resolver rejects stale and future candidate evidence", () => {
  const oldEvidence = everyTickFixture({
    candidateCollectedAt: "2026-09-01T23:58:59.000Z"
  });
  assert.throws(
    () => resolveEveryTickFixture(oldEvidence),
    /candidate evidence is stale/
  );

  const expiredEvidence = everyTickFixture({
    candidateStaleAfter: AS_OF
  });
  assert.throws(
    () => resolveEveryTickFixture(expiredEvidence),
    /candidate evidence is stale/
  );

  const futureEvidence = everyTickFixture({
    candidateCollectedAt: "2026-09-02T00:00:01.000Z",
    candidateStaleAfter: "2026-09-02T00:01:00.000Z"
  });
  assert.throws(
    () => resolveEveryTickFixture(futureEvidence),
    /candidate evidence postdates the market packet/
  );

  const offsetlessExpiry = everyTickFixture({
    packetExpiresAt: "2026-09-02T00:05:00"
  });
  assert.throws(
    () => resolveEveryTickFixture(offsetlessExpiry),
    /expiresAt must be an offset-qualified timestamp/
  );

  const offsetlessCandidateEvidence = everyTickFixture({
    candidateCollectedAt: "2026-09-02T00:00:00"
  });
  assert.throws(
    () => resolveEveryTickFixture(offsetlessCandidateEvidence),
    /candidate.collectedAt must be an offset-qualified timestamp/
  );
});

test("selection request resolver rejects ignored every-tick source input", () => {
  const fixture = selectionFixture();
  const everyTick = everyTickFixture();
  assert.throws(
    () =>
      resolveBucketSelectionRequest({
        value: fixture.request,
        sizingSnapshot: fixture.snapshot,
        activePolicy: fixture.policy,
        cycleTrigger: fixture.trigger,
        everyTickTriggerSource: {
          marketPacketHistory: everyTick.history,
          selectionPolicy: everyTick.selectionPolicy
        },
        bucketOpeningCapacities: openingCapacities()
      }),
    /allowed only for an every_tick trigger/
  );
});

function everyTickFixture(
  options: {
    packetGeneratedAt?: string;
    packetPortfolioId?: string;
    enabledMarkets?: readonly ("KR" | "US")[];
    sourceContractId?: string;
    selectionPolicyCreatedAt?: string;
    sourceMaximumAgeSeconds?: number;
    evidenceMaximumAgeSeconds?: number;
    candidateCollectedAt?: string;
    candidateStaleAfter?: string;
    minimumObservationCount?: number;
    packetExpiresAt?: string;
  } = {}
) {
  const sourceContractId =
    options.sourceContractId ?? "verified-market-packet.v1";
  const selectionPolicy = createBucketSelectionPolicyRecord({
    bucket: "intraday",
    version: "v1",
    requiredEvidence: [
      {
        evidenceClass: "market_technical",
        sourceContractId,
        maximumAgeSeconds: options.evidenceMaximumAgeSeconds ?? 60,
        ...(options.minimumObservationCount === undefined
          ? {}
          : { minimumObservationCount: options.minimumObservationCount })
      }
    ],
    everyTickSourceRequirement: {
      sourceContractId,
      eventType: "verified_market_packet",
      maximumAgeSeconds: options.sourceMaximumAgeSeconds ?? 60,
      dedupeKey: "packet_hash"
    },
    hardGateRuleIds: ["liquidity"],
    scoringModelVersion: "selector.intraday.v1",
    featureDefinitionRefs: ["momentum.v1"],
    createdAt: options.selectionPolicyCreatedAt ?? POLICY_CREATED_AT
  });
  const policy = runtimePolicy({
    intradaySelectionPolicyRef: selectionPolicyRefFor(selectionPolicy),
    ...(options.enabledMarkets === undefined
      ? {}
      : { intradayEnabledMarkets: options.enabledMarkets })
  });
  const snapshot = emptySizingSnapshot(policy.policyHash);
  const generatedAt = options.packetGeneratedAt ?? AS_OF;
  const basePacket = createMockMarketPacket({
    now: new Date(generatedAt),
    portfolio: {
      portfolioId: options.packetPortfolioId ?? snapshot.portfolioId,
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-09-01T23:30:00.000Z"
    }
  }).packet;
  const packet = {
    ...basePacket,
    expiresAt: options.packetExpiresAt ?? basePacket.expiresAt,
    candidates: basePacket.candidates.map((candidate) => ({
      ...candidate,
      collectedAt: options.candidateCollectedAt ?? candidate.collectedAt,
      staleAfter: options.candidateStaleAfter ?? candidate.staleAfter
    }))
  };
  const packetHash = createMarketPacketHash(packet);
  const trigger = {
    triggerKind: "every_tick" as const,
    packetHash,
    packetAsOf: packet.generatedAt
  };
  const request = createBucketSelectionRequest({
    cycleId: "cycle-intraday-2026-09-02",
    triggerIdentity: "every_tick",
    triggerRef: packetHash,
    portfolioId: snapshot.portfolioId,
    portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash,
    asOf: snapshot.asOf,
    bucket: "intraday",
    gapBasis: "entry_floor",
    gapKrw: 20_000,
    availableSlots: 4,
    maximumAdditionalExposureKrw: 20_000,
    evidenceCutoffAt: packet.generatedAt,
    createdAt: "2026-09-02T00:00:01.000Z"
  });
  return {
    history: parseCanonicalMarketPacketHistoryText(
      `${JSON.stringify(packet)}\n`
    ),
    packet,
    policy,
    request,
    selectionPolicy,
    snapshot,
    trigger
  };
}

function resolveEveryTickFixture(fixture: ReturnType<typeof everyTickFixture>) {
  return resolveBucketSelectionRequest({
    value: fixture.request,
    sizingSnapshot: fixture.snapshot,
    activePolicy: fixture.policy,
    cycleTrigger: fixture.trigger,
    everyTickTriggerSource: {
      marketPacketHistory: fixture.history,
      selectionPolicy: fixture.selectionPolicy
    },
    bucketOpeningCapacities: openingCapacities()
  });
}

function regimePolicyEventSource(
  policyHash: RuntimePortfolioPolicyRecord["policyHash"],
  options: { eventCreatedAt?: string } = {}
) {
  const evidence = createPortfolioPolicyTriggerEvidenceRecord({
    portfolioId: "portfolio-1",
    policyHash,
    market: "KR",
    evidenceType: "regime_change",
    sourceContractId: "fundamental-regime-evidence.v1",
    sourceArtifactId: "regime-artifact-1",
    sourceArtifactHash: `sha256:${"c".repeat(64)}`,
    observedAt: "2026-09-01T23:58:00.000Z",
    previousRegime: "neutral",
    currentRegime: "risk_on",
    createdAt: "2026-09-01T23:58:30.000Z"
  });
  if (evidence.evidenceType !== "regime_change") {
    throw new Error("regime evidence fixture construction failed");
  }
  const event = createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash,
    evidenceRefs: [evidence.evidenceRef],
    eventType: "regime_change",
    market: "KR",
    previousRegime: evidence.previousRegime,
    currentRegime: evidence.currentRegime,
    asOf: "2026-09-01T23:59:00.000Z",
    createdAt: options.eventCreatedAt ?? "2026-09-01T23:59:30.000Z"
  });
  if (event.eventType !== "regime_change") {
    throw new Error("regime event fixture construction failed");
  }
  return {
    event,
    evidence,
    policyTriggerEventHistory: verifiedPolicyEventHistory(event),
    policyTriggerEvidenceHistory: verifiedPolicyEvidenceHistory(evidence)
  };
}

function thesisSelectionFixture(
  options: { mandateBucket?: StrategyBucket } = {}
) {
  const policy = runtimePolicy();
  const snapshot = emptySizingSnapshot(policy.policyHash);
  const longTermPolicy = policy.strategyBuckets.find(
    (bucket) => bucket.bucket === "long_term"
  );
  if (longTermPolicy === undefined) {
    throw new Error("long-term policy fixture construction failed");
  }
  const mandate = createInvestmentMandateRecord({
    portfolioId: snapshot.portfolioId,
    market: "KR",
    symbol: "005930",
    bucket: options.mandateBucket ?? "long_term",
    policyHash: policy.policyHash,
    asOf: "2026-09-01T12:00:00.000Z",
    targetWeightRatio: 0.35,
    minWeightRatio: 0.2,
    maxWeightRatio: 0.5,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: ["manual-classification"],
    evidenceRefs: ["classification-evidence"],
    evidenceAsOf: "2026-09-01T11:59:00.000Z",
    reviewCadence: longTermPolicy.reviewCadence,
    validFrom: "2026-09-01T12:00:00.000Z",
    reviewAfter: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-03T00:00:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-assignment-1",
    createdAt: "2026-09-01T12:00:00.000Z"
  });
  const mandateActivation = createInvestmentMandateEvent({
    mandateId: mandate.mandateId,
    mandateHash: mandate.mandateHash,
    portfolioId: mandate.portfolioId,
    market: mandate.market,
    symbol: mandate.symbol,
    bucket: mandate.bucket,
    policyHash: mandate.policyHash,
    eventType: "activated",
    reasonCodes: ["lifecycle"],
    asOf: "2026-09-01T12:00:00.000Z",
    createdAt: "2026-09-01T12:00:01.000Z"
  });
  const evidence = createPortfolioPolicyTriggerEvidenceRecord({
    portfolioId: snapshot.portfolioId,
    policyHash: policy.policyHash,
    market: mandate.market,
    evidenceType: "thesis_evidence_change",
    sourceContractId: "fundamental-thesis-evidence.v1",
    sourceArtifactId: "thesis-artifact-1",
    sourceArtifactHash: `sha256:${"d".repeat(64)}`,
    observedAt: "2026-09-01T23:58:00.000Z",
    mandateId: mandate.mandateId,
    symbol: mandate.symbol,
    previousThesisStatus: "intact",
    currentThesisStatus: "watch",
    createdAt: "2026-09-01T23:58:30.000Z"
  });
  if (evidence.evidenceType !== "thesis_evidence_change") {
    throw new Error("thesis evidence fixture construction failed");
  }
  const event = createPortfolioPolicyTriggerEvent({
    portfolioId: snapshot.portfolioId,
    policyHash: policy.policyHash,
    evidenceRefs: [evidence.evidenceRef],
    eventType: "thesis_evidence_change",
    mandateId: mandate.mandateId,
    market: mandate.market,
    symbol: mandate.symbol,
    previousThesisStatus: evidence.previousThesisStatus,
    currentThesisStatus: evidence.currentThesisStatus,
    asOf: "2026-09-01T23:59:00.000Z",
    createdAt: "2026-09-01T23:59:30.000Z"
  });
  if (event.eventType !== "thesis_evidence_change") {
    throw new Error("thesis event fixture construction failed");
  }
  const request = createBucketSelectionRequest({
    ...requestInput(snapshot, "long_term"),
    triggerIdentity: "event:thesis_evidence_change",
    triggerRef: event.eventHash,
    evidenceCutoffAt: event.asOf
  });
  return {
    policy,
    snapshot,
    mandate,
    mandateActivation,
    request,
    trigger: {
      triggerKind: "policy_event" as const,
      eventType: event.eventType,
      policyTriggerEventId: event.policyTriggerEventId,
      eventHash: event.eventHash,
      eventAsOf: event.asOf
    },
    policyEventTriggerSource: {
      policyTriggerEventHistory: verifiedPolicyEventHistory(event),
      policyTriggerEvidenceHistory: verifiedPolicyEvidenceHistory(evidence)
    }
  };
}

async function withVerifiedMandateHistory<T>(
  records: readonly InvestmentMandateRecord[],
  events: readonly InvestmentMandateEvent[],
  operation: (history: VerifiedInvestmentMandateHistory) => Promise<T> | T
): Promise<T> {
  const baseDir = await mkdtemp(join(tmpdir(), "bucket-selection-mandate-"));
  try {
    const repository = new InvestmentMandateFileRepository(baseDir);
    for (const record of records) {
      await repository.appendRecord(record);
    }
    for (const event of events) {
      await repository.appendEvent(event);
    }
    return await repository.withVerifiedHistory(operation);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function verifiedPolicyEventHistory(
  ...events: readonly PortfolioPolicyTriggerEvent[]
) {
  return parseVerifiedPortfolioPolicyTriggerEventHistory(
    events.map((event) => JSON.stringify(event)).join("\n") +
      (events.length === 0 ? "" : "\n")
  );
}

function verifiedPolicyEvidenceHistory(
  ...records: readonly PortfolioPolicyTriggerEvidenceRecord[]
) {
  return parseVerifiedPortfolioPolicyTriggerEvidenceHistory(
    records.map((record) => JSON.stringify(record)).join("\n") +
      (records.length === 0 ? "" : "\n")
  );
}

function selectionFixture(
  options: {
    bucket?: "long_term" | "short_term";
    longTermEnabledMarkets?: readonly ("KR" | "US")[];
    eventCreatedAt?: string;
  } = {}
): {
  policy: RuntimePortfolioPolicyRecord;
  snapshot: PortfolioSizingSnapshot;
  request: ReturnType<typeof createBucketSelectionRequest>;
  trigger: PortfolioCycleTrigger;
  policyEventTriggerSource: ReturnType<typeof regimePolicyEventSource>;
} {
  const policy = runtimePolicy({
    ...(options.longTermEnabledMarkets === undefined
      ? {}
      : { longTermEnabledMarkets: options.longTermEnabledMarkets })
  });
  const snapshot = emptySizingSnapshot(policy.policyHash);
  const bucket = options.bucket ?? "long_term";
  const policyEventTriggerSource = regimePolicyEventSource(policy.policyHash, {
    ...(options.eventCreatedAt === undefined
      ? {}
      : { eventCreatedAt: options.eventCreatedAt })
  });
  const request = createBucketSelectionRequest({
    ...requestInput(snapshot, bucket),
    ...(bucket === "long_term"
      ? {
          triggerRef: policyEventTriggerSource.event.eventHash,
          evidenceCutoffAt: policyEventTriggerSource.event.asOf
        }
      : {})
  });
  const trigger: PortfolioCycleTrigger =
    bucket === "long_term"
      ? {
          triggerKind: "policy_event",
          eventType: policyEventTriggerSource.event.eventType,
          policyTriggerEventId:
            policyEventTriggerSource.event.policyTriggerEventId,
          eventHash: policyEventTriggerSource.event.eventHash,
          eventAsOf: policyEventTriggerSource.event.asOf
        }
      : cycleTrigger(bucket, policy.policyHash);
  return {
    policy,
    snapshot,
    request,
    trigger,
    policyEventTriggerSource
  };
}

function scheduledSelectionFixture() {
  const calendar = createSessionCalendarRecord({
    market: "KR",
    version: "v1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-09-02",
    validThroughExchangeDate: "2026-09-02",
    sessions: [
      {
        exchangeDate: "2026-09-02",
        sessionKind: "regular",
        opensAt: "2026-09-02T09:00:00+09:00",
        closesAt: "2026-09-02T15:30:00+09:00",
        sourceEvidenceRefs: ["calendar-evidence-1"]
      }
    ],
    createdAt: "2026-08-31T00:00:00.000Z"
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR",
    version: "v1",
    timeZone: calendar.timeZone,
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily",
    anchorLocalTime: "09:00:00",
    nonSessionDayRule: "previous_session",
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  const policy = runtimePolicy({ shortTermBoundaryRef: scheduleBoundaryRefFor(boundary) });
  const snapshot = emptySizingSnapshot(policy.policyHash);
  const slot = generateCanonicalScheduleSlots(boundary, calendar)[0]!;
  const trigger = {
    triggerKind: "scheduled" as const,
    scheduleBoundaryHash: boundary.hash,
    scheduleSlotId: slot.scheduleSlotId,
    slotEndsAt: slot.slotEndsAt
  };
  const request = createBucketSelectionRequest({
    ...requestInput(snapshot, "short_term"),
    triggerIdentity: `scheduled:${boundary.hash}`,
    triggerRef: slot.scheduleSlotId,
    evidenceCutoffAt: slot.slotEndsAt
  });
  return {
    policy,
    snapshot,
    request,
    trigger,
    scheduledTriggerSource: {
      scheduleBoundary: boundary,
      sessionCalendar: calendar
    }
  };
}

function requestInput(
  snapshot: PortfolioSizingSnapshot,
  bucket: "long_term" | "short_term"
): CreateBucketSelectionRequestInput {
  const entryFloor = bucket === "short_term";
  const policyEvent = regimePolicyEventSource(snapshot.policyHash).event;
  return {
    cycleId: `cycle-${bucket}-2026-09-02`,
    triggerIdentity: entryFloor
      ? `scheduled:${HASH}`
      : "event:regime_change",
    triggerRef: entryFloor ? "schedule-slot-1" : policyEvent.eventHash,
    portfolioId: snapshot.portfolioId,
    portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash,
    asOf: snapshot.asOf,
    bucket,
    gapBasis: entryFloor ? "entry_floor" : "min",
    gapKrw: entryFloor ? 50_000 : 200_000,
    availableSlots: 4,
    maximumAdditionalExposureKrw: entryFloor ? 50_000 : 200_000,
    evidenceCutoffAt: entryFloor
      ? "2026-09-01T23:59:00.000Z"
      : policyEvent.asOf,
    createdAt: "2026-09-02T00:00:01.000Z"
  };
}

function cycleTrigger(
  bucket: "long_term" | "short_term",
  policyHash: RuntimePortfolioPolicyRecord["policyHash"] = HASH
): PortfolioCycleTrigger {
  const policyEvent = regimePolicyEventSource(policyHash).event;
  return bucket === "short_term"
    ? {
        triggerKind: "scheduled",
        scheduleBoundaryHash: HASH,
        scheduleSlotId: "schedule-slot-1",
        slotEndsAt: "2026-09-01T23:59:00.000Z"
      }
    : {
        triggerKind: "policy_event",
        eventType: policyEvent.eventType,
        policyTriggerEventId: policyEvent.policyTriggerEventId,
        eventHash: policyEvent.eventHash,
        eventAsOf: policyEvent.asOf
      };
}

function emptySizingSnapshot(policyHash: string): PortfolioSizingSnapshot {
  const exposure = createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 1_000_000,
    cashKrw: 1_000_000,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: 0,
      short_term: 0,
      swing: 0
    },
    symbolExposureKrw: [],
    marketExposureKrw: { KR: 0, US: 0 },
    sectorExposureKrw: {},
    countryExposureKrw: {},
    currencyExposureKrw: {},
    pendingBuyExposureKrw: 0,
    pendingSellExposureKrw: 0
  });
  return createPortfolioSizingSnapshot({
    portfolioId: "portfolio-1",
    portfolioVersion: "portfolio-version-1",
    policyHash,
    asOf: AS_OF,
    virtualPortfolio: {
      portfolioId: "portfolio-1",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-09-01T23:30:00.000Z"
    },
    valuationInputs: [],
    pendingActionInputs: [],
    ...exposure
  });
}

function openingCapacities(
  override?: Partial<BucketSelectionOpeningCapacity> & {
    bucket: StrategyBucket;
  }
): BucketSelectionOpeningCapacity[] {
  return BUCKETS.map((bucket) => ({
    bucket,
    maximumPositionCount: 4,
    activePositionCount: 0,
    pendingReservationCount: 0,
    mandateBoundUnusedSlotCount: 0,
    ...(override?.bucket === bucket ? override : {})
  }));
}

function runtimePolicy(
  overrides: {
    minimumCashReserveKrw?: number;
    enabledLongTermEvents?: boolean;
    longTermEnabledMarkets?: readonly ("KR" | "US")[];
    intradaySelectionPolicyRef?: BucketSelectionPolicyRef;
    intradayEnabledMarkets?: readonly ("KR" | "US")[];
    shortTermBoundaryRef?: ReturnType<typeof scheduleBoundaryRefFor>;
  } = {}
): RuntimePortfolioPolicyRecord {
  const payload = {
    mode: "paper_only" as const,
    recordType: "runtime_portfolio_policy_record" as const,
    portfolioId: "portfolio-1",
    sourcePolicyRecordId: "source-policy-1",
    sourcePolicyRecordHash: HASH,
    sourcePolicyHash: "b".repeat(64),
    policyId: "balanced-paper",
    version: "v1",
    name: "Balanced paper policy",
    strategyBuckets: BUCKETS.map((bucket) =>
      bucketPolicy(
        bucket,
        overrides.enabledLongTermEvents ?? true,
        bucket === "intraday"
          ? overrides.intradaySelectionPolicyRef
          : undefined,
        bucket === "intraday" ? overrides.intradayEnabledMarkets : undefined,
        bucket === "long_term"
          ? overrides.longTermEnabledMarkets
          : undefined,
        bucket === "short_term" ? overrides.shortTermBoundaryRef : undefined
      )
    ),
    cashPolicy: {
      targetCashRatio: 0.15,
      minimumCashReserveKrw: overrides.minimumCashReserveKrw ?? 100_000,
      ruleSource: "static" as const
    },
    hedgePolicy: {
      hedgeEnabled: true,
      hedgeTargetRatio: 0.05,
      maxCostRatio: 0.01
    },
    exposurePolicy: {
      maxSymbolExposureRatio: 0.1,
      maxCountryExposureRatio: 0.8,
      maxCurrencyExposureRatio: 0.8
    },
    legacyReduceOnlyPolicy: {
      allowBuyOrIncrease: false as const,
      maximumParticipationRatio: 0.1,
      riskRuleSetRef: dependencyRef("legacy-risk", "riskRuleSetRecordId")
    }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId(
    "runtime_portfolio_policy",
    policyHash
  );
  return {
    ...payload,
    runtimePolicyRecordId,
    policyHash,
    lineageHash: hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: runtimePolicyRecordId,
      semanticHash: policyHash,
      createdAt: POLICY_CREATED_AT
    }),
    createdAt: POLICY_CREATED_AT
  };
}

function bucketPolicy(
  bucket: StrategyBucket,
  enabledLongTermEvents = true,
  selectionPolicyRef?: BucketSelectionPolicyRef,
  enabledMarkets?: readonly ("KR" | "US")[],
  longTermEnabledMarkets?: readonly ("KR" | "US")[],
  scheduleBoundaryRef?: ReturnType<typeof scheduleBoundaryRefFor>
): StrategyBucketRuntimePolicy {
  const weights = {
    long_term: [0.35, 0.2, 0.5, "below_min", 0] as const,
    swing: [0.2, 0.1, 0.3, "below_min", 0] as const,
    short_term: [0.15, 0, 0.25, "entry_floor_on_due_cycle", 0.05] as const,
    intraday: [0.1, 0, 0.15, "entry_floor_on_due_cycle", 0.02] as const,
    hedge: [0.05, 0, 0.15, "entry_floor_on_due_cycle", 0.02] as const
  }[bucket];
  const [targetWeightRatio, minWeightRatio, maxWeightRatio, mode, entry] =
    weights;
  return {
    bucket,
    targetWeightRatio,
    minWeightRatio,
    maxWeightRatio,
    maxTurnoverRatio: bucket === "long_term" ? 0.15 : 0.5,
    turnoverWindow: {
      mode: "fixed_utc",
      durationSeconds: 86_400,
      anchor: "unix_epoch",
      denominator: "window_open_portfolio_net_worth_krw"
    },
    maxDrawdownRatio: 0.1,
    drawdownSemanticsRef: dependencyRef(
      `${bucket}-drawdown`,
      "drawdownSemanticsRecordId"
    ),
    reviewCadence:
      bucket === "intraday"
        ? { mode: "every_tick" }
        : {
            mode: "scheduled",
            boundaryRefs: [
              scheduleBoundaryRef ?? {
                scheduleBoundaryRecordId: `${bucket}-boundary`,
                version: "v1",
                hash: HASH,
                lineageHash: HASH
              }
            ]
          },
    eventTriggers:
      bucket === "long_term" && enabledLongTermEvents
        ? ["regime_change", "thesis_evidence_change"]
        : [],
    selectionTrigger:
      mode === "below_min"
        ? { mode }
        : { mode, entryWeightRatio: entry },
    exitPolicy: {
      takeProfit: { mode: "disabled" },
      timeExpiryAction: "review_required"
    },
    enabledMarkets: [
      ...(longTermEnabledMarkets ?? enabledMarkets ?? ["KR", "US"])
    ],
    enabledAssetClasses: ["equity"],
    selectionPolicyRef:
      selectionPolicyRef ??
      dependencyRef(`${bucket}-selection`, "selectionPolicyRecordId"),
    riskRuleSetRef: dependencyRef(`${bucket}-risk`, "riskRuleSetRecordId")
  };
}

function dependencyRef(
  id: string,
  idKey:
    | "selectionPolicyRecordId"
    | "riskRuleSetRecordId"
    | "drawdownSemanticsRecordId"
) {
  return {
    [idKey]: id,
    version: "v1",
    hash: HASH,
    lineageHash: HASH
  } as Record<typeof idKey, string> & {
    version: string;
    hash: typeof HASH;
    lineageHash: typeof HASH;
  };
}
