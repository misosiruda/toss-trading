import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_holiday_data_post_wire_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION =
  "krx_holiday_data_post_wire_encoding.v1";

const KRX_HOLIDAY_DATA_POST_URL =
  "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx";

export const officialMarketCalendarKrxHolidayDataPostWirePolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION
      ),
      sourceSelector: z
        .object({
          exchange: z.literal("KRX"),
          requestMethod: z.literal("POST"),
          requestedUrl: z.literal(KRX_HOLIDAY_DATA_POST_URL)
        })
        .strict()
        .readonly(),
      requestContentType: z.literal(
        "application/x-www-form-urlencoded; charset=UTF-8"
      ),
      parameterOrder: z
        .tuple([
          z.literal("search_bas_yy"),
          z.literal("gridTp"),
          z.literal("pagePath"),
          z.literal("code")
        ])
        .readonly(),
      componentEncoding: z.literal(
        "rfc3986_unreserved_uppercase_percent_triplets.v1"
      ),
      rawOtpHandling: z.literal(
        "canonical_base64_bytes_without_string_copy.v1"
      ),
      maximumRequestBodyByteLength: z.literal(1_024)
    })
    .strict()
    .readonly();

export type OfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxHolidayDataPostWirePolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION,
  sourceSelector: {
    exchange: "KRX",
    requestMethod: "POST",
    requestedUrl: KRX_HOLIDAY_DATA_POST_URL
  },
  requestContentType: "application/x-www-form-urlencoded; charset=UTF-8",
  parameterOrder: ["search_bas_yy", "gridTp", "pagePath", "code"],
  componentEncoding: "rfc3986_unreserved_uppercase_percent_triplets.v1",
  rawOtpHandling: "canonical_base64_bytes_without_string_copy.v1",
  maximumRequestBodyByteLength: 1_024
} as const;

export function parseOfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition {
  return officialMarketCalendarKrxHolidayDataPostWirePolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION
  ).parse(policyVersion);
  return parseOfficialMarketCalendarKrxHolidayDataPostWirePolicyDefinition(
    REGISTERED_POLICY_INPUT
  );
}
