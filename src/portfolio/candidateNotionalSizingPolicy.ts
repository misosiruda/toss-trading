import { z } from "zod";

export const CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION = "candidate_gap_score_notional.v1";
const multiplier = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0));
/** Explicit parameters only. This initial notional model does not define final cost/benefit or weight bands. */
export const candidateNotionalSizingPolicySchema = z.object({
  modelVersion: z.string().min(1).max(80).refine((value) => value.trim() === value &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)),
  minimumScoreMultiplier: multiplier,
  maximumScoreMultiplier: multiplier.refine((value) => value > 0),
  minimumOrderNotionalKrw: z.number().int().positive().safe()
}).strict().refine((value) => value.minimumScoreMultiplier <= value.maximumScoreMultiplier, "score multiplier bounds are reversed");
export type CandidateNotionalSizingPolicy = z.infer<typeof candidateNotionalSizingPolicySchema>;
