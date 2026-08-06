import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION =
  "official_market_calendar_credential_free_client.v1";

const credentialFreeClientPolicySchema = z
  .object({
    credentialFreeClientPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION
    ),
    credentialProviderConfigured: z.literal(false),
    proxyCredentialConfigured: z.literal(false),
    httpAuthHandlerConfigured: z.literal(false),
    cookieJarConfigured: z.literal(false)
  })
  .strict();

export type OfficialMarketCalendarCredentialFreeClientPolicy = z.infer<
  typeof credentialFreeClientPolicySchema
>;

export function verifyOfficialMarketCalendarCredentialFreeClientPolicy(
  value: unknown
): OfficialMarketCalendarCredentialFreeClientPolicy {
  return credentialFreeClientPolicySchema.parse(value);
}
