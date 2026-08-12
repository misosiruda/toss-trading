import assert from "node:assert/strict";
import test from "node:test";

import {
  BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION,
  brokerObservedCalendarEvidenceTransitionInputSchema,
  brokerObservedCalendarEvidenceTransitionResultSchema,
  calendarSourceEvidenceClassSchema,
  evaluateBrokerObservedCalendarEvidenceTransition,
  type BrokerObservedCalendarEvidenceTransitionInput,
  type BrokerObservedCalendarEvidenceTransitionRejectionCode
} from "./officialBrokerObservedCalendarEvidenceTransition.js";

test("calendar source evidence classes remain broker-observed or exchange", () => {
  assert.equal(
    calendarSourceEvidenceClassSchema.parse("official_broker_observed"),
    "official_broker_observed"
  );
  assert.equal(
    calendarSourceEvidenceClassSchema.parse("official_exchange"),
    "official_exchange"
  );
  assert.equal(
    calendarSourceEvidenceClassSchema.safeParse("observed_session_only")
      .success,
    false
  );
});

test("verified broker evidence is eligible only as observed-session replay input", () => {
  assert.deepEqual(
    evaluateBrokerObservedCalendarEvidenceTransition(verifiedInput()),
    {
      schemaVersion:
        BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION,
      mode: "paper_only",
      sourceEvidenceClass: "official_broker_observed",
      historicalCompletenessClaim: "not_claimed",
      status: "eligible",
      replayEvidenceClass: "observed_session_only",
      rejectionCode: null
    }
  );
});

test("broker evidence gates reject unsupported, partial, invalid, missing, stale, and ambiguous input", () => {
  const cases: Array<{
    patch: Partial<BrokerObservedCalendarEvidenceTransitionInput>;
    rejectionCode: BrokerObservedCalendarEvidenceTransitionRejectionCode;
  }> = [
    {
      patch: { requestedDateStatus: "unsupported" },
      rejectionCode: "OFFICIAL_BROKER_CALENDAR_UNSUPPORTED_DATE"
    },
    {
      patch: { responseCompleteness: "partial" },
      rejectionCode: "OFFICIAL_BROKER_CALENDAR_PARTIAL_RESPONSE"
    },
    {
      patch: { responseSchemaStatus: "mismatch" },
      rejectionCode: "OFFICIAL_BROKER_CALENDAR_SCHEMA_MISMATCH"
    },
    {
      patch: { provenanceStatus: "missing" },
      rejectionCode: "OFFICIAL_BROKER_CALENDAR_PROVENANCE_MISSING"
    },
    {
      patch: { freshnessStatus: "stale" },
      rejectionCode: "OFFICIAL_BROKER_CALENDAR_SOURCE_STALE"
    },
    {
      patch: { coverageStatus: "ambiguous" },
      rejectionCode: "OFFICIAL_BROKER_CALENDAR_COVERAGE_AMBIGUOUS"
    }
  ];

  for (const { patch, rejectionCode } of cases) {
    const result = evaluateBrokerObservedCalendarEvidenceTransition({
      ...verifiedInput(),
      ...patch
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.replayEvidenceClass, null);
    assert.equal(result.historicalCompletenessClaim, "not_claimed");
    assert.equal(result.rejectionCode, rejectionCode);
  }
});

test("broker evidence transition uses deterministic fail-closed precedence", () => {
  const result = evaluateBrokerObservedCalendarEvidenceTransition({
    ...verifiedInput(),
    requestedDateStatus: "unsupported",
    responseCompleteness: "partial",
    responseSchemaStatus: "mismatch",
    provenanceStatus: "missing",
    freshnessStatus: "stale",
    coverageStatus: "ambiguous"
  });

  assert.equal(
    result.rejectionCode,
    "OFFICIAL_BROKER_CALENDAR_UNSUPPORTED_DATE"
  );
});

test("broker evidence transition rejects class promotion and unknown fields", () => {
  assert.equal(
    brokerObservedCalendarEvidenceTransitionInputSchema.safeParse({
      ...verifiedInput(),
      sourceEvidenceClass: "official_exchange"
    }).success,
    false
  );
  assert.equal(
    brokerObservedCalendarEvidenceTransitionInputSchema.safeParse({
      ...verifiedInput(),
      targetEvidenceClass: "official_exchange"
    }).success,
    false
  );
  assert.equal(
    brokerObservedCalendarEvidenceTransitionResultSchema.safeParse({
      ...evaluateBrokerObservedCalendarEvidenceTransition(verifiedInput()),
      replayEvidenceClass: "official_exchange"
    }).success,
    false
  );
});

function verifiedInput(): BrokerObservedCalendarEvidenceTransitionInput {
  return {
    schemaVersion:
      BROKER_OBSERVED_CALENDAR_EVIDENCE_TRANSITION_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    requestedDateStatus: "supported",
    responseCompleteness: "complete",
    responseSchemaStatus: "verified",
    provenanceStatus: "verified",
    freshnessStatus: "fresh",
    coverageStatus: "verified"
  };
}
