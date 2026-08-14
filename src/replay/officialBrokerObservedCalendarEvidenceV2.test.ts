import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION,
  OFFICIAL_TOSS_OPEN_API_VERSION,
  createOfficialBrokerObservedCalendarEvidence
} from "./officialBrokerObservedCalendarEvidence.js";
import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION,
  createOfficialBrokerObservedCalendarEvidenceV2,
  officialBrokerObservedCalendarEvidenceV2Schema,
  resolveTrustedOfficialTossCalendarParserContract,
  verifyOfficialBrokerObservedCalendarEvidenceV2,
  verifyVersionedOfficialBrokerObservedCalendarEvidence,
  type CreateOfficialBrokerObservedCalendarEvidenceV2Input,
  type OfficialBrokerObservedCalendarEvidenceV2
} from "./officialBrokerObservedCalendarEvidenceV2.js";
import {
  OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256,
  verifyOfficialTossOpenApiCalendarCompatibility
} from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import { OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION } from "./officialBrokerObservedCalendarResponse.js";
import { OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION } from "./officialMarketCalendarCacheRequestPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION } from "./officialMarketCalendarNetworkResponseFreshness.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

const PINNED_OPENAPI_BYTES = canonicalPinnedSnapshotBytes(
  readFileSync("src/replay/officialTossCalendarOpenApi-1.2.14.json")
);
const PINNED_OPENAPI_DOCUMENT = JSON.parse(
  PINNED_OPENAPI_BYTES.toString("utf8")
) as {
  paths: Record<
    string,
    {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                examples: Record<string, { value: unknown }>;
              };
            };
          };
        };
      };
    }
  >;
};

test("builds v2 evidence from verified compatibility and network provenance", () => {
  const rawResponseBytes = pinnedResponseBytes("businessDay");
  const evidence = createEvidence(rawResponseBytes);

  assert.equal(
    evidence.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION
  );
  assert.equal(evidence.mode, "paper_only");
  assert.equal(evidence.sourceEvidenceClass, "official_broker_observed");
  assert.equal(evidence.replayEvidenceClass, "observed_session_only");
  assert.equal(evidence.market, "KR");
  assert.equal(evidence.requestedDate, "2026-03-25");
  assert.deepEqual(evidence.request, {
    method: "GET",
    path: "/api/v1/market-calendar/KR",
    operationId: "getKrMarketCalendar",
    query: { date: "2026-03-25" }
  });
  assert.equal(
    evidence.source.apiContractVersion,
    OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION
  );
  assert.equal(
    evidence.source.openApiDocumentSha256,
    OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256
  );
  assert.equal(
    evidence.source.openApiSnapshotSha256,
    OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256
  );
  assert.equal(
    evidence.source.responseParserContractVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
  );
  assert.equal(
    evidence.source.cacheRequestPolicyVersion,
    OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION
  );
  assert.equal(
    evidence.source.freshnessPolicy.policyVersion,
    OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION
  );
  assert.equal(evidence.source.retrievedAt, "2026-03-25T01:00:10.000Z");
  assert.equal(evidence.source.responseDate, "2026-03-25T01:00:00Z");
  assert.equal(evidence.source.responseAgeSeconds, 5);
  assert.equal(evidence.source.responseExpires, null);
  assert.equal(evidence.source.responseDelayMilliseconds, 250);
  assert.deepEqual(evidence.source.responseCacheControl, [
    "max-age=60",
    "public"
  ]);
  assert.equal(
    evidence.source.effectiveResponseAt,
    "2026-03-25T01:00:00.000Z"
  );
  assert.equal(evidence.source.staleAfter, "2026-03-25T01:01:00.000Z");
  assert.equal(evidence.source.responseByteLength, rawResponseBytes.byteLength);
  assert.equal(
    evidence.source.responseHash,
    `sha256:${createHash("sha256").update(rawResponseBytes).digest("hex")}`
  );
  assert.equal(evidence.coverage.historicalCompletenessClaim, "not_claimed");

  const { artifactHash, ...payload } = evidence;
  assert.equal(artifactHash, createReplayResearchHash(payload));
  assert.deepEqual(
    verifyOfficialBrokerObservedCalendarEvidenceV2(evidence, {
      asOf: "2026-03-25T01:00:30.000Z",
      rawResponseBytes
    }),
    evidence
  );
});

test("v2 preserves nullable Expires and applies it without max-age", () => {
  const evidence = createOfficialBrokerObservedCalendarEvidenceV2({
    ...builderInput(),
    responseCacheHeaders: {
      dateHeaderValues: ["Wed, 25 Mar 2026 01:00:00 GMT"],
      ageHeaderValues: [],
      expiresHeaderValues: ["Wed, 25 Mar 2026 01:02:00 GMT"]
    },
    responseCacheControl: { cacheControlHeaderValues: [] }
  });
  assert.equal(evidence.source.responseExpires, "2026-03-25T01:02:00Z");
  assert.equal(evidence.source.staleAfter, "2026-03-25T01:02:00.000Z");
});

test("version dispatch preserves legacy v1 identity and verifies v2", () => {
  const rawResponseBytes = pinnedResponseBytes("businessDay");
  const legacy = createOfficialBrokerObservedCalendarEvidence({
    market: "KR",
    requestedDate: "2026-03-25",
    retrievedAt: "2026-03-25T01:00:00.000Z",
    evaluatedAt: "2026-03-25T01:00:10.000Z",
    rawResponseBytes
  });
  assert.equal(
    legacy.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION
  );
  assert.equal(legacy.source.apiVersion, OFFICIAL_TOSS_OPEN_API_VERSION);
  assert.deepEqual(
    verifyVersionedOfficialBrokerObservedCalendarEvidence(legacy, {
      asOf: "2026-03-25T01:00:10.000Z",
      rawResponseBytes
    }),
    legacy
  );

  const v2 = createEvidence(rawResponseBytes);
  assert.deepEqual(
    verifyVersionedOfficialBrokerObservedCalendarEvidence(v2, {
      asOf: "2026-03-25T01:00:30.000Z",
      rawResponseBytes
    }),
    v2
  );
  assert.throws(
    () =>
      verifyVersionedOfficialBrokerObservedCalendarEvidence(
        { ...v2, schemaVersion: "official_broker_observed_calendar_evidence.v3" },
        {
          asOf: "2026-03-25T01:00:30.000Z",
          rawResponseBytes
        }
      ),
    /unsupported.*schema version/
  );
});

test("v2 builder rejects caller contract claims and compatibility drift", () => {
  const compatibilityResult = compatibility(pinnedResponseBytes("businessDay"));
  assert.throws(() =>
    resolveTrustedOfficialTossCalendarParserContract({
      ...compatibilityResult,
      apiContract: {
        ...compatibilityResult.apiContract,
        apiContractVersion: "1.2.13"
      }
    })
  );
  assert.throws(() =>
    resolveTrustedOfficialTossCalendarParserContract({
      ...compatibilityResult,
      providerApiVersion: "1.2.14"
    })
  );
  assert.throws(
    () =>
      resolveTrustedOfficialTossCalendarParserContract(
        structuredClone(compatibilityResult)
      ),
    /must be produced by the verified compatibility gate/
  );
  const callerContractClaim = {
    ...builderInput(),
    apiContractVersion: "1.2.14"
  };
  assert.throws(
    () =>
      createOfficialBrokerObservedCalendarEvidenceV2(callerContractClaim),
    /Unrecognized key/
  );
});

test("v2 binds exact response bytes to the compatibility result", () => {
  const businessDayBytes = pinnedResponseBytes("businessDay");
  const alternateBytes = pinnedResponseBytes("nxtPreMarketHoliday");
  assert.throws(
    () =>
      createOfficialBrokerObservedCalendarEvidenceV2({
        ...builderInput(businessDayBytes),
        rawResponseBytes: alternateBytes
      }),
    /do not match verified compatibility result/
  );

  const evidence = createEvidence(businessDayBytes);
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(evidence, {
        asOf: "2026-03-25T01:00:30.000Z",
        rawResponseBytes: Buffer.from(
          JSON.stringify(JSON.parse(businessDayBytes.toString("utf8")), null, 2),
          "utf8"
        )
      }),
    /byte length mismatch|response hash mismatch/
  );
});

test("v2 verifier rejects provenance, request, hash, and class tampering", () => {
  const rawResponseBytes = pinnedResponseBytes("businessDay");
  const evidence = createEvidence(rawResponseBytes);

  assert.equal(
    officialBrokerObservedCalendarEvidenceV2Schema.safeParse({
      ...evidence,
      sourceEvidenceClass: "official_exchange"
    }).success,
    false
  );
  assert.equal(
    officialBrokerObservedCalendarEvidenceV2Schema.safeParse({
      ...evidence,
      source: { ...evidence.source, apiVersion: "1.2.14" }
    }).success,
    false
  );
  assert.equal(
    officialBrokerObservedCalendarEvidenceV2Schema.safeParse({
      ...evidence,
      source: {
        ...evidence.source,
        openApiDocumentSha256: createReplayResearchHash("untrusted")
      }
    }).success,
    false
  );

  const requestTamper = structuredClone(evidence);
  requestTamper.request.path = "/api/v1/market-calendar/US";
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(
        rehashEvidence(requestTamper),
        { asOf: "2026-03-25T01:00:30.000Z", rawResponseBytes }
      ),
    /request identity does not match/
  );

  const freshnessTamper = structuredClone(evidence);
  freshnessTamper.source.staleAfter = "2026-03-25T01:01:00.001Z";
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(
        rehashEvidence(freshnessTamper),
        { asOf: "2026-03-25T01:00:30.000Z", rawResponseBytes }
      ),
    /staleAfter does not match/
  );

  const responseHashTamper = structuredClone(evidence);
  responseHashTamper.source.responseHash = createReplayResearchHash("tampered");
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(
        rehashEvidence(responseHashTamper),
        { asOf: "2026-03-25T01:00:30.000Z", rawResponseBytes }
      ),
    /response hash mismatch/
  );

  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(
        { ...evidence, artifactHash: createReplayResearchHash("tampered") },
        { asOf: "2026-03-25T01:00:30.000Z", rawResponseBytes }
      ),
    /artifact hash mismatch/
  );
});

test("v2 freshness verification fails closed before retrieval and at stale boundary", () => {
  const rawResponseBytes = pinnedResponseBytes("businessDay");
  const evidence = createEvidence(rawResponseBytes);
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(evidence, {
        asOf: "2026-03-25T01:00:09.999Z",
        rawResponseBytes
      }),
    /must not precede retrieval/
  );
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarEvidenceV2(evidence, {
        asOf: evidence.source.staleAfter,
        rawResponseBytes
      }),
    /source is stale/
  );
});

function createEvidence(
  rawResponseBytes: Buffer
): OfficialBrokerObservedCalendarEvidenceV2 {
  return createOfficialBrokerObservedCalendarEvidenceV2(
    builderInput(rawResponseBytes)
  );
}

function builderInput(
  rawResponseBytes = pinnedResponseBytes("businessDay")
): CreateOfficialBrokerObservedCalendarEvidenceV2Input {
  return {
    compatibilityResult: compatibility(rawResponseBytes),
    completedAt: "2026-03-25T01:00:10.000Z",
    responseDelayMilliseconds: 250,
    responseCacheHeaders: {
      dateHeaderValues: ["Wed, 25 Mar 2026 01:00:00 GMT"],
      ageHeaderValues: ["5"],
      expiresHeaderValues: []
    },
    responseCacheControl: {
      cacheControlHeaderValues: ["public, max-age=60"]
    },
    rawResponseBytes
  };
}

function compatibility(rawResponseBytes: Buffer) {
  return verifyOfficialTossOpenApiCalendarCompatibility({
    market: "KR",
    requestedDate: "2026-03-25",
    rawOpenApiDocumentBytes: PINNED_OPENAPI_BYTES,
    rawResponseBytes
  });
}

function canonicalPinnedSnapshotBytes(value: Buffer): Buffer {
  return Buffer.from(value.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
}

function pinnedResponseBytes(
  name: "businessDay" | "holidayToday" | "nxtPreMarketHoliday"
): Buffer {
  const value = PINNED_OPENAPI_DOCUMENT.paths[
    "/api/v1/market-calendar/KR"
  ]!.get.responses["200"].content["application/json"].examples[name]!.value;
  return Buffer.from(JSON.stringify(value), "utf8");
}

function rehashEvidence(
  evidence: OfficialBrokerObservedCalendarEvidenceV2
): OfficialBrokerObservedCalendarEvidenceV2 {
  const { artifactHash: _artifactHash, ...payload } = evidence;
  return { ...payload, artifactHash: createReplayResearchHash(payload) };
}
