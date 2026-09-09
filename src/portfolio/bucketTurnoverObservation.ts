import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const count = z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0));
export const bucketTurnoverObservationSchema = z.object({
  sourceWindowCount: count, sourceWindowGenerationHash: sha256HashSchema.nullable(),
  sourceEventCount: count, sourceEventGenerationHash: sha256HashSchema.nullable(),
  projectionHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema.refine((value) => value === new Date(value).toISOString())
}).strict();
export type BucketTurnoverObservation = Readonly<z.infer<typeof bucketTurnoverObservationSchema>>;
