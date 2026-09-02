import { z } from "zod";

import {
  sha256HashSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
import {
  type BucketValuationApplicationFileSnapshot,
  type PersistedBucketValuationApplication,
  BucketValuationApplicationFileRepository
} from "../portfolio/bucketValuationApplicationFiles.js";
import { createBucketValuationMarkRecord } from "../portfolio/bucketValuationMark.js";
import {
  compareText,
  offsetQualifiedIsoDateTimeSchema
} from "../portfolio/runtimePolicyContracts.js";
import {
  type SourcePriceEvidenceRecord
} from "../portfolio/sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "../portfolio/sourcePriceEvidenceFiles.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim() === value, "identifier must be canonical");

const storageBaseDirSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value,
    "storageBaseDir must be canonical"
  );

export const bucketValuationRunOnceInputSchema = z
  .object({
    storageBaseDir: storageBaseDirSchema,
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    currentPriceEvidenceRefs: z.array(identifierSchema).min(1).max(10_000),
    asOf: offsetQualifiedIsoDateTimeSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    const canonicalRefs = [...value.currentPriceEvidenceRefs].sort(compareText);
    if (new Set(canonicalRefs).size !== canonicalRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["currentPriceEvidenceRefs"],
        message: "current price evidence refs must be unique"
      });
    }
    if (!sameStrings(value.currentPriceEvidenceRefs, canonicalRefs)) {
      context.addIssue({
        code: "custom",
        path: ["currentPriceEvidenceRefs"],
        message: "current price evidence refs must use canonical order"
      });
    }
    if (Date.parse(value.createdAt) < Date.parse(value.asOf)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "valuation run cannot be created before its asOf"
      });
    }
  });

export type BucketValuationRunOnceInput = z.infer<
  typeof bucketValuationRunOnceInputSchema
>;

/**
 * Builds and atomically applies one paper-only bucket valuation.
 *
 * Position and evidence reads are proposal inputs. The aggregate repository
 * independently re-resolves every current head, risk state, and durable
 * evidence record under its own lock set before committing any mutation.
 */
export async function runBucketValuationOnce(
  value: unknown
): Promise<PersistedBucketValuationApplication> {
  const input = bucketValuationRunOnceInputSchema.parse(value);
  const applicationRepository = new BucketValuationApplicationFileRepository(
    input.storageBaseDir
  );
  const evidenceRepository = new SourcePriceEvidenceFileRepository(
    input.storageBaseDir
  );
  const snapshot = await applicationRepository.readSnapshot();
  const storedOrigin = resolveStoredOrigin(snapshot, input);
  if (storedOrigin !== undefined) {
    return applicationRepository.apply({ value: storedOrigin });
  }
  const evidenceRecords = await evidenceRepository.readAll();
  const activeStates = snapshot.positions.states.filter(
    (state) =>
      state.portfolioId === input.portfolioId &&
      state.bucket === input.bucket &&
      state.quantity > 0
  );
  if (activeStates.length === 0) {
    throw new Error("bucket valuation run requires active positions");
  }
  if (activeStates.length !== input.currentPriceEvidenceRefs.length) {
    throw new Error(
      "bucket valuation run evidence must cover every active position exactly once"
    );
  }

  const selectedEvidence = resolveSelectedEvidence(
    input.currentPriceEvidenceRefs,
    evidenceRecords
  );
  const evidenceByScope = indexEvidenceByScope(selectedEvidence);
  const positionInputs = activeStates
    .map((state) => {
      const currentEvidence = evidenceByScope.get(instrumentKey(state));
      if (currentEvidence === undefined) {
        throw new Error(
          "bucket valuation run evidence scope does not resolve exactly once"
        );
      }
      if (Date.parse(currentEvidence.observedAt) !== Date.parse(input.asOf)) {
        throw new Error("bucket valuation run evidence time mismatch");
      }
      return {
        market: state.market,
        symbol: state.symbol,
        quantity: state.quantity,
        previousPositionMarkHeadId: state.positionMarkHeadId,
        previousPositionMarkHeadHash: state.positionMarkHeadHash,
        previousPriceKrw: state.currentPriceKrw,
        currentPriceKrw: currentEvidence.priceKrw,
        previousPriceEvidenceRef: state.currentPriceEvidenceRef,
        currentPriceEvidenceRef: currentEvidence.evidenceRef
      };
    })
    .sort(comparePositionInputs);
  const equityDeltaKrw = positionInputs.reduce(
    (sum, position) =>
      sum +
      position.quantity *
        (position.currentPriceKrw - position.previousPriceKrw),
    0
  );
  const record = createBucketValuationMarkRecord({
    portfolioId: input.portfolioId,
    bucket: input.bucket,
    policyHash: input.policyHash,
    positionInputs,
    equityDeltaKrw,
    asOf: input.asOf,
    createdAt: input.createdAt
  });
  return applicationRepository.apply({ value: record });
}

function resolveStoredOrigin(
  snapshot: BucketValuationApplicationFileSnapshot,
  input: BucketValuationRunOnceInput
): BucketValuationApplicationFileSnapshot["records"][number] | undefined {
  const matches = snapshot.records.filter(
    (record) =>
      record.portfolioId === input.portfolioId &&
      record.bucket === input.bucket &&
      Date.parse(record.asOf) === Date.parse(input.asOf)
  );
  if (matches.length > 1) {
    throw new Error("bucket valuation run origin does not resolve exactly once");
  }
  const record = matches[0];
  if (record === undefined) {
    return undefined;
  }
  if (record.policyHash !== input.policyHash) {
    throw new Error("bucket valuation run stored origin policy mismatch");
  }
  const storedRefs = record.positionInputs
    .map((position) => position.currentPriceEvidenceRef)
    .sort(compareText);
  if (!sameStrings(storedRefs, input.currentPriceEvidenceRefs)) {
    throw new Error("bucket valuation run stored origin evidence mismatch");
  }
  return record;
}

function resolveSelectedEvidence(
  refs: readonly string[],
  records: readonly SourcePriceEvidenceRecord[]
): readonly SourcePriceEvidenceRecord[] {
  const recordsByRef = new Map(
    records.map((record) => [record.evidenceRef, record])
  );
  return Object.freeze(
    refs.map((ref) => {
      const record = recordsByRef.get(ref);
      if (record === undefined) {
        throw new Error(
          "bucket valuation run evidence does not resolve exactly once"
        );
      }
      return record;
    })
  );
}

function indexEvidenceByScope(
  records: readonly SourcePriceEvidenceRecord[]
): ReadonlyMap<string, SourcePriceEvidenceRecord> {
  const byScope = new Map<string, SourcePriceEvidenceRecord>();
  for (const record of records) {
    const key = instrumentKey(record);
    if (byScope.has(key)) {
      throw new Error("bucket valuation run evidence contains duplicate scope");
    }
    byScope.set(key, record);
  }
  return byScope;
}

function instrumentKey(value: { market: string; symbol: string }): string {
  return JSON.stringify([value.market, value.symbol]);
}

function comparePositionInputs(
  left: { market: string; symbol: string },
  right: { market: string; symbol: string }
): number {
  return (
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
