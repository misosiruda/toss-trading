import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_holiday_data_post_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION =
  "krx_holiday_data_post_static_request.v1";

const KRX_HOLIDAY_SOURCE_PAGE_URL =
  "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp";
const KRX_HOLIDAY_DATA_POST_URL =
  "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx";
const KRX_HOLIDAY_PAGE_PATH =
  "/contents/GLB/05/0501/0501110000/GLB0501110000.jsp";

export const officialMarketCalendarKrxHolidayDataPostPolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_DEFINITION_VERSION
    ),
    policyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
    ),
    sourcePageUrl: z.literal(KRX_HOLIDAY_SOURCE_PAGE_URL),
    sourceSelector: z
      .object({
        exchange: z.literal("KRX"),
        requestMethod: z.literal("POST"),
        requestedUrl: z.literal(KRX_HOLIDAY_DATA_POST_URL)
      })
      .strict()
      .readonly(),
    fixedRequestParameters: z
      .object({
        gridTp: z.literal("KRX"),
        pagePath: z.literal(KRX_HOLIDAY_PAGE_PATH)
      })
      .strict()
      .readonly(),
    dynamicRequestParameterNames: z
      .tuple([z.literal("code"), z.literal("search_bas_yy")])
      .readonly()
  })
  .strict()
  .readonly();

export type OfficialMarketCalendarKrxHolidayDataPostPolicyDefinition = z.infer<
  typeof officialMarketCalendarKrxHolidayDataPostPolicyDefinitionSchema
>;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_DEFINITION_VERSION,
  policyVersion: OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  sourcePageUrl: KRX_HOLIDAY_SOURCE_PAGE_URL,
  sourceSelector: {
    exchange: "KRX",
    requestMethod: "POST",
    requestedUrl: KRX_HOLIDAY_DATA_POST_URL
  },
  fixedRequestParameters: {
    gridTp: "KRX",
    pagePath: KRX_HOLIDAY_PAGE_PATH
  },
  dynamicRequestParameterNames: ["code", "search_bas_yy"]
} as const;

export function parseOfficialMarketCalendarKrxHolidayDataPostPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxHolidayDataPostPolicyDefinition {
  return officialMarketCalendarKrxHolidayDataPostPolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxHolidayDataPostPolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
  ).parse(policyVersion);
  return parseOfficialMarketCalendarKrxHolidayDataPostPolicyDefinition(
    REGISTERED_POLICY_INPUT
  );
}
