import {
  type BucketPositionMarkHeadState,
  parseBucketPositionMarkHeadState
} from "./bucketPositionMarkHead.js";
import {
  type BucketValuationMarkRecord,
  type BucketValuationPositionInput,
  parseBucketValuationMarkRecord
} from "./bucketValuationMark.js";
import {
  type SourcePriceEvidenceRecord,
  parseSourcePriceEvidenceRecord
} from "./sourcePriceEvidence.js";

export interface ResolvedBucketValuationPositionInput {
  input: BucketValuationPositionInput;
  previousHead: BucketPositionMarkHeadState;
}

export interface ResolvedBucketValuationMarkPreviousHeads {
  record: BucketValuationMarkRecord;
  positions: readonly ResolvedBucketValuationPositionInput[];
}

export interface ResolvedBucketValuationPositionOrigins
  extends ResolvedBucketValuationPositionInput {
  currentPriceEvidence: SourcePriceEvidenceRecord;
}

export interface ResolvedBucketValuationMarkOrigins {
  record: BucketValuationMarkRecord;
  positions: readonly ResolvedBucketValuationPositionOrigins[];
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

/** Resolves every current mark price to one immutable typed observation. */
export function resolveBucketValuationMarkOrigins(input: {
  value: unknown;
  currentStates: readonly unknown[];
  currentPriceEvidence: readonly unknown[];
}): ResolvedBucketValuationMarkOrigins {
  const previous = resolveBucketValuationMarkPreviousHeads(input);
  const evidence = parseUniqueEvidence(input.currentPriceEvidence);
  const positions = previous.positions.map((position) => {
    const matches = evidence.filter(
      (candidate) =>
        candidate.evidenceRef === position.input.currentPriceEvidenceRef
    );
    if (matches.length !== 1) {
      throw new Error(
        "bucket valuation current price evidence does not resolve exactly once"
      );
    }
    const currentPriceEvidence = matches[0] as SourcePriceEvidenceRecord;
    assertCurrentPriceEvidenceMatches(
      previous.record,
      position.input,
      currentPriceEvidence
    );
    return deepFreeze({ ...position, currentPriceEvidence });
  });
  return deepFreeze({ record: previous.record, positions });
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

function parseUniqueEvidence(
  values: readonly unknown[]
): readonly SourcePriceEvidenceRecord[] {
  const evidence = values.map((value) =>
    parseSourcePriceEvidenceRecord(value)
  );
  const refs = new Set<string>();
  for (const record of evidence) {
    if (refs.has(record.evidenceRef)) {
      throw new Error("source price evidence contains a duplicate ref");
    }
    refs.add(record.evidenceRef);
  }
  return evidence;
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

function assertCurrentPriceEvidenceMatches(
  record: BucketValuationMarkRecord,
  input: BucketValuationPositionInput,
  evidence: SourcePriceEvidenceRecord
): void {
  if (
    evidence.market !== input.market ||
    evidence.symbol !== input.symbol ||
    evidence.priceField !== "last_price"
  ) {
    throw new Error("bucket valuation current price evidence scope mismatch");
  }
  if (evidence.priceKrw !== input.currentPriceKrw) {
    throw new Error("bucket valuation current price evidence value mismatch");
  }
  if (Date.parse(evidence.observedAt) !== Date.parse(record.asOf)) {
    throw new Error("bucket valuation current price evidence time mismatch");
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
