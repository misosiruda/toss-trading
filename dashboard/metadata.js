import { fallbackSymbolMetadata, state } from "./state.js";

export function registerSymbolMetadata(item) {
  if (!item?.market || !item?.symbol) {
    return;
  }
  const key = symbolKey(item.market, item.symbol);
  const current = state.symbolMetadata.get(key) ?? {};
  const fallback = fallbackSymbolMetadata.get(key) ?? {};
  state.symbolMetadata.set(key, {
    name: cleanMetadataValue(item.name) ?? current.name ?? fallback.name ?? null,
    sector:
      cleanMetadataValue(item.sector ?? item.category) ??
      current.sector ??
      fallback.sector ??
      null,
    industry:
      cleanMetadataValue(item.industry ?? item.theme) ??
      current.industry ??
      fallback.industry ??
      null
  });
}

export function symbolCodeText(market, symbol) {
  if (market && symbol) {
    return `${market}:${symbol}`;
  }
  return symbol ?? market ?? "-";
}

export function symbolDisplayName(market, symbol, item = {}) {
  return metadataForSymbol(market, symbol, item).name ?? symbol ?? "-";
}

export function symbolDisplayText(market, symbol, item = {}) {
  const name = symbolDisplayName(market, symbol, item);
  const code = symbolCodeText(market, symbol);
  return name && name !== symbol && name !== code ? `${name} (${code})` : code;
}

export function enrichPositionForDisplay(position, candidate = {}) {
  const metadata = metadataForSymbol(position?.market, position?.symbol, {
    ...candidate,
    ...position
  });
  return {
    ...position,
    name: metadata.name ?? position?.name,
    sector: metadata.sector ?? position?.sector,
    industry: metadata.industry ?? position?.industry
  };
}

export function enrichCandidateForDisplay(candidate) {
  const metadata = metadataForSymbol(
    candidate?.market,
    candidate?.symbol,
    candidate
  );
  return {
    ...candidate,
    name: metadata.name ?? candidate?.name,
    sector: metadata.sector ?? candidate?.sector,
    industry: metadata.industry ?? candidate?.industry
  };
}

function symbolKey(market, symbol) {
  return `${market ?? ""}:${symbol ?? ""}`;
}

function cleanMetadataValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

export function metadataForSymbol(market, symbol, item = {}) {
  const key = symbolKey(market, symbol);
  const remembered = state.symbolMetadata.get(key) ?? {};
  const fallback = fallbackSymbolMetadata.get(key) ?? {};
  return {
    name: cleanMetadataValue(item.name) ?? remembered.name ?? fallback.name ?? null,
    sector:
      cleanMetadataValue(item.sector ?? item.category) ??
      remembered.sector ??
      fallback.sector ??
      null,
    industry:
      cleanMetadataValue(item.industry ?? item.theme) ??
      remembered.industry ??
      fallback.industry ??
      null
  };
}
