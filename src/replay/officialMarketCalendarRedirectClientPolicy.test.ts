import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION,
  verifyOfficialMarketCalendarRedirectClientPolicy
} from "./officialMarketCalendarRedirectClientPolicy.js";

test("calendar redirect client policy accepts observable manual redirect handling", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectClientPolicy(policy()),
    policy()
  );
});

test("calendar redirect client policy rejects automatic follow", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectClientPolicy(
      policy({ automaticRedirectFollowEnabled: true })
    )
  );
});

test("calendar redirect client policy requires response and request observation", () => {
  for (const overrides of [
    { responsePerHopObservationRequired: false },
    { effectiveRequestPerHopObservationRequired: false }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRedirectClientPolicy(policy(overrides))
    );
  }
});

test("calendar redirect client policy rejects unknown version and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectClientPolicy(
      policy({
        redirectPolicyVersion: "official_market_calendar_redirect.v2"
      })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectClientPolicy({
        ...policy(),
        maxRedirects: 5
      }),
    /Unrecognized key/
  );
});

function policy(
  overrides: Partial<{
    redirectPolicyVersion: string;
    automaticRedirectFollowEnabled: boolean;
    responsePerHopObservationRequired: boolean;
    effectiveRequestPerHopObservationRequired: boolean;
  }> = {}
) {
  return {
    redirectPolicyVersion: OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION,
    automaticRedirectFollowEnabled: false,
    responsePerHopObservationRequired: true,
    effectiveRequestPerHopObservationRequired: true,
    ...overrides
  };
}
