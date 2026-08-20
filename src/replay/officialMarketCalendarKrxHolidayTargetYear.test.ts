import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayTargetYear,
  parseOfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy
} from "./officialMarketCalendarKrxHolidayTargetYear.js";

test("KRX holiday target year policy resolves the observed selector values", () => {
  const policy = resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
  );

  assert.deepEqual(policy.allowedValues, [
    "2026",
    "2025",
    "2024",
    "2023",
    "2022",
    "2021",
    "2020",
    "2019",
    "2018",
    "2017",
    "2016"
  ]);
  assert.equal(policy.requestParameterName, "search_bas_yy");
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.allowedValues), true);
});

test("KRX holiday target year accepts each exact registered string", () => {
  for (let year = 2016; year <= 2026; year += 1) {
    assert.equal(
      parseOfficialMarketCalendarKrxHolidayTargetYear(String(year)),
      String(year)
    );
  }
});

test("KRX holiday target year rejects values outside the observed selector", () => {
  for (const value of [
    "2015",
    "2027",
    2026,
    "02026",
    "2026 ",
    "",
    null
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayTargetYear(value)
    );
  }
});

test("KRX holiday target year policy rejects unregistered versions", () => {
  for (const policyVersion of [
    "krx_holiday_target_year_values_2016_2027.v1",
    "",
    null
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
        policyVersion
      )
    );
  }
});

test("KRX holiday target year policy rejects selector drift", () => {
  const policy = resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
  );

  for (const value of [
    { ...policy, requestParameterName: "year" },
    { ...policy, allowedValues: [...policy.allowedValues, "2015"] },
    { ...policy, allowedValues: [...policy.allowedValues].reverse() },
    { ...policy, sourcePageUrl: "https://global.krx.co.kr/other.jsp" },
    { ...policy, extra: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition(value)
    );
  }
});

test("KRX holiday target year policy returns fresh immutable definitions", () => {
  const first = resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
  );
  const second = resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
  );

  assert.notEqual(first, second);
  assert.throws(() => {
    (first.allowedValues as unknown as string[]).push("2015");
  });
  assert.equal(second.allowedValues.at(-1), "2016");
});
