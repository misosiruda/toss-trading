import assert from "node:assert/strict";
import test from "node:test";

import {
  isStrategyBucket,
  normalizeStrategyBucket,
  STRATEGY_BUCKETS,
  UNKNOWN_STRATEGY_BUCKET
} from "./strategyBucketPolicy.js";

test("strategy bucket policy exposes stable paper-only bucket keys", () => {
  assert.deepEqual(STRATEGY_BUCKETS, [
    "long_term",
    "swing",
    "short_term",
    "intraday",
    "hedge"
  ]);
  assert.equal(UNKNOWN_STRATEGY_BUCKET, "unknown");
});

test("strategy bucket policy normalizes known buckets only", () => {
  assert.equal(isStrategyBucket("swing"), true);
  assert.equal(normalizeStrategyBucket("intraday"), "intraday");
  assert.equal(isStrategyBucket("day_trade"), false);
  assert.equal(normalizeStrategyBucket("day_trade"), null);
});
