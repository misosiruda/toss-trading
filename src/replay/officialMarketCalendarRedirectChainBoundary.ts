import { z } from "zod";

import {
  type OfficialMarketCalendarRedirectLocationBoundary,
  verifyOfficialMarketCalendarRedirectLocationBoundary
} from "./officialMarketCalendarRedirectLocationBoundary.js";
import {
  type OfficialMarketCalendarRedirectMethodBoundary,
  verifyOfficialMarketCalendarRedirectMethodBoundary
} from "./officialMarketCalendarRedirectMethodBoundary.js";
import {
  type OfficialMarketCalendarRedirectStatusBoundary,
  verifyOfficialMarketCalendarRedirectStatusBoundary
} from "./officialMarketCalendarRedirectStatusBoundary.js";

const redirectChainBoundarySchema = z
  .object({
    statusBoundary: z.record(z.string(), z.unknown()),
    locationBoundary: z.record(z.string(), z.unknown()),
    methodBoundary: z.record(z.string(), z.unknown())
  })
  .strict();

export interface OfficialMarketCalendarRedirectChainBoundary {
  statusBoundary: OfficialMarketCalendarRedirectStatusBoundary;
  locationBoundary: OfficialMarketCalendarRedirectLocationBoundary;
  methodBoundary: OfficialMarketCalendarRedirectMethodBoundary;
}

export function verifyOfficialMarketCalendarRedirectChainBoundary(
  value: unknown
): OfficialMarketCalendarRedirectChainBoundary {
  const rawBoundary = redirectChainBoundarySchema.parse(value);
  const boundary = {
    statusBoundary: verifyOfficialMarketCalendarRedirectStatusBoundary(
      rawBoundary.statusBoundary
    ),
    locationBoundary: verifyOfficialMarketCalendarRedirectLocationBoundary(
      rawBoundary.locationBoundary
    ),
    methodBoundary: verifyOfficialMarketCalendarRedirectMethodBoundary(
      rawBoundary.methodBoundary
    )
  };
  const hopCount = boundary.statusBoundary.responseStatuses.length;
  if (
    boundary.locationBoundary.redirectHops.length !== hopCount ||
    boundary.methodBoundary.transitions.length !== hopCount
  ) {
    throw new Error(
      "official calendar redirect boundaries must contain the same hop count"
    );
  }
  for (const [index, responseStatus] of
    boundary.statusBoundary.responseStatuses.entries()) {
    if (
      boundary.methodBoundary.transitions[index]?.responseStatus !==
      responseStatus
    ) {
      throw new Error(
        "official calendar redirect status must match its method transition"
      );
    }
  }
  return boundary;
}
