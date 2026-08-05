import { z } from "zod";

import { verifyOfficialMarketCalendarHttpsUrlBoundary } from "./officialMarketCalendarHttpsUrlBoundary.js";

export const OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION =
  "official_market_calendar_domain_allowlist.v1";

export const OFFICIAL_MARKET_CALENDAR_ALLOWED_HOSTNAMES = {
  KRX: ["global.krx.co.kr"],
  NYSE: ["www.nyse.com"]
} as const;

const domainAllowlistInputSchema = z
  .object({
    exchange: z.enum(["KRX", "NYSE"]),
    domainAllowlistPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION
    ),
    urls: z.array(z.string().min(1)).min(1)
  })
  .strict();

export type OfficialMarketCalendarDomainAllowlistInput = z.infer<
  typeof domainAllowlistInputSchema
>;

export function verifyOfficialMarketCalendarDomainAllowlist(
  value: unknown
): OfficialMarketCalendarDomainAllowlistInput {
  const input = domainAllowlistInputSchema.parse(value);
  const allowedHostnames = OFFICIAL_MARKET_CALENDAR_ALLOWED_HOSTNAMES[
    input.exchange
  ] as readonly string[];

  for (const rawUrl of input.urls) {
    verifyOfficialMarketCalendarHttpsUrlBoundary({
      requestedUrl: rawUrl,
      effectiveRequestUrls: [rawUrl],
      finalUrl: rawUrl
    });
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("official calendar allowlist URL must be valid");
    }
    if (!allowedHostnames.includes(url.hostname) || url.port !== "") {
      throw new Error(
        `official calendar URL host is not allowed for ${input.exchange}`
      );
    }
  }
  return input;
}
