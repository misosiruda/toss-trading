import { z } from "zod";

import { OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION } from "./officialMarketCalendarKrxHolidayDataResponseBody.js";
import { OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";
import { OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION } from "./officialMarketCalendarKrxHolidayTargetYear.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_holiday_data_row_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_VERSION =
  "krx_holiday_data_row_semantics_2016_2026.v1";

const KRX_HOLIDAY_DATA_POST_URL =
  "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx";

export const officialMarketCalendarKrxHolidayDataRowPolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_DEFINITION_VERSION
    ),
    policyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_VERSION
    ),
    sourceSelector: z
      .object({
        exchange: z.literal("KRX"),
        requestMethod: z.literal("POST"),
        requestedUrl: z.literal(KRX_HOLIDAY_DATA_POST_URL)
      })
      .strict()
      .readonly(),
    contractVersions: z
      .object({
        responseMetadataVersion: z.literal(
          OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION
        ),
        responseBodyVersion: z.literal(
          OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION
        ),
        targetYearPolicyVersion: z.literal(
          OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
        )
      })
      .strict()
      .readonly(),
    observation: z
      .object({
        observedAtDate: z.literal("2026-08-20"),
        targetYearCoverage: z.literal("all_registered_target_year_values")
      })
      .strict()
      .readonly(),
    fieldSemantics: z
      .object({
        dateField: z.literal("calnd_dd"),
        dateEncoding: z.literal("canonical_iso_date"),
        targetYearBinding: z.literal("exact_search_bas_yy_year"),
        calendarDayField: z.literal("calnd_dd_dy"),
        calendarDayBinding: z.literal("exact_date_field_match"),
        weekdayField: z.literal("dy_tp_cd"),
        weekdayCodes: z
          .tuple([
            z.literal("SUN"),
            z.literal("MON"),
            z.literal("TUE"),
            z.literal("WED"),
            z.literal("THU"),
            z.literal("FRI"),
            z.literal("SAT")
          ])
          .readonly(),
        weekdayBinding: z.literal("exact_proleptic_gregorian_weekday"),
        koreanHolidayNameField: z.literal("kr_dy_tp"),
        koreanHolidayNamePolicy: z.literal(
          "non_empty_trimmed_without_ascii_control"
        ),
        englishHolidayNameField: z.literal("holdy_eng_nm"),
        englishHolidayNamePolicy: z.literal(
          "empty_or_trimmed_without_ascii_control"
        )
      })
      .strict()
      .readonly(),
    sequenceSemantics: z
      .object({
        rowOrder: z.literal("strictly_ascending_date"),
        duplicateDatePolicy: z.literal("reject")
      })
      .strict()
      .readonly(),
    safetyBoundary: z
      .object({
        outputRetention: z.literal("summary_only_without_row_values"),
        historicalCompletenessClaim: z.literal("not_claimed"),
        durableEvidenceReusable: z.literal(false),
        acceptedAcquisition: z.literal(false)
      })
      .strict()
      .readonly()
  })
  .strict()
  .readonly();

export type OfficialMarketCalendarKrxHolidayDataRowPolicyDefinition = z.infer<
  typeof officialMarketCalendarKrxHolidayDataRowPolicyDefinitionSchema
>;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_DEFINITION_VERSION,
  policyVersion: OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_VERSION,
  sourceSelector: {
    exchange: "KRX",
    requestMethod: "POST",
    requestedUrl: KRX_HOLIDAY_DATA_POST_URL
  },
  contractVersions: {
    responseMetadataVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION,
    responseBodyVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_BODY_VERSION,
    targetYearPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_TARGET_YEAR_POLICY_VERSION
  },
  observation: {
    observedAtDate: "2026-08-20",
    targetYearCoverage: "all_registered_target_year_values"
  },
  fieldSemantics: {
    dateField: "calnd_dd",
    dateEncoding: "canonical_iso_date",
    targetYearBinding: "exact_search_bas_yy_year",
    calendarDayField: "calnd_dd_dy",
    calendarDayBinding: "exact_date_field_match",
    weekdayField: "dy_tp_cd",
    weekdayCodes: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    weekdayBinding: "exact_proleptic_gregorian_weekday",
    koreanHolidayNameField: "kr_dy_tp",
    koreanHolidayNamePolicy: "non_empty_trimmed_without_ascii_control",
    englishHolidayNameField: "holdy_eng_nm",
    englishHolidayNamePolicy: "empty_or_trimmed_without_ascii_control"
  },
  sequenceSemantics: {
    rowOrder: "strictly_ascending_date",
    duplicateDatePolicy: "reject"
  },
  safetyBoundary: {
    outputRetention: "summary_only_without_row_values",
    historicalCompletenessClaim: "not_claimed",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxHolidayDataRowPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxHolidayDataRowPolicyDefinition {
  return officialMarketCalendarKrxHolidayDataRowPolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxHolidayDataRowPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxHolidayDataRowPolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_ROW_POLICY_VERSION
  ).parse(policyVersion);
  return parseOfficialMarketCalendarKrxHolidayDataRowPolicyDefinition(
    REGISTERED_POLICY_INPUT
  );
}
