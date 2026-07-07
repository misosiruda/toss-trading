import type { TossInvestHistoricalChartSymbol } from "../collectors/tossInvestHistoricalChartCollector.js";
import type { Market } from "../domain/schemas.js";
import type { HistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";

export function createTossInvestHistoricalChartSymbols(input: {
  universe: HistoricalUniverseManifest | null;
  symbols: string[];
  market: Market;
}): TossInvestHistoricalChartSymbol[] {
  if (input.universe === null) {
    return input.symbols.map((symbol) => ({
      market: input.market,
      symbol,
      assetType: "STOCK",
      assetClass: "equity",
      region: input.market
    }));
  }

  return input.universe.symbols.map(
    (symbol): TossInvestHistoricalChartSymbol => ({
      market: symbol.market,
      symbol: symbol.symbol,
      ...(symbol.sourceSymbol === undefined
        ? {}
        : { sourceSymbol: symbol.sourceSymbol }),
      ...(symbol.name === undefined ? {} : { name: symbol.name }),
      ...(symbol.assetType === undefined ? {} : { assetType: symbol.assetType }),
      ...(symbol.assetClass === undefined
        ? {}
        : { assetClass: symbol.assetClass }),
      ...(symbol.region === undefined ? {} : { region: symbol.region }),
      ...(symbol.riskTags === undefined ? {} : { riskTags: symbol.riskTags }),
      ...(symbol.strategyBucket === undefined
        ? {}
        : { strategyBucket: symbol.strategyBucket }),
      ...(symbol.sector === undefined ? {} : { sector: symbol.sector })
    })
  );
}
