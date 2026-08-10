import { z } from "zod";

export type OfficialMarketCalendarCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | OfficialMarketCalendarCanonicalJsonValue[]
  | { [key: string]: OfficialMarketCalendarCanonicalJsonValue };

export const officialMarketCalendarCanonicalJsonValueSchema: z.ZodType<OfficialMarketCalendarCanonicalJsonValue> =
  z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number(),
      z.string(),
      z.array(officialMarketCalendarCanonicalJsonValueSchema),
      z.record(
        z.string(),
        officialMarketCalendarCanonicalJsonValueSchema
      )
    ])
  );

export const officialMarketCalendarCanonicalJsonObjectSchema = z.record(
  z.string(),
  officialMarketCalendarCanonicalJsonValueSchema
);

export function verifyOfficialMarketCalendarCanonicalJsonObject(
  value: { [key: string]: OfficialMarketCalendarCanonicalJsonValue },
  path: string
): void {
  const keys = Object.keys(value);
  if (keys.some(containsLoneSurrogate)) {
    throw new Error(
      `official calendar canonical metadata keys must be valid Unicode at ${path}`
    );
  }
  if (keys.some(isArrayIndexKey)) {
    throw new Error(
      `official calendar canonical metadata keys must not use array-index grammar at ${path}`
    );
  }
  const canonicalKeys = [...keys].sort(compareUtf8Text);
  if (keys.some((key, index) => key !== canonicalKeys[index])) {
    throw new Error(
      `official calendar canonical metadata must use canonical key order at ${path}`
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    verifyNestedCanonicalObjects(entry, `${path}.${key}`);
  }
}

function verifyNestedCanonicalObjects(
  value: OfficialMarketCalendarCanonicalJsonValue,
  path: string
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      verifyNestedCanonicalObjects(entry, `${path}[${index}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    verifyOfficialMarketCalendarCanonicalJsonObject(value, path);
  }
}

function compareUtf8Text(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isArrayIndexKey(value: string): boolean {
  const index = Number(value);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < 4_294_967_295 &&
    String(index) === value
  );
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode >= 0xd800 && charCode <= 0xdbff) {
      const nextCharCode = value.charCodeAt(index + 1);
      if (nextCharCode >= 0xdc00 && nextCharCode <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (charCode >= 0xdc00 && charCode <= 0xdfff) {
      return true;
    }
  }
  return false;
}
