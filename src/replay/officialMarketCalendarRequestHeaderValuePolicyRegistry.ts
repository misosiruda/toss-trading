import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry,
  resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry,
  type OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry
} from "./officialMarketCalendarRequestHeaderValuePolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS } from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS = {
  KRX_FORM_OTP: "krx_form_otp_request_header_values.v1"
} as const;

const REQUEST_HEADER_VALUE_POLICY_REGISTRY_INPUT = [
  {
    requestHeaderValuePolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS.KRX_FORM_OTP,
    requestHeaderValuePolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestMethod: "GET",
        requestedUrl:
          "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
        requestHeaderPolicyVersion:
          OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP,
        requestParameterPolicyVersion:
          OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_FORM_OTP
      },
      fixedHeaderValues: {
        "user-agent": "Mozilla/5.0"
      }
    }
  }
];

export function getOfficialMarketCalendarRequestHeaderValuePolicyRegistry(
): OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry[] {
  return parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry(
    REQUEST_HEADER_VALUE_POLICY_REGISTRY_INPUT
  );
}

export function resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy(
  requestHeaderValuePolicyVersion: unknown
): OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry {
  return resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry(
    requestHeaderValuePolicyVersion,
    REQUEST_HEADER_VALUE_POLICY_REGISTRY_INPUT
  );
}
