import { z } from "zod";
import { historicalMarketSnapshotSchema } from "../domain/schemas.js";

const identifier = z.string().min(1).max(160).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const bound = z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0));

/** Explicit policy parameters, no default thresholds or executable user expressions. */
export const candidateHardGateRuleSchema = z.discriminatedUnion("algorithm", [
  z.object({ ruleId: identifier, algorithm: z.literal("numeric_feature_range.v1"), featureDefinitionRef: identifier,
    minimum: bound.optional(), maximum: bound.optional() }).strict()
    .refine((rule) => rule.minimum !== undefined || rule.maximum !== undefined, "hard gate requires a bound")
    .refine((rule) => rule.minimum === undefined || rule.maximum === undefined || rule.minimum <= rule.maximum,
      "hard gate bounds must not be reversed"),
  z.object({ ruleId: identifier, algorithm: z.literal("market_interval.v1"),
    allowedIntervals: z.array(historicalMarketSnapshotSchema.shape.interval).min(1).max(5) }).strict()
]);
export type CandidateHardGateRule = z.infer<typeof candidateHardGateRuleSchema>;
