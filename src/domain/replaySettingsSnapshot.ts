import { z } from "zod";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { REPLAY_SETTINGS_SNAPSHOT_VERSION, replaySettingsSnapshotDataSchema, type ReplaySettingsSnapshot } from "./replaySettingsSnapshotFields.js";
import { cloneReplaySettingsProjection, freezeReplaySettingsSnapshot, plainSettingsObject, preflightReplaySettingsSnapshot } from "./replaySettingsSnapshotPreflight.js";

export { REPLAY_SETTINGS_SNAPSHOT_VERSION, REPLAY_SETTINGS_SNAPSHOT_LIMITS, type ReplaySettingsSnapshot } from "./replaySettingsSnapshotFields.js";
export { REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS } from "./replaySettingsCredentialInspection.js";
export type { ReplaySettingsSnapshotUnavailableReason } from "./replaySettingsSnapshotPreflight.js";

// Gate first: Zod must never inspect a proxy/getter or allocate a large clone before bounded preflight.
export const replaySettingsSnapshotSchema = z.unknown().superRefine((value, context) => {
  const reason = preflightReplaySettingsSnapshot(value, false);
  if (reason) context.addIssue({ code: "custom", message: `Settings snapshot unavailable: ${reason}` });
}).pipe(replaySettingsSnapshotDataSchema).transform(value => freezeReplaySettingsSnapshot(value) as ReplaySettingsSnapshot);
const observationDataSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), snapshotVersion: z.literal(REPLAY_SETTINGS_SNAPSHOT_VERSION),
    snapshot: replaySettingsSnapshotSchema, contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["unsupported_shape", "redacted", "limit", "inspection_unavailable"]) }).strict()
]);
export const replaySettingsSnapshotObservationSchema = z.unknown().superRefine((value, context) => {
  if (!plainObservation(value)) context.addIssue({ code: "custom", message: "Unsupported settings observation shape" });
}).pipe(observationDataSchema).transform(value => Object.freeze(value));
export type ReplaySettingsSnapshotObservation = z.infer<typeof replaySettingsSnapshotObservationSchema>;

export function prepareReplaySettingsSnapshot(options: unknown): ReplaySettingsSnapshotObservation {
  const reason = preflightReplaySettingsSnapshot(options, true);
  if (reason) return Object.freeze({ status: "unavailable", reason });
  const snapshot = freezeReplaySettingsSnapshot(cloneReplaySettingsProjection(options));
  return Object.freeze({ status: "recorded", snapshotVersion: REPLAY_SETTINGS_SNAPSHOT_VERSION, snapshot,
    contentHash: createReplayResearchHash({ schemaVersion: REPLAY_SETTINGS_SNAPSHOT_VERSION, snapshot }) });
}
function plainObservation(value: unknown): boolean {
  if (!plainSettingsObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 4) return false;
  for (const key of keys) {
    if (typeof key !== "string" || !["status", "snapshotVersion", "snapshot", "contentHash", "reason"].includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || (key !== "snapshot" && typeof descriptor.value !== "string")) return false;
  }
  return true;
}
