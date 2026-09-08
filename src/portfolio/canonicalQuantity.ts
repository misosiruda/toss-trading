// 324 decimal places cover the shortest decimal form of every finite JS number,
// including Number.MIN_VALUE. This is representation, not a broker lot-size rule.
const SCALE = 324;

/** Exact units of the stored number's canonical decimal spelling; no epsilon. */
export function canonicalQuantityUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) {
    throw new Error("quantity must be finite, nonnegative and within the safe range");
  }
  const [mantissa, exponentText] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  const exponent = SCALE + Number(exponentText ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || exponent < 0) throw new Error("quantity decimal scale is not representable");
  return BigInt(`${whole}${fraction}`) * (10n ** BigInt(exponent));
}

/** Returns only an exactly representable canonical decimal sum. Never rounds a cap. */
export function addCanonicalQuantities(left: number, right: number): number {
  const units = canonicalQuantityUnits(left) + canonicalQuantityUnits(right);
  return quantityFromUnits(units);
}

/** Exact remaining quantity; never increases a target through binary rounding. */
export function subtractCanonicalQuantities(target: number, filled: number): number {
  const units = canonicalQuantityUnits(target) - canonicalQuantityUnits(filled);
  if (units < 0n) throw new Error("filled quantity exceeds target");
  return quantityFromUnits(units);
}

function quantityFromUnits(units: bigint): number {
  const digits = units.toString().padStart(SCALE + 1, "0");
  const result = Number(`${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`);
  if (canonicalQuantityUnits(result) !== units) throw new Error("canonical quantity result is not exactly representable");
  return result;
}
