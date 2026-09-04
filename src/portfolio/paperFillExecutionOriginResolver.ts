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
  resolveVerifiedSourcePriceEvidenceOrigin,
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
  const origin = resolveVerifiedSourcePriceEvidenceOrigin(
    input.sourcePriceEvidenceHistory,
    record.sourcePriceEvidence.evidenceRef
  );
  const sourcePriceEvidence = parseSourcePriceEvidenceRecord(origin.record);
  assertSourcePriceEvidenceMatches(
    record,
    sourcePriceEvidence,
    origin.appendedAt
  );
  return deepFreeze({ record, sourcePriceEvidence });
}

function assertSourcePriceEvidenceMatches(
  record: PaperFillExecutionRecord,
  evidence: SourcePriceEvidenceRecord,
  appendedAt: string
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
  // A same-millisecond bucket cannot prove that fsync preceded the cutoff.
  if (Date.parse(appendedAt) >= Date.parse(record.asOf)) {
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
