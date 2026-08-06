import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION =
  "official_market_calendar_tls_client.v1";

const tlsClientPolicySchema = z
  .object({
    tlsClientPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION
    ),
    trustStore: z.literal("platform_default"),
    certificateChainVerification: z.literal("required"),
    hostnameVerification: z.literal("required"),
    insecureTlsBypassEnabled: z.literal(false),
    clientCertificateConfigured: z.literal(false)
  })
  .strict();

export type OfficialMarketCalendarTlsClientPolicy = z.infer<
  typeof tlsClientPolicySchema
>;

export function verifyOfficialMarketCalendarTlsClientPolicy(
  value: unknown
): OfficialMarketCalendarTlsClientPolicy {
  return tlsClientPolicySchema.parse(value);
}
