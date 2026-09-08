import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { bucketTurnoverStateSchema, createInitialBucketTurnoverState, parseBucketTurnoverState } from "./bucketTurnover.js";
import { type PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { getDurablePortfolioSizingSnapshotObservation, portfolioSizingSnapshotObservationSchema,
  resolveObservedPortfolioSizingSnapshotHistory, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(160).refine((value) => value === value.trim());
const requestSchema = z.object({
  portfolioId: identifier, bucket: strategyBucketSchema, policyHash: sha256HashSchema,
  asOf: offsetQualifiedIsoDateTimeSchema,
  durationSeconds: z.number().int().positive().safe()
}).strict();
export const bucketTurnoverSnapshotOriginSchema = z.object({
  schemaVersion: z.literal("bucket_turnover_snapshot_origin.v1"), initialState: bucketTurnoverStateSchema,
  portfolioSnapshotId: identifier, portfolioSnapshotHash: sha256HashSchema, exposureSnapshotHash: sha256HashSchema,
  observation: portfolioSizingSnapshotObservationSchema
}).strict();
export type BucketTurnoverSnapshotOrigin = Readonly<z.infer<typeof bucketTurnoverSnapshotOriginSchema>>;

/**
 * Selects the denominator only from a currently held, repository-issued source lease.
 * Policy/duration are not authenticated here; the window owner must bind their activation separately.
 */
export function createBucketTurnoverSnapshotOrigin(
  history: VerifiedPortfolioSizingSnapshotHistory, value: z.input<typeof requestSchema>
): BucketTurnoverSnapshotOrigin {
  const input = requestSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("turnover snapshot request must already be canonical");
  const observation = getDurablePortfolioSizingSnapshotObservation(history);
  if (Date.parse(input.asOf) > Date.parse(observation.observedAt)) throw new Error("turnover snapshot request is after source observation");
  const window = createInitialBucketTurnoverState({ ...input, windowOpenPortfolioNetWorthKrw: 1 });
  const snapshot = selectWindowOpeningSnapshot(history.snapshots, window.portfolioId, window.windowStartedAt);
  const initialState = createInitialBucketTurnoverState({ ...input,
    windowOpenPortfolioNetWorthKrw: snapshot.exposureSnapshot.virtualNetWorthKrw });
  return deepFreeze({ schemaVersion: "bucket_turnover_snapshot_origin.v1" as const, initialState,
    portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    exposureSnapshotHash: snapshot.exposureSnapshotHash, observation });
}

/**
 * Revalidates the original observed prefix after restart or later append. This proves content,
 * not issuance of an arbitrary receipt, unique persisted window ownership, or current Risk authority.
 * A window repository must store this entire origin in its independently hashed append record.
 */
export function resolveBucketTurnoverSnapshotOrigin(
  history: VerifiedPortfolioSizingSnapshotHistory, value: unknown
): BucketTurnoverSnapshotOrigin {
  const origin = bucketTurnoverSnapshotOriginSchema.parse(value);
  if (!isDeepStrictEqual(origin, value)) throw new Error("turnover snapshot origin must already be canonical");
  const initialState = parseBucketTurnoverState(origin.initialState);
  if (initialState.cumulativeAbsoluteFilledNotionalKrw !== 0 || initialState.lastTurnoverEventId !== undefined ||
    initialState.asOf !== initialState.windowStartedAt) throw new Error("turnover snapshot origin requires an empty window root");
  if (Date.parse(origin.observation.observedAt) < Date.parse(initialState.windowStartedAt)) {
    throw new Error("turnover snapshot window starts after its source observation");
  }
  const prefix = resolveObservedPortfolioSizingSnapshotHistory(history, origin.observation);
  const snapshot = selectWindowOpeningSnapshot(prefix, initialState.portfolioId, initialState.windowStartedAt);
  if (snapshot.portfolioSnapshotId !== origin.portfolioSnapshotId || snapshot.portfolioSnapshotHash !== origin.portfolioSnapshotHash ||
    snapshot.exposureSnapshotHash !== origin.exposureSnapshotHash ||
    snapshot.exposureSnapshot.virtualNetWorthKrw !== initialState.windowOpenPortfolioNetWorthKrw) {
    throw new Error("turnover window denominator or snapshot identity differs from source");
  }
  return deepFreeze({ ...origin, initialState });
}

function selectWindowOpeningSnapshot(snapshots: readonly PortfolioSizingSnapshot[], portfolioId: string, windowStartedAt: string): PortfolioSizingSnapshot {
  const boundary = Date.parse(windowStartedAt);
  let latest = -Infinity;
  let matches: PortfolioSizingSnapshot[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.portfolioId !== portfolioId) continue;
    const asOf = Date.parse(snapshot.asOf);
    if (asOf >= boundary || asOf < latest) continue;
    if (asOf > latest) { latest = asOf; matches = []; }
    matches.push(snapshot);
  }
  if (matches.length !== 1) throw new Error("turnover window opening snapshot is missing or ambiguous");
  const snapshot = resolvePortfolioSizingSnapshot(matches[0]).snapshot;
  if (snapshot.exposureSnapshot.virtualNetWorthKrw <= 0) throw new Error("turnover window opening snapshot net worth must be positive");
  return snapshot;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
