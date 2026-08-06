import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION =
  "official_market_calendar_redirect.v1";

const redirectClientPolicySchema = z
  .object({
    redirectPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION
    ),
    automaticRedirectFollowEnabled: z.literal(false),
    responsePerHopObservationRequired: z.literal(true),
    effectiveRequestPerHopObservationRequired: z.literal(true)
  })
  .strict();

export type OfficialMarketCalendarRedirectClientPolicy = z.infer<
  typeof redirectClientPolicySchema
>;

export function verifyOfficialMarketCalendarRedirectClientPolicy(
  value: unknown
): OfficialMarketCalendarRedirectClientPolicy {
  return redirectClientPolicySchema.parse(value);
}
