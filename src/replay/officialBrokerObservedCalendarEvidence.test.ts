import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION,
  OFFICIAL_BROKER_OBSERVED_CALENDAR_FRESHNESS_POLICY_VERSION,
  OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS,
  OFFICIAL_TOSS_OPEN_API_VERSION,
  createOfficialBrokerObservedCalendarEvidence,
  officialBrokerObservedCalendarEvidenceSchema,
  verifyOfficialBrokerObservedCalendarEvidence,
  type OfficialBrokerObservedCalendarEvidence
} from "./officialBrokerObservedCalendarEvidence.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

test("binds synthetic Toss response bytes to strict provenance and coverage", () => {
  const rawResponseBytes = responseBytes();
  const evidence = createEvidence(rawResponseBytes);

  assert.equal(
    evidence.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION
  );
  assert.equal(evidence.mode, "paper_only");
  assert.equal(evidence.sourceEvidenceClass, "official_broker_observed");
  assert.equal(evidence.replayEvidenceClass, "observed_session_only");
  assert.deepEqual(evidence.request, {
    method: "GET",
    path: "/api/v1/market-calendar/KR",
    operationId: "getKrMarketCalendar",
    query: { date: "2026-03-25" }
  });
  assert.equal(evidence.source.apiVersion, OFFICIAL_TOSS_OPEN_API_VERSION);
  assert.equal(
    evidence.source.freshnessPolicy.policyVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_FRESHNESS_POLICY_VERSION
  );
  assert.equal(
    evidence.source.freshnessPolicy.maximumAgeSeconds,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS
  );
  assert.equal(evidence.source.staleAfter, "2026-03-26T01:00:00.000Z");
  assert.equal(evidence.source.responseByteLength, rawResponseBytes.byteLength);
  assert.equal(
    evidence.source.responseHash,
    `sha256:${createHash("sha256").update(rawResponseBytes).digest("hex")}`
  );
  assert.deepEqual(evidence.coverage, {
    status: "verified",
    scope: "requested_date_and_returned_sessions_only",
    requestedDate: "2026-03-25",
    returnedDates: ["2026-03-24", "2026-03-25", "2026-03-26"],
    returnedDateRange: {
      startDate: "2026-03-24",
      endDate: "2026-03-26"
    },
    returnedSessionCount: 9,
    returnedSessionRange: {
      startAt: "2026-03-23T23:00:00.000Z",
      endAt: "2026-03-26T11:00:00.000Z"
    },
    historicalCompletenessClaim: "not_claimed"
  });

  const { artifactHash, ...payload } = evidence;
  assert.equal(artifactHash, createReplayResearchHash(payload));
  assert.deepEqual(
    verifyOfficialBrokerObservedCalendarEvidence(evidence, {
      asOf: "2026-03-25T12:00:00.000Z",
      rawResponseBytes
    }),
    evidence
  );
});

test("hashes exact raw bytes while preserving deterministic normalization", () => {
  const compactBytes = responseBytes();
  const prettyBytes = Buffer.from(JSON.stringify(krResponse(), null, 2), "utf8");
  const compact = createEvidence(compactBytes);
  const pretty = createEvidence(prettyBytes);

  assert.deepEqual(compact.response, pretty.response);
  assert.notEqual(compact.source.responseHash, pretty.source.responseHash);
  assert.notEqual(
    compact.source.responseByteLength,
    pretty.source.responseByteLength
  );
  assert.notEqual(compact.artifactHash, pretty.artifactHash);
});

test("rejects raw byte, response hash, and artifact hash mismatches", () => {
  const rawResponseBytes = responseBytes();
  const evidence = createEvidence(rawResponseBytes);
  const sameLengthDifferentBytes = Buffer.from(
    rawResponseBytes.toString("utf8").replace("2026-03-25", "2026-03-23"),
    "utf8"
  );
  assert.equal(sameLengthDifferentBytes.byteLength, rawResponseBytes.byteLength);
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(evidence, {
        asOf: "2026-03-25T12:00:00.000Z",
        rawResponseBytes: sameLengthDifferentBytes
      }),
    /response hash mismatch/
  );

  const responseHashTamper = structuredClone(evidence);
  responseHashTamper.source.responseHash = createReplayResearchHash("tampered");
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(
        rehashEvidence(responseHashTamper),
        {
          asOf: "2026-03-25T12:00:00.000Z",
          rawResponseBytes
        }
      ),
    /response hash mismatch/
  );

  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(
        { ...evidence, artifactHash: createReplayResearchHash("tampered") },
        {
          asOf: "2026-03-25T12:00:00.000Z",
          rawResponseBytes
        }
      ),
    /artifact hash mismatch/
  );
});

test("rejects request, coverage, freshness, promotion, and secret-field tampering", () => {
  const rawResponseBytes = responseBytes();
  const evidence = createEvidence(rawResponseBytes);

  const requestTamper = structuredClone(evidence);
  requestTamper.request.path = "/api/v1/market-calendar/US";
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(
        rehashEvidence(requestTamper),
        {
          asOf: "2026-03-25T12:00:00.000Z",
          rawResponseBytes
        }
      ),
    /request identity does not match/
  );

  const coverageTamper = structuredClone(evidence);
  coverageTamper.coverage.returnedSessionCount -= 1;
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(
        rehashEvidence(coverageTamper),
        {
          asOf: "2026-03-25T12:00:00.000Z",
          rawResponseBytes
        }
      ),
    /coverage does not match/
  );

  const freshnessTamper = structuredClone(evidence);
  freshnessTamper.source.staleAfter = "2026-03-27T01:00:00.000Z";
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(
        rehashEvidence(freshnessTamper),
        {
          asOf: "2026-03-25T12:00:00.000Z",
          rawResponseBytes
        }
      ),
    /stale time does not match/
  );

  assert.equal(
    officialBrokerObservedCalendarEvidenceSchema.safeParse({
      ...evidence,
      sourceEvidenceClass: "official_exchange"
    }).success,
    false
  );
  assert.equal(
    officialBrokerObservedCalendarEvidenceSchema.safeParse({
      ...evidence,
      source: { ...evidence.source, accessToken: "must-not-be-recorded" }
    }).success,
    false
  );
});

test("fails closed before retrieval and at the 24-hour stale boundary", () => {
  const rawResponseBytes = responseBytes();
  assert.throws(
    () =>
      createOfficialBrokerObservedCalendarEvidence({
        market: "KR",
        requestedDate: "2026-03-25",
        retrievedAt: "2026-03-25T01:00:00.000Z",
        evaluatedAt: "2026-03-25T00:59:59.999Z",
        rawResponseBytes
      }),
    /must not precede retrieval/
  );
  assert.throws(
    () =>
      createOfficialBrokerObservedCalendarEvidence({
        market: "KR",
        requestedDate: "2026-03-25",
        retrievedAt: "2026-03-25T01:00:00.000Z",
        evaluatedAt: "2026-03-26T01:00:00.000Z",
        rawResponseBytes
      }),
    /source is stale/
  );

  const evidence = createEvidence(rawResponseBytes);
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidence(evidence, {
        asOf: evidence.source.staleAfter,
        rawResponseBytes
      }),
    /source is stale/
  );
});

test("rejects invalid UTF-8, malformed JSON, and incomplete response schema", () => {
  assert.throws(
    () => createEvidence(Uint8Array.from([0xff])),
    /must be valid UTF-8/
  );
  assert.throws(
    () => createEvidence(Buffer.from("{", "utf8")),
    /must be valid JSON/
  );
  assert.throws(() =>
    createEvidence(
      Buffer.from(
        JSON.stringify({ result: { today: krResponse().result.today } }),
        "utf8"
      )
    )
  );
});

function createEvidence(
  rawResponseBytes: Uint8Array
): OfficialBrokerObservedCalendarEvidence {
  return createOfficialBrokerObservedCalendarEvidence({
    market: "KR",
    requestedDate: "2026-03-25",
    retrievedAt: "2026-03-25T01:00:00.000Z",
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });
}

function rehashEvidence(
  evidence: OfficialBrokerObservedCalendarEvidence
): OfficialBrokerObservedCalendarEvidence {
  const { artifactHash: _artifactHash, ...payload } = evidence;
  return { ...payload, artifactHash: createReplayResearchHash(payload) };
}

function responseBytes(): Buffer {
  return Buffer.from(JSON.stringify(krResponse()), "utf8");
}

interface KrMarketDayFixture {
  date: string;
  integrated: KrIntegratedFixture;
}

interface KrResponseFixture {
  result: {
    today: KrMarketDayFixture;
    previousBusinessDay: KrMarketDayFixture;
    nextBusinessDay: KrMarketDayFixture;
  };
}

function krResponse(): KrResponseFixture {
  return {
    result: {
      today: { date: "2026-03-25", integrated: krIntegrated("2026-03-25") },
      previousBusinessDay: {
        date: "2026-03-24",
        integrated: krIntegrated("2026-03-24")
      },
      nextBusinessDay: {
        date: "2026-03-26",
        integrated: krIntegrated("2026-03-26")
      }
    }
  };
}

interface KrIntegratedFixture {
  preMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  };
  regularMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  };
  afterMarket: {
    startTime: string;
    singlePriceAuctionEndTime: string;
    endTime: string;
  };
}

function krIntegrated(date: string): KrIntegratedFixture {
  return {
    preMarket: {
      startTime: `${date}T08:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T08:50:00+09:00`,
      endTime: `${date}T09:00:00+09:00`
    },
    regularMarket: {
      startTime: `${date}T09:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T15:20:00+09:00`,
      endTime: `${date}T15:30:00+09:00`
    },
    afterMarket: {
      startTime: `${date}T15:30:00+09:00`,
      singlePriceAuctionEndTime: `${date}T15:40:00+09:00`,
      endTime: `${date}T20:00:00+09:00`
    }
  };
}
