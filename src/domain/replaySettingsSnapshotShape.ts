import { z } from "zod";

export type SettingsShape =
  | { kind: "number"; optional?: boolean }
  | { kind: "boolean"; optional?: boolean }
  | { kind: "string"; maxUnits: number; values?: readonly string[]; optional?: boolean }
  | { kind: "array"; item: SettingsShape; maxLength: number; optional?: boolean }
  | { kind: "object"; fields: ReadonlyMap<string, SettingsShape>; excluded: ReadonlySet<string>; optional?: boolean };

const shapes = new WeakMap<z.ZodType, SettingsShape>();
function register<T extends z.ZodType>(schema: T, shape: SettingsShape): T {
  shapes.set(schema, shape);
  return schema;
}
export function settingsShape(schema: z.ZodType): SettingsShape {
  const shape = shapes.get(schema);
  if (!shape) throw new Error("Missing frozen settings shape");
  return shape;
}

// Each frozen field has one definition shared by the pre-clone gate and typed Zod parser.
export const settingsNumber = register(z.number().refine(value => Number.isFinite(value) && !Object.is(value, -0)), { kind: "number" });
export const settingsBoolean = register(z.boolean(), { kind: "boolean" });
export function settingsString(maxUnits: number) {
  return register(z.string().max(maxUnits), { kind: "string", maxUnits });
}
export function settingsEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return register(z.enum(values), { kind: "string", maxUnits: 120, values });
}
export function optionalSettings<T extends z.ZodType>(schema: T) {
  return register(schema.optional(), { ...settingsShape(schema), optional: true });
}
export function settingsArray<T extends z.ZodType>(schema: T, maxLength: number) {
  return register(z.array(schema).max(maxLength), { kind: "array", item: settingsShape(schema), maxLength });
}
export function settingsObject<T extends Record<string, z.ZodType>>(fields: T, excluded: readonly string[] = []) {
  return register(z.object(fields).strict(), {
    kind: "object", fields: new Map(Object.entries(fields).map(([key, schema]) => [key, settingsShape(schema)])),
    excluded: new Set(excluded)
  });
}
