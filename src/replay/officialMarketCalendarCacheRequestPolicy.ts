import { z } from "zod";

export const OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION =
  "official_market_calendar_cache_request.v1";

const cacheRequestPolicyInputSchema = z
  .object({
    cacheRequestPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION
    ),
    cacheControlHeaderValues: z.array(z.string()),
    pragmaHeaderValues: z.array(z.string()),
    ifNoneMatchHeaderValues: z.array(z.string()),
    ifModifiedSinceHeaderValues: z.array(z.string())
  })
  .strict();

export type OfficialMarketCalendarCacheRequestPolicyInput = z.infer<
  typeof cacheRequestPolicyInputSchema
>;

export function verifyOfficialMarketCalendarCacheRequestPolicy(
  value: unknown
): OfficialMarketCalendarCacheRequestPolicyInput {
  const policy = cacheRequestPolicyInputSchema.parse(value);
  requireSingleCanonicalHeader(
    policy.cacheControlHeaderValues,
    "Cache-Control",
    "no-cache, no-store, max-age=0"
  );
  requireSingleCanonicalHeader(
    policy.pragmaHeaderValues,
    "Pragma",
    "no-cache"
  );
  if (
    policy.ifNoneMatchHeaderValues.length !== 0 ||
    policy.ifModifiedSinceHeaderValues.length !== 0
  ) {
    throw new Error(
      "official calendar cache request must not contain conditional headers"
    );
  }
  return policy;
}

function requireSingleCanonicalHeader(
  values: string[],
  name: string,
  expectedValue: string
): void {
  if (values.length !== 1 || values[0] !== expectedValue) {
    throw new Error(
      `official calendar cache request ${name} must be exactly ${expectedValue}`
    );
  }
}
