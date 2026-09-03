import { isDeepStrictEqual } from "node:util";

import {
  parsePaperFillExecutionRecord,
  type PaperFillExecutionRecord
} from "./paperFillExecution.js";
import {
  parseSourcePriceEvidenceRecord,
  type SourcePriceEvidenceRecord
} from "./sourcePriceEvidence.js";
import {
  getVerifiedSourcePriceEvidenceRecords,
  type VerifiedSourcePriceEvidenceHistory
} from "./sourcePriceEvidenceFiles.js";

export interface ResolvedPaperFillExecutionOrigins {
  record: PaperFillExecutionRecord;
  sourcePriceEvidence: SourcePriceEvidenceRecord;
}

/** Resolves a paper fill's projected source price to one immutable observation. */
export function resolvePaperFillExecutionOrigins(input: {
  value: unknown;
  sourcePriceEvidenceHistory: VerifiedSourcePriceEvidenceHistory;
}): ResolvedPaperFillExecutionOrigins {
  const record = parsePaperFillExecutionRecord(input.value);
  const evidence = getVerifiedSourcePriceEvidenceRecords(
    input.sourcePriceEvidenceHistory
  ).map((value) => parseSourcePriceEvidenceRecord(value));
  const matches = evidence.filter(
    (candidate) =>
      candidate.evidenceRef === record.sourcePriceEvidence.evidenceRef
  );
  if (matches.length !== 1) {
    throw new Error(
      "paper fill source price evidence does not resolve exactly once"
    );
  }
  const sourcePriceEvidence = matches[0] as SourcePriceEvidenceRecord;
  assertSourcePriceEvidenceMatches(record, sourcePriceEvidence);
  return deepFreeze({ record, sourcePriceEvidence });
}

function assertSourcePriceEvidenceMatches(
  record: PaperFillExecutionRecord,
  evidence: SourcePriceEvidenceRecord
): void {
  const projection = record.sourcePriceEvidence;
  const expectedProjection = {
    sourceContractId: evidence.sourceContractId,
    evidenceRef: evidence.evidenceRef,
    evidenceHash: evidence.evidenceHash,
    market: evidence.market,
    symbol: evidence.symbol,
    priceField: evidence.priceField,
    observedAt: projection.observedAt
  };
  if (
    !isDeepStrictEqual(projection, expectedProjection) ||
    Date.parse(projection.observedAt) !== Date.parse(evidence.observedAt)
  ) {
    throw new Error("paper fill source price evidence projection mismatch");
  }
  if (evidence.priceKrw !== record.sourcePriceKrw) {
    throw new Error("paper fill source price evidence value mismatch");
  }
  if (Date.parse(evidence.createdAt) > Date.parse(record.asOf)) {
    throw new Error("paper fill source price evidence postdates fill cutoff");
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
