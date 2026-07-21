import {
  US_STOCK_SYMBOL_CATALOG,
  type UsStockSymbolCatalogEntry,
} from "./us-stock-symbol-catalog.generated";

export type UsStockSymbolHint = {
  symbol: string;
  name: string;
  exchange: string;
};

type SearchableSymbol = UsStockSymbolHint & {
  normalizedSymbol: string;
  normalizedName: string;
  normalizedWords: string[];
  lowPrioritySecurity: boolean;
  popularityRank: number;
};

const normalize = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9]/g, "")
  .toUpperCase();

const curatedOrder = [
  "AAPL", "AMZN", "ARM", "GOOGL", "GOOG", "MSFT", "META", "NVDA", "TSLA", "AVGO",
  "BRK.B", "JPM", "V", "MA", "LLY", "WMT", "ORCL", "NFLX", "COST", "PLTR",
] as const;

const popularityRank = new Map<string, number>(curatedOrder.map((symbol, index) => [symbol, index]));
const lowPrioritySecurity = /\b(?:WARRANTS?|RIGHTS?|UNITS?|NOTES?|BONDS?|PREFERRED)\b/i;

const toSearchableSymbol = ([symbol, name, exchange]: UsStockSymbolCatalogEntry): SearchableSymbol => ({
  symbol,
  name,
  exchange,
  normalizedSymbol: normalize(symbol),
  normalizedName: normalize(name),
  normalizedWords: name
    .split(/[^A-Za-z0-9]+/)
    .map(normalize)
    .filter(Boolean),
  lowPrioritySecurity: lowPrioritySecurity.test(name),
  popularityRank: popularityRank.get(symbol) ?? Number.MAX_SAFE_INTEGER,
});

const searchableSymbols = US_STOCK_SYMBOL_CATALOG.map(toSearchableSymbol);

const scoreSymbol = (entry: SearchableSymbol, query: string) => {
  if (entry.normalizedSymbol === query) return 0;
  if (entry.normalizedWords.some((word) => word.startsWith(query))) return 90;
  if (entry.normalizedSymbol.startsWith(query)) return 100;
  if (entry.normalizedSymbol.includes(query)) return 200;
  if (entry.normalizedName.includes(query)) return 400;
  return null;
};

/**
 * Searches the bundled U.S. exchange symbol catalog without a network request.
 * Ticker matches lead; then company-name word prefixes and name fragments follow.
 */
export const searchUsSymbolHints = (query: string, limit = 8): UsStockSymbolHint[] => {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return [];

  return searchableSymbols
    .map((entry) => ({ entry, score: scoreSymbol(entry, normalizedQuery) }))
    .filter((candidate): candidate is { entry: SearchableSymbol; score: number } => candidate.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      const lowPriorityDifference = Number(left.entry.lowPrioritySecurity) - Number(right.entry.lowPrioritySecurity);
      if (lowPriorityDifference !== 0) return lowPriorityDifference;
      if (left.entry.popularityRank !== right.entry.popularityRank) {
        return left.entry.popularityRank - right.entry.popularityRank;
      }
      return left.entry.symbol.localeCompare(right.entry.symbol);
    })
    .slice(0, Math.max(0, limit))
    .map(({ entry }) => ({ symbol: entry.symbol, name: entry.name, exchange: entry.exchange }));
};
