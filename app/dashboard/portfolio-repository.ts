import type { MarketQuote } from "./market-data";

export type MarketQuoteSnapshot = MarketQuote;

export const SHARED_MARKET_KEYS = ["GOOGL", "SCB", "KBANK", "USDTHB"] as const;

export type SharedMarketKey = (typeof SHARED_MARKET_KEYS)[number];

export type PersistedQuoteMerge = {
  quotes: Record<string, MarketQuoteSnapshot>;
  failures: Record<string, string>;
  refreshedKeys: string[];
  retainedKeys: string[];
};

export type MarketRefreshSource = {
  url: string;
  title: string;
};

export type PersistableMarketRefresh = {
  quotes: Record<string, MarketQuoteSnapshot>;
  failures: Record<string, string>;
  fetchedAt: string;
  provider?: string;
  sources?: MarketRefreshSource[];
};

export type PersistedMarketRefresh = PersistedQuoteMerge & {
  fetchedAt: string;
  provider?: string;
  sources?: MarketRefreshSource[];
};

export interface MarketQuotePersistenceRepository {
  loadRecentMarketRefresh(
    maxAgeMs: number,
  ): Promise<PersistedMarketRefresh | null>;
  persistMarketRefresh(
    refresh: PersistableMarketRefresh,
  ): Promise<PersistedMarketRefresh>;
}

export function mergePersistedMarketQuotes(
  stored: Record<string, MarketQuoteSnapshot>,
  refresh: {
    quotes: Record<string, MarketQuoteSnapshot>;
    failures: Record<string, string>;
  },
): PersistedQuoteMerge {
  const quotes: Record<string, MarketQuoteSnapshot> = {};
  const failures: Record<string, string> = {};
  const refreshedKeys: string[] = [];
  const retainedKeys: string[] = [];

  for (const key of SHARED_MARKET_KEYS) {
    const fresh = refresh.quotes[key];
    if (fresh) {
      quotes[key] = fresh;
      refreshedKeys.push(key);
      continue;
    }
    const previous = stored[key];
    if (previous) {
      quotes[key] = previous;
      retainedKeys.push(key);
      continue;
    }
    failures[key] =
      refresh.failures[key] ?? "No persisted or newly refreshed market quote is available.";
  }

  return { quotes, failures, refreshedKeys, retainedKeys };
}
