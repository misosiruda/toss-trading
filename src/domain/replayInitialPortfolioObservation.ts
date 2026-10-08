import { z } from "zod";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { maskObject } from "../security/masking.js";
import { containsReplaySourceCredential } from "../security/replaySourceText.js";

const text = (max: number) => z.string().min(1).max(max);
const time = text(80).refine(value => Number.isFinite(Date.parse(value)));
const money = z.number().int().nonnegative();
// Frozen v1: preserve presence and all fields consumed by the current portfolio contract.
export const replayInitialPortfolioSnapshotSchema = z.object({
  portfolioId: text(120), cashKrw: money, updatedAt: time,
  positions: z.array(z.object({
    market: z.enum(["KR", "US"]), symbol: text(120),
    assetType: z.enum(["STOCK", "ETF"]).optional(),
    assetClass: z.enum(["equity", "bond", "cash_like", "commodity", "currency", "inverse", "leveraged"]).optional(),
    region: z.enum(["KR", "US", "GLOBAL"]).optional(),
    riskTags: z.array(z.enum(["inverse", "leveraged", "currency_exposed", "sector_concentrated"])).max(32).optional(),
    strategyBucket: z.enum(["long_term", "swing", "short_term", "intraday", "hedge"]).optional(),
    sector: text(120).optional(), quantity: z.number().nonnegative(), averagePriceKrw: money,
    marketPriceKrw: money.optional(), marketValueKrw: money.optional(), unrealizedPnlKrw: z.number().optional(),
    priceUpdatedAt: time.optional(), priceStaleAfter: time.optional(),
    priceSourceRefs: z.array(text(512)).max(128).optional(), isPriceStale: z.boolean().optional(), updatedAt: time
  }).strict()).max(512)
}).strict();
// Stored identity is not a path input. Batch producers preserve opaque text separately from directory names.
const childId = text(256).regex(/^[A-Za-z0-9_.-]+(?![\s\S])/).refine(value => value !== "." && value !== "..");
const batchId = text(4096).refine(value => value === value.trim());
export const replayInitialPortfolioIdentitySchema = z.object({
  runId: childId, batchId, runIndex: z.number().int().nonnegative()
}).strict();
const origin = z.enum(["stored_portfolio", "generated"]);
export const replayInitialPortfolioReservationSchema = z.object({
  schemaVersion: z.literal("replay_initial_portfolio_reservation.v1"), identity: replayInitialPortfolioIdentitySchema,
  startedAt: z.iso.datetime(), origin
}).strict();
const initialPortfolio = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), origin,
    snapshotVersion: z.literal("replay_initial_portfolio_snapshot.v1"),
    snapshot: replayInitialPortfolioSnapshotSchema, contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  z.object({ status: z.literal("unavailable"), origin,
    reason: z.enum(["unsupported_shape", "redacted", "limit"]) }).strict()
]);
export const replayInitialPortfolioObservationSchema = z.object({
  schemaVersion: z.literal("replay_initial_portfolio_observation.v1"), mode: z.literal("paper_only"),
  phase: z.literal("runner_initial_state"), identity: replayInitialPortfolioIdentitySchema, startedAt: z.iso.datetime(),
  reservationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  initialPortfolio,
  admission: z.literal("unavailable"), source: z.literal("unavailable"), configuration: z.literal("unavailable"),
  runtime: z.literal("unavailable"), dependencies: z.literal("unavailable"), result: z.literal("unavailable"),
  completeInput: z.literal(false), comparability: z.literal("unavailable")
}).strict();
export type ReplayInitialPortfolioIdentity = z.infer<typeof replayInitialPortfolioIdentitySchema>;
export type ReplayInitialPortfolioOrigin = z.infer<typeof origin>;
export function observeReplayInitialPortfolio(value: unknown, origin: ReplayInitialPortfolioOrigin): z.infer<typeof initialPortfolio> {
  const parsed = replayInitialPortfolioSnapshotSchema.safeParse(value);
  if (!parsed.success) return { status: "unavailable", origin, reason: "unsupported_shape" };
  const snapshot = parsed.data;
  if (containsCredentialText(snapshot) || createReplayResearchHash(maskObject(snapshot)) !== createReplayResearchHash(snapshot)) {
    return { status: "unavailable", origin, reason: "redacted" };
  }
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 262_144) return { status: "unavailable", origin, reason: "limit" };
  return { status: "recorded", origin, snapshotVersion: "replay_initial_portfolio_snapshot.v1", snapshot,
    contentHash: createReplayResearchHash({ schemaVersion: "replay_initial_portfolio_snapshot.v1", snapshot }) };
}

// This is already a bounded, parsed portfolio; source refs can also reach the earlier initial observation.
function containsCredentialText(value: unknown): boolean {
  if (typeof value === "string") return containsReplaySourceCredential(value);
  if (Array.isArray(value)) return value.some(containsCredentialText);
  if (value !== null && typeof value === "object") return Object.values(value).some(containsCredentialText);
  return false;
}
