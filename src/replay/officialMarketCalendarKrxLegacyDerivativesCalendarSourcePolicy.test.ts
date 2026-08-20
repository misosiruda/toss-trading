import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  parseOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";

test("KRX legacy derivatives calendar policy registers exact 2013-2015 document identities", () => {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );

  assert.equal(policy.observation.marketScope, "derivatives");
  assert.deepEqual(policy.observation.verifiedDocumentYearCoverage, [
    "2013",
    "2014",
    "2015"
  ]);
  assert.deepEqual(
    policy.documents.map((document) => [
      document.targetYear,
      document.fileName,
      document.contentLength,
      document.sha256,
      document.oleCompoundFileSignature
    ]),
    [
      [
        "2013",
        "E_Trading_Calendar2013.doc",
        195_584,
        "9f2937d2f4d70d9e044890ed3fa846b26c062f145480f6cf816475666dae198c",
        "d0cf11e0a1b11ae1"
      ],
      [
        "2014",
        "E_Trading_Calendar2014.doc",
        214_016,
        "ec41dd2495a36001c4d0b506f77a8aebfcad903290a602f9523fb12d4137f774",
        "d0cf11e0a1b11ae1"
      ],
      [
        "2015",
        "E_Trading_Calendar2015.doc",
        252_928,
        "00ddf53202cccee4a1d2617e46a8be94ae63e559e239936c936ad6ce3ea9b592",
        "d0cf11e0a1b11ae1"
      ]
    ]
  );
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.documents), true);
  assert.equal(Object.isFrozen(policy.documents[0]), true);
});

test("KRX legacy derivatives calendar policy keeps download tokens and source acceptance disabled", () => {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );
  const serialized = JSON.stringify(policy);

  assert.deepEqual(policy.otpRequest.dynamicParameterNames, ["file_nm"]);
  assert.deepEqual(policy.downloadRequest.dynamicParameterNames, ["code"]);
  assert.equal(policy.downloadRequest.cookieJarEnabled, false);
  assert.equal(policy.downloadRequest.credentialHeaderCount, 0);
  assert.equal(policy.safetyBoundary.rawOtpRetention, "forbidden");
  assert.equal(policy.safetyBoundary.parserStatus, "required_not_implemented");
  assert.equal(policy.safetyBoundary.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(policy.safetyBoundary.historicalCompletenessClaim, "not_claimed");
  assert.equal(policy.safetyBoundary.durableEvidenceReusable, false);
  assert.equal(policy.safetyBoundary.acceptedAcquisition, false);
  assert.equal(serialized.includes("rawResponseBytes"), false);
  assert.equal(serialized.includes("otpValue"), false);
});

test("KRX legacy derivatives calendar policy rejects document identity drift", () => {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );

  for (const documents of [
    [policy.documents[1], policy.documents[0], policy.documents[2]],
    [
      { ...policy.documents[0], contentLength: 195_583 },
      policy.documents[1],
      policy.documents[2]
    ],
    [
      { ...policy.documents[0], sha256: "f".repeat(64) },
      policy.documents[1],
      policy.documents[2]
    ]
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition({
        ...policy,
        documents
      })
    );
  }
});

test("KRX legacy derivatives calendar policy rejects unknown versions and fields", () => {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );

  assert.throws(() =>
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      "krx_legacy_derivatives_calendar_2013_2015.v2"
    )
  );
  assert.throws(() =>
    parseOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition({
      ...policy,
      unknown: true
    })
  );
});
