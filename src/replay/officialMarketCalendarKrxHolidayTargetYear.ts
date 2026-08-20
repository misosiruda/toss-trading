import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_holiday_target_year_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION =
  "krx_holiday_target_year_values_2016_2026.v1";

const KRX_HOLIDAY_SOURCE_PAGE_URL =
  "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp";
const KRX_HOLIDAY_TARGET_YEAR_VALUES = [
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
] as const;

const targetYearSchema = z.enum(KRX_HOLIDAY_TARGET_YEAR_VALUES);

export type OfficialMarketCalendarKrxHolidayTargetYear = z.infer<
  typeof targetYearSchema
>;

export const officialMarketCalendarKrxHolidayTargetYearPolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
      ),
      sourcePageUrl: z.literal(KRX_HOLIDAY_SOURCE_PAGE_URL),
      requestParameterName: z.literal("search_bas_yy"),
      allowedValues: z
        .tuple([
          z.literal("2026"),
          z.literal("2025"),
          z.literal("2024"),
          z.literal("2023"),
          z.literal("2022"),
          z.literal("2021"),
          z.literal("2020"),
          z.literal("2019"),
          z.literal("2018"),
          z.literal("2017"),
          z.literal("2016")
        ])
        .readonly()
    })
    .strict()
    .readonly();

export type OfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxHolidayTargetYearPolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION,
  sourcePageUrl: KRX_HOLIDAY_SOURCE_PAGE_URL,
  requestParameterName: "search_bas_yy",
  allowedValues: KRX_HOLIDAY_TARGET_YEAR_VALUES
} as const;

export function parseOfficialMarketCalendarKrxHolidayTargetYear(
  value: unknown
): OfficialMarketCalendarKrxHolidayTargetYear {
  return targetYearSchema.parse(value);
}

export function parseOfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition {
  return officialMarketCalendarKrxHolidayTargetYearPolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxHolidayTargetYearPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
  ).parse(policyVersion);
  return parseOfficialMarketCalendarKrxHolidayTargetYearPolicyDefinition(
    REGISTERED_POLICY_INPUT
  );
}
