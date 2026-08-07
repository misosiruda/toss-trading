import { z } from "zod";

import { parseOfficialMarketCalendarFreshnessPolicyRegistry } from "./officialMarketCalendarFreshnessPolicy.js";
import {
  type ResolvedOfficialMarketCalendarFreshnessPolicySelectorBinding,
  resolveOfficialMarketCalendarFreshnessPolicySelectorBinding
} from "./officialMarketCalendarFreshnessPolicySelectorBinding.js";
import {
  type OfficialMarketCalendarRedirectChainBoundary,
  verifyOfficialMarketCalendarRedirectChainBoundary
} from "./officialMarketCalendarRedirectChainBoundary.js";

const acquisitionFreshnessPolicyBoundarySchema = z
  .object({
    redirectChainBoundary: z.record(z.string(), z.unknown()),
    freshnessPolicySelectorMetadata: z.record(z.string(), z.unknown())
  })
  .strict();

export interface OfficialMarketCalendarAcquisitionFreshnessPolicyBoundary {
  redirectChainBoundary: OfficialMarketCalendarRedirectChainBoundary;
  freshnessPolicySelectorBinding: ResolvedOfficialMarketCalendarFreshnessPolicySelectorBinding;
}

export function verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
  value: unknown,
  freshnessPolicyRegistry: unknown
): OfficialMarketCalendarAcquisitionFreshnessPolicyBoundary {
  const rawBoundary = acquisitionFreshnessPolicyBoundarySchema.parse(value);
  const redirectChainBoundary =
    verifyOfficialMarketCalendarRedirectChainBoundary(
      rawBoundary.redirectChainBoundary,
      freshnessPolicyRegistry
    );
  const policyIdentity =
    redirectChainBoundary.finalResponseBoundary.freshnessPolicyExpiry;
  const registeredEntry =
    parseOfficialMarketCalendarFreshnessPolicyRegistry(
      freshnessPolicyRegistry
    ).find(
      (entry) =>
        entry.freshnessPolicyVersion ===
        policyIdentity.freshnessPolicyVersion
    );
  if (
    registeredEntry === undefined ||
    registeredEntry.freshnessPolicyHash !==
      policyIdentity.freshnessPolicyHash
  ) {
    throw new Error(
      "official calendar final response freshness policy identity does not match registry"
    );
  }
  const sourceSelector =
    registeredEntry.freshnessPolicyDefinition.sourceSelector;
  const initialMethodTransition =
    redirectChainBoundary.methodBoundary.transitions[0];
  if (
    initialMethodTransition === undefined ||
    sourceSelector.exchange !==
      redirectChainBoundary.domainAllowlistBoundary.exchange ||
    sourceSelector.requestedUrl !==
      redirectChainBoundary.httpsUrlBoundary.requestedUrl ||
    sourceSelector.requestMethod !==
      initialMethodTransition.requestMethod ||
    sourceSelector.requestBodyContentType !==
      initialMethodTransition.requestBodyContentType ||
    sourceSelector.requestBodyHash !==
      initialMethodTransition.requestBodyHash
  ) {
    throw new Error(
      "official calendar freshness policy selectors do not match verified initial request"
    );
  }
  return {
    redirectChainBoundary,
    freshnessPolicySelectorBinding:
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        rawBoundary.freshnessPolicySelectorMetadata,
        registeredEntry,
        freshnessPolicyRegistry
      )
  };
}
