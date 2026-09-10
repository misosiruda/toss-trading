import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths } from "../storage/repositories.js";
import { candidatePacketClassificationRef, CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION,
  deriveCandidatePacketClassification } from "./candidatePacketClassification.js";
import { readCanonicalMarketPacketHistory } from "./everyTickPortfolioCycleTriggerResolver.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateCashCapacity } from "./storedCandidateCashCapacity.js";

/** Actual stored packet metadata replay, not provider trust, portfolio-fit evidence or allocation authority. */
export async function resolveStoredCandidateClassification(
  input: Parameters<typeof resolveStoredCandidateCashCapacity>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateCashCapacity>[1]> = {}
) {
  const lookup = { ...input, baseDir: resolve(input.baseDir) }, capturedOptions = { ...options };
  const cashReplay = await resolveStoredCandidateCashCapacity(lookup, capturedOptions);
  const evidenceAssessment = cashReplay.costBasisReplay.liquidityReplay.policyCostReplay.costReplay.hardGateAssessment.evidenceAssessment;
  const { scoreReplay, request } = evidenceAssessment, candidate = scoreReplay.sizingInputOrigin.record;
  if (scoreReplay.selectionPolicy.classificationModelVersion !== CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION) {
    throw new Error("candidate classification model is not selected by the as-of policy");
  }
  const history = await readCanonicalMarketPacketHistory(createStoragePaths(lookup.baseDir).marketPacketsPath);
  if (history.corruptLineCount !== 0) throw new Error("candidate classification packet history is corrupt");
  const matches = history.records.filter((packet) => candidatePacketClassificationRef(createMarketPacketHash(packet),
    candidate.market, candidate.symbol) === candidate.exposureKeys.classificationEvidenceRef);
  if (matches.length !== 1) throw new Error("classification packet must resolve exactly once");
  const packet = matches[0]!;
  if (history.records.filter((item) => item.packetId === packet.packetId).length !== 1) throw new Error("classification packet ID was reused");
  if (packet.virtualPortfolio.portfolioId !== candidate.portfolioId) throw new Error("classification packet portfolio mismatch");
  const classification = deriveCandidatePacketClassification({ modelVersion: CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION,
    packet, market: candidate.market, symbol: candidate.symbol });
  if (!isDeepStrictEqual(candidate.exposureKeys, classification.exposureKeys)) throw new Error("candidate classification keys differ from actual packet");
  if (Date.parse(classification.generatedAt) > Date.parse(request.evidenceCutoffAt) ||
    Date.parse(classification.expiresAt) <= Date.parse(request.asOf) || Date.parse(classification.staleAfter) <= Date.parse(request.asOf)) {
    throw new Error("classification packet is after cutoff or stale at request as-of");
  }
  const assessment = Object.freeze({ verificationScope: "stored_packet_classification_content_only" as const,
    sizingInputHash: candidate.sizingInputHash, cashAssessmentHash: cashReplay.assessmentHash,
    classificationEvidenceHash: classification.evidenceHash, classificationModelSelection: "as_of_selection_policy_bound" as const,
    sourceHistoryHash: hashCanonicalPayload(history.records), sourceRecordCount: history.records.length,
    sourceTrust: "not_evaluated" as const, historicalDiskAvailability: "not_proven" as const,
    portfolioFitEvidence: "not_evaluated" as const, observedBucketAuthority: "metadata_only" as const,
    finalSizing: "not_performed" as const, cashConditionSatisfied: cashReplay.assessment.cashConditionSatisfied,
    evidenceAndHardGateConditionsSatisfied: cashReplay.assessment.evidenceAndHardGateConditionsSatisfied });
  return Object.freeze({ cashReplay, classification, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
