import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestHeaderPolicyRegistry,
  resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry,
  type OfficialMarketCalendarRequestHeaderPolicyRegistryEntry
} from "./officialMarketCalendarRequestHeaderPolicy.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS = {
  KRX_FORM_OTP: "krx_form_otp_request_headers.v1",
  KRX_LEGACY_DOWNLOAD_OTP:
    "krx_legacy_download_otp_request_headers.v1",
  KRX_MARKET_CLOSING_HOLIDAY:
    "krx_market_closing_holiday_request_headers.v1",
  KRX_REGULAR_SESSION: "krx_regular_session_request_headers.v1",
  KRX_2016_SESSION_EXTENSION_BROCHURE:
    "krx_2016_session_extension_brochure_request_headers.v1",
  NYSE_TRADE_HOURS_CALENDARS:
    "nyse_trade_hours_calendars_request_headers.v1"
} as const;

const REQUEST_HEADER_POLICY_REGISTRY_INPUT = [
  {
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP,
    requestHeaderPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestedUrl:
          "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx"
      },
      allowedHeaderNames: [
        "accept",
        "cache-control",
        "pragma",
        "user-agent"
      ]
    }
  },
  {
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP,
    requestHeaderPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestedUrl:
          "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx"
      },
      allowedHeaderNames: [
        "accept",
        "cache-control",
        "pragma",
        "referer",
        "user-agent"
      ]
    }
  },
  {
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_MARKET_CLOSING_HOLIDAY,
    requestHeaderPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestedUrl:
          "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp"
      },
      allowedHeaderNames: [
        "accept",
        "accept-language",
        "cache-control",
        "content-type",
        "pragma"
      ]
    }
  },
  {
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_REGULAR_SESSION,
    requestHeaderPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestedUrl:
          "https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp"
      },
      allowedHeaderNames: [
        "accept",
        "accept-language",
        "cache-control",
        "content-type",
        "pragma"
      ]
    }
  },
  {
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_2016_SESSION_EXTENSION_BROCHURE,
    requestHeaderPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestedUrl:
          "https://global.krx.co.kr/contents/GLB/01/0107/0107010000/20170630_eng_brochure.pdf"
      },
      allowedHeaderNames: [
        "accept",
        "accept-language",
        "cache-control",
        "content-type",
        "pragma"
      ]
    }
  },
  {
    requestHeaderPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.NYSE_TRADE_HOURS_CALENDARS,
    requestHeaderPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "NYSE",
        requestedUrl: "https://www.nyse.com/trade/hours-calendars"
      },
      allowedHeaderNames: ["accept", "cache-control", "pragma"]
    }
  }
];

export function getOfficialMarketCalendarRequestHeaderPolicyRegistry(
): OfficialMarketCalendarRequestHeaderPolicyRegistryEntry[] {
  return parseOfficialMarketCalendarRequestHeaderPolicyRegistry(
    REQUEST_HEADER_POLICY_REGISTRY_INPUT
  );
}

export function resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
  requestHeaderPolicyVersion: unknown
): OfficialMarketCalendarRequestHeaderPolicyRegistryEntry {
  return resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry(
    requestHeaderPolicyVersion,
    REQUEST_HEADER_POLICY_REGISTRY_INPUT
  );
}
