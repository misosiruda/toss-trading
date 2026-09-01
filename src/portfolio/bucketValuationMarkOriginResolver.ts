import {
  type BucketPositionMarkHeadState,
  parseBucketPositionMarkHeadState
} from "./bucketPositionMarkHead.js";
import {
  type BucketValuationMarkRecord,
  type BucketValuationPositionInput,
  parseBucketValuationMarkRecord
} from "./bucketValuationMark.js";

export interface ResolvedBucketValuationPositionInput {
  input: BucketValuationPositionInput;
  previousHead: BucketPositionMarkHeadState;
}

export interface ResolvedBucketValuationMarkPreviousHeads {
  record: BucketValuationMarkRecord;
  positions: readonly ResolvedBucketValuationPositionInput[];
}

/**
 * Resolves a valuation mark against every active position head in its bucket.
 *
 * Current-price evidence remains an independent immutable dependency. This
 * resolver does not infer it from a generic reference or validate the future
 * valuation/equity events that will consume the mark.
 */
export function resolveBucketValuationMarkPreviousHeads(input: {
  value: unknown;
  currentStates: readonly unknown[];
}): ResolvedBucketValuationMarkPreviousHeads {
  const record = parseBucketValuationMarkRecord(input.value);
  const states = parseUniqueStates(input.currentStates);
  const activeStates = states.filter(
    (state) =>
      state.portfolioId === record.portfolioId &&
      state.bucket === record.bucket &&
      state.quantity > 0
  );
  if (activeStates.length !== record.positionInputs.length) {
    throw new Error(
      "bucket valuation mark does not cover every active position exactly once"
    );
  }

  const positions = record.positionInputs.map((positionInput) => {
    const matches = activeStates.filter(
      (state) =>
        state.market === positionInput.market &&
        state.symbol === positionInput.symbol
    );
    if (matches.length !== 1) {
      throw new Error(
        "bucket valuation position head does not resolve exactly once"
      );
    }
    const previousHead = matches[0] as BucketPositionMarkHeadState;
    assertPreviousHeadMatches(record, positionInput, previousHead);
    return deepFreeze({ input: positionInput, previousHead });
  });

  return deepFreeze({ record, positions });
}

function parseUniqueStates(
  values: readonly unknown[]
): readonly BucketPositionMarkHeadState[] {
  const states = values.map((value) => parseBucketPositionMarkHeadState(value));
  const scopes = new Set<string>();
  for (const state of states) {
    const scope = JSON.stringify([
      state.portfolioId,
      state.bucket,
      state.market,
      state.symbol
    ]);
    if (scopes.has(scope)) {
      throw new Error("position mark head states contain a duplicate scope");
    }
    scopes.add(scope);
  }
  return states;
}

function assertPreviousHeadMatches(
  record: BucketValuationMarkRecord,
  input: BucketValuationPositionInput,
  previousHead: BucketPositionMarkHeadState
): void {
  if (
    input.previousPositionMarkHeadId !== previousHead.positionMarkHeadId ||
    input.previousPositionMarkHeadHash !== previousHead.positionMarkHeadHash
  ) {
    throw new Error("bucket valuation previous head identity mismatch");
  }
  if (input.quantity !== previousHead.quantity) {
    throw new Error("bucket valuation previous head quantity mismatch");
  }
  if (
    input.previousPriceKrw !== previousHead.currentPriceKrw ||
    input.previousPriceEvidenceRef !== previousHead.currentPriceEvidenceRef
  ) {
    throw new Error("bucket valuation previous price basis mismatch");
  }
  if (Date.parse(record.asOf) <= Date.parse(previousHead.asOf)) {
    throw new Error(
      "bucket valuation mark must advance every previous head interval"
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
