import {
  isSafeYahooSymbol,
  parseYahooChartQuote,
  parseYahooSearch,
  type MarketQuote,
} from "./market-data";
import type { MarketQuotePersistenceRepository } from "./portfolio-repository";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type CachedPayload = {
  expiresAt: number;
  body: Record<string, unknown>;
};

type YahooFailure = {
  error: string;
  manualFallback: true;
  status: number;
};

type YahooReadResult =
  | { payload: unknown }
  | { failure: YahooFailure };

type YahooQuoteResult =
  | { quote: MarketQuote }
  | { failure: YahooFailure };

type PublicQuoteParser = "google" | "set";

type PublicMarketQuoteConfig = {
  symbol: string;
  currency: "THB" | "USD";
  exchange: string;
  provider: "Google Finance" | "SET public quote";
  url: string;
  title: string;
  parser: PublicQuoteParser;
  googlePageTitles?: string[];
};

const PUBLIC_MARKET_QUOTES = {
  GOOGL: {
    symbol: "GOOGL",
    currency: "USD",
    exchange: "NASDAQ",
    provider: "Google Finance",
    url: "https://www.google.com/finance/quote/GOOGL:NASDAQ?hl=en",
    title: "Google Finance · GOOGL (NASDAQ)",
    parser: "google",
    googlePageTitles: ["GOOGL:NASDAQ"],
  },
  USDTHB: {
    symbol: "USDTHB",
    currency: "THB",
    exchange: "FX",
    provider: "Google Finance",
    url: "https://www.google.com/finance/quote/USD-THB?hl=en",
    title: "Google Finance · USD/THB",
    parser: "google",
    googlePageTitles: ["USD / THB", "USD-THB"],
  },
  SCB: {
    symbol: "SCB",
    currency: "THB",
    exchange: "SET",
    provider: "SET public quote",
    url: "https://www.set.or.th/en/market/product/stock/quote/SCB/price",
    title: "SET · SCB",
    parser: "set",
  },
  KBANK: {
    symbol: "KBANK",
    currency: "THB",
    exchange: "SET",
    provider: "SET public quote",
    url: "https://www.set.or.th/en/market/product/stock/quote/KBANK/price",
    title: "SET · KBANK",
    parser: "set",
  },
} as const satisfies Record<string, PublicMarketQuoteConfig>;

type PublicMarketKey = keyof typeof PUBLIC_MARKET_QUOTES;

type MarketRefreshSource = {
  url: string;
  title: string;
};

export type MarketRefreshPayload = {
  quotes: Record<string, MarketQuote>;
  failures: Record<string, string>;
  fetchedAt: string;
  provider?: string;
  sources?: MarketRefreshSource[];
};

const cacheTtlMs = 5 * 60 * 1000;
const responseCache = new Map<string, CachedPayload>();

const json = (
  body: Record<string, unknown>,
  status = 200,
  cacheControl = status === 200 ? "public, max-age=300" : "no-store",
) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": cacheControl,
    },
  });

const cachedPayload = (key: string) => {
  const cached = responseCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return cached.body;
};

const cachedResponse = (key: string) => {
  const body = cachedPayload(key);
  return body ? json(body) : null;
};

const remember = (key: string, body: Record<string, unknown>) => {
  responseCache.set(key, { body, expiresAt: Date.now() + cacheTtlMs });
};

const yahooFailure = (status: number): YahooFailure => {
  if (status === 429) {
    return {
      error: "Yahoo Finance rate limit reached. Enter a manual price or retry later.",
      manualFallback: true,
      status: 429,
    };
  }
  return {
    error: "Yahoo Finance is temporarily unavailable. Enter a manual price or retry later.",
    manualFallback: true,
    status: 502,
  };
};

const readYahooJson = async (
  target: string,
  fetchImplementation: FetchImplementation,
): Promise<YahooReadResult> => {
  try {
    const response = await fetchImplementation(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { failure: yahooFailure(response.status) };
    return { payload: await response.json() };
  } catch {
    return {
      failure: {
        error: "Yahoo Finance could not be reached. Enter a manual price or retry later.",
        manualFallback: true,
        status: 502,
      },
    };
  }
};

const isMarketQuote = (value: unknown): value is MarketQuote => {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<MarketQuote>;
  return (
    typeof quote.symbol === "string" &&
    typeof quote.price === "number" &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    typeof quote.currency === "string" &&
    typeof quote.exchange === "string" &&
    typeof quote.marketState === "string"
  );
};

const parsePositivePrice = (value: string) => {
  const normalized = value.replace(/,/g, "").replace(/[^0-9.]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : undefined;
};

const googleQuoteSegment = (page: string, config: PublicMarketQuoteConfig) => {
  for (const title of config.googlePageTitles ?? []) {
    const offset = page.indexOf(`title="${title}"`);
    if (offset >= 0) return page.slice(offset, offset + 120_000);
  }
  return "";
};

const parseGoogleFinanceQuote = (
  page: string,
  config: PublicMarketQuoteConfig,
  fetchedAt: string,
): MarketQuote | null => {
  const segment = googleQuoteSegment(page, config);
  if (!segment) return null;
  const priceText = segment.match(
    /<div\s+class="N6SYTe"[^>]*>[\s\S]{0,700}?<span[^>]*>\s*([^<]+?)\s*<\/span>/i,
  )?.[1];
  const price = priceText ? parsePositivePrice(priceText) : undefined;
  if (!price) return null;
  return {
    symbol: config.symbol,
    price,
    currency: config.currency,
    exchange: config.exchange,
    marketState: "DELAYED",
    quoteTimestamp: fetchedAt,
    source: "Google Finance",
    freshness: "delayed",
  };
};

const parseSetPublicQuote = (
  page: string,
  config: PublicMarketQuoteConfig,
  fetchedAt: string,
): MarketQuote | null => {
  const priceText = page.match(
    /<label>\s*Last\s*<\/label>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i,
  )?.[1];
  const price = priceText ? parsePositivePrice(priceText) : undefined;
  if (!price) return null;
  return {
    symbol: config.symbol,
    price,
    currency: config.currency,
    exchange: config.exchange,
    marketState: "DELAYED",
    quoteTimestamp: fetchedAt,
    source: "SET public quote",
    freshness: "delayed",
  };
};

const readPublicMarketQuote = async (
  key: PublicMarketKey,
  config: PublicMarketQuoteConfig,
  fetchImplementation: FetchImplementation,
  fetchedAt: string,
): Promise<{ key: PublicMarketKey; quote?: MarketQuote; failure?: string }> => {
  let response: Response;
  try {
    response = await fetchImplementation(config.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
      },
    });
  } catch {
    return { key, failure: `${config.provider} could not be reached.` };
  }
  if (!response.ok) {
    return { key, failure: `${config.provider} returned HTTP ${response.status}.` };
  }

  let page: string;
  try {
    page = await response.text();
  } catch {
    return { key, failure: `${config.provider} returned unreadable data.` };
  }

  const quote =
    config.parser === "google"
      ? parseGoogleFinanceQuote(page, config, fetchedAt)
      : parseSetPublicQuote(page, config, fetchedAt);
  return quote
    ? { key, quote }
    : { key, failure: `${config.provider} did not return a valid ${config.symbol} quote.` };
};

const refreshMarketQuotes = async (
  fetchImplementation: FetchImplementation,
): Promise<MarketRefreshPayload> => {
  const fetchedAt = new Date().toISOString();
  const entries = Object.entries(PUBLIC_MARKET_QUOTES) as Array<
    [PublicMarketKey, PublicMarketQuoteConfig]
  >;
  const results = await Promise.all(
    entries.map(([key, config]) =>
      readPublicMarketQuote(key, config, fetchImplementation, fetchedAt),
    ),
  );
  const quotes: Record<string, MarketQuote> = {};
  const failures: Record<string, string> = {};
  for (const result of results) {
    if (result.quote) quotes[result.key] = result.quote;
    else if (result.failure) failures[result.key] = result.failure;
  }

  return {
    quotes,
    failures,
    fetchedAt,
    provider: "Google Finance + SET public quotes",
    sources: entries.map(([, config]) => ({ url: config.url, title: config.title })),
  };
};

const fetchYahooQuote = async (
  symbol: string,
  fetchImplementation: FetchImplementation,
  bypassCache = false,
): Promise<YahooQuoteResult> => {
  const cacheKey = `quote:${symbol.toUpperCase()}`;
  const cached = bypassCache ? null : cachedPayload(cacheKey)?.quote;
  if (isMarketQuote(cached)) return { quote: cached };

  const target = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  target.searchParams.set("range", "1d");
  target.searchParams.set("interval", "1m");
  target.searchParams.set("includePrePost", "false");

  const result = await readYahooJson(target.toString(), fetchImplementation);
  if ("failure" in result) return result;

  const quote = parseYahooChartQuote(result.payload);
  if (!quote) {
    return {
      failure: {
        error: "Yahoo Finance did not return a usable current quote. Enter a manual price.",
        manualFallback: true,
        status: 404,
      },
    };
  }

  remember(cacheKey, { quote });
  return { quote };
};

const parseBatchSymbols = (rawSymbols: string | null) => {
  if (!rawSymbols) return null;
  const symbols = Array.from(
    new Set(
      rawSymbols
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (
    symbols.length === 0 ||
    symbols.length > 12 ||
    symbols.some((symbol) => !isSafeYahooSymbol(symbol))
  ) {
    return null;
  }
  return symbols;
};

export async function handleMarketApiRequest(
  request: Request,
  fetchImplementation: FetchImplementation = fetch,
  persistence?: MarketQuotePersistenceRepository,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isSearch = url.pathname === "/api/market/search";
  const isQuote = url.pathname === "/api/market/quote";
  const isBatchQuote = url.pathname === "/api/market/quotes";
  const isMarketRefresh = url.pathname === "/api/market/refresh";
  if (!isSearch && !isQuote && !isBatchQuote && !isMarketRefresh) return null;

  if (isMarketRefresh) {
    const refreshed = await refreshMarketQuotes(fetchImplementation);
    if (!persistence) {
      return json(refreshed, 200, "no-store");
    }
    try {
      return json(
        await persistence.persistMarketRefresh(refreshed),
        200,
        "no-store",
      );
    } catch {
      return json(
        { error: "Market prices were found but could not be saved to the shared database." },
        503,
        "no-store",
      );
    }
  }

  if (isSearch) {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 80) {
      return json({ error: "Enter a company name or ticker up to 80 characters." }, 400);
    }

    const cacheKey = `search:${query.toUpperCase()}`;
    const cached = cachedResponse(cacheKey);
    if (cached) return cached;

    const target = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    target.searchParams.set("q", query);
    target.searchParams.set("quotesCount", "8");
    target.searchParams.set("newsCount", "0");

    const result = await readYahooJson(target.toString(), fetchImplementation);
    if ("failure" in result) {
      return json(result.failure, result.failure.status);
    }

    const body = { candidates: parseYahooSearch(result.payload) };
    remember(cacheKey, body);
    return json(body);
  }

  if (isBatchQuote) {
    const symbols = parseBatchSymbols(url.searchParams.get("symbols"));
    if (!symbols) {
      return json(
        { error: "Enter 1 to 12 valid comma-separated Yahoo Finance symbols." },
        400,
      );
    }

    const results = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        result: await fetchYahooQuote(symbol, fetchImplementation, true),
      })),
    );
    const quotes: Record<string, MarketQuote> = {};
    const failures: Record<string, string> = {};
    for (const { symbol, result } of results) {
      if ("quote" in result) {
        quotes[symbol] = result.quote;
      } else {
        failures[symbol] = result.failure.error;
      }
    }

    return json(
      {
        quotes,
        failures,
        fetchedAt: new Date().toISOString(),
      },
      200,
      "no-store",
    );
  }

  const symbol = url.searchParams.get("symbol")?.trim() ?? "";
  if (!isSafeYahooSymbol(symbol)) {
    return json({ error: "Enter a valid Yahoo Finance symbol." }, 400);
  }

  const result = await fetchYahooQuote(symbol, fetchImplementation);
  if ("failure" in result) {
    return json(result.failure, result.failure.status);
  }
  return json({ quote: result.quote });
}
