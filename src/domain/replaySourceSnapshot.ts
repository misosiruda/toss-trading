import { types } from "node:util";
import { z } from "zod";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { maskSensitiveText } from "../security/masking.js";

export const REPLAY_SOURCE_SNAPSHOT_VERSION = "replay_source_snapshot.v1";
export const REPLAY_SOURCE_SNAPSHOT_LIMITS = Object.freeze({
  records: 50_000, jsonBytes: 16_777_216, textUnits: 120, timeUnits: 80,
  sourceRefs: 128, sourceRefUnits: 512, riskTags: 32
});
const limits = REPLAY_SOURCE_SNAPSHOT_LIMITS;
const text = (max: number) => z.string().min(1).max(max);
const time = text(limits.timeUnits).refine(value => Number.isFinite(Date.parse(value)));
const money = z.number().int().nonnegative();
// Frozen v1 fields: do not inherit future changes, defaults, trimming, or coercion.
const recordSchema = z.object({
  snapshotId: text(limits.textUnits), market: z.enum(["KR", "US"]), symbol: text(limits.textUnits),
  name: text(limits.textUnits).optional(), assetType: z.enum(["STOCK", "ETF"]).optional(),
  assetClass: z.enum(["equity", "bond", "cash_like", "commodity", "currency", "inverse", "leveraged"]).optional(),
  region: z.enum(["KR", "US", "GLOBAL"]).optional(),
  riskTags: z.array(z.enum(["inverse", "leveraged", "currency_exposed", "sector_concentrated"])).max(limits.riskTags).optional(),
  strategyBucket: z.enum(["long_term", "swing", "short_term", "intraday", "hedge"]).optional(),
  sector: text(limits.textUnits).optional(), observedAt: time, interval: z.enum(["1m", "5m", "15m", "1h", "1d"]),
  openPriceKrw: money.optional(), highPriceKrw: money.optional(), lowPriceKrw: money.optional(),
  closePriceKrw: money.optional(), lastPriceKrw: money, volume: z.number().nonnegative().optional(),
  sourceRefs: z.array(text(limits.sourceRefUnits)).min(1).max(limits.sourceRefs), createdAt: time
}).strict().refine(value => value.highPriceKrw === undefined || value.lowPriceKrw === undefined ||
  value.highPriceKrw >= value.lowPriceKrw, { path: ["highPriceKrw"], message: "Invalid source price range" });
const snapshotDataSchema = z.array(recordSchema).max(limits.records);
type Snapshot = z.infer<typeof snapshotDataSchema>;
type PreflightReason = "unsupported_shape" | "redacted" | "limit";

// This gate runs before Zod clones the array; error messages never repeat input values.
export const replaySourceSnapshotSchema = z.unknown().superRefine((value, context) => {
  const reason = preflight(value);
  if (reason) context.addIssue({ code: "custom", message: `Source snapshot unavailable: ${reason}` });
}).pipe(snapshotDataSchema).transform(freezeSnapshot);
const observationDataSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), snapshotVersion: z.literal(REPLAY_SOURCE_SNAPSHOT_VERSION),
    snapshot: replaySourceSnapshotSchema, contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  z.object({ status: z.literal("unavailable"),
    reason: z.enum(["unsupported_shape", "redacted", "limit", "retention_unavailable"]) }).strict()
]);
export const replaySourceSnapshotObservationSchema = z.unknown().superRefine((value, context) => {
  if (!plainObservation(value)) context.addIssue({ code: "custom", message: "Unsupported source observation shape" });
}).pipe(observationDataSchema);
export type ReplaySourceSnapshotObservation = z.infer<typeof replaySourceSnapshotObservationSchema>;

export function prepareReplaySourceSnapshot(value: unknown): ReplaySourceSnapshotObservation {
  const reason = preflight(value);
  if (reason) return { status: "unavailable", reason };
  const parsed = snapshotDataSchema.safeParse(value);
  if (!parsed.success) return { status: "unavailable", reason: "unsupported_shape" };
  const snapshot = freezeSnapshot(parsed.data);
  return { status: "recorded", snapshotVersion: REPLAY_SOURCE_SNAPSHOT_VERSION, snapshot,
    contentHash: createReplayResearchHash({ schemaVersion: REPLAY_SOURCE_SNAPSHOT_VERSION, snapshot }) };
}

function freezeSnapshot(snapshot: Snapshot): Snapshot {
  for (const record of snapshot) {
    Object.freeze(record.sourceRefs);
    if (record.riskTags) Object.freeze(record.riskTags);
    Object.freeze(record);
  }
  Object.freeze(snapshot);
  return snapshot;
}

function plainObservation(value: unknown): boolean {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 4) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === "string" && descriptor.enumerable && Object.hasOwn(descriptor, "value");
  });
}

const stringFields = new Set(["snapshotId", "market", "symbol", "name", "assetType", "assetClass", "region",
  "strategyBucket", "sector", "observedAt", "interval", "createdAt"]);
const numberFields = new Set(["openPriceKrw", "highPriceKrw", "lowPriceKrw", "closePriceKrw", "lastPriceKrw", "volume"]);
const timeFields = new Set(["observedAt", "createdAt"]);
const requiredFields = ["snapshotId", "market", "symbol", "observedAt", "interval", "lastPriceKrw", "sourceRefs", "createdAt"];

function preflight(value: unknown): PreflightReason | undefined {
  const arrayReason = plainArray(value, limits.records);
  if (arrayReason) return arrayReason;
  const records = value as unknown[];
  let bytes = 2; // Raw array brackets, with one comma between records.
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const reason = recordFields(record);
    if (reason) return reason;
    // Only a bounded, getter-free record reaches serialization. Never serialize the whole input here.
    bytes += Buffer.byteLength(JSON.stringify(record), "utf8") + (index === 0 ? 0 : 1);
    if (bytes > limits.jsonBytes) return "limit";
  }
  return undefined;
}

function recordFields(value: unknown): PreflightReason | undefined {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return "unsupported_shape";
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return "unsupported_shape";
  const keys = Reflect.ownKeys(value);
  if (keys.length > 20) return "unsupported_shape";
  for (const key of keys) {
    if (typeof key !== "string") return "unsupported_shape";
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return "unsupported_shape";
    const field: unknown = descriptor.value;
    let reason: PreflightReason | undefined;
    if (stringFields.has(key)) reason = stringValue(field, timeFields.has(key) ? limits.timeUnits : limits.textUnits);
    else if (numberFields.has(key)) {
      if (typeof field !== "number" || !Number.isFinite(field) || Object.is(field, -0)) return "unsupported_shape";
    } else if (key === "sourceRefs" || key === "riskTags") {
      reason = plainArray(field, key === "sourceRefs" ? limits.sourceRefs : limits.riskTags);
      if (!reason) {
        for (const item of field as unknown[]) {
          reason = stringValue(item, key === "sourceRefs" ? limits.sourceRefUnits : limits.textUnits);
          if (reason) break;
        }
      }
    } else return "unsupported_shape";
    if (reason) return reason;
  }
  for (const key of requiredFields) if (!Object.hasOwn(value, key)) return "unsupported_shape";
  return undefined;
}

function plainArray(value: unknown, maxLength: number): PreflightReason | undefined {
  // Proxies (including revoked proxies) can trap even descriptor/prototype inspection.
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value)) return "unsupported_shape";
  const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
  if (length > maxLength) return "limit";
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== length + 1) return "unsupported_shape";
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return "unsupported_shape";
  }
  return undefined;
}

function stringValue(value: unknown, maxLength: number): PreflightReason | undefined {
  if (typeof value !== "string") return "unsupported_shape";
  if (value.length > maxLength) return "limit";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "unsupported_shape";
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return "unsupported_shape";
  }
  // Source names/IDs do not confer trust or a replay-ID masking exemption.
  return maskSensitiveText(value) === value ? undefined : "redacted";
}
