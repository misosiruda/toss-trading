import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const payloadSchema = z.object({ schemaVersion: z.literal("bucket_turnover_completion.v1"),
  sourceKind: z.enum(["window", "event"]), commitHash: sha256HashSchema, completedAt: offsetQualifiedIsoDateTimeSchema }).strict();
const schema = payloadSchema.extend({ completionHash: sha256HashSchema }).strict();
export type BucketTurnoverCompletion = Readonly<z.infer<typeof schema>>;

/** Pure receipt encoding; only the repository writer may attest actual post-pair-sync and post-barrier-removal completion. */
export function createBucketTurnoverCompletion(value: Omit<z.input<typeof payloadSchema>, "schemaVersion">): BucketTurnoverCompletion {
  const payload = payloadSchema.parse({ ...value, schemaVersion: "bucket_turnover_completion.v1" });
  if (new Date(payload.completedAt).toISOString() !== payload.completedAt) throw new Error("turnover completion time must be canonical");
  return Object.freeze({ ...payload, completionHash: hashCanonicalPayload(payload) });
}

export function parseBucketTurnoverCompletion(value: unknown, expected: {
  sourceKind: "window" | "event"; commitHash: string; committedAt: string; windowEndsAt: string; observedAt: string;
}): BucketTurnoverCompletion {
  const parsed = schema.parse(value);
  const { schemaVersion: _version, completionHash: _hash, ...payload } = parsed;
  const completion = createBucketTurnoverCompletion(payload);
  if (!isDeepStrictEqual(value, completion) || completion.sourceKind !== expected.sourceKind || completion.commitHash !== expected.commitHash ||
    Date.parse(completion.completedAt) < Date.parse(expected.committedAt) || Date.parse(completion.completedAt) >= Date.parse(expected.windowEndsAt) ||
    Date.parse(completion.completedAt) > Date.parse(expected.observedAt)) throw new Error("turnover completion receipt hash, source or time mismatch");
  return completion;
}
