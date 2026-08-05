import { z } from "zod";

const httpsUrlBoundarySchema = z
  .object({
    requestedUrl: z.string().min(1),
    effectiveRequestUrls: z.array(z.string().min(1)).min(1),
    finalUrl: z.string().min(1)
  })
  .strict();

export type OfficialMarketCalendarHttpsUrlBoundary = z.infer<
  typeof httpsUrlBoundarySchema
>;

export function verifyOfficialMarketCalendarHttpsUrlBoundary(
  value: unknown
): OfficialMarketCalendarHttpsUrlBoundary {
  const boundary = httpsUrlBoundarySchema.parse(value);
  if (boundary.effectiveRequestUrls[0] !== boundary.requestedUrl) {
    throw new Error(
      "official calendar requested URL must match first effective request URL"
    );
  }
  if (
    boundary.effectiveRequestUrls[boundary.effectiveRequestUrls.length - 1] !==
    boundary.finalUrl
  ) {
    throw new Error(
      "official calendar final URL must match last effective request URL"
    );
  }

  for (const rawUrl of [
    boundary.requestedUrl,
    ...boundary.effectiveRequestUrls,
    boundary.finalUrl
  ]) {
    verifyHttpsUrl(rawUrl);
  }
  return boundary;
}

function verifyHttpsUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("official calendar request URL must be valid");
  }
  if (url.protocol !== "https:") {
    throw new Error("official calendar request URL must use HTTPS");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("official calendar request URL must not contain userinfo");
  }
}
