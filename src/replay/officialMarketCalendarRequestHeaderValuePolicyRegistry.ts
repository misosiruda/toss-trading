import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry,
  resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry,
  type OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry
} from "./officialMarketCalendarRequestHeaderValuePolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS } from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS = {
  KRX_FORM_OTP: "krx_form_otp_request_header_values.v1",
  KRX_LEGACY_DOWNLOAD_OTP_2013:
    "krx_legacy_download_otp_2013_request_header_values.v1",
  KRX_LEGACY_DOWNLOAD_OTP_2014:
    "krx_legacy_download_otp_2014_request_header_values.v1",
  KRX_LEGACY_DOWNLOAD_OTP_2015:
    "krx_legacy_download_otp_2015_request_header_values.v1"
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
  },
  ...([
    [
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2013,
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2013
    ],
    [
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2014,
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2014
    ],
    [
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2015,
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2015
    ]
  ] as const).map(
    ([requestHeaderValuePolicyVersion, requestParameterPolicyVersion]) => ({
      requestHeaderValuePolicyVersion,
      requestHeaderValuePolicyDefinition: {
        schemaVersion:
          OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION,
        sourceSelector: {
          exchange: "KRX",
          requestMethod: "GET",
          requestedUrl:
            "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
          requestHeaderPolicyVersion:
            OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP,
          requestParameterPolicyVersion
        },
        fixedHeaderValues: {
          referer:
            "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp",
          "user-agent": "Mozilla/5.0"
        }
      }
    })
  )
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
