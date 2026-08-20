import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy
} from "./officialMarketCalendarKrxHolidayDataPostWirePolicy.js";

test("KRX holiday data POST wire policy resolves the observed encoding", () => {
  const policy = resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION
  );

  assert.equal(
    policy.requestContentType,
    "application/x-www-form-urlencoded; charset=UTF-8"
  );
  assert.deepEqual(policy.parameterOrder, [
    "search_bas_yy",
    "gridTp",
    "pagePath",
    "code"
  ]);
  assert.equal(
    policy.componentEncoding,
    "rfc3986_unreserved_uppercase_percent_triplets.v1"
  );
  assert.equal(policy.maximumRequestBodyByteLength, 1_024);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.sourceSelector), true);
  assert.equal(Object.isFrozen(policy.parameterOrder), true);
});

test("KRX holiday data POST wire policy rejects unregistered versions", () => {
  for (const policyVersion of [
    "krx_holiday_data_post_wire_encoding.v2",
    "",
    null
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy(
        policyVersion
      )
    );
  }
});

test("KRX holiday data POST wire policy fixes the exact source selector", () => {
  const policy = validPolicy();
  for (const value of [
    { ...policy, sourceSelector: { ...policy.sourceSelector, requestMethod: "GET" } },
    { ...policy, sourceSelector: { ...policy.sourceSelector, exchange: "NYSE" } },
    {
      ...policy,
      sourceSelector: {
        ...policy.sourceSelector,
        requestedUrl: "https://global.krx.co.kr/other.jspx"
      }
    }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition(value)
    );
  }
});

test("KRX holiday data POST wire policy rejects encoding drift", () => {
  const policy = validPolicy();
  for (const value of [
    { ...policy, requestContentType: "application/json" },
    { ...policy, parameterOrder: [...policy.parameterOrder].reverse() },
    { ...policy, parameterOrder: policy.parameterOrder.slice(0, 3) },
    { ...policy, componentEncoding: "form_plus.v1" },
    { ...policy, rawOtpHandling: "string_copy.v1" },
    { ...policy, maximumRequestBodyByteLength: 2_048 },
    { ...policy, extra: true }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition(value)
    );
  }
});

test("KRX holiday data POST wire policy returns fresh immutable definitions", () => {
  const first = validPolicy();
  const second = validPolicy();

  assert.notEqual(first, second);
  assert.throws(() => {
    (first.parameterOrder as unknown as string[]).push("extra");
  });
  assert.equal(second.parameterOrder.at(-1), "code");
});

function validPolicy() {
  return resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION
  );
}
