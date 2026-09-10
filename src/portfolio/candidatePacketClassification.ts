import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { candidateSizingInputPayloadSchema } from "./candidateSizingInput.js";
import { parseCanonicalMarketPacketHistoryText } from "./everyTickPortfolioCycleTriggerResolver.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION = "candidate_packet_classification.v1";
const identifier = z.string().min(1).max(160).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const symbolSchema = candidateSizingInputPayloadSchema.shape.symbol;
const inputSchema = z.object({ modelVersion: z.literal(CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION),
  packet: z.unknown(), market: marketSchema, symbol: symbolSchema }).strict();

/** A content address, never proof that the packet exists or its metadata is authoritative. */
export function candidatePacketClassificationRef(packetHash: string, market: z.infer<typeof marketSchema>, symbol: string) {
  return hashDerivedId("candidate_packet_classification", hashCanonicalPayload({
    modelVersion: CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION, packetHash: sha256HashSchema.parse(packetHash),
    market: marketSchema.parse(market), symbol: symbolSchema.parse(symbol) }));
}

/** Declared sector/region and market settlement currency, not issuer domicile or look-through FX exposure. */
export function deriveCandidatePacketClassification(value: unknown) {
  const parsed = inputSchema.parse(value);
  if (!isDeepStrictEqual(parsed, value)) throw new Error("candidate classification input must already be canonical");
  const history = parseCanonicalMarketPacketHistoryText(`${JSON.stringify(parsed.packet)}\n`);
  const packet = history.records[0];
  if (history.corruptLineCount !== 0 || !packet || !isDeepStrictEqual(packet, parsed.packet)) {
    throw new Error("candidate classification packet is not canonical");
  }
  const matches = packet.candidates.filter((item) => item.market === parsed.market && item.symbol === parsed.symbol);
  if (matches.length !== 1) throw new Error("classification candidate must resolve exactly once");
  const candidate = matches[0]!;
  const sector = identifier.parse(candidate.sector);
  const numeric = Number(sector);
  if ((Number.isInteger(numeric) && numeric >= 0 && numeric < 4294967295 && String(numeric) === sector) ||
    sector === "prototype" || Object.hasOwn(Object.prototype, sector)) throw new Error("classification sector requires a safe non-index key");
  if (candidate.region === undefined) throw new Error("classification requires an explicit region");
  const sourceRefs = z.array(identifier).min(1).max(128).parse(candidate.sourceRefs);
  if (new Set(sourceRefs).size !== sourceRefs.length) throw new Error("classification source refs must be unique");
  const [generated, expires, collected, stale] = [packet.generatedAt, packet.expiresAt, candidate.collectedAt, candidate.staleAfter]
    .map((time) => Date.parse(offsetQualifiedIsoDateTimeSchema.parse(time)));
  if (collected! > generated! || generated! >= expires! || generated! >= stale!) {
    throw new Error("classification packet chronology is inconsistent");
  }
  const input = Object.freeze({ ...parsed, packet });
  const packetHash = createMarketPacketHash(packet);
  const evidenceRef = candidatePacketClassificationRef(packetHash, parsed.market, parsed.symbol);
  const exposureKeys = Object.freeze({ sector, country: candidate.region, currency: parsed.market === "KR" ? "KRW" : "USD",
    classificationEvidenceRef: evidenceRef });
  const payload = Object.freeze({ input, inputHash: hashCanonicalPayload(input), packetHash, evidenceRef, exposureKeys,
    sourceRefs: Object.freeze(sourceRefs), observedStrategyBucket: candidate.strategyBucket ?? null,
    generatedAt: packet.generatedAt, expiresAt: packet.expiresAt, collectedAt: candidate.collectedAt, staleAfter: candidate.staleAfter,
    verificationScope: "packet_classification_content_only" as const,
    classificationSemantics: "declared_sector_region_and_market_settlement_currency" as const });
  return Object.freeze({ ...payload, evidenceHash: hashCanonicalPayload(payload) });
}

export function parseCandidatePacketClassification(value: unknown) {
  const record = z.object({ input: inputSchema }).passthrough().parse(value);
  const expected = deriveCandidatePacketClassification(record.input);
  if (!isDeepStrictEqual(value, expected)) throw new Error("candidate classification complete payload replay mismatch");
  return expected;
}
