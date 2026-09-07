import { isDeepStrictEqual } from "node:util";
import { sha256HashSchema } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths } from "../storage/repositories.js";
import { readCanonicalMarketPacketHistory } from "./everyTickPortfolioCycleTriggerResolver.js";
import { createPortfolioPolicyExecutionPreview, portfolioPolicyExecutionPreviewInputSchema } from "./portfolioPolicyExecutionPreview.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import type { z } from "zod";

export const portfolioPacketExecutionPreviewInputSchema = portfolioPolicyExecutionPreviewInputSchema
  .omit({ volume: true, averageVolume: true, liquidityStale: true })
  .extend({ liquidityPacketHash: sha256HashSchema }).strict();

/**
 * Reads liquidity from an exact stored paper packet, never from caller numeric overrides.
 * Packet history is a canonical read, not a durable observation or an execution authorization.
 */
export async function createPortfolioPacketExecutionPreview(value: z.input<typeof portfolioPacketExecutionPreviewInputSchema>) {
  const input = portfolioPacketExecutionPreviewInputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("packet execution preview input must already be canonical");
  const history = await readCanonicalMarketPacketHistory(createStoragePaths(input.baseDir).marketPacketsPath);
  if (history.corruptLineCount !== 0) throw new Error("execution liquidity packet history is corrupt");
  const matches = history.records.filter((record) => createMarketPacketHash(record) === input.liquidityPacketHash);
  if (matches.length !== 1) throw new Error("execution liquidity packet must resolve exactly once");
  const packet = matches[0]!;
  if (history.records.filter((record) => record.packetId === packet.packetId).length !== 1) {
    throw new Error("execution liquidity packet ID was reused");
  }
  if (packet.virtualPortfolio.portfolioId !== input.portfolioId) throw new Error("execution liquidity packet portfolio mismatch");
  const candidates = packet.candidates.filter((candidate) => candidate.market === input.market && candidate.symbol === input.symbol);
  if (candidates.length !== 1) throw new Error("execution liquidity candidate must resolve exactly once");
  const candidate = candidates[0]!;
  const volume = candidate.volume ?? null;
  const averageVolume = candidate.averageVolume ?? null;
  if (volume === null && averageVolume === null) throw new Error("execution liquidity packet has no volume evidence");
  for (const amount of [volume, averageVolume]) {
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER || Object.is(amount, -0))) {
      throw new Error("execution liquidity volume is outside the supported range");
    }
  }
  const readAt = new Date().toISOString();
  const generatedAt = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(packet.generatedAt));
  const expiresAt = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(packet.expiresAt));
  const collectedAt = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(candidate.collectedAt));
  const staleAfter = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(candidate.staleAfter));
  const assertFresh = (asOf: string) => {
    const cutoff = Date.parse(asOf);
    if (collectedAt > generatedAt || generatedAt > cutoff || Date.parse(readAt) > cutoff ||
      expiresAt <= cutoff || staleAfter <= cutoff || collectedAt >= staleAfter) {
      throw new Error("execution liquidity packet or candidate is stale or temporally inconsistent");
    }
  };
  assertFresh(readAt);
  const { liquidityPacketHash: _packetHash, ...request } = input;
  const policyPreview = await createPortfolioPolicyExecutionPreview({ ...request, volume, averageVolume, liquidityStale: false });
  // Policy/price I/O can cross an expiry boundary after the packet read.
  assertFresh(policyPreview.preview.input.asOf);
  const liquidityContext = {
    sourceContractId: "stored-market-packet-liquidity.v1" as const,
    packetId: packet.packetId, packetHash: input.liquidityPacketHash,
    portfolioId: input.portfolioId, market: input.market, symbol: input.symbol,
    sourceRefs: candidate.sourceRefs, collectedAt: candidate.collectedAt, staleAfter: candidate.staleAfter,
    generatedAt: packet.generatedAt, expiresAt: packet.expiresAt, readAt,
    historyRecordCount: history.records.length, historyHash: hashCanonicalPayload(history.records)
  };
  return deepFreeze({ policyPreview, liquidityContext, observationHash: hashCanonicalPayload({ policyPreview, liquidityContext }) });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
