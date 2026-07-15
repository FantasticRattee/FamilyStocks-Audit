export type YahooSearchCandidate = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  quoteType: string;
};

export type MarketQuote = {
  symbol: string;
  price: number;
  currency: string;
  exchange: string;
  marketState: string;
  quoteTimestamp?: string;
  source?: "Yahoo Finance" | "Google Finance" | "EODHD" | "OpenAI web search";
  freshness?: "delayed" | "latest close" | "searched live";
};

const symbolPattern = /^[A-Za-z0-9.^=-]{1,32}$/;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function isSafeYahooSymbol(symbol: string) {
  return symbolPattern.test(symbol.trim());
}

export function isYahooCandidateCurrencyCompatible(
  candidateCurrency: string,
  holdingCurrency: "THB" | "USD",
) {
  const currency = candidateCurrency.trim().toUpperCase();
  return !currency || currency === "—" || currency === holdingCurrency;
}

export function parseYahooSearch(payload: unknown): YahooSearchCandidate[] {
  const root = asRecord(payload);
  const quotes = root?.quotes;
  if (!Array.isArray(quotes)) return [];

  return quotes.flatMap((item) => {
    const quote = asRecord(item);
    if (!quote) return [];

    const symbol = text(quote.symbol);
    if (!isSafeYahooSymbol(symbol)) return [];

    return [
      {
        symbol,
        name:
          text(quote.longname) || text(quote.shortname) || text(quote.displayName) || symbol,
        exchange:
          text(quote.exchDisp) || text(quote.exchange) || text(quote.fullExchangeName) || "—",
        currency: text(quote.currency).toUpperCase() || "—",
        quoteType: text(quote.quoteType).toUpperCase() || "—",
      },
    ];
  });
}

export function parseYahooChartQuote(payload: unknown): MarketQuote | null {
  const root = asRecord(payload);
  const chart = asRecord(root?.chart);
  const result = chart?.result;
  if (!Array.isArray(result) || result.length === 0) return null;

  const firstResult = asRecord(result[0]);
  const meta = asRecord(firstResult?.meta);
  if (!meta) return null;

  const symbol = text(meta.symbol);
  const price = finiteNumber(meta.regularMarketPrice) ?? finiteNumber(meta.previousClose);
  if (!isSafeYahooSymbol(symbol) || price === undefined || price <= 0) return null;

  const timestamp = finiteNumber(meta.regularMarketTime);
  const quote: MarketQuote = {
    symbol,
    price,
    currency: text(meta.currency).toUpperCase() || "—",
    exchange: text(meta.exchangeName) || text(meta.fullExchangeName) || "—",
    marketState: text(meta.marketState).toUpperCase() || "UNKNOWN",
  };
  if (timestamp !== undefined && timestamp > 0) {
    quote.quoteTimestamp = new Date(timestamp * 1000).toISOString();
  }
  return quote;
}
