import { isDeepStrictEqual } from "node:util";

import {
  type OfficialMarketCalendarFreshnessPolicyDefinition,
  type OfficialMarketCalendarFreshnessPolicyRegistryEntry,
  resolveOfficialMarketCalendarFreshnessPolicyFromRegistry
} from "./officialMarketCalendarFreshnessPolicy.js";

export type OfficialMarketCalendarFreshnessPolicySelectorMetadata =
  OfficialMarketCalendarFreshnessPolicyDefinition["sourceSelector"] &
    OfficialMarketCalendarFreshnessPolicyDefinition["coverageSelector"];

export interface ResolvedOfficialMarketCalendarFreshnessPolicySelectorBinding {
  freshnessPolicyEntry: OfficialMarketCalendarFreshnessPolicyRegistryEntry;
  selectorMetadata: OfficialMarketCalendarFreshnessPolicySelectorMetadata;
}

export function resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
  value: unknown,
  recordedEntry: unknown,
  registry: unknown
): ResolvedOfficialMarketCalendarFreshnessPolicySelectorBinding {
  const freshnessPolicyEntry =
    resolveOfficialMarketCalendarFreshnessPolicyFromRegistry(
      recordedEntry,
      registry
    );
  const selectorMetadata = {
    ...freshnessPolicyEntry.freshnessPolicyDefinition.sourceSelector,
    ...freshnessPolicyEntry.freshnessPolicyDefinition.coverageSelector
  };
  if (!isDeepStrictEqual(value, selectorMetadata)) {
    throw new Error(
      "official calendar freshness policy selectors do not match acquisition metadata"
    );
  }
  return {
    freshnessPolicyEntry,
    selectorMetadata
  };
}
