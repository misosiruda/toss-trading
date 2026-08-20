import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayDataRowPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataRowPolicy
} from "./officialMarketCalendarKrxHolidayDataRowPolicy.js";

test("KRX holiday row policy binds the response and target-year contracts", () => {
  const policy = registeredPolicy();
  assert.deepEqual(policy.contractVersions, {
    responseMetadataVersion: "krx_holiday_data_response_metadata.v1",
    responseBodyVersion: "krx_holiday_data_response_body.v1",
    targetYearPolicyVersion: "krx_holiday_target_year_values_2016_2026.v1"
  });
  assert.deepEqual(policy.observation, {
    observedAtDate: "2026-08-20",
    targetYearCoverage: "all_registered_target_year_values"
  });
});

test("KRX holiday row policy fixes field meanings and weekday codes", () => {
  assert.deepEqual(registeredPolicy().fieldSemantics, {
    dateField: "calnd_dd",
    dateEncoding: "canonical_iso_date",
    targetYearBinding: "exact_search_bas_yy_year",
    calendarDayField: "calnd_dd_dy",
    calendarDayBinding: "exact_date_field_match",
    weekdayField: "dy_tp_cd",
    weekdayCodes: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    weekdayBinding: "exact_proleptic_gregorian_weekday",
    koreanHolidayNameField: "kr_dy_tp",
    koreanHolidayNamePolicy: "non_empty_trimmed_without_ascii_control",
    englishHolidayNameField: "holdy_eng_nm",
    englishHolidayNamePolicy: "empty_or_trimmed_without_ascii_control"
  });
});

test("KRX holiday row policy fixes ordering and duplicate rejection", () => {
  assert.deepEqual(registeredPolicy().sequenceSemantics, {
    rowOrder: "strictly_ascending_date",
    duplicateDatePolicy: "reject"
  });
});

test("KRX holiday row policy does not claim retention or completeness", () => {
  assert.deepEqual(registeredPolicy().safetyBoundary, {
    outputRetention: "summary_only_without_row_values",
    historicalCompletenessClaim: "not_claimed",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  });
});

test("KRX holiday row policy rejects definition drift and unknown fields", () => {
  const policy = registeredPolicy();
  for (const value of [
    {
      ...policy,
      fieldSemantics: {
        ...policy.fieldSemantics,
        englishHolidayNamePolicy: "non_empty"
      }
    },
    {
      ...policy,
      sequenceSemantics: {
        ...policy.sequenceSemantics,
        duplicateDatePolicy: "keep_last"
      }
    },
    { ...policy, durableArtifact: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataRowPolicyDefinition(value)
    );
  }
});

test("KRX holiday row policy rejects unregistered versions", () => {
  assert.throws(() =>
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataRowPolicy("unknown")
  );
});

test("KRX holiday row policy returns fresh immutable definitions", () => {
  const first = registeredPolicy();
  const second = registeredPolicy();
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.fieldSemantics), true);
  assert.equal(Object.isFrozen(first.fieldSemantics.weekdayCodes), true);
  assert.throws(() =>
    (first.fieldSemantics.weekdayCodes as unknown as string[]).push("OTHER")
  );
  assert.deepEqual(first, second);
});

function registeredPolicy() {
  return resolveRegisteredOfficialMarketCalendarKrxHolidayDataRowPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_VERSION
  );
}
