import assert from "node:assert/strict";
import test from "node:test";

import { resolveOfficialMarketCalendarResponseFreshness } from "./officialMarketCalendarResponseFreshness.js";

test("calendar response freshness uses apparent age when it is larger", () => {
  const resolved = resolveOfficialMarketCalendarResponseFreshness(
    freshness({
      retrievedAt: "2025-07-01T12:00:10.000Z",
      responseDate: "2025-07-01T12:00:00Z",
      responseAgeSeconds: 5,
      effectiveResponseAt: "2025-07-01T12:00:00.000Z"
    })
  );

  assert.equal(resolved.apparentAgeSeconds, 10);
  assert.equal(resolved.effectiveCacheAgeSeconds, 10);
});

test("calendar response freshness uses header age when it is larger", () => {
  const resolved = resolveOfficialMarketCalendarResponseFreshness(
    freshness({
      responseAgeSeconds: 30,
      effectiveResponseAt: "2025-07-01T11:59:40.000Z"
    })
  );

  assert.equal(resolved.apparentAgeSeconds, 10);
  assert.equal(resolved.effectiveCacheAgeSeconds, 30);
});

test("calendar response freshness treats absent Age as zero", () => {
  const resolved = resolveOfficialMarketCalendarResponseFreshness(
    freshness({
      responseAgeSeconds: null,
      effectiveResponseAt: "2025-07-01T12:00:00.000Z"
    })
  );

  assert.equal(resolved.effectiveCacheAgeSeconds, 10);
});

test("calendar response freshness accepts an existing leap date with offset", () => {
  const resolved = resolveOfficialMarketCalendarResponseFreshness(
    freshness({
      retrievedAt: "2024-02-29T21:00:10.000+09:00",
      responseDate: "2024-02-29T21:00:00+09:00",
      effectiveResponseAt: "2024-02-29T12:00:00.000Z"
    })
  );

  assert.equal(resolved.apparentAgeSeconds, 10);
  assert.equal(resolved.effectiveCacheAgeSeconds, 10);
});

test("calendar response freshness rejects a future response Date", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarResponseFreshness(
        freshness({
          responseDate: "2025-07-01T12:00:11Z",
          effectiveResponseAt: "2025-07-01T12:00:10.000Z"
        })
      ),
    /Date must not follow retrieval time/
  );
});

test("calendar response freshness rejects a derived time mismatch", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarResponseFreshness(
        freshness({ effectiveResponseAt: "2025-07-01T12:00:01.000Z" })
      ),
    /does not match cache age/
  );
});

test("calendar response freshness rejects invalid timestamps and Age", () => {
  for (const invalid of [
    freshness({ retrievedAt: "2025-07-01T12:00:10" }),
    freshness({ retrievedAt: "2025-07-01T12:00:10.000999Z" }),
    freshness({ retrievedAt: "2025-02-30T12:00:10.000Z" }),
    freshness({ retrievedAt: "2025-02-29T12:00:10.000-05:00" }),
    freshness({ responseDate: "2025-07-01T12:00:00.500Z" }),
    freshness({ responseDate: "2025-07-01T12:00:00.000999Z" }),
    freshness({ responseDate: "2025-02-30T12:00:00Z" }),
    freshness({ effectiveResponseAt: "2025-07-01T12:00:00.000999Z" }),
    freshness({ effectiveResponseAt: "2025-07-01T21:00:00.000+09:00" }),
    freshness({ responseAgeSeconds: -1 }),
    freshness({ responseAgeSeconds: 1.5 }),
    freshness({ responseAgeSeconds: Number.MAX_SAFE_INTEGER + 1 }),
    freshness({
      responseAgeSeconds: Number.MAX_SAFE_INTEGER,
      effectiveResponseAt: "1970-01-01T00:00:00.000Z"
    })
  ]) {
    assert.throws(() => resolveOfficialMarketCalendarResponseFreshness(invalid));
  }
});

test("calendar response freshness rejects unknown fields", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarResponseFreshness({
        ...freshness(),
        downloadCompletedAt: "2025-07-01T12:00:10.000Z"
      }),
    /Unrecognized key/
  );
});

function freshness(
  overrides: Partial<{
    retrievedAt: string;
    responseDate: string;
    responseAgeSeconds: number | null;
    effectiveResponseAt: string;
  }> = {}
) {
  return {
    retrievedAt: "2025-07-01T12:00:10.000Z",
    responseDate: "2025-07-01T12:00:00Z",
    responseAgeSeconds: 5,
    effectiveResponseAt: "2025-07-01T12:00:00.000Z",
    ...overrides
  };
}
