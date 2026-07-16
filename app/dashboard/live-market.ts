import type { HoldingEdits } from "./edit-model";
import type { MarketQuote } from "./market-data";
import type {
  DashboardSnapshot,
  Scenario,
} from "./model";

const AUDIT_TICKER_MARKET_KEYS: Record<
  string,
  { marketKey: string; currency: "THB" | "USD" }
> = {
  GOOGL: { marketKey: "GOOGL", currency: "USD" },
  KBANK: { marketKey: "KBANK", currency: "THB" },
  SCB: { marketKey: "SCB", currency: "THB" },
};

export const USD_THB_MARKET_KEY = "USDTHB";

export type LiveMarketStockRequest = {
  ticker: string;
  marketKey: string;
  currency: "THB" | "USD";
};

export type LiveMarketRefreshPlan = {
  symbols: string[];
  stocks: LiveMarketStockRequest[];
  unmappedTickers: Record<string, string>;
};

export type LiveMarketBatchResponse = {
  quotes: Record<string, MarketQuote>;
  failures: Record<string, string>;
  fetchedAt: string;
  provider?: string;
  sources?: LiveMarketSource[];
  refreshedKeys?: string[];
  retainedKeys?: string[];
  cooldownActive?: boolean;
};

export type LiveMarketSource = {
  url: string;
  title: string;
};

export type LiveMarketState = {
  quotesByTicker: Record<string, MarketQuote>;
  fx?: number;
  fetchedAt?: string;
  provider?: string;
  sources?: LiveMarketSource[];
  failures: Record<string, string>;
  refreshedStockCount: number;
  retainedStockCount: number;
  requestedStockCount: number;
  refreshedFx: boolean;
  retainedFx: boolean;
  cooldownActive: boolean;
};

const uniqueHoldings = (snapshot: DashboardSnapshot) =>
  Array.from(
    new Map(snapshot.holdings.map((holding) => [holding.ticker, holding])).values(),
  );

const positiveFinite = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function createLiveMarketRefreshPlan(
  snapshot: DashboardSnapshot,
  _edits: HoldingEdits,
): LiveMarketRefreshPlan {
  // Edit Mode's Yahoo selection affects a deliberate export/manual override.
  // The public refresh uses a stable OpenAI request contract instead.
  void _edits;
  const stocks: LiveMarketStockRequest[] = [];
  const unmappedTickers: Record<string, string> = {};

  for (const holding of uniqueHoldings(snapshot)) {
    const configured = AUDIT_TICKER_MARKET_KEYS[holding.ticker.trim().toUpperCase()];
    if (!configured) {
      unmappedTickers[holding.ticker] =
        "No OpenAI market mapping is configured for this holding.";
      continue;
    }
    if (configured.currency !== holding.currency) {
      unmappedTickers[holding.ticker] =
        `Configured market source currency does not match ${holding.currency}.`;
      continue;
    }
    stocks.push({
      ticker: holding.ticker,
      marketKey: configured.marketKey,
      currency: holding.currency,
    });
  }

  return {
    symbols: Array.from(
      new Set([...stocks.map((stock) => stock.marketKey), USD_THB_MARKET_KEY]),
    ),
    stocks,
    unmappedTickers,
  };
}

export function createLiveMarketState(
  plan: LiveMarketRefreshPlan,
  response: LiveMarketBatchResponse,
): LiveMarketState {
  const quotesByTicker: Record<string, MarketQuote> = {};
  const failures = { ...plan.unmappedTickers };
  const refreshedKeys = new Set(response.refreshedKeys ?? []);
  const retainedKeys = new Set(response.retainedKeys ?? []);

  for (const stock of plan.stocks) {
    const quote = response.quotes[stock.marketKey];
    if (!quote) {
      failures[stock.ticker] =
        response.failures[stock.marketKey] ?? "Market data provider did not return a quote.";
      continue;
    }
    if (quote.currency.trim().toUpperCase() !== stock.currency) {
      failures[stock.ticker] =
        `${quote.source ?? "Market provider"} returned ${quote.currency || "unknown"} for a ${stock.currency} holding.`;
      continue;
    }
    if (!positiveFinite(quote.price)) {
      failures[stock.ticker] = `${quote.source ?? "Market provider"} returned an invalid price.`;
      continue;
    }
    quotesByTicker[stock.ticker] = quote;
  }

  const fxQuote = response.quotes[USD_THB_MARKET_KEY];
  const fx = positiveFinite(fxQuote?.price) ? fxQuote.price : undefined;
  if (!fx) {
    failures[USD_THB_MARKET_KEY] =
      response.failures[USD_THB_MARKET_KEY] ??
      `${response.provider ?? "Market provider"} did not return a valid USD/THB rate.`;
  }

  return {
    quotesByTicker,
    ...(fx === undefined ? {} : { fx }),
    fetchedAt: response.fetchedAt,
    ...(response.provider ? { provider: response.provider } : {}),
    ...(response.sources?.length ? { sources: response.sources } : {}),
    failures,
    refreshedStockCount: response.refreshedKeys
      ? plan.stocks.filter(
          (stock) =>
            refreshedKeys.has(stock.marketKey) && Boolean(quotesByTicker[stock.ticker]),
        ).length
      : Object.keys(quotesByTicker).length,
    retainedStockCount: plan.stocks.filter(
      (stock) =>
        retainedKeys.has(stock.marketKey) && Boolean(quotesByTicker[stock.ticker]),
    ).length,
    requestedStockCount: plan.stocks.length,
    refreshedFx: refreshedKeys.has(USD_THB_MARKET_KEY),
    retainedFx: retainedKeys.has(USD_THB_MARKET_KEY),
    cooldownActive: response.cooldownActive === true,
  };
}

export function applyLiveMarketState(
  snapshot: DashboardSnapshot,
  auditScenario: Scenario,
  state: LiveMarketState,
): Scenario {
  const prices = { ...auditScenario.prices };
  for (const holding of uniqueHoldings(snapshot)) {
    const quote = state.quotesByTicker[holding.ticker];
    if (quote && positiveFinite(quote.price)) {
      prices[holding.ticker] = quote.price;
    }
  }

  return {
    ...auditScenario,
    prices,
    fx: state.fx ?? auditScenario.fx,
  };
}
