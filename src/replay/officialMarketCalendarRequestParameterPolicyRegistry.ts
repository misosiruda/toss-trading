import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION,
  parseOfficialMarketCalendarRequestParameterPolicyRegistry,
  resolveOfficialMarketCalendarRequestParameterPolicyFromRegistry,
  type OfficialMarketCalendarRequestParameterPolicyRegistryEntry
} from "./officialMarketCalendarRequestParameterPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS = {
  KRX_FORM_OTP: "krx_form_otp_request_parameters.v1",
  KRX_LEGACY_DOWNLOAD_OTP_2013:
    "krx_legacy_download_otp_2013_request_parameters.v1",
  KRX_LEGACY_DOWNLOAD_OTP_2014:
    "krx_legacy_download_otp_2014_request_parameters.v1",
  KRX_LEGACY_DOWNLOAD_OTP_2015:
    "krx_legacy_download_otp_2015_request_parameters.v1"
} as const;

const REQUEST_PARAMETER_POLICY_REGISTRY_INPUT = [
  {
    requestParameterPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_FORM_OTP,
    requestParameterPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestMethod: "GET",
        requestedUrl:
          "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
        requestHeaderPolicyVersion:
          OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP
      },
      requestParameters: {
        bld: "GLB/05/0501/0501110000/glb0501110000_01",
        name: "form"
      }
    }
  },
  ...([
    [
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2013,
      "E_Trading_Calendar2013.doc"
    ],
    [
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2014,
      "E_Trading_Calendar2014.doc"
    ],
    [
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP_2015,
      "E_Trading_Calendar2015.doc"
    ]
  ] as const).map(([requestParameterPolicyVersion, fileName]) => ({
    requestParameterPolicyVersion,
    requestParameterPolicyDefinition: {
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION,
      sourceSelector: {
        exchange: "KRX",
        requestMethod: "GET",
        requestedUrl:
          "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx",
        requestHeaderPolicyVersion:
          OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_LEGACY_DOWNLOAD_OTP
      },
      requestParameters: {
        file_nm: fileName,
        filetype: "att",
        name: "fileDown",
        url: "MKD/01/0110/01100303/mkd01100303_DN"
      }
    }
  }))
];

export function getOfficialMarketCalendarRequestParameterPolicyRegistry(
): OfficialMarketCalendarRequestParameterPolicyRegistryEntry[] {
  return parseOfficialMarketCalendarRequestParameterPolicyRegistry(
    REQUEST_PARAMETER_POLICY_REGISTRY_INPUT
  );
}

export function resolveRegisteredOfficialMarketCalendarRequestParameterPolicy(
  requestParameterPolicyVersion: unknown
): OfficialMarketCalendarRequestParameterPolicyRegistryEntry {
  return resolveOfficialMarketCalendarRequestParameterPolicyFromRegistry(
    requestParameterPolicyVersion,
    REQUEST_PARAMETER_POLICY_REGISTRY_INPUT
  );
}
