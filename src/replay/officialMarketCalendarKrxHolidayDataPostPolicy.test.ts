import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_DEFINITION_VERSION,
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  parseOfficialMarketCalendarKrxHolidayDataPostPolicyDefinition,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy
} from "./officialMarketCalendarKrxHolidayDataPostPolicy.js";

test("KRX holiday data POST policy resolves the exact registered request partition", () => {
  const policy = resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
  );

  assert.deepEqual(policy, validDefinition());
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.sourceSelector), true);
  assert.equal(Object.isFrozen(policy.fixedRequestParameters), true);
  assert.equal(Object.isFrozen(policy.dynamicRequestParameterNames), true);
});

test("KRX holiday data POST policy rejects unregistered versions", () => {
  for (const policyVersion of [
    "krx_holiday_data_post_static_request.v2",
    "",
    null
  ]) {
    assert.throws(() =>
      resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
        policyVersion
      )
    );
  }
});

test("KRX holiday data POST policy fixes the source page and POST target", () => {
  for (const mutate of [
    (definition: ReturnType<typeof validDefinition>) => {
      definition.sourcePageUrl =
        "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/other.jsp";
    },
    (definition: ReturnType<typeof validDefinition>) => {
      definition.sourceSelector.requestMethod = "GET";
    },
    (definition: ReturnType<typeof validDefinition>) => {
      definition.sourceSelector.requestedUrl =
        "https://global.krx.co.kr/contents/GLB/99/other.jspx";
    }
  ]) {
    const definition = validDefinition();
    mutate(definition);
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataPostPolicyDefinition(definition)
    );
  }
});

test("KRX holiday data POST policy fixes non-token parameters exactly", () => {
  for (const fixedRequestParameters of [
    { gridTp: "NYSE", pagePath: validPagePath() },
    { gridTp: "KRX", pagePath: "/other.jsp" },
    { gridTp: "KRX" },
    { gridTp: "KRX", pagePath: validPagePath(), code: "raw-otp" }
  ]) {
    const definition = validDefinition();
    definition.fixedRequestParameters =
      fixedRequestParameters as typeof definition.fixedRequestParameters;
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataPostPolicyDefinition(definition)
    );
  }
});

test("KRX holiday data POST policy allows only named dynamic slots without values", () => {
  for (const dynamicRequestParameterNames of [
    ["search_bas_yy", "code"],
    ["code"],
    ["code", "search_bas_yy", "pageFirstCall"],
    ["code", "search_bas_yy", "raw-otp"]
  ]) {
    const definition = validDefinition();
    definition.dynamicRequestParameterNames =
      dynamicRequestParameterNames as typeof definition.dynamicRequestParameterNames;
    assert.throws(() =>
      parseOfficialMarketCalendarKrxHolidayDataPostPolicyDefinition(definition)
    );
  }
});

test("KRX holiday data POST policy returns fresh immutable definitions", () => {
  const first = resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
  );
  const second = resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
  );

  assert.notEqual(first, second);
  assert.throws(() => {
    (first.fixedRequestParameters as { gridTp: string }).gridTp = "NYSE";
  });
  assert.equal(second.fixedRequestParameters.gridTp, "KRX");
});

function validDefinition() {
  return {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_DEFINITION_VERSION,
    policyVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
    sourcePageUrl:
      "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp",
    sourceSelector: {
      exchange: "KRX",
      requestMethod: "POST",
      requestedUrl:
        "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx"
    },
    fixedRequestParameters: {
      gridTp: "KRX",
      pagePath: validPagePath()
    },
    dynamicRequestParameterNames: ["code", "search_bas_yy"]
  };
}

function validPagePath(): string {
  return "/contents/GLB/05/0501/0501110000/GLB0501110000.jsp";
}
