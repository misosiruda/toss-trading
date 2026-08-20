import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_legacy_derivatives_calendar_source_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION =
  "krx_legacy_derivatives_calendar_2013_2015.v1";

const SOURCE_PAGE_URL =
  "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp";
const OTP_REQUEST_URL =
  "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx";
const DOWNLOAD_REQUEST_URL = "https://file.krx.co.kr/download.jspx";
const DOWNLOAD_DATA_URL = "MKD/01/0110/01100303/mkd01100303_DN";

const documentSchema = z
  .object({
    targetYear: z.enum(["2013", "2014", "2015"]),
    fileName: z.enum([
      "E_Trading_Calendar2013.doc",
      "E_Trading_Calendar2014.doc",
      "E_Trading_Calendar2015.doc"
    ]),
    contentLength: z.union([
      z.literal(195_584),
      z.literal(214_016),
      z.literal(252_928)
    ]),
    sha256: z.enum([
      "9f2937d2f4d70d9e044890ed3fa846b26c062f145480f6cf816475666dae198c",
      "ec41dd2495a36001c4d0b506f77a8aebfcad903290a602f9523fb12d4137f774",
      "00ddf53202cccee4a1d2617e46a8be94ae63e559e239936c936ad6ce3ea9b592"
    ]),
    oleCompoundFileSignature: z.literal("d0cf11e0a1b11ae1"),
    observedDocumentTitle: z.enum([
      "KRX Derivatives Trading Calendar 2013",
      "KRX Derivatives Market Trading Calendar 2014",
      "KRX Derivatives Market Trading Calendar 2015"
    ]),
    observedHolidayLineCount: z.union([
      z.literal(11),
      z.literal(9)
    ])
  })
  .strict()
  .readonly();

export const officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
      ),
      observation: z
        .object({
          observedAtDate: z.literal("2026-08-20"),
          exchange: z.literal("KRX"),
          marketScope: z.literal("derivatives"),
          sourcePageUrl: z.literal(SOURCE_PAGE_URL),
          sourcePageYearSelectorCoverage: z.literal("2004_2025_with_gap_2021"),
          verifiedDocumentYearCoverage: z
            .tuple([z.literal("2013"), z.literal("2014"), z.literal("2015")])
            .readonly()
        })
        .strict()
        .readonly(),
      otpRequest: z
        .object({
          method: z.literal("GET"),
          requestedUrl: z.literal(OTP_REQUEST_URL),
          fixedParameters: z
            .object({
              name: z.literal("fileDown"),
              filetype: z.literal("att"),
              url: z.literal(DOWNLOAD_DATA_URL)
            })
            .strict()
            .readonly(),
          dynamicParameterNames: z.tuple([z.literal("file_nm")]).readonly()
        })
        .strict()
        .readonly(),
      downloadRequest: z
        .object({
          method: z.literal("POST"),
          requestedUrl: z.literal(DOWNLOAD_REQUEST_URL),
          requestContentType: z.literal("application/x-www-form-urlencoded"),
          dynamicParameterNames: z.tuple([z.literal("code")]).readonly(),
          observedOrigin: z.literal("https://global.krx.co.kr"),
          observedReferer: z.literal(SOURCE_PAGE_URL),
          automaticRedirectFollow: z.literal(false),
          cookieJarEnabled: z.literal(false),
          credentialHeaderCount: z.literal(0)
        })
        .strict()
        .readonly(),
      observedResponse: z
        .object({
          httpStatus: z.literal(200),
          contentType: z.literal("application/octet-stream"),
          contentDispositionBinding: z.literal("attachment_exact_file_name"),
          redirectLocationHeaderCount: z.literal(0)
        })
        .strict()
        .readonly(),
      documents: z
        .tuple([documentSchema, documentSchema, documentSchema])
        .readonly(),
      safetyBoundary: z
        .object({
          rawOtpRetention: z.literal("forbidden"),
          rawDocumentRetention: z.literal("not_registered_by_policy"),
          parserStatus: z.literal("required_not_implemented"),
          sourceRoleStatus: z.literal("candidate_not_accepted"),
          historicalCompletenessClaim: z.literal("not_claimed"),
          durableEvidenceReusable: z.literal(false),
          acceptedAcquisition: z.literal(false)
        })
        .strict()
        .readonly()
    })
    .strict()
    .superRefine((value, context) => {
      const expected = [
        [
          "2013",
          "E_Trading_Calendar2013.doc",
          195_584,
          "9f2937d2f4d70d9e044890ed3fa846b26c062f145480f6cf816475666dae198c",
          "KRX Derivatives Trading Calendar 2013",
          11
        ],
        [
          "2014",
          "E_Trading_Calendar2014.doc",
          214_016,
          "ec41dd2495a36001c4d0b506f77a8aebfcad903290a602f9523fb12d4137f774",
          "KRX Derivatives Market Trading Calendar 2014",
          9
        ],
        [
          "2015",
          "E_Trading_Calendar2015.doc",
          252_928,
          "00ddf53202cccee4a1d2617e46a8be94ae63e559e239936c936ad6ce3ea9b592",
          "KRX Derivatives Market Trading Calendar 2015",
          9
        ]
      ] as const;
      for (let index = 0; index < expected.length; index += 1) {
        const document = value.documents[index]!;
        const [year, fileName, contentLength, sha256, title, holidayLineCount] =
          expected[index]!;
        if (
          document.targetYear !== year ||
          document.fileName !== fileName ||
          document.contentLength !== contentLength ||
          document.sha256 !== sha256 ||
          document.observedDocumentTitle !== title ||
          document.observedHolidayLineCount !== holidayLineCount
        ) {
          context.addIssue({
            code: "custom",
            path: ["documents", index],
            message: "KRX legacy calendar document identity must match the registered observation"
          });
        }
      }
    })
    .readonly();

export type OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  observation: {
    observedAtDate: "2026-08-20",
    exchange: "KRX",
    marketScope: "derivatives",
    sourcePageUrl: SOURCE_PAGE_URL,
    sourcePageYearSelectorCoverage: "2004_2025_with_gap_2021",
    verifiedDocumentYearCoverage: ["2013", "2014", "2015"]
  },
  otpRequest: {
    method: "GET",
    requestedUrl: OTP_REQUEST_URL,
    fixedParameters: {
      name: "fileDown",
      filetype: "att",
      url: DOWNLOAD_DATA_URL
    },
    dynamicParameterNames: ["file_nm"]
  },
  downloadRequest: {
    method: "POST",
    requestedUrl: DOWNLOAD_REQUEST_URL,
    requestContentType: "application/x-www-form-urlencoded",
    dynamicParameterNames: ["code"],
    observedOrigin: "https://global.krx.co.kr",
    observedReferer: SOURCE_PAGE_URL,
    automaticRedirectFollow: false,
    cookieJarEnabled: false,
    credentialHeaderCount: 0
  },
  observedResponse: {
    httpStatus: 200,
    contentType: "application/octet-stream",
    contentDispositionBinding: "attachment_exact_file_name",
    redirectLocationHeaderCount: 0
  },
  documents: [
    {
      targetYear: "2013",
      fileName: "E_Trading_Calendar2013.doc",
      contentLength: 195_584,
      sha256:
        "9f2937d2f4d70d9e044890ed3fa846b26c062f145480f6cf816475666dae198c",
      oleCompoundFileSignature: "d0cf11e0a1b11ae1",
      observedDocumentTitle: "KRX Derivatives Trading Calendar 2013",
      observedHolidayLineCount: 11
    },
    {
      targetYear: "2014",
      fileName: "E_Trading_Calendar2014.doc",
      contentLength: 214_016,
      sha256:
        "ec41dd2495a36001c4d0b506f77a8aebfcad903290a602f9523fb12d4137f774",
      oleCompoundFileSignature: "d0cf11e0a1b11ae1",
      observedDocumentTitle: "KRX Derivatives Market Trading Calendar 2014",
      observedHolidayLineCount: 9
    },
    {
      targetYear: "2015",
      fileName: "E_Trading_Calendar2015.doc",
      contentLength: 252_928,
      sha256:
        "00ddf53202cccee4a1d2617e46a8be94ae63e559e239936c936ad6ce3ea9b592",
      oleCompoundFileSignature: "d0cf11e0a1b11ae1",
      observedDocumentTitle: "KRX Derivatives Market Trading Calendar 2015",
      observedHolidayLineCount: 9
    }
  ],
  safetyBoundary: {
    rawOtpRetention: "forbidden",
    rawDocumentRetention: "not_registered_by_policy",
    parserStatus: "required_not_implemented",
    sourceRoleStatus: "candidate_not_accepted",
    historicalCompletenessClaim: "not_claimed",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition {
  return officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
  ).parse(policyVersion);
  return parseOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicyDefinition(
    REGISTERED_POLICY_INPUT
  );
}
