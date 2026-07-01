import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFxSnapshotFreshness,
  parseFxRateSnapshotFixture,
  parseFxRateSnapshotFixtures
} from "./fxSnapshotFreshness.js";

test("FX snapshot fixture parser accepts USD/KRW paper replay fixture", () => {
  const fixture = parseFxRateSnapshotFixture(baseFixture());

  assert.deepEqual(fixture, {
    fxId: "fx.usdkrw.2025-01-02",
    pair: "USD/KRW",
    sourceSymbol: "KRW=X",
    observedAt: "2025-01-02T00:00:00.000Z",
    rate: 1460.25,
    staleAfter: "2025-01-03T00:00:00.000Z",
    sourceRefs: ["yahoo_fx:KRW=X:2025-01-02"],
    createdAt: "2026-07-01T00:00:00.000Z"
  });
});

test("FX snapshot freshness classifies fresh fixtures without warning codes", () => {
  const fixture = parseFxRateSnapshotFixture(baseFixture());

  assert.deepEqual(
    classifyFxSnapshotFreshness({
      priceObservedAt: "2025-01-02T14:30:00.000Z",
      fixture
    }),
    {
      status: "fresh",
      fxId: "fx.usdkrw.2025-01-02",
      pair: "USD/KRW",
      sourceSymbol: "KRW=X",
      observedAt: "2025-01-02T00:00:00.000Z",
      staleAfter: "2025-01-03T00:00:00.000Z",
      warningCodes: []
    }
  );
});

test("FX snapshot freshness fails closed when fixture is missing", () => {
  assert.deepEqual(
    classifyFxSnapshotFreshness({
      priceObservedAt: "2025-01-02T14:30:00.000Z",
      pair: "USD/KRW"
    }),
    {
      status: "missing",
      fxId: null,
      pair: "USD/KRW",
      sourceSymbol: null,
      observedAt: null,
      staleAfter: null,
      warningCodes: ["VIRTUAL_FX_MISSING"]
    }
  );
});

test("FX snapshot freshness treats staleAfter boundary as stale", () => {
  const fixture = parseFxRateSnapshotFixture(baseFixture());

  assert.deepEqual(
    classifyFxSnapshotFreshness({
      priceObservedAt: "2025-01-03T00:00:00.000Z",
      fixture
    }),
    {
      status: "stale",
      fxId: "fx.usdkrw.2025-01-02",
      pair: "USD/KRW",
      sourceSymbol: "KRW=X",
      observedAt: "2025-01-02T00:00:00.000Z",
      staleAfter: "2025-01-03T00:00:00.000Z",
      warningCodes: ["VIRTUAL_FX_STALE"]
    }
  );
});

test("FX snapshot parser rejects malformed fixtures", () => {
  assert.throws(
    () => parseFxRateSnapshotFixture({ ...baseFixture(), pair: "EUR/KRW" }),
    /pair/
  );
  assert.throws(
    () => parseFxRateSnapshotFixture({ ...baseFixture(), rate: 0 }),
    /rate/
  );
  assert.throws(
    () =>
      parseFxRateSnapshotFixture({
        ...baseFixture(),
        observedAt: "2025-01-03T00:00:00.000Z",
        staleAfter: "2025-01-03T00:00:00.000Z"
      }),
    /observedAt/
  );
  assert.throws(
    () =>
      parseFxRateSnapshotFixture({
        ...baseFixture(),
        observedAt: "2025-01-02T00:00:00"
      }),
    /timezone offset/
  );
  assert.throws(
    () =>
      parseFxRateSnapshotFixture({
        ...baseFixture(),
        staleAfter: "2025-02-31T00:00:00.000Z"
      }),
    /valid calendar date/
  );
  assert.throws(
    () => parseFxRateSnapshotFixture({ ...baseFixture(), sourceRefs: [] }),
    /sourceRefs/
  );
  assert.throws(
    () =>
      classifyFxSnapshotFreshness({
        priceObservedAt: "2025-01-02T14:30:00"
      }),
    /timezone offset/
  );
  assert.throws(
    () =>
      classifyFxSnapshotFreshness({
        priceObservedAt: "2025-01-02T14:30:00.000Z",
        pair: "EUR/KRW" as "USD/KRW"
      }),
    /pair/
  );
});

test("FX snapshot fixture parser maps fixture arrays", () => {
  const fixtures = parseFxRateSnapshotFixtures([baseFixture()]);

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0]?.fxId, "fx.usdkrw.2025-01-02");
});

function baseFixture(): Record<string, unknown> {
  return {
    fxId: "fx.usdkrw.2025-01-02",
    pair: "USD/KRW",
    sourceSymbol: "KRW=X",
    observedAt: "2025-01-02T00:00:00.000Z",
    rate: 1460.25,
    staleAfter: "2025-01-03T00:00:00.000Z",
    sourceRefs: ["yahoo_fx:KRW=X:2025-01-02"],
    createdAt: "2026-07-01T00:00:00.000Z"
  };
}
