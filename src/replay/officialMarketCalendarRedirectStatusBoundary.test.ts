import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRedirectStatusBoundary } from "./officialMarketCalendarRedirectStatusBoundary.js";

test("calendar redirect status boundary accepts 301, 302, and 303", () => {
  const boundary = { responseStatuses: [301, 302, 303] };

  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectStatusBoundary(boundary),
    boundary
  );
});

test("calendar redirect status boundary rejects unsupported statuses", () => {
  for (const responseStatus of [200, 300, 304, 305, 307, 308, 400]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRedirectStatusBoundary({
        responseStatuses: [responseStatus]
      })
    );
  }
});

test("calendar redirect status boundary rejects empty and unknown fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectStatusBoundary({
      responseStatuses: []
    })
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectStatusBoundary({
        responseStatuses: [302],
        finalStatus: 200
      }),
    /Unrecognized key/
  );
});
