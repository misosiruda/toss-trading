import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { candidateExecutionCostInputSchema, parseCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";

/** Reference-notional estimate, deliberately distinct from paper fill/cost simulator versions. */
export const CANDIDATE_EXECUTION_COST_MODEL_VERSION = "candidate_reference_notional_cost.v1";
const inputSchema = candidateExecutionCostInputSchema.omit({ estimatedCostKrw: true }).extend({
  modelVersion: z.literal(CANDIDATE_EXECUTION_COST_MODEL_VERSION)
}).strict();
const resultSchema = z.object({ input: inputSchema, inputHash: z.string(),
  verificationScope: z.literal("reference_notional_cost_only"),
  rounding: z.literal("ceil_each_component_canonical_decimal_krw"),
  feeKrw: z.number(), taxKrw: z.number(), slippageKrw: z.number(), spreadCostKrw: z.number(),
  impactCostKrw: z.number(), estimatedCostKrw: z.number(), outputHash: z.string() }).strict();
const UNIT = canonicalQuantityUnits(1);

/** No inferred fill, source authentication, policy approval, or default execution parameters. */
export function calculateCandidateExecutionCost(value: unknown) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("candidate cost input must already be canonical");
  if (new Set(input.evidenceRefs).size !== input.evidenceRefs.length ||
    !isDeepStrictEqual(input.evidenceRefs, [...input.evidenceRefs].sort(compareText))) {
    throw new Error("candidate cost evidence refs must be unique and canonical");
  }
  // Validate even inactive SELL tax / zero-notional rates. Decimal units avoid binary underflow
  // and off-by-one ceilings; the stored JS number's shortest decimal spelling is authoritative.
  const fee = canonicalQuantityUnits(input.feeBps), tax = canonicalQuantityUnits(input.taxBps);
  const slippage = canonicalQuantityUnits(input.slippageBps), spread = canonicalQuantityUnits(input.halfSpreadBps);
  const impact = canonicalQuantityUnits(input.marketImpactBpsPerParticipationRate);
  const participation = canonicalQuantityUnits(input.participationRate);
  const notional = BigInt(input.referenceNotionalKrw);
  const feeKrw = ceiling(notional * fee, UNIT * 10_000n);
  const taxKrw = input.side === "SELL" ? ceiling(notional * tax, UNIT * 10_000n) : 0n;
  const slippageKrw = ceiling(notional * slippage, UNIT * 10_000n);
  const spreadCostKrw = ceiling(notional * spread, UNIT * 10_000n);
  const impactCostKrw = ceiling(notional * impact * participation, UNIT * UNIT * 10_000n);
  const payload = { input: freeze(input), inputHash: hashCanonicalPayload(input),
    verificationScope: "reference_notional_cost_only" as const,
    rounding: "ceil_each_component_canonical_decimal_krw" as const,
    feeKrw: safeAmount(feeKrw), taxKrw: safeAmount(taxKrw), slippageKrw: safeAmount(slippageKrw),
    spreadCostKrw: safeAmount(spreadCostKrw), impactCostKrw: safeAmount(impactCostKrw),
    estimatedCostKrw: safeAmount(feeKrw + taxKrw + slippageKrw + spreadCostKrw + impactCostKrw) };
  return Object.freeze({ ...payload, outputHash: hashCanonicalPayload(payload) });
}

/** Hash checking alone is insufficient: independently recalculate the complete output. */
export function parseCandidateExecutionCost(value: unknown) {
  const record = resultSchema.parse(value);
  const expected = calculateCandidateExecutionCost(record.input);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate cost complete payload or calculation replay mismatch");
  return expected;
}

/** Verifies a declaration's arithmetic, not its actual policy/source selection or final sizing. */
export function replayCandidateSizingExecutionCost(value: unknown) {
  const sizingInput = parseCandidateSizingInputRecord(value);
  const { estimatedCostKrw, ...parameters } = sizingInput.executionCostInput;
  const calculation = calculateCandidateExecutionCost(parameters);
  if (estimatedCostKrw !== calculation.estimatedCostKrw) throw new Error("candidate estimated cost does not match independent replay");
  return Object.freeze({ sizingInput, calculation });
}

function ceiling(numerator: bigint, denominator: bigint) { return (numerator + denominator - 1n) / denominator; }
function safeAmount(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("candidate execution cost exceeds safe KRW range");
  return Number(value);
}
function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
