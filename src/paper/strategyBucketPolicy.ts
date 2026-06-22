import {
  strategyBucketSchema,
  type StrategyBucket
} from "../domain/schemas.js";

export const STRATEGY_BUCKETS: readonly StrategyBucket[] =
  strategyBucketSchema.options;
export const UNKNOWN_STRATEGY_BUCKET = "unknown";

export type StrategyBucketKey =
  | StrategyBucket
  | typeof UNKNOWN_STRATEGY_BUCKET;

export function isStrategyBucket(value: unknown): value is StrategyBucket {
  return strategyBucketSchema.safeParse(value).success;
}

export function normalizeStrategyBucket(
  value: unknown
): StrategyBucket | null {
  const parsed = strategyBucketSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
