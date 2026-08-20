import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestParameterPolicyDefinition,
  parseOfficialMarketCalendarRequestParameterPolicyRegistry,
  parseOfficialMarketCalendarRequestParameterPolicyRegistryEntry,
  resolveOfficialMarketCalendarRequestParameterPolicyFromRegistry
} from "./officialMarketCalendarRequestParameterPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";

test("calendar request parameter policy accepts an exact credential-free OTP definition", () => {
  const definition = policyDefinition();

  assert.deepEqual(
    parseOfficialMarketCalendarRequestParameterPolicyDefinition(definition),
    definition
  );
});

test("calendar request parameter policy rejects non-canonical parameter order", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestParameterPolicyDefinition(
        policyDefinition({
          requestParameters: {
            name: "form",
            bld: "GLB/05/0501/0501110000/glb0501110000_01"
          }
        })
      ),
    /canonical key order/
  );
});

test("calendar request parameter policy rejects secret and unregistered names", () => {
  for (const parameterName of [
    "authorization",
    "code",
    "cookie",
    "otp",
    "token",
    "year"
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarRequestParameterPolicyDefinition(
          policyDefinition({ requestParameters: { [parameterName]: "value" } })
        ),
      /must only contain known-safe names/
    );
  }
});

test("calendar request parameter policy rejects unsafe values", () => {
  for (const value of ["", " form", "form ", "form\n", "한글"]) {
    assert.throws(() =>
      parseOfficialMarketCalendarRequestParameterPolicyDefinition(
        policyDefinition({ requestParameters: { name: value } })
      )
    );
  }
});

test("calendar request parameter policy rejects invalid or mismatched selectors", () => {
  for (const definition of [
    policyDefinition({
      requestedUrl:
        "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx?name=form"
    }),
    policyDefinition({
      requestedUrl:
        "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp"
    }),
    policyDefinition({ requestHeaderPolicyVersion: "unknown.v1" })
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarRequestParameterPolicyDefinition(definition)
    );
  }
});

test("calendar request parameter policy rejects invalid fields and empty parameters", () => {
  assert.throws(() =>
    parseOfficialMarketCalendarRequestParameterPolicyDefinition({
      ...policyDefinition(),
      allowsSecrets: false
    })
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestParameterPolicyDefinition(
        policyDefinition({ requestParameters: {} })
      ),
    /must contain fixed parameters/
  );
});

test("calendar request parameter policy resolves exact unique registry versions", () => {
  const entry = registryEntry();

  assert.deepEqual(
    parseOfficialMarketCalendarRequestParameterPolicyRegistryEntry(entry),
    entry
  );
  assert.deepEqual(
    resolveOfficialMarketCalendarRequestParameterPolicyFromRegistry(
      entry.requestParameterPolicyVersion,
      [entry]
    ),
    entry
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarRequestParameterPolicyRegistry([
        entry,
        entry
      ]),
    /versions must be unique/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarRequestParameterPolicyFromRegistry(
        "unknown.v1",
        [entry]
      ),
    /version is not registered/
  );
});

function policyDefinition(
  overrides: Partial<{
    schemaVersion: string;
    requestMethod: "GET" | "POST";
    requestedUrl: string;
    requestHeaderPolicyVersion: string;
    requestParameters: Record<string, string>;
  }> = {}
) {
  return {
    schemaVersion:
      overrides.schemaVersion ??
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION,
    sourceSelector: {
      exchange: "KRX" as const,
      requestMethod: overrides.requestMethod ?? ("GET" as const),
      requestedUrl:
        overrides.requestedUrl ??
        "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
      requestHeaderPolicyVersion:
        overrides.requestHeaderPolicyVersion ??
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP
    },
    requestParameters: overrides.requestParameters ?? {
      bld: "GLB/05/0501/0501110000/glb0501110000_01",
      name: "form"
    }
  };
}

function registryEntry() {
  return {
    requestParameterPolicyVersion: "test.krx_form_otp_parameters.v1",
    requestParameterPolicyDefinition: policyDefinition()
  };
}
