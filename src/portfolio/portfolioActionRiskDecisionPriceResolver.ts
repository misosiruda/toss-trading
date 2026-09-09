import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { resolvePortfolioActionRiskDecisionSnapshot } from "./portfolioActionRiskDecisionSnapshotResolver.js";
import { SourcePriceEvidenceFileRepository, resolveObservedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { riskDecisionPriceIdentity, validateRiskDecisionPriceState } from "./portfolioActionRiskDecisionPriceContext.js";

/** Historical price input replay. A resolved price is not a fresh quote or permission to execute. */
export async function resolvePortfolioActionRiskDecisionPrice(input: { baseDir: string; riskDecisionId: string },
  options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
  const lockOptions = { ...options };
  const parsed = z.object({ baseDir: z.string().min(1), riskDecisionId: z.string().min(1) }).strict().parse(input);
  const snapshot = await resolvePortfolioActionRiskDecisionSnapshot(parsed, lockOptions);
  const receipt = snapshot.origin.priceOrigin;
  if (receipt === null) throw new Error("risk decision lacks price-before-creation provenance; legacy record requires review");
  return new SourcePriceEvidenceFileRepository(parsed.baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const prefix = resolveObservedSourcePriceEvidenceHistory(history, receipt.observation);
    const sourcePrice = validateRiskDecisionPriceState(snapshot.decision, prefix, receipt.evidenceRef);
    const { observation: _time, ...identity } = receipt;
    if (!isDeepStrictEqual(identity, riskDecisionPriceIdentity(sourcePrice))) throw new Error("risk decision price origin does not match stored source");
    return Object.freeze({ ...snapshot, sourcePrice, priceOrigin: receipt });
  });
}
