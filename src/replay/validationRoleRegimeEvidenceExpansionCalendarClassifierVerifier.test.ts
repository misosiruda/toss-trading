import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG } from "../analytics/marketRegimeClassifier.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";
import {
  createValidationFeasibilityCalendarHash,
  createValidationFeasibilityClassifierHash
} from "./validationSplitRegimeFeasibility.js";
import {
  verifyEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";

const classifier = {
  version: "market_regime_classifier.v1" as const,
  ...DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG
};

test("calendar/classifier verifier canonicalizes sources and computes baseline-compatible hashes", () => {
  const calendarValidation = calendarSource();
  const baselineCalendarHash =
    createValidationFeasibilityCalendarHash(calendarValidation);
  const baselineMarketRegimeClassifierHash =
    createValidationFeasibilityClassifierHash(classifier);

  const verified = verifyEvidenceExpansionCalendarClassifier({
    calendarValidation: {
      rules: [...calendarValidation.rules].reverse(),
      fixtures: [...calendarValidation.fixtures]
        .reverse()
        .map((fixture) => ({
          ...fixture,
          sourceRefs: [...fixture.sourceRefs].reverse()
        }))
    },
    marketRegimeClassifier: classifier,
    asOf: "2025-03-11T00:00:00.000Z",
    baselineCalendarHash,
    baselineMarketRegimeClassifierHash
  });

  assert.deepEqual(
    verified.calendarValidation.rules.map((rule) => rule.market),
    ["KR", "US"]
  );
  assert.deepEqual(
    verified.calendarValidation.fixtures.map((fixture) => fixture.market),
    ["KR", "US"]
  );
  assert.deepEqual(verified.calendarValidation.fixtures[0]?.sourceRefs, [
    "source-a",
    "source-b"
  ]);
  assert.equal(verified.hashes.calendarHash, baselineCalendarHash);
  assert.equal(
    verified.hashes.marketRegimeClassifierHash,
    baselineMarketRegimeClassifierHash
  );
  assert.equal(verified.officialCalendarArtifact, null);
  assert.equal(verified.hashes.officialCalendarArtifactHash, null);
});

test("calendar/classifier verifier validates optional official evidence and preserves its hash", () => {
  const calendarValidation = calendarSource();
  const artifact = officialArtifact();

  const verified = verifyEvidenceExpansionCalendarClassifier({
    calendarValidation,
    marketRegimeClassifier: classifier,
    officialCalendarArtifact: artifact,
    asOf: "2025-03-11T00:00:00.000Z",
    baselineCalendarHash:
      createValidationFeasibilityCalendarHash(calendarValidation),
    baselineMarketRegimeClassifierHash:
      createValidationFeasibilityClassifierHash(classifier)
  });

  assert.equal(
    verified.hashes.officialCalendarArtifactHash,
    artifact.artifactHash
  );
  assert.equal(
    verified.officialCalendarArtifact?.schemaVersion,
    "official_market_calendar_evidence.v1"
  );
});

test("calendar/classifier verifier rejects calendar and classifier baseline provenance conflicts", () => {
  const calendarValidation = calendarSource();
  const calendarHash =
    createValidationFeasibilityCalendarHash(calendarValidation);
  const classifierHash =
    createValidationFeasibilityClassifierHash(classifier);

  assert.throws(
    () =>
      verifyEvidenceExpansionCalendarClassifier({
        calendarValidation,
        marketRegimeClassifier: classifier,
        asOf: "2025-03-11T00:00:00.000Z",
        baselineCalendarHash: hash("f"),
        baselineMarketRegimeClassifierHash: classifierHash
      }),
    /calendar hash does not match baseline/
  );
  assert.throws(
    () =>
      verifyEvidenceExpansionCalendarClassifier({
        calendarValidation,
        marketRegimeClassifier: classifier,
        asOf: "2025-03-11T00:00:00.000Z",
        baselineCalendarHash: calendarHash,
        baselineMarketRegimeClassifierHash: hash("f")
      }),
    /classifier hash does not match baseline/
  );
});

test("calendar/classifier verifier rejects stale official evidence", () => {
  const calendarValidation = calendarSource();

  assert.throws(
    () =>
      verifyEvidenceExpansionCalendarClassifier({
        calendarValidation,
        marketRegimeClassifier: classifier,
        officialCalendarArtifact: officialArtifact(),
        asOf: "2026-01-01T00:00:00.000Z",
        baselineCalendarHash:
          createValidationFeasibilityCalendarHash(calendarValidation),
        baselineMarketRegimeClassifierHash:
          createValidationFeasibilityClassifierHash(classifier)
      }),
    /calendar evidence is stale/
  );
});

test("calendar/classifier verifier rejects legacy fixtures that conflict with official sessions", () => {
  const calendarValidation = calendarSource();
  calendarValidation.fixtures[1]!.marketClose =
    "2025-03-10T19:00:00.000Z";

  assert.throws(
    () =>
      verifyEvidenceExpansionCalendarClassifier({
        calendarValidation,
        marketRegimeClassifier: classifier,
        officialCalendarArtifact: officialArtifact(),
        asOf: "2025-03-11T00:00:00.000Z",
        baselineCalendarHash:
          createValidationFeasibilityCalendarHash(calendarValidation),
        baselineMarketRegimeClassifierHash:
          createValidationFeasibilityClassifierHash(classifier)
      }),
    /calendar fixture does not match official session/
  );
});

test("calendar/classifier verifier rejects unknown source fields", () => {
  const calendarValidation = calendarSource();

  assert.throws(
    () =>
      verifyEvidenceExpansionCalendarClassifier({
        calendarValidation: {
          ...calendarValidation,
          result: "not-allowlisted"
        },
        marketRegimeClassifier: classifier,
        asOf: "2025-03-11T00:00:00.000Z",
        baselineCalendarHash:
          createValidationFeasibilityCalendarHash(calendarValidation),
        baselineMarketRegimeClassifierHash:
          createValidationFeasibilityClassifierHash(classifier)
      }),
    /Unrecognized key/
  );
});

function calendarSource() {
  return {
    rules: [
      {
        market: "KR" as const,
        exchange: "KRX",
        timezone: "Asia/Seoul" as const
      },
      {
        market: "US" as const,
        exchange: "NYSE",
        timezone: "America/New_York" as const
      }
    ],
    fixtures: [
      {
        calendarId: "krx-2025-03-10",
        exchange: "KRX",
        market: "KR" as const,
        timezone: "Asia/Seoul" as const,
        sessionDate: "2025-03-10",
        marketOpen: "2025-03-10T00:00:00.000Z",
        marketClose: "2025-03-10T06:30:00.000Z",
        isHoliday: false,
        sourceRefs: ["source-b", "source-a"],
        createdAt: "2025-03-10T22:00:00.000Z"
      },
      {
        calendarId: "nyse-2025-03-10",
        exchange: "NYSE",
        market: "US" as const,
        timezone: "America/New_York" as const,
        sessionDate: "2025-03-10",
        marketOpen: "2025-03-10T13:30:00.000Z",
        marketClose: "2025-03-10T20:00:00.000Z",
        isHoliday: false,
        sourceRefs: ["source-b", "source-a"],
        createdAt: "2025-03-10T22:00:00.000Z"
      }
    ]
  };
}

function officialArtifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload: OfficialMarketCalendarEvidencePayload = {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-03-10T22:00:00.000Z",
    coverage: {
      startDate: "2025-03-10",
      endDate: "2025-03-10",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      {
        sourceId: "krx-source",
        evidenceClass: "official_exchange",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        publisher: "synthetic KRX fixture",
        sourceUrl: "https://example.com/krx",
        sourceDocumentHash: hash("a"),
        retrievedAt: "2025-03-01T00:00:00.000Z",
        staleAfter: "2026-01-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:00",
          closeLocalTime: "15:30"
        }
      },
      {
        sourceId: "nyse-source",
        evidenceClass: "official_exchange",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        publisher: "synthetic NYSE fixture",
        sourceUrl: "https://example.com/nyse",
        sourceDocumentHash: hash("b"),
        retrievedAt: "2025-03-01T00:00:00.000Z",
        staleAfter: "2026-01-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:30",
          closeLocalTime: "16:00"
        }
      }
    ],
    sessions: [
      {
        sessionId: "krx-session",
        sourceId: "krx-source",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-03-10",
        sessionType: "regular",
        marketOpen: "2025-03-10T09:00:00.000+09:00",
        marketClose: "2025-03-10T15:30:00.000+09:00",
        exceptionName: null
      },
      {
        sessionId: "nyse-session",
        sourceId: "nyse-source",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-03-10",
        sessionType: "regular",
        marketOpen: "2025-03-10T09:30:00.000-04:00",
        marketClose: "2025-03-10T16:00:00.000-04:00",
        exceptionName: null
      }
    ]
  };
  return {
    ...payload,
    artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
  };
}

function hash(character: string): `${string}` {
  return `sha256:${character.repeat(64)}`;
}
